"""Build a curated real field: select wavelength-matched epochs, align, difference, publish.

Selection is driven by verified archive coverage: every exposure whose footprint contains the
target is ranked by its predicted LVF wavelength at the target, the densest +/-0.25% window
containing both DR1 and QR3 epochs is kept, and epochs are spread evenly over the baseline.
Each downloaded cutout's exact wavelength (spectral WCS) must stay within 0.4% of the window.
"""

from __future__ import annotations

import datetime as dt
import itertools
import json
import logging
from pathlib import Path

import numpy as np
from astropy.io import fits

from parallax_science import __version__
from parallax_science.align import grid_wcs, resample
from parallax_science.cache import cache_key, file_sha256
from parallax_science.config import Settings
from parallax_science.difference import Frame, Params, light_curve, run
from parallax_science.display import asinh_stretch, write_png_gray
from parallax_science.irsa import (
    RELEASES,
    SpherexExposure,
    cutout_url,
    fetch_cutout,
    predicted_detector_xy,
    search,
)
from parallax_science.models import (
    SCHEMA_VERSION,
    Assets,
    Candidate,
    Dataset,
    Difference,
    Epoch,
    GeneratedBy,
    Image,
    LightCurvePoint,
    Manifest,
    Measurement,
    Observation,
    Provenance,
    Quality,
    Spectral,
    Target,
    Template,
)
from parallax_science.spherex import pipeline_version, read_cutout, table_wavelength, wave_table
from parallax_science.validation import assess_compatibility

log = logging.getLogger("parallax.field")

SCALE_ARCSEC = 6.15  # SPHEREx native pixel scale (ObsCore s_pixel_scale)
GRID_PX = 147  # 15 arcmin, odd so the target sits on a pixel center
WINDOW = 0.0025
ACCEPT = 0.004
MAX_CANDIDATES = 40
SIG_RANGE = 10.0
SPHEREX_ACK = (
    "This publication makes use of data products from the Spectro-Photometer for the History "
    "of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint "
    "project of the Jet Propulsion Laboratory and the California Institute of Technology, and "
    "is funded by the National Aeronautics and Space Administration. This research has made "
    "use of the NASA/IPAC Infrared Science Archive, which is funded by the National "
    "Aeronautics and Space Administration and operated by the California Institute of "
    "Technology."
)
ALIGNMENT = (
    f"IRSA cutouts resampled (bilinear, SIP-aware astropy WCS) onto a {GRID_PX}x{GRID_PX} "
    f"north-up TAN grid at {SCALE_ARCSEC} arcsec/px centered on the target; hard-flagged "
    "pixels masked, flags OR-combined over the 2x2 source neighbourhood."
)
TEMPLATE_METHOD = (
    "Per-pixel median of background-subtracted epochs (>=3 valid); variance (pi/2)*mean(var)/n. "
    "Shown for reference; each epoch is differenced against the median of the other epochs."
)


def _write(hdul: fits.HDUList, path: Path) -> None:
    # astropy dates CHECKSUM comments by wall clock; a fixed one keeps rebuilds byte-identical
    for hdu in hdul:
        hdu.add_checksum(when="PARALLAX")
    hdul.writeto(path, overwrite=True)


def _usable(e: SpherexExposure, ra: float, dec: float, margin_px: float) -> tuple[float, float]:
    x, y = predicted_detector_xy(e, ra, dec)
    if not (margin_px < x < 2039 - margin_px and margin_px < y < 2039 - margin_px):
        raise ValueError("too close to detector edge")
    return x, y


def select_window(exps, ra, dec, detector, tables, margin_px):
    """Return (center wavelength, exposures predicted within the window, sorted by time)."""
    rows = []
    for e in exps:
        if e.detector != detector:
            continue
        try:
            x, y = _usable(e, ra, dec, margin_px)
        except ValueError:
            continue
        rows.append((e, table_wavelength(tables[detector], x, y)))
    best = None
    for lc in np.unique(np.round([lam for _, lam in rows], 3)):
        sel = [(e, lam) for e, lam in rows if abs(lam - lc) / lc < WINDOW]
        releases = {RELEASES[e.collection] for e, _ in sel}
        score = (len(releases), len(sel))
        if best is None or score > best[0]:
            best = (score, float(lc), sel)
    if best is None:
        raise RuntimeError("no exposure covers the target away from the detector edges")
    return best[1], sorted((e for e, _ in best[2]), key=lambda e: e.mjd_mid)


def spread(exps: list[SpherexExposure], n: int) -> list[SpherexExposure]:
    """Candidates ordered so the first n are spread evenly in time; the rest are fallbacks."""
    t = np.array([e.mjd_mid for e in exps])
    order: list[int] = []
    for target_t in np.linspace(t.min(), t.max(), n):
        for i in np.argsort(np.abs(t - target_t)):
            if i not in order:
                order.append(int(i))
                break
    order += [i for i in np.argsort(t) if i not in order]
    return [exps[i] for i in order]


def build_field(
    name: str,
    title: str,
    ra: float,
    dec: float,
    detector: int,
    n_epochs: int,
    settings: Settings,
    params: Params | None = None,
) -> Manifest:
    params = params or Params()
    data_dir, cache_dir, limits = settings.data_dir, settings.cache_dir, settings.limits
    size_arcsec = round(GRID_PX * SCALE_ARCSEC * 1.5)  # covers the grid at any rotation
    target = Target(label=title, ra_deg=ra, dec_deg=dec, radius_arcsec=GRID_PX * SCALE_ARCSEC / 2)

    exps = search(target, limits)
    log.info("%d exposures contain the target", len(exps))
    tables = {}
    for d in {detector}:
        probe = next(e for e in exps if e.detector == d)
        tables[d] = wave_table(fetch_cutout(probe, ra, dec, size_arcsec, cache_dir, limits))
    lam0, window = select_window(exps, ra, dec, detector, tables, margin_px=size_arcsec / 6.15)
    log.info("window %.4f um: %d exposures", lam0, len(window))

    wgrid = grid_wcs(ra, dec, GRID_PX, SCALE_ARCSEC)
    shape = (GRID_PX, GRID_PX)
    picked: list[tuple[SpherexExposure, Path, object, tuple]] = []
    budget_mb = 0.0
    for e in spread(window, n_epochs):
        if len(picked) == n_epochs:
            break
        if budget_mb > limits.max_download_mb:
            raise RuntimeError("download budget exhausted before enough epochs were accepted")
        path = fetch_cutout(e, ra, dec, size_arcsec, cache_dir, limits)
        budget_mb += path.stat().st_size / 1e6
        c = read_cutout(path, ra, dec)
        why = None
        if abs(c.wavelength_um - lam0) / lam0 > ACCEPT:
            why = f"wavelength {c.wavelength_um:.4f} um outside window"
        elif c.header.get("L2DQAFLG", "Pass").strip() != "Pass":
            why = "L2 data-quality assessment did not pass"
        aligned = resample(c.wcs, c.image, c.variance, c.flags, wgrid, shape)
        if why is None and np.isnan(aligned[0]).mean() > 0.2:
            why = "more than 20% of the grid masked or uncovered"
        if why:
            log.info("skip %s: %s", e.obs_id, why)
            continue
        picked.append((e, path, c, aligned))
    if len(picked) < 3:
        raise RuntimeError(f"only {len(picked)} usable epochs; need >= 3")
    picked.sort(key=lambda r: r[2].mjd_mid)

    rel = f"processed/{name}"
    out = data_dir / rel
    out.mkdir(parents=True, exist_ok=True)
    frames = [Frame(f"{name}.{e.obs_id}", c.mjd_mid, a[0], a[1], a[2]) for e, _, c, a in picked]
    tmpl, tvar, floor, diffs, loo = run(frames, params)
    bgs = [d.background for d in diffs]
    finite = tmpl[np.isfinite(tmpl)]
    lo, hi = np.percentile(finite, [0.5, 99.5])
    wcs_cards = {k: v for k, v in wgrid.to_header().items() if k not in ("COMMENT", "HISTORY")}

    def png(path: Path, arr: np.ndarray) -> None:
        write_png_gray(path, asinh_stretch(arr, limits=(lo, hi))[::-1])

    observations = []
    for (e, path, c, (img, var, flg)), f, bg in zip(picked, frames, bgs, strict=True):
        suffix = e.obs_id
        hdr = wgrid.to_header()
        hdr["BUNIT"] = "MJy/sr"
        hdr["MJD-AVG"] = (c.mjd_mid, "[d] UTC mid-exposure, from source IMAGE header")
        hdr["DETECTOR"] = c.detector
        hdr["WAVELEN"] = (round(c.wavelength_um, 5), "[um] LVF wavelength at target")
        hdr["SRCURL"] = cutout_url(e.source_url, ra, dec, size_arcsec)
        hdr["COMMENT"] = "Resampled by PARALLAX; see manifest provenance.processing."
        _write(
            fits.HDUList(
                [
                    fits.PrimaryHDU(),
                    fits.ImageHDU(img, header=hdr, name="IMAGE"),
                    fits.ImageHDU(var, header=wgrid.to_header(), name="VARIANCE"),
                    fits.ImageHDU(flg, header=wgrid.to_header(), name="FLAGS"),
                ]
            ),
            out / f"{suffix}.fits",
        )
        png(out / f"{suffix}.png", img - bg)
        version = pipeline_version(e.source_url)
        observations.append(
            Observation(
                observation_id=f.observation_id,
                data_kind="real",
                epoch=Epoch(
                    mjd_mid=c.mjd_mid,
                    time_scale="utc",
                    exposure_s=c.exposure_s,
                    source_keyword="MJD-AVG",
                ),
                spectral=Spectral(
                    detector=c.detector,
                    wavelength_center_um=round(c.wavelength_um, 5),
                    wavelength_min_um=round(c.wavelength_um - c.bandwidth_um / 2, 5),
                    wavelength_max_um=round(c.wavelength_um + c.bandwidth_um / 2, 5),
                    basis="spectral-wcs",
                ),
                image=Image(
                    width_px=GRID_PX,
                    height_px=GRID_PX,
                    pixel_scale_arcsec=SCALE_ARCSEC,
                    units="MJy/sr",
                    wcs=wcs_cards,
                ),
                quality=Quality(
                    flags_available=True,
                    variance_available=True,
                    masked_fraction=round(float(np.isnan(img).mean()), 4),
                    psf_fwhm_arcsec=c.psf_fwhm_arcsec,
                    notes=[f"L2 DQA: {c.header.get('L2DQAFLG', 'n/a').strip()}"],
                ),
                assets=Assets(
                    science_fits=f"{rel}/{suffix}.fits",
                    display_png=f"{rel}/{suffix}.png",
                    display_stretch=f"asinh(template p0.5-p99.5, a=0.1), background {bg:.4g} "
                    "MJy/sr subtracted",
                ),
                provenance=Provenance(
                    source_url=cutout_url(e.source_url, ra, dec, size_arcsec),
                    source_id=e.source_id,
                    retrieved_utc=dt.datetime.fromtimestamp(path.stat().st_mtime, dt.UTC)
                    .replace(microsecond=0)
                    .isoformat(),
                    source_sha256=file_sha256(path),
                    calibration_version=version[0] if version else None,
                    collection=e.collection,
                    data_release=RELEASES[e.collection],
                    processing=ALIGNMENT + (f" Pipeline build {version[1]}." if version else ""),
                    cache_key=cache_key(e.source_id, {"grid": wcs_cards, "size": size_arcsec}),
                ),
            )
        )

    _write(
        fits.HDUList(
            [
                fits.PrimaryHDU(),
                fits.ImageHDU(tmpl.astype(np.float32), header=wgrid.to_header(), name="IMAGE"),
                fits.ImageHDU(tvar.astype(np.float32), header=wgrid.to_header(), name="VARIANCE"),
            ]
        ),
        out / "template.fits",
    )
    png(out / "template.png", tmpl)

    differences, candidates = [], []
    by_id = {o.observation_id: o for o in observations}
    for d in diffs:
        write_png_gray(
            out / f"{d.observation_id.split('.', 1)[1]}.diff.png",
            encode_significance(d.significance),
        )
        differences.append(
            Difference(
                difference_id=f"{d.observation_id}.diff",
                observation_id=d.observation_id,
                status="validated" if d.validated else "visualization_only",
                reasons=d.reasons,
                method="(epoch - background - template) / sqrt(k^2 (var + var_template) + "
                f"({floor} * template)^2); k from faint pixels per epoch, floor from bright pixels",
                background_mjysr=round(d.background, 6),
                noise_scale=round(d.noise_scale, 4),
                error_floor_fraction=floor,
                threshold_sigma=params.threshold_sigma,
                display_png=f"{rel}/{d.observation_id.split('.', 1)[1]}.diff.png",
                display_range_sigma=SIG_RANGE,
            )
        )
    dets = sorted((x for d in diffs for x in d.detections), key=lambda x: -abs(x.peak_sigma))
    for k, det in enumerate(dets[:MAX_CANDIDATES], start=1):
        sky = wgrid.pixel_to_world_values(det.x, det.y)
        obs = by_id[det.observation_id]
        lc = light_curve(frames, diffs, loo, floor, det.x, det.y, params)
        hits = sum(1 for *_, v, s in lc if v is not None and abs(v) > 5 * s)
        if hits <= 1:
            det.evidence.append(
                "only this epoch deviates by more than 5 sigma: cosmic rays, unflagged detector "
                "events and moving objects all look like this, so a second detection is needed"
            )
        else:
            det.evidence.append(f"{hits} of {len(lc)} epochs deviate by more than 5 sigma")
        candidates.append(
            Candidate(
                candidate_id=f"{name}-c{k:03d}",
                status=det.status,
                kind=det.kind,
                observation_ids=[det.observation_id],
                ra_deg=round(float(sky[0]) % 360, 6),
                dec_deg=round(float(sky[1]), 6),
                pixel_x=round(det.x, 2),
                pixel_y=round(det.y, 2),
                measurements=[
                    Measurement(
                        name="peak significance",
                        value=round(det.peak_sigma, 2),
                        uncertainty=None,
                        unit="sigma",
                    ),
                    Measurement(
                        name="aperture flux change",
                        value=round(det.delta_ujy, 1),
                        uncertainty=round(det.delta_err_ujy, 1),
                        unit="uJy",
                    ),
                    Measurement(
                        name="reference flux",
                        value=round(det.template_ujy, 1),
                        uncertainty=round(det.template_err_ujy, 1),
                        unit="uJy",
                    ),
                    Measurement(
                        name="wavelength",
                        value=obs.spectral.wavelength_center_um,
                        uncertainty=None,
                        unit="um",
                    ),
                    Measurement(
                        name="area above 3 sigma", value=det.area_px, uncertainty=None, unit="px"
                    ),
                ],
                light_curve=[
                    LightCurvePoint(
                        observation_id=oid,
                        mjd_mid=round(mjd, 6),
                        delta_flux_ujy=None if v is None else round(v, 1),
                        uncertainty_ujy=None if s is None else round(s, 1),
                    )
                    for oid, mjd, v, s in lc
                ],
                evidence=det.evidence,
                caveats=det.caveats,
                method=f"template difference, |S| >= {params.threshold_sigma} peak, grown to "
                f"{params.grow_sigma} sigma, r={params.aperture_radius_px} px aperture",
            )
        )
    if len(dets) > MAX_CANDIDATES:
        log.info("kept the %d most significant of %d detections", MAX_CANDIDATES, len(dets))

    tol = settings.tolerances
    releases = sorted({RELEASES[e.collection] for e, *_ in picked})
    return Manifest(
        schema_version=SCHEMA_VERSION,
        manifest_id=name,
        data_kind="real",
        title=title,
        notice=None,
        target=target,
        dataset=Dataset(
            mission="SPHEREx",
            archive="NASA/IPAC Infrared Science Archive (IRSA)",
            collection=", ".join(sorted({e.collection for e, *_ in picked})),
            data_release=" + ".join(releases),
            citation="SPHEREx Level 2 Spectral Images, NASA/IPAC Infrared Science Archive.",
            acknowledgement=SPHEREX_ACK,
        ),
        observations=observations,
        comparisons=[
            assess_compatibility(a, b, tol) for a, b in itertools.combinations(observations, 2)
        ],
        alignment=ALIGNMENT,
        template=Template(
            observation_ids=[o.observation_id for o in observations],
            method=TEMPLATE_METHOD,
            display_png=f"{rel}/template.png",
            science_fits=f"{rel}/template.fits",
        ),
        differences=differences,
        candidates=candidates,
        generated_by=GeneratedBy(
            tool="parallax-science",
            version=__version__,
            command=f"parallax build-field {name} --ra {ra} --dec {dec} --detector {detector} "
            f"--epochs {n_epochs} --title {json.dumps(title)}",
        ),
    )


def encode_significance(s: np.ndarray, r: float = SIG_RANGE) -> np.ndarray:
    """uint8: 0 = masked, 1..255 = significance linearly over [-r, +r] (128 = 0)."""
    v = np.round(128 + np.clip(np.nan_to_num(s), -r, r) / r * 127).astype(np.uint8)
    return np.where(np.isfinite(s), v, 0).astype(np.uint8)[::-1]

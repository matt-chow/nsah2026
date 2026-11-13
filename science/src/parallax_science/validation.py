"""Scientific validation beyond schema structure: WCS, footprints, assets, comparability."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales

from parallax_science.config import CompatibilityTolerances
from parallax_science.models import Comparison, CompatibilityStatus, Manifest, Observation


def load_manifest(path: Path) -> Manifest:
    return Manifest.model_validate(json.loads(path.read_text(encoding="utf-8")))


def celestial_wcs(obs: Observation) -> WCS:
    w = WCS(fits.Header(obs.image.wcs))
    if not w.has_celestial or w.naxis != 2:
        raise ValueError(f"{obs.observation_id}: WCS is not a 2-D celestial WCS")
    return w


def assess_compatibility(
    a: Observation, b: Observation, tol: CompatibilityTolerances
) -> Comparison:
    """Decide whether a and b may be blinked/subtracted pixel-for-pixel.

    Any failed check -> incompatible; any check that cannot be evaluated -> unknown.
    Invalid comparisons are reported as unavailable, never as results.
    """
    failed: list[str] = []
    unknown: list[str] = []

    if a.data_kind != b.data_kind:
        failed.append("mixes real and simulated data")
    if abs(a.epoch.mjd_mid - b.epoch.mjd_mid) < tol.min_epoch_separation_days:
        failed.append("same epoch")
    if a.epoch.time_scale != b.epoch.time_scale:
        failed.append(f"time scales differ ({a.epoch.time_scale} vs {b.epoch.time_scale})")

    sa, sb = a.spectral, b.spectral
    if sa.detector is None or sb.detector is None:
        unknown.append("detector unknown")
    elif sa.detector != sb.detector:
        failed.append(f"different detectors ({sa.detector} vs {sb.detector})")
    offset = abs(sa.wavelength_center_um - sb.wavelength_center_um) / sa.wavelength_center_um
    if offset > tol.max_wavelength_offset_fraction:
        failed.append(
            f"wavelength offset {offset:.2%} exceeds {tol.max_wavelength_offset_fraction:.2%}"
        )

    if a.image.units != b.image.units:
        failed.append(f"units differ ({a.image.units} vs {b.image.units})")
    ratio = a.image.pixel_scale_arcsec / b.image.pixel_scale_arcsec
    if abs(ratio - 1) > tol.max_pixel_scale_ratio_offset:
        failed.append(f"pixel scales differ by {abs(ratio - 1):.2%}")

    ca, cb = a.provenance.calibration_version, b.provenance.calibration_version
    if ca is None or cb is None:
        unknown.append("calibration version unknown")
    elif ca != cb:
        failed.append(f"calibration versions differ ({ca} vs {cb})")

    status: CompatibilityStatus = (
        "incompatible" if failed else ("unknown" if unknown else "compatible")
    )
    return Comparison(
        reference_id=a.observation_id,
        target_id=b.observation_id,
        status=status,
        reasons=failed + unknown,
    )


def validate_manifest(
    manifest: Manifest,
    data_root: Path | None = None,
    tol: CompatibilityTolerances | None = None,
) -> list[str]:
    """Return a list of problems (empty == valid). Schema validity is already guaranteed."""
    tol = tol or CompatibilityTolerances()
    errors: list[str] = []
    target = SkyCoord(manifest.target.ra_deg, manifest.target.dec_deg, unit="deg", frame="icrs")
    by_id = {o.observation_id: o for o in manifest.observations}

    for obs in manifest.observations:
        oid = obs.observation_id
        try:
            w = celestial_wcs(obs)
        except Exception as exc:  # astropy raises several types for bad headers
            errors.append(f"{oid}: invalid WCS: {exc}")
            continue
        scale = float(np.mean(proj_plane_pixel_scales(w))) * 3600.0
        if abs(scale / obs.image.pixel_scale_arcsec - 1) > 0.01:
            errors.append(
                f'{oid}: WCS pixel scale {scale:.3f}" != manifest {obs.image.pixel_scale_arcsec}"'
            )
        x, y = w.world_to_pixel(target)
        if not (-0.5 <= x < obs.image.width_px - 0.5 and -0.5 <= y < obs.image.height_px - 0.5):
            errors.append(f"{oid}: target position falls outside the image footprint")

        if data_root is not None:
            for rel in (obs.assets.display_png, obs.assets.science_fits):
                if rel is not None and not (data_root / rel).is_file():
                    errors.append(f"{oid}: missing asset {rel}")
            if obs.assets.science_fits and (data_root / obs.assets.science_fits).is_file():
                with fits.open(data_root / obs.assets.science_fits, memmap=True) as hdul:
                    shape = hdul["IMAGE"].shape
                if shape != (obs.image.height_px, obs.image.width_px):
                    errors.append(f"{oid}: FITS IMAGE shape {shape} != manifest dimensions")

    for c in manifest.comparisons:
        # Stored statuses are re-derived so a hand-edited manifest cannot claim compatibility.
        expected = assess_compatibility(by_id[c.reference_id], by_id[c.target_id], tol)
        if c.status != expected.status:
            errors.append(
                f"comparison {c.reference_id}/{c.target_id} status {c.status!r} "
                f"but checks give {expected.status!r}: {expected.reasons}"
            )
    return errors

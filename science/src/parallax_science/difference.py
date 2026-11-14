"""Template-difference engine: background, significance, candidates, and their evidence.

Each aligned epoch is compared with the median of all epochs (a moving source or a transient
is rejected by the median; a persistent source is not). The noise model is calibrated on the
data: a per-epoch variance scale from faint pixels, then one fractional error floor (PSF and
registration mismatch at bright sources) chosen so bright pixels also have unit robust scatter.
See docs/SCIENCE.md for the full method.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from parallax_science.spherex import CAUTION_FLAGS, CAUTION_MASK

SOURCE_BIT = 21
PIXEL_SR = (6.15 / 206264.806) ** 2  # SPHEREx pixel solid angle, sr
MJYSR_TO_UJY = PIXEL_SR * 1e12  # MJy/sr per pixel -> microjansky


@dataclass(frozen=True)
class Params:
    threshold_sigma: float = 5.0
    grow_sigma: float = 3.0
    min_area_px: int = 1  # SPHEREx PSF FWHM ~1.2 px: real point sources can be one pixel
    faint_snr: float = 3.0  # template S/N below which pixels calibrate the variance scale
    bright_snr: float = 20.0  # template S/N above which pixels calibrate the error floor
    max_error_floor: float = 1.0
    aperture_radius_px: float = 1.5
    aperture_snr_min: float = 3.0  # integrated change needed to keep a peak-pixel hit
    edge_px: int = 3
    dipole_radius_px: float = 3.0
    template_snr_source: float = 5.0
    min_template_epochs: int = 3
    noise_scale_range: tuple[float, float] = (0.3, 3.0)
    min_valid_fraction: float = 0.6


@dataclass
class Frame:
    observation_id: str
    mjd: float
    image: np.ndarray
    variance: np.ndarray
    flags: np.ndarray


@dataclass
class Detection:
    observation_id: str
    sign: int
    x: float
    y: float
    peak_sigma: float
    area_px: int
    delta_ujy: float
    delta_err_ujy: float
    template_ujy: float
    template_err_ujy: float
    caution: list[str]
    near_edge: bool
    kind: str = ""
    status: str = ""
    evidence: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)


@dataclass
class EpochDifference:
    observation_id: str
    significance: np.ndarray
    background: float
    noise_scale: float
    valid_fraction: float
    reasons: list[str]
    detections: list[Detection]

    @property
    def validated(self) -> bool:
        return not self.reasons


def background(image: np.ndarray, flags: np.ndarray) -> float:
    """3-sigma-clipped median of finite pixels that are not on known sources or flagged."""
    sel = np.isfinite(image) & ((flags & ((1 << SOURCE_BIT) | CAUTION_MASK)) == 0)
    v = image[sel] if sel.sum() > 50 else image[np.isfinite(image)]
    if v.size == 0:
        return float("nan")
    for _ in range(5):
        med = np.median(v)
        mad = 1.4826 * np.median(np.abs(v - med))
        if mad == 0:
            break
        v = v[np.abs(v - med) < 3 * mad]
    return float(np.median(v))


def _median(stack: np.ndarray, var: np.ndarray, p: Params) -> tuple[np.ndarray, np.ndarray]:
    n = np.isfinite(stack).sum(axis=0)
    ok = n >= p.min_template_epochs
    with np.errstate(invalid="ignore", divide="ignore"):
        med = np.nanmedian(np.where(ok, stack, np.nan), axis=0)
        # Variance of a median of n Gaussian samples ~ (pi/2) * sigma^2 / n.
        tvar = (np.pi / 2) * np.nanmean(np.where(np.isfinite(stack), var, np.nan), axis=0) / n
    return np.where(ok, med, np.nan), np.where(ok, tvar, np.nan)


def template(frames: list[Frame], p: Params):
    """Median of all epochs (for display), plus each epoch's leave-one-out median.

    Differencing against a template that excludes the epoch keeps residual noise independent
    and Gaussian, and keeps a transient from leaking into its own reference.
    """
    bgs = [background(f.image, f.flags) for f in frames]
    stack = np.stack([f.image - b for f, b in zip(frames, bgs, strict=True)])
    var = np.stack([f.variance for f in frames])
    keep = np.ones(len(frames), bool)
    loo = []
    for i in range(len(frames)):
        keep[i] = False
        loo.append(_median(stack[keep], var[keep], p))
        keep[i] = True
    return *_median(stack, var, p), bgs, loo


def _robust_sigma(v: np.ndarray) -> float:
    v = v[np.isfinite(v)]
    return float(1.4826 * np.median(np.abs(v - np.median(v)))) if v.size else float("nan")


def _aperture(arr: np.ndarray, x: float, y: float, r: float) -> np.ndarray:
    yy, xx = np.ogrid[: arr.shape[0], : arr.shape[1]]
    return (xx - x) ** 2 + (yy - y) ** 2 <= r * r


def calibrate(
    frames: list[Frame], bgs: list[float], tmpl: np.ndarray, tvar: np.ndarray, loo, p: Params
) -> tuple[list[float], float]:
    """Per-epoch variance scale from faint pixels, and one pooled error floor from bright ones."""
    with np.errstate(invalid="ignore", divide="ignore"):
        snr = tmpl / np.sqrt(tvar)
    faint, bright = snr < p.faint_snr, snr > p.bright_snr
    resids = [f.image - bg - t for f, bg, (t, _) in zip(frames, bgs, loo, strict=True)]
    rvars = [f.variance + tv for f, (_, tv) in zip(frames, loo, strict=True)]
    scales = []
    for r, rv in zip(resids, rvars, strict=True):
        with np.errstate(invalid="ignore", divide="ignore"):
            scales.append(_robust_sigma((r / np.sqrt(rv))[faint]))
    if bright.sum() < 20 or not np.isfinite(scales).all():
        return scales, 0.0
    r = np.concatenate([r[bright] for r in resids])
    v = np.concatenate([k**2 * rv[bright] for rv, k in zip(rvars, scales, strict=True)])
    t = np.tile(tmpl[bright], len(frames))
    for floor in np.arange(0.0, p.max_error_floor, 0.01):
        with np.errstate(invalid="ignore", divide="ignore"):
            if _robust_sigma(r / np.sqrt(v + (floor * t) ** 2)) <= 1.0:
                return scales, round(float(floor), 2)
    return scales, p.max_error_floor


def difference(
    frame: Frame,
    bg: float,
    tmpl: np.ndarray,
    tvar: np.ndarray,
    scale: float,
    floor: float,
    p: Params,
) -> EpochDifference:
    """Significance of (epoch - background - template), with tmpl excluding this epoch."""
    resid = frame.image - bg - tmpl
    total_var = scale**2 * (frame.variance + tvar) + (floor * np.clip(tmpl, 0, None)) ** 2
    with np.errstate(invalid="ignore", divide="ignore"):
        s = resid / np.sqrt(total_var)
    valid_fraction = float(np.isfinite(s).mean())

    reasons = []
    lo, hi = p.noise_scale_range
    if not lo <= scale <= hi:  # NaN fails too
        reasons.append(f"empirical noise scale {scale:.2f} outside [{lo}, {hi}]")
    if valid_fraction < p.min_valid_fraction:
        reasons.append(f"only {valid_fraction:.0%} of pixels usable")

    detections = [] if reasons else _detect(frame, s, resid, total_var, tmpl, tvar, p)
    return EpochDifference(
        frame.observation_id, s.astype(np.float32), bg, scale, valid_fraction, reasons, detections
    )


def _detect(frame, s, resid, var, tmpl, tvar, p: Params) -> list[Detection]:
    out = []
    h, w = s.shape
    filled = np.nan_to_num(s, nan=0.0)
    for sign in (1, -1):
        labels, n = ndimage.label(sign * filled >= p.grow_sigma, structure=np.ones((3, 3)))
        for i in range(1, n + 1):
            comp = labels == i
            peak = float((sign * filled)[comp].max())
            area = int(comp.sum())
            if peak < p.threshold_sigma or area < p.min_area_px:
                continue
            wts = np.abs(filled) * comp
            y, x = (float(c) for c in ndimage.center_of_mass(wts))
            ap = _aperture(s, x, y, p.aperture_radius_px)
            fin = ap & np.isfinite(resid)
            tfin = ap & np.isfinite(tmpl)
            bits = int(np.bitwise_or.reduce(frame.flags[comp | ap]))
            out.append(
                Detection(
                    observation_id=frame.observation_id,
                    sign=sign,
                    x=x,
                    y=y,
                    peak_sigma=sign * peak,
                    area_px=area,
                    delta_ujy=float(resid[fin].sum() * MJYSR_TO_UJY),
                    delta_err_ujy=float(np.sqrt(var[fin].sum()) * MJYSR_TO_UJY),
                    template_ujy=float(tmpl[tfin].sum() * MJYSR_TO_UJY),
                    template_err_ujy=float(np.sqrt(tvar[tfin].sum()) * MJYSR_TO_UJY),
                    caution=[n for n, b in CAUTION_FLAGS.items() if bits & (1 << b)],
                    near_edge=min(x, y, w - 1 - x, h - 1 - y) < p.edge_px,
                )
            )
    return out


def classify(d: Detection, same_epoch: list[Detection], p: Params) -> None:
    """Heuristic triage. Labels say what a residual resembles; they identify nothing."""
    t_snr = d.template_ujy / d.template_err_ujy if d.template_err_ujy > 0 else 0.0
    has_source = t_snr >= p.template_snr_source
    partner = [
        o
        for o in same_epoch
        if o.sign != d.sign and np.hypot(o.x - d.x, o.y - d.y) <= p.dipole_radius_px
    ]
    d.evidence.append(
        f"peak {d.peak_sigma:+.1f} sigma over {d.area_px} px; aperture change "
        f"{d.delta_ujy:+.0f} +/- {d.delta_err_ujy:.0f} uJy"
    )
    d.evidence.append(
        f"reference flux at this position {d.template_ujy:.0f} +/- {d.template_err_ujy:.0f} uJy "
        f"(S/N {t_snr:.1f})"
    )
    if d.caution or d.near_edge:
        d.kind, d.status = "artifact_like", "likely_artifact"
        if d.caution:
            d.evidence.append("touches pixels flagged " + ", ".join(d.caution))
        if d.near_edge:
            d.evidence.append(f"within {p.edge_px} px of the grid edge")
    elif abs(d.delta_ujy) < p.aperture_snr_min * d.delta_err_ujy:
        d.kind, d.status = "artifact_like", "likely_artifact"
        d.evidence.append(
            f"aperture change below {p.aperture_snr_min:g} sigma although the peak pixel is "
            "significant: typical of an undersampled PSF shifting between pixels"
        )
    elif partner:
        d.kind = "dipole_like"
        d.status = "likely_artifact" if has_source else "needs_followup"
        d.evidence.append(
            "opposite-sign residual within "
            f"{p.dipole_radius_px:g} px: a shifted source, PSF mismatch, or motion"
        )
    elif has_source:
        d.kind, d.status = "variable_like", "needs_followup"
        d.evidence.append(
            f"{'brighter' if d.sign > 0 else 'fainter'} than the reference at a persistent source"
        )
    elif d.sign > 0:
        d.kind, d.status = "new_source_like", "needs_followup"
        d.evidence.append("no significant reference source: transient, moving object, or artifact")
    else:
        d.kind, d.status = "artifact_like", "likely_artifact"
        d.evidence.append("negative residual where the reference shows no source")
    d.caveats.extend(
        [
            "Single-detector, single-wavelength comparison; no PSF matching.",
            "Not cross-matched against catalogs in this build.",
        ]
    )


def light_curve(
    frames: list[Frame],
    diffs: list[EpochDifference],
    loo,
    floor: float,
    x: float,
    y: float,
    p: Params,
) -> list[tuple[str, float, float | None, float | None]]:
    """Aperture residual (uJy) at (x, y) in every epoch; None where pixels are masked."""
    ap = _aperture(frames[0].image, x, y, p.aperture_radius_px)
    rows = []
    for f, d, (t, tv) in zip(frames, diffs, loo, strict=True):
        resid = (f.image - d.background - t)[ap]
        var = d.noise_scale**2 * (f.variance + tv)[ap] + (floor * np.clip(t[ap], 0, None)) ** 2
        if not np.isfinite(resid).all():
            rows.append((f.observation_id, f.mjd, None, None))
        else:
            rows.append(
                (
                    f.observation_id,
                    f.mjd,
                    float(resid.sum() * MJYSR_TO_UJY),
                    float(np.sqrt(var.sum()) * MJYSR_TO_UJY),
                )
            )
    return rows


def run(frames: list[Frame], p: Params | None = None):
    """Template + per-epoch differences + classified detections."""
    p = p or Params()
    tmpl, tvar, bgs, loo = template(frames, p)
    scales, floor = calibrate(frames, bgs, tmpl, tvar, loo, p)
    diffs = [
        difference(f, bg, t, tv, k, floor, p)
        for f, bg, (t, tv), k in zip(frames, bgs, loo, scales, strict=True)
    ]
    for d in diffs:
        for det in d.detections:
            classify(det, d.detections, p)
    return tmpl, tvar, floor, diffs, loo

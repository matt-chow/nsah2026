"""Reading SPHEREx L2 cutouts: science planes, flags, timing and the LVF wavelength at a pixel.

Flag bits are from the FLAGS HDU's MSKN/MSKD cards (SPHEREx Explanatory Supplement, Table 10).
"""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

# Pixels with these bits carry no usable signal.
HARD_FLAGS = {
    "OVERFLOW": 1,
    "SUR_ERROR": 2,
    "NONFUNC": 6,
    "DICHROIC": 7,
    "MISSING_DATA": 9,
    "HOT": 10,
    "COLD": 11,
    "NONLINEAR": 15,
}
# Usable, but a residual touching them is more likely an artifact than a sky change.
CAUTION_FLAGS = {
    "TRANSIENT": 0,
    "PERSIST": 17,
    "OUTLIER": 19,
    "CROSSTALK": 20,
    "GHOST": 22,
    "GHOST_FPA": 23,
    "GHOST_EXT": 24,
    "STREAK": 25,
    "BLOOM": 26,
    "SNOWBALL": 27,
    "HALO": 28,
}
HARD_MASK = sum(1 << b for b in HARD_FLAGS.values())
CAUTION_MASK = sum(1 << b for b in CAUTION_FLAGS.values())
PIPELINE_RE = re.compile(r"_spx_(l2b-v\d+)-(\d{4}-\d{3})\.fits$")


@dataclass(frozen=True)
class Cutout:
    image: np.ndarray  # float32 MJy/sr
    variance: np.ndarray  # float32 (MJy/sr)^2
    flags: np.ndarray  # int32 bit field
    header: fits.Header  # IMAGE header (celestial WCS, timing)
    wcs: WCS
    detector: int
    mjd_mid: float
    exposure_s: float
    wavelength_um: float  # at the requested position
    bandwidth_um: float
    psf_fwhm_arcsec: float | None


def _quiet_wcs(header: fits.Header, **kw) -> WCS:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        return WCS(header, **kw)


def pipeline_version(source_url: str) -> tuple[str, str] | None:
    """('l2b-v27', '2026-224') from an IRSA L2 file name, if it follows the convention."""
    m = PIPELINE_RE.search(source_url)
    return (m.group(1), m.group(2)) if m else None


def wavelength_at(hdul: fits.HDUList, x: float, y: float) -> tuple[float, float]:
    """Central wavelength and bandwidth (um) at 0-based cutout pixel (x, y), via the 'W' WCS."""
    h = hdul["IMAGE"].header.copy()
    # The 'W' lookup-table WCS has no distortion; drop SIP so astropy doesn't apply it.
    for k in [k for k in h if re.match(r"^(A|B|AP|BP)_(\d+_\d+|ORDER)$", k)]:
        del h[k]
    w = _quiet_wcs(h, fobj=hdul, key="W")
    lam, bw = w.pixel_to_world_values(x, y)
    return float(lam), float(bw)


def read_cutout(path: Path, ra: float, dec: float) -> Cutout:
    with fits.open(path, memmap=False) as hdul:
        h = hdul["IMAGE"].header
        wcs = _quiet_wcs(h)
        x, y = wcs.world_to_pixel_values(ra, dec)
        lam, bw = wavelength_at(hdul, float(x), float(y))
        if h.get("TIMESYS", "UTC").upper() != "UTC":
            raise ValueError(f"{path.name}: unexpected TIMESYS {h.get('TIMESYS')}")
        return Cutout(
            image=np.asarray(hdul["IMAGE"].data, dtype=np.float32),
            variance=np.asarray(hdul["VARIANCE"].data, dtype=np.float32),
            flags=np.asarray(hdul["FLAGS"].data, dtype=np.int32),
            header=h.copy(),
            wcs=wcs,
            detector=int(h["DETECTOR"]),
            mjd_mid=float(h["MJD-AVG"]),
            exposure_s=float(h["XPOSURE"]),
            wavelength_um=lam,
            bandwidth_um=bw,
            psf_fwhm_arcsec=float(h["PSF_FWHM"]) if "PSF_FWHM" in h else None,
        )


def wave_table(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(x_ctrl, y_ctrl, wavelength[y, x]) for a detector, in 1-based raw pixels."""
    with fits.open(path, memmap=False) as hdul:
        t = hdul["WCS-WAVE"].data
        return np.array(t["X"][0]), np.array(t["Y"][0]), np.array(t["VALUES"][0][..., 0])


def table_wavelength(table, x0: float, y0: float) -> float:
    """Bilinear lookup in a wave_table at 0-based raw detector pixel (x0, y0)."""
    from scipy.interpolate import RegularGridInterpolator

    xs, ys, v = table
    f = RegularGridInterpolator((ys, xs), v, bounds_error=False, fill_value=None)
    return float(f([[y0 + 1, x0 + 1]])[0])

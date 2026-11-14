"""WCS-aware resampling of cutouts onto one shared north-up tangent-plane grid."""

from __future__ import annotations

import numpy as np
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from parallax_science.spherex import HARD_MASK

OFF_IMAGE_BIT = 9  # reuse MISSING_DATA for grid pixels the cutout does not cover


def grid_wcs(ra: float, dec: float, size_px: int, scale_arcsec: float) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(size_px + 1) / 2, (size_px + 1) / 2]  # target on the central pixel
    w.wcs.cdelt = [-scale_arcsec / 3600.0, scale_arcsec / 3600.0]
    w.wcs.cunit = ["deg", "deg"]
    w.wcs.radesys = "ICRS"
    return w


def resample(
    src_wcs: WCS,
    image: np.ndarray,
    variance: np.ndarray,
    flags: np.ndarray,
    dst_wcs: WCS,
    shape: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Bilinear image/variance, OR-combined flags. Hard-flagged pixels become NaN.

    Variance is interpolated with the same bilinear weights rather than their squares, which
    overestimates it (conservative); the empirical noise rescale in `difference` absorbs it.
    shortcut: no flux-conserving drizzle; fine while source and grid scales match (6.15").
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    ra, dec = dst_wcs.pixel_to_world_values(xx, yy)
    sx, sy = src_wcs.world_to_pixel_values(ra, dec)

    bad = (flags & HARD_MASK) != 0
    img = np.where(bad, np.nan, image).astype(np.float64)
    var = np.where(bad, np.nan, variance).astype(np.float64)
    coords = np.array([sy, sx])
    out_img = map_coordinates(img, coords, order=1, mode="constant", cval=np.nan)
    out_var = map_coordinates(var, coords, order=1, mode="constant", cval=np.nan)

    x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
    out_flags = np.zeros(shape, dtype=np.int32)
    sh, sw = flags.shape
    for dy in (0, 1):
        for dx in (0, 1):
            xi, yi = x0 + dx, y0 + dy
            inside = (xi >= 0) & (xi < sw) & (yi >= 0) & (yi < sh)
            out_flags |= np.where(
                inside, flags[np.clip(yi, 0, sh - 1), np.clip(xi, 0, sw - 1)], 1 << OFF_IMAGE_BIT
            )
    return out_img.astype(np.float32), out_var.astype(np.float32), out_flags

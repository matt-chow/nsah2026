"""IRSA SPHEREx adapter: SIA2 metadata search and bounded FITS cutouts (stdlib HTTP only).

IRSA throttles with a plain-text "Server busy" body, so every download is validated as FITS
and retried with backoff. Cutouts are cached by a deterministic key and never re-fetched.
"""

from __future__ import annotations

import csv
import io
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from parallax_science.archive import ArchiveRecord, check_cutout_size
from parallax_science.cache import cache_key, cache_path
from parallax_science.config import RequestLimits
from parallax_science.models import Target

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
COLLECTIONS = ("spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep")
RELEASES = {
    "spherex_dr1": "DR1",
    "spherex_dr1_deep": "DR1",
    "spherex_qr3": "QR3",
    "spherex_qr3_deep": "QR3",
}
USER_AGENT = "parallax-science/0.1 (NASA Space Apps 2026; bounded cutouts)"
DETECTOR_PX = 2040


@dataclass(frozen=True)
class SpherexExposure(ArchiveRecord):
    obs_id: str
    t_min: float
    t_max: float
    exptime_s: float
    corners: tuple[tuple[float, float], ...]  # s_region vertices, raw detector corner order


def _get(url: str, limits: RequestLimits, attempts: int = 6) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=limits.timeout_s) as r:
                body = r.read(int(limits.max_download_mb * 1024 * 1024) + 1)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 502, 503, 504):
                raise
            body = b"Server busy"
        if len(body) > limits.max_download_mb * 1024 * 1024:
            raise ValueError(f"response exceeds {limits.max_download_mb} MB: {url}")
        if not body.startswith(b"Server busy"):
            return body
        time.sleep(2.0 * 2**i)
    raise TimeoutError(f"IRSA stayed busy after {attempts} attempts: {url}")


def parse_polygon(s_region: str) -> tuple[tuple[float, float], ...]:
    nums = [float(t) for t in s_region.split()[2:]]
    pts = list(zip(nums[0::2], nums[1::2], strict=True))
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return tuple(pts)


def search(target: Target, limits: RequestLimits, collections=COLLECTIONS) -> list[SpherexExposure]:
    """All L2 exposures whose footprint contains the target (bounded by limits.max_results)."""
    out: list[SpherexExposure] = []
    for coll in collections:
        q = urllib.parse.urlencode(
            {
                "COLLECTION": coll,
                "POS": f"CIRCLE {target.ra_deg} {target.dec_deg} 0.001",
                "RESPONSEFORMAT": "CSV",
                "MAXREC": limits.max_results,
            }
        )
        rows = csv.DictReader(io.StringIO(_get(f"{SIA_URL}?{q}", limits).decode()))
        for r in rows:
            if r["dataproduct_subtype"] != "science" or not r["access_url"].endswith(".fits"):
                continue
            out.append(
                SpherexExposure(
                    source_id=r["obs_publisher_did"],
                    source_url=r["access_url"],
                    collection=coll,
                    mjd_mid=(float(r["t_min"]) + float(r["t_max"])) / 2,
                    detector=int(r["energy_bandpassname"].rsplit("D", 1)[1]),
                    obs_id=r["obs_id"],
                    t_min=float(r["t_min"]),
                    t_max=float(r["t_max"]),
                    exptime_s=float(r["t_exptime"]),
                    corners=parse_polygon(r["s_region"]),
                )
            )
    return out


def _tangent(ra0: float, dec0: float, ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    a0, d0 = np.radians(ra0), np.radians(dec0)
    a, d = np.radians(ra), np.radians(dec)
    cosc = np.sin(d0) * np.sin(d) + np.cos(d0) * np.cos(d) * np.cos(a - a0)
    x = np.cos(d) * np.sin(a - a0) / cosc
    y = (np.cos(d0) * np.sin(d) - np.sin(d0) * np.cos(d) * np.cos(a - a0)) / cosc
    return np.stack([x, y], axis=-1)


def predicted_detector_xy(exp: SpherexExposure, ra: float, dec: float) -> tuple[float, float]:
    """Approximate 0-based raw detector pixel of (ra, dec) from the footprint corners.

    The corners are ordered (0,0), (N,0), (N,N), (0,N) in raw pixels (checked against the
    'A' WCS of downloaded headers). A homography ignores SIP distortion (a few pixels), which
    is enough to pre-select exposures; final wavelengths always come from the cutout header.
    """
    if len(exp.corners) != 4:
        raise ValueError(f"{exp.obs_id}: expected 4 footprint corners")
    sky = _tangent(ra, dec, *np.array(exp.corners).T)
    n = DETECTOR_PX - 1
    pix = np.array([(0, 0), (n, 0), (n, n), (0, n)], dtype=float)
    rows = []
    for (u, v), (x, y) in zip(sky, pix, strict=True):
        rows.append([u, v, 1, 0, 0, 0, -x * u, -x * v, x])
        rows.append([0, 0, 0, u, v, 1, -y * u, -y * v, y])
    a = np.array(rows)
    h = np.append(np.linalg.solve(a[:, :8], a[:, 8]), 1.0).reshape(3, 3)
    x, y, w = h @ np.array([0.0, 0.0, 1.0])  # target is the tangent point
    return float(x / w), float(y / w)


def cutout_url(source_url: str, ra: float, dec: float, size_arcsec: float) -> str:
    return f"{source_url}?center={ra:.6f},{dec:.6f}&size={size_arcsec:g}arcsec"


def fetch_cutout(
    exp: ArchiveRecord,
    ra: float,
    dec: float,
    size_arcsec: float,
    cache_dir: Path,
    limits: RequestLimits,
) -> Path:
    check_cutout_size(size_arcsec, limits)
    url = cutout_url(exp.source_url, ra, dec, size_arcsec)
    path = cache_path(cache_dir, cache_key(exp.source_id, {"url": url}), ".fits")
    if path.exists():
        return path
    body = _get(url, limits)
    if not body.startswith(b"SIMPLE  ="):
        raise ValueError(f"not a FITS response ({body[:80]!r}): {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)
    return path

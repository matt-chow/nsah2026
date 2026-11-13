"""Display assets: 8-bit renderings for the browser. Never used for measurement."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np

STRETCH_NAME = "asinh(p0.5-p99.5, a=0.1)"


def asinh_stretch(
    data: np.ndarray,
    mask: np.ndarray | None = None,
    lo_pct: float = 0.5,
    hi_pct: float = 99.5,
    a: float = 0.1,
) -> np.ndarray:
    """Map a float image to uint8 with an asinh stretch. Masked/NaN pixels become 0."""
    valid = np.isfinite(data)
    if mask is not None:
        valid &= ~mask
    if not valid.any():
        return np.zeros(data.shape, dtype=np.uint8)
    lo, hi = np.percentile(data[valid], [lo_pct, hi_pct])
    scaled = np.clip((data - lo) / max(hi - lo, np.finfo(np.float32).tiny), 0.0, 1.0)
    out = np.arcsinh(scaled / a) / np.arcsinh(1.0 / a)
    out = np.where(valid, out, 0.0)
    return np.round(out * 255.0).astype(np.uint8)


def write_png_gray(path: Path, image: np.ndarray) -> None:
    """Write an 8-bit grayscale PNG with the stdlib (avoids a Pillow dependency).

    Row 0 of `image` is written as the top row, so callers flip FITS arrays (origin at
    bottom-left) before calling.
    """
    if image.dtype != np.uint8 or image.ndim != 2:
        raise ValueError("expected a 2-D uint8 array")
    h, w = image.shape
    raw = b"".join(b"\x00" + image[r].tobytes() for r in range(h))

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)

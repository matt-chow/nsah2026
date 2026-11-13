import numpy as np
import pytest
from astropy.io import fits

from parallax_science.archive import check_cutout_size
from parallax_science.cache import cache_key
from parallax_science.config import CompatibilityTolerances, RequestLimits
from parallax_science.display import asinh_stretch, write_png_gray
from parallax_science.validation import assess_compatibility

TOL = CompatibilityTolerances()


def test_cache_key_is_order_independent_and_param_sensitive():
    assert cache_key("a", {"x": 1, "y": 2}) == cache_key("a", {"y": 2, "x": 1})
    assert cache_key("a", {"x": 1}) != cache_key("a", {"x": 2})
    assert cache_key("a", {"x": 1}) != cache_key("b", {"x": 1})


def test_cutout_size_bounded():
    limits = RequestLimits(max_cutout_arcsec=600)
    check_cutout_size(600, limits)
    for bad in (0, -1, 601):
        with pytest.raises(ValueError):
            check_cutout_size(bad, limits)


def test_asinh_stretch_range_and_masking():
    data = np.linspace(0, 10, 100, dtype=np.float32).reshape(10, 10)
    data[0, 0] = np.nan
    out = asinh_stretch(data)
    assert out.dtype == np.uint8 and out[0, 0] == 0 and out.max() == 255
    assert np.all(asinh_stretch(np.full((4, 4), np.nan)) == 0)


def test_png_header(tmp_path):
    p = tmp_path / "x.png"
    write_png_gray(p, np.zeros((3, 5), dtype=np.uint8))
    b = p.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    assert int.from_bytes(b[16:20], "big") == 5 and int.from_bytes(b[20:24], "big") == 3


def test_compatibility(fixture_manifest):
    manifest, _ = fixture_manifest
    e1, e2, e3 = manifest.observations
    assert assess_compatibility(e1, e2, TOL).status == "compatible"
    r = assess_compatibility(e1, e3, TOL)
    assert r.status == "incompatible" and any("detectors" in s for s in r.reasons)
    assert assess_compatibility(e1, e1, TOL).status == "incompatible"  # same epoch
    unknown = e2.model_copy(
        update={"provenance": e2.provenance.model_copy(update={"calibration_version": None})}
    )
    assert assess_compatibility(e1, unknown, TOL).status == "unknown"


def test_injected_mover_is_where_the_fixture_says(fixture_manifest):
    """Synthetic injection check: the simulated mover is recoverable at its injected pixel."""
    _, root = fixture_manifest
    with fits.open(root / "fixtures/synthetic-fixture-001/e1.fits") as hdul:
        img = hdul["IMAGE"].data
        assert img.dtype == np.dtype(">f4")
        assert hdul["IMAGE"].header["BUNIT"] == "MJy/sr" and hdul[0].header["SIMULATE"]
    # e1 mover injected at (x=20, y=30): local peak well above background + 5 sigma.
    assert img[30, 20] > 1.0 + 5 * 0.05

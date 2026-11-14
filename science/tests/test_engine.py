"""Alignment, masks, difference significance, and injection-recovery on synthetic frames."""

import numpy as np
import pytest

from parallax_science.align import OFF_IMAGE_BIT, grid_wcs, resample
from parallax_science.difference import Frame, background, run
from parallax_science.spherex import CAUTION_FLAGS, HARD_FLAGS

N = 61
SIGMA_PSF = 0.6  # px, roughly SPHEREx's undersampled core
NOISE = 0.02


def _psf(x, y, flux, shape=(N, N)):
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]]
    return (
        flux
        / (2 * np.pi * SIGMA_PSF**2)
        * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * SIGMA_PSF**2))
    )


def _frames(n=8, seed=1, inject=None, stars=12):
    rng = np.random.default_rng(seed)
    star_list = [
        (rng.uniform(8, N - 8), rng.uniform(8, N - 8), rng.uniform(0.5, 3)) for _ in range(stars)
    ]
    frames = []
    for i in range(n):
        img = np.full((N, N), 0.3 + 0.01 * i)  # background drifts between epochs
        for x, y, f in star_list:
            img = img + _psf(x, y, f)
        if inject:
            img = img + inject(i)
        img = img + rng.normal(0, NOISE, img.shape)
        frames.append(
            Frame(
                f"e{i}",
                61000 + i,
                img.astype(np.float32),
                np.full((N, N), NOISE**2, np.float32),
                np.zeros((N, N), np.int32),
            )
        )
    return frames, star_list


def _all(diffs):
    return [d for e in diffs for d in e.detections]


def test_resample_identity_and_shift():
    w = grid_wcs(10.0, 20.0, N, 6.15)
    img = _psf(30.0, 25.0, 1.0).astype(np.float32)
    out, _, flags = resample(w, img, np.ones_like(img), np.zeros(img.shape, np.int32), w, (N, N))
    assert np.allclose(out[1:-1, 1:-1], img[1:-1, 1:-1], atol=1e-6)
    # Source grid offset by +2 px in x: the star lands at x=28 on the target grid.
    src = grid_wcs(10.0, 20.0, N, 6.15)
    src.wcs.crpix = [src.wcs.crpix[0] + 2, src.wcs.crpix[1]]
    out, _, flags = resample(src, img, np.ones_like(img), np.zeros(img.shape, np.int32), w, (N, N))
    _, xx = np.mgrid[0:N, 0:N]
    good = np.isfinite(out)
    cx = (out[good] * xx[good]).sum() / out[good].sum()
    assert cx == pytest.approx(28.0, abs=0.05)
    assert (flags[:, -2:] & (1 << OFF_IMAGE_BIT)).all()  # uncovered columns are flagged


def test_hard_flags_become_nan_and_flags_propagate():
    w = grid_wcs(10.0, 20.0, N, 6.15)
    img = np.ones((N, N), np.float32)
    flags = np.zeros((N, N), np.int32)
    flags[30, 30] = 1 << HARD_FLAGS["HOT"]
    flags[10, 10] = 1 << CAUTION_FLAGS["PERSIST"]
    out, _, of = resample(w, img, img, flags, w, (N, N))
    assert np.isnan(out[30, 30]) and np.isfinite(out[10, 10])
    assert of[10, 10] & (1 << CAUTION_FLAGS["PERSIST"])


def test_background_ignores_sources():
    frames, _ = _frames(n=1, stars=40)
    assert background(frames[0].image, frames[0].flags) == pytest.approx(0.3, abs=3 * NOISE)


def test_null_pairs_produce_no_candidates():
    for seed in range(5):
        frames, _ = _frames(seed=seed)
        _, _, _, diffs, _ = run(frames)
        assert all(d.validated for d in diffs)
        assert _all(diffs) == []


def test_moving_source_recovered_in_each_epoch():
    track = [(10 + 5 * i, 15 + 3 * i) for i in range(8)]
    frames, _ = _frames(inject=lambda i: _psf(*track[i], 0.5))
    _, _, _, diffs, _ = run(frames)
    for i, d in enumerate(diffs):
        pos = [x for x in d.detections if x.sign > 0]
        assert len(pos) == 1, f"epoch {i}"
        assert np.hypot(pos[0].x - track[i][0], pos[0].y - track[i][1]) < 0.5
        # Where the track crosses a star the residual sits on a persistent source.
        assert pos[0].kind in ("new_source_like", "variable_like")
        assert pos[0].status == "needs_followup"
        assert pos[0].delta_ujy > 3 * pos[0].delta_err_ujy


def test_variable_source_classified_variable():
    frames, stars = _frames()
    x, y, f = stars[0]
    frames[3].image += _psf(x, y, f * 0.6).astype(np.float32)
    _, _, _, diffs, _ = run(frames)
    dets = _all(diffs)
    assert [(d.observation_id, d.kind) for d in dets] == [("e3", "variable_like")]


def test_caution_flags_mark_artifacts():
    frames, _ = _frames(inject=lambda i: _psf(40, 40, 0.5) if i == 2 else 0)
    frames[2].flags[39:42, 39:42] = 1 << CAUTION_FLAGS["SNOWBALL"]
    _, _, _, diffs, _ = run(frames)
    (d,) = _all(diffs)
    assert d.kind == "artifact_like" and "SNOWBALL" in d.caution


def test_partly_masked_aperture_marks_artifact():
    # a brightening measured only on the wings of a masked star core must not pass as a change
    frames, stars = _frames()
    x, y, f = stars[0]
    frames[3].image += _psf(x, y, f * 3).astype(np.float32)
    frames[3].image[round(y), round(x)] = np.nan
    _, _, _, diffs, _ = run(frames)
    dets = [d for d in _all(diffs) if d.observation_id == "e3"]
    assert dets and all(d.status == "likely_artifact" and d.masked_px for d in dets)


def test_underestimated_variance_disables_quantitative_use():
    frames, _ = _frames(inject=lambda i: _psf(40, 40, 0.5) if i == 2 else 0)
    for f in frames:
        f.variance = f.variance / 25
    _, _, _, diffs, _ = run(frames)
    assert not any(d.validated for d in diffs)
    assert _all(diffs) == [] and "noise scale" in diffs[0].reasons[0]


def test_completeness_curve():
    """Injection-recovery: faint sources are missed, bright ones are found (8 trials each)."""
    sigma_ap = NOISE * np.sqrt(np.pi * 1.5**2)  # aperture noise, flux units of _psf
    rates = {}
    for snr in (2, 15):
        found = 0
        for t in range(8):
            frames, _ = _frames(
                seed=100 + t,
                inject=lambda i, s=snr: _psf(30.3, 30.7, s * sigma_ap) if i == 4 else 0,
                stars=0,
            )
            _, _, _, diffs, _ = run(frames)
            found += any(d.observation_id == "e4" and d.sign > 0 for d in _all(diffs))
        rates[snr] = found / 8
    assert rates[2] <= 0.125 and rates[15] == 1.0

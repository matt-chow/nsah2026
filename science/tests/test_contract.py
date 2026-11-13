"""The committed schema and fixture must match what the code generates."""

import json

import pytest
from conftest import DATA_DIR
from pydantic import ValidationError

from parallax_science.cli import FIXTURE_MANIFEST, SCHEMA_PATH, main, schema_text
from parallax_science.models import Manifest
from parallax_science.validation import load_manifest, validate_manifest


def test_committed_schema_is_current():
    assert (DATA_DIR / SCHEMA_PATH).read_text(encoding="utf-8") == schema_text(), (
        "run `uv run parallax schema`"
    )


def test_committed_fixture_matches_generator(fixture_manifest):
    manifest, _ = fixture_manifest
    assert load_manifest(DATA_DIR / FIXTURE_MANIFEST) == manifest, (
        "run `uv run parallax make-fixture`"
    )


def test_committed_fixture_validates_with_assets():
    assert main(["--data-dir", str(DATA_DIR), "validate", str(DATA_DIR / FIXTURE_MANIFEST)]) == 0


def test_fixture_assets_are_deterministic(fixture_manifest, tmp_path):
    from parallax_science.fixture import build

    _, first_root = fixture_manifest
    build(tmp_path)
    for rel in ("fixtures/synthetic-fixture-001/e1.fits", "fixtures/synthetic-fixture-001/e1.png"):
        assert (tmp_path / rel).read_bytes() == (first_root / rel).read_bytes()


def _raw() -> dict:
    return json.loads((DATA_DIR / FIXTURE_MANIFEST).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m["target"].update(ra_deg=360.0),
        lambda m: m["target"].update(dec_deg=-91.0),
        lambda m: m.update(schema_version="2.0.0"),
        lambda m: m.update(notice=None),
        lambda m: m["observations"][0].update(data_kind="real"),
        lambda m: m["observations"][0]["assets"].update(display_png="../secrets.png"),
        lambda m: m["observations"][0]["assets"].update(display_png="C:/x.png"),
        lambda m: m["observations"][0]["spectral"].update(wavelength_min_um=5.0),
        lambda m: m["observations"].append(m["observations"][0]),
        lambda m: m["comparisons"][0].update(target_id="missing"),
        lambda m: m.update(unexpected_field=1),
        lambda m: m["candidates"].append(
            {
                "candidate_id": "c1",
                "status": "confirmed",
                "observation_ids": ["x"],
                "ra_deg": 1,
                "dec_deg": 1,
                "evidence": [],
                "method": "x",
            }
        ),
    ],
)
def test_invalid_manifests_rejected(mutate):
    raw = _raw()
    mutate(raw)
    with pytest.raises(ValidationError):
        Manifest.model_validate(raw)


def test_real_observation_requires_source_url():
    raw = _raw()
    raw["data_kind"] = "real"
    raw["dataset"]["mission"] = "SPHEREx"
    for o in raw["observations"]:
        o["data_kind"] = "real"
    with pytest.raises(ValidationError, match="source_url"):
        Manifest.model_validate(raw)


def test_tampered_comparison_status_detected():
    raw = _raw()
    raw["comparisons"][1]["status"] = "compatible"  # e1 vs e3 crosses detectors
    errors = validate_manifest(Manifest.model_validate(raw))
    assert any("checks give 'incompatible'" in e for e in errors)


def test_target_outside_footprint_detected():
    raw = _raw()
    raw["target"]["ra_deg"] = 10.0
    errors = validate_manifest(Manifest.model_validate(raw))
    assert any("outside the image footprint" in e for e in errors)

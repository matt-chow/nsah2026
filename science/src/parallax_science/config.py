"""Pipeline configuration. Defaults are the enforced bounds; override per run, never unbounded."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

REPO_ROOT = Path(__file__).resolve().parents[3]


class RequestLimits(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    max_results: int = Field(default=5000, ge=1, le=20000, description="Archive rows per query")
    max_cutout_arcsec: float = Field(default=1800.0, gt=0.0, le=3600.0, description="Cutout side")
    max_download_mb: float = Field(default=200.0, gt=0.0, le=2000.0, description="Per run, total")
    max_concurrency: int = Field(default=2, ge=1, le=4)
    timeout_s: float = Field(default=60.0, gt=0.0, le=600.0)


class CompatibilityTolerances(BaseModel):
    """Thresholds for allowing pixel comparison. ASSUMPTIONS: validate against SPHEREx docs."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Fractional center-wavelength offset. SPHEREx R ~ 35-130, so 0.01 is well inside one
    # spectral resolution element.
    max_wavelength_offset_fraction: float = Field(default=0.01, gt=0.0, le=0.1)
    max_pixel_scale_ratio_offset: float = Field(default=0.01, gt=0.0, le=0.1)
    min_epoch_separation_days: float = Field(default=1e-4, gt=0.0)


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data_dir: Path = REPO_ROOT / "data"
    # Disposable downloads live outside data/ so they can never ship with the static site.
    cache_dir: Path = REPO_ROOT / ".cache" / "parallax"
    limits: RequestLimits = RequestLimits()
    tolerances: CompatibilityTolerances = CompatibilityTolerances()

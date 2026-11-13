"""Observation manifest contract (see docs/DATA_CONTRACT.md).

These models are the single source of truth. `parallax schema` exports them to
data/manifests/manifest.schema.json; web/src/types/manifest.ts mirrors them by hand
and tests in both packages check the committed fixture against them.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0.0"

DataKind = Literal["real", "simulated"]
TimeScale = Literal["utc", "tt", "tai", "tdb"]
CompatibilityStatus = Literal["compatible", "incompatible", "unknown"]
# Deliberately no "confirmed": PARALLAX never confirms objects, it triages.
CandidateStatus = Literal[
    "unreviewed", "needs_followup", "known_object", "likely_artifact", "rejected"
]

WcsValue = str | float | int | bool


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _check_relative_path(value: str) -> str:
    p = value.replace("\\", "/")
    if p.startswith("/") or ":" in p or any(part in ("", "..") for part in p.split("/")):
        raise ValueError(f"asset path must be relative to the data root without '..': {value!r}")
    return p


class Target(_Model):
    label: str
    ra_deg: float = Field(ge=0.0, lt=360.0, description="Right ascension, degrees")
    dec_deg: float = Field(ge=-90.0, le=90.0, description="Declination, degrees")
    frame: Literal["icrs"] = "icrs"
    radius_arcsec: float = Field(gt=0.0, le=3600.0, description="Cutout half-size, arcsec")


class Dataset(_Model):
    mission: Literal["SPHEREx", "SIMULATED"]
    archive: str | None = Field(description="e.g. 'IRSA'; null for simulations")
    collection: str | None = Field(description="Archive collection, e.g. 'spherex_qr'")
    data_release: str | None = Field(description="Release label exactly as the archive states it")
    citation: str
    acknowledgement: str


class Epoch(_Model):
    mjd_mid: float = Field(gt=0.0, description="Mid-exposure Modified Julian Date")
    time_scale: TimeScale
    exposure_s: float | None = Field(default=None, gt=0.0)
    source_keyword: str | None = Field(default=None, description="FITS keyword the time came from")


class Spectral(_Model):
    detector: int | None = Field(ge=1, le=6, description="SPHEREx detector/band 1-6")
    wavelength_center_um: float = Field(gt=0.0, description="Wavelength at cutout center, micron")
    wavelength_min_um: float = Field(gt=0.0)
    wavelength_max_um: float = Field(gt=0.0)
    basis: Literal["spectral-wcs", "header", "simulated"] = Field(
        description="How wavelengths were derived; SPHEREx wavelength varies across each detector"
    )

    @model_validator(mode="after")
    def _ordered(self) -> Spectral:
        if not self.wavelength_min_um <= self.wavelength_center_um <= self.wavelength_max_um:
            raise ValueError(
                "require wavelength_min_um <= wavelength_center_um <= wavelength_max_um"
            )
        return self


class Image(_Model):
    width_px: int = Field(gt=0, le=4096)
    height_px: int = Field(gt=0, le=4096)
    pixel_scale_arcsec: float = Field(gt=0.0)
    units: str = Field(description="Science array units, e.g. 'MJy/sr'")
    wcs: dict[str, WcsValue] = Field(description="Celestial FITS WCS cards of the science array")


class Quality(_Model):
    flags_available: bool
    variance_available: bool
    masked_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    notes: list[str] = Field(default_factory=list)


class Assets(_Model):
    science_fits: str | None = Field(description="Science cutout (FITS, original HDUs) path")
    display_png: str = Field(description="8-bit display rendering; never used for measurement")
    display_stretch: str = Field(description="Stretch used for display_png")

    @field_validator("science_fits", "display_png")
    @classmethod
    def _relative(cls, v: str | None) -> str | None:
        return None if v is None else _check_relative_path(v)


class Provenance(_Model):
    source_url: str | None = Field(description="Original archive URL; required for real data")
    source_id: str = Field(description="Stable archive identifier (or simulation id)")
    retrieved_utc: str | None = None
    source_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    calibration_version: str | None = None
    processing: str = Field(description="Exact command/parameters that produced the assets")
    cache_key: str = Field(pattern=r"^[0-9a-f]{64}$")


class Observation(_Model):
    observation_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,128}$")
    data_kind: DataKind
    epoch: Epoch
    spectral: Spectral
    image: Image
    quality: Quality
    assets: Assets
    provenance: Provenance

    @model_validator(mode="after")
    def _real_needs_source(self) -> Observation:
        if self.data_kind == "real" and not self.provenance.source_url:
            raise ValueError(
                f"{self.observation_id}: real observations require provenance.source_url"
            )
        return self


class Comparison(_Model):
    reference_id: str
    target_id: str
    status: CompatibilityStatus
    reasons: list[str] = Field(description="Every failed or unknown check, human readable")


class Candidate(_Model):
    candidate_id: str
    status: CandidateStatus
    observation_ids: list[str] = Field(min_length=1)
    ra_deg: float = Field(ge=0.0, lt=360.0)
    dec_deg: float = Field(ge=-90.0, le=90.0)
    evidence: list[str] = Field(description="Measured facts supporting/refuting the candidate")
    method: str


class GeneratedBy(_Model):
    tool: str
    version: str
    command: str


class Manifest(_Model):
    schema_version: Literal["1.0.0"]
    manifest_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,128}$")
    data_kind: DataKind
    title: str
    notice: str | None = Field(description="Shown prominently in the UI; required for simulations")
    target: Target
    dataset: Dataset
    observations: list[Observation] = Field(min_length=1, max_length=200)
    comparisons: list[Comparison] = Field(default_factory=list)
    candidates: list[Candidate] = Field(default_factory=list)
    generated_by: GeneratedBy

    @model_validator(mode="after")
    def _consistent(self) -> Manifest:
        ids = [o.observation_id for o in self.observations]
        if len(ids) != len(set(ids)):
            raise ValueError("observation_id values must be unique")
        known = set(ids)
        for c in self.comparisons:
            if c.reference_id not in known or c.target_id not in known:
                raise ValueError(f"comparison references unknown observation: {c}")
        for cand in self.candidates:
            if not set(cand.observation_ids) <= known:
                raise ValueError(f"candidate {cand.candidate_id} references unknown observation")
        if self.data_kind == "simulated":
            if not self.notice:
                raise ValueError("simulated manifests require a notice")
            if any(o.data_kind != "simulated" for o in self.observations):
                raise ValueError("a simulated manifest may not contain real observations")
            if self.dataset.mission != "SIMULATED":
                raise ValueError("simulated manifests must use dataset.mission='SIMULATED'")
        elif any(o.data_kind != "real" for o in self.observations):
            # Mixing real and simulated data in one manifest invites misattribution.
            raise ValueError("a real manifest may not contain simulated observations")
        return self

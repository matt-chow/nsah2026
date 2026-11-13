"""Archive adapter boundary. Phase 1 adds an IRSA SPHEREx implementation (SIA2 + cutout URLs).

Adapters return cutouts only; full spectral images and survey-scale queries are out of scope.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from parallax_science.config import RequestLimits
from parallax_science.models import Target


@dataclass(frozen=True)
class ArchiveRecord:
    source_id: str
    source_url: str
    collection: str
    mjd_mid: float | None
    detector: int | None


class ArchiveAdapter(Protocol):
    name: str

    def search(self, target: Target, limits: RequestLimits) -> list[ArchiveRecord]: ...

    def fetch_cutout(
        self, record: ArchiveRecord, size_arcsec: float, dest_dir: Path, limits: RequestLimits
    ) -> Path: ...


def check_cutout_size(size_arcsec: float, limits: RequestLimits) -> None:
    """Reject unbounded requests before any network call. Adapters must call this."""
    if not 0 < size_arcsec <= limits.max_cutout_arcsec:
        raise ValueError(
            f"cutout size {size_arcsec} arcsec outside (0, {limits.max_cutout_arcsec}]"
        )

"""Deterministic cache keys: same source + same parameters -> same key -> no reprocessing."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def cache_key(source_id: str, params: dict[str, Any]) -> str:
    """SHA-256 over the source identity and canonical JSON of processing parameters."""
    canonical = json.dumps(
        {"source": source_id, "params": params}, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def cache_path(cache_dir: Path, key: str, suffix: str) -> Path:
    # Two-character fan-out keeps directories small on Windows.
    return cache_dir / key[:2] / f"{key}{suffix}"


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

from pathlib import Path

import pytest

from parallax_science.fixture import build
from parallax_science.models import Manifest

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@pytest.fixture(scope="session")
def fixture_manifest(tmp_path_factory: pytest.TempPathFactory) -> tuple[Manifest, Path]:
    root = tmp_path_factory.mktemp("data")
    return build(root), root

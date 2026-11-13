"""`parallax` command-line entry point."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from parallax_science import __version__
from parallax_science.config import Settings
from parallax_science.models import Manifest

SCHEMA_PATH = Path("manifests/manifest.schema.json")
FIXTURE_MANIFEST = Path("manifests/synthetic-fixture.json")


def schema_text() -> str:
    return json.dumps(Manifest.model_json_schema(), indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    settings = Settings()
    parser = argparse.ArgumentParser(prog="parallax", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--data-dir", type=Path, default=settings.data_dir)
    sub = parser.add_subparsers(dest="command", required=True)
    v = sub.add_parser("validate", help="validate a manifest (schema + WCS + assets + comparisons)")
    v.add_argument("manifest", type=Path)
    sub.add_parser("schema", help="write data/manifests/manifest.schema.json")
    sub.add_parser("make-fixture", help="regenerate the SIMULATED fixture under data/")
    args = parser.parse_args(argv)
    data_dir: Path = args.data_dir

    if args.command == "schema":
        (data_dir / SCHEMA_PATH).write_text(schema_text(), encoding="utf-8", newline="\n")
        print(f"wrote {data_dir / SCHEMA_PATH}")
        return 0

    if args.command == "make-fixture":
        from parallax_science.fixture import build, write_manifest

        write_manifest(build(data_dir), data_dir / FIXTURE_MANIFEST)
        print(f"wrote {data_dir / FIXTURE_MANIFEST}")
        return 0

    from parallax_science.validation import load_manifest, validate_manifest

    try:
        manifest = load_manifest(args.manifest)
    except (ValidationError, ValueError, OSError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    errors = validate_manifest(manifest, data_root=data_dir, tol=settings.tolerances)
    for e in errors:
        print(f"INVALID: {e}", file=sys.stderr)
    if not errors:
        print(
            f"OK: {manifest.manifest_id} ({manifest.data_kind}, "
            f"{len(manifest.observations)} observations)"
        )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

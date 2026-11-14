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
INDEX_PATH = Path("manifests/index.json")


def schema_text() -> str:
    return json.dumps(Manifest.model_json_schema(), indent=2) + "\n"


def index_text(data_dir: Path) -> str:
    """Field list for the web app: real fields first, then simulations."""
    from parallax_science.validation import load_manifest

    entries = []
    for p in sorted((data_dir / "manifests").glob("*.json")):
        if p.name in (SCHEMA_PATH.name, INDEX_PATH.name):
            continue
        m = load_manifest(p)
        entries.append(
            {
                "manifest_id": m.manifest_id,
                "path": f"manifests/{p.name}",
                "title": m.title,
                "data_kind": m.data_kind,
                "ra_deg": m.target.ra_deg,
                "dec_deg": m.target.dec_deg,
                "radius_arcsec": m.target.radius_arcsec,
                "observations": len(m.observations),
                "candidates": len(m.candidates),
                "data_release": m.dataset.data_release,
                "wavelength_um": m.observations[0].spectral.wavelength_center_um,
            }
        )
    entries.sort(key=lambda e: (e["data_kind"] != "real", e["manifest_id"]))
    return json.dumps({"schema_version": 1, "fields": entries}, indent=2) + "\n"


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
    b = sub.add_parser("build-field", help="fetch, align and difference a real SPHEREx field")
    b.add_argument("name", help="field id, e.g. nep-d2")
    b.add_argument("--ra", type=float, required=True)
    b.add_argument("--dec", type=float, required=True)
    b.add_argument("--detector", type=int, required=True, choices=range(1, 7))
    b.add_argument("--epochs", type=int, default=10)
    b.add_argument("--title", required=True)
    sub.add_parser("index", help="write data/manifests/index.json from the manifests present")
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

    if args.command == "build-field":
        import logging

        from parallax_science.field import build_field
        from parallax_science.fixture import write_manifest

        logging.basicConfig(level=logging.INFO, format="%(message)s")
        settings = settings.model_copy(update={"data_dir": data_dir})
        m = build_field(
            args.name, args.title, args.ra, args.dec, args.detector, args.epochs, settings
        )
        write_manifest(m, data_dir / "manifests" / f"{args.name}.json")
        print(f"wrote {data_dir / 'manifests' / f'{args.name}.json'}")
        return 0

    from parallax_science.validation import load_manifest, validate_manifest

    if args.command == "index":
        (data_dir / INDEX_PATH).write_text(index_text(data_dir), encoding="utf-8", newline="\n")
        print(f"wrote {data_dir / INDEX_PATH}")
        return 0

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

"""Pre-bake the challenge's five test targets into data/targets/<id>.json.

The landing page plays these without the archive functions (static hosts, IRSA outages): the full
exposure listing in every band, plus every exposure of one band cut out exactly as /api/spherex
cuts it (api/_spherex.py). Display imagery only, like the live API.

Run: uv run --no-project python scripts/bake_targets.py [target-id ...]
"""
import datetime
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import _spherex as sp  # noqa: E402

# Positions as in data/flipbook (fast movers propagated to late 2025) and web/src/prototype/places.ts
# TARGETS, which a web test keeps in step with the baked files. The band is where each shows best.
TARGETS = [
    ("barnard", "Barnard's Star", 269.4463, 4.7679, "D1"),
    ("eps-indi-b", "Epsilon Indi B", 331.0964, -56.8006, "D5"),
    ("wise-0855", "WISE 0855", 133.7600, -7.2422, "D6"),
    ("rw-aur", "RW Aurigae", 76.956417, 30.401417, "D1"),
    ("r-dra", "R Draconis", 248.16742, 66.755, "D1"),
]

# ~30 kB per cutout; keeps each file under the 5 MB data budget. R Draconis, near the North
# Ecliptic Pole, has ~600 D1 visits; the rest are not baked and load live when played.
MAX_CUTOUTS = 120


def retry(fn, *a):
    for attempt in range(5):
        try:
            return fn(*a)
        except Exception as e:  # IRSA answers 502/503 when busy
            if attempt == 4:
                raise
            print(f"  retry after {e}", flush=True)
            time.sleep(5 * (attempt + 1))


def bake(tid, name, ra, dec, band):
    frames = retry(sp.search, ra, dec)
    cut = {}
    pick = [f for f in frames if f["band"] == band]
    if len(pick) > MAX_CUTOUTS:  # evenly through time, first and last kept, so the time span stays
        pick = [pick[round(k * (len(pick) - 1) / (MAX_CUTOUTS - 1))] for k in range(MAX_CUTOUTS)]
    for k, f in enumerate(pick):
        print(f"{tid} {band} {k + 1}/{len(pick)}", flush=True)
        try:
            cut[f["url"]] = retry(sp.cutout, f["url"], ra, dec)
        except Exception as e:
            print(f"  skipped: {e}", flush=True)  # the player loads it live, or shows it as failed
    out = {"id": tid, "name": name, "ra": ra, "dec": dec, "band": band, "size_arcmin": sp.SIZE_ARCMIN,
           "collections": sorted({f["rel"] for f in frames}, key=sp.release_rank), "baked": datetime.date.today().isoformat(),
           "frames": frames, "cutouts": cut}
    path = ROOT / "data" / "targets" / f"{tid}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{path.name}: {len(frames)} exposures, {len(cut)} {band} cutouts, {path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    want = set(sys.argv[1:])
    for t in TARGETS:
        if not want or t[0] in want:
            bake(*t)

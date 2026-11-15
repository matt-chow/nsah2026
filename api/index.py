"""FastAPI on Vercel: live SPHEREx exposure listing from IRSA SIA2.

Metadata only (IRSA sends no CORS headers, so the browser cannot ask directly). No images pass
through and nothing is stored. Deliberately stdlib + FastAPI: the science package pulls in
astropy, which would blow the function size limit.
"""

import csv
import io
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _spherex  # noqa: E402  (Sky Flipbook backend; leading underscore = not its own Vercel function)

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
COLLECTIONS = ("spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep")
MAXREC = 500
HEADERS = {"User-Agent": "parallax-web/0.1 (NASA Space Apps 2026; metadata lookup)"}

app = FastAPI(title="PARALLAX archive lookup", docs_url=None, redoc_url=None, openapi_url=None)


def summarize(csv_text: str) -> dict:
    """Science-exposure count and newest dates from one SIA CSV; `truncated` if MAXREC cut it."""
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None:
        return {"exposures": 0, "truncated": False, "latest_mjd": None, "latest_release": None}
    if not {"dataproduct_subtype", "access_url", "t_max", "obs_release_date"} <= set(reader.fieldnames):
        raise ValueError("unexpected SIA response")
    rows = list(reader)
    sci = [r for r in rows if r["dataproduct_subtype"] == "science" and r["access_url"].endswith(".fits")]
    return {
        "exposures": len(sci),
        "truncated": len(rows) >= MAXREC,
        "latest_mjd": max((float(r["t_max"]) for r in sci), default=None),
        "latest_release": max((r["obs_release_date"][:10] for r in sci), default=None),
    }


def query(collection: str, ra: float, dec: float) -> dict:
    q = urllib.parse.urlencode(
        {
            "COLLECTION": collection,
            "POS": f"CIRCLE {ra} {dec} 0.001",
            "RESPONSEFORMAT": "CSV",
            "MAXREC": MAXREC,
        }
    )
    with urllib.request.urlopen(
        urllib.request.Request(f"{SIA_URL}?{q}", headers=HEADERS), timeout=20
    ) as r:
        body = r.read().decode()
    if body.startswith("Server busy"):
        raise OSError("IRSA busy")
    return {"collection": collection, **summarize(body)}


@app.get("/api/sia")
def sia(
    response: Response,
    ra: float = Query(ge=0, lt=360),
    dec: float = Query(ge=-90, le=90),
) -> dict:
    try:
        with ThreadPoolExecutor(len(COLLECTIONS)) as pool:
            collections = list(pool.map(lambda c: query(c, ra, dec), COLLECTIONS))
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "IRSA is unavailable; try again later") from exc
    # Hourly: fresh enough to show new releases, cheap enough not to hammer IRSA.
    response.headers["Cache-Control"] = "public, s-maxage=3600, stale-while-revalidate=86400"
    return {"ra": ra, "dec": dec, "collections": collections}


@app.get("/api/spherex")
def spherex(ra: str = "", dec: str = "", url: str | None = None, size: str | None = None) -> JSONResponse:
    """Sky Flipbook: same contract as the original stdlib handler in _spherex.py."""
    def send(code: int, body: dict) -> JSONResponse:
        cache = "public, s-maxage=86400" if code == 200 else "no-store"
        return JSONResponse(body, code, headers={"Cache-Control": cache})

    try:
        r, d = _spherex.parse_angle(ra, True), _spherex.parse_angle(dec, False)
        sz = _spherex.parse_size({"size": [size]} if size else {})
        if url:
            _spherex.check_url(url)
    except ValueError as e:
        return send(400, {"error": f"need ra, dec (and optional SPHEREx url, size): {e}"})
    try:
        body = _spherex.cutout(url, r, d, sz) if url else {"ra": r, "dec": d, "frames": _spherex.search(r, d)}
    except Exception as e:  # IRSA down/busy or an unexpected file layout
        return send(502, {"error": f"IRSA request failed: {e}"})
    return send(200, body)

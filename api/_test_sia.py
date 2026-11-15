# Leading underscore keeps Vercel from deploying this as a function. Run: pytest api/_test_sia.py
import pytest
from fastapi.testclient import TestClient

import index

HEAD = "dataproduct_subtype,access_url,t_max,obs_release_date\n"
CSV = (
    HEAD
    + "science,https://x/a.fits,61241.5,2026-09-15 16:02:25\n"
    + "science,https://x/b.fits,61300.25,2026-10-01 00:00:00\n"
    + "ancillary,https://x/c.fits,61999,2027-01-01 00:00:00\n"
    + "science,https://x/d.png,61999,2027-01-01 00:00:00\n"
)


def test_summarize_counts_science_fits_and_newest_dates():
    s = index.summarize(CSV)
    assert s == {"exposures": 2, "truncated": False, "latest_mjd": 61300.25, "latest_release": "2026-10-01"}


def test_summarize_empty_and_malformed():
    assert index.summarize("")["exposures"] == 0
    assert index.summarize(HEAD)["latest_mjd"] is None
    with pytest.raises(ValueError):
        index.summarize("a,b\n1,2\n")


def test_summarize_flags_truncation():
    rows = "science,https://x/a.fits,1,2026-01-01\n" * index.MAXREC
    assert index.summarize(HEAD + rows)["truncated"] is True


def test_endpoint_validates_position_and_maps_irsa_failure(monkeypatch):
    c = TestClient(index.app)
    for q in ("ra=360&dec=0", "ra=1&dec=91", "ra=nan&dec=0", "dec=0"):
        assert c.get(f"/api/sia?{q}").status_code == 422
    monkeypatch.setattr(index, "query", lambda *a: (_ for _ in ()).throw(OSError("down")))
    assert c.get("/api/sia?ra=1&dec=1").status_code == 503
    monkeypatch.setattr(index, "query", lambda col, ra, dec: {"collection": col, "exposures": 1})
    r = c.get("/api/sia?ra=1&dec=1")
    assert r.status_code == 200 and len(r.json()["collections"]) == 4
    assert "s-maxage" in r.headers["cache-control"]


def test_spherex_route_rejects_bad_input_without_network():
    c = TestClient(index.app)
    r = c.get("/api/spherex", params={"ra": "400", "dec": "0"})
    assert r.status_code == 400 and "error" in r.json() and r.headers["cache-control"] == "no-store"
    r = c.get("/api/spherex", params={"ra": "1", "dec": "0", "url": "https://evil.com/ibe/data/spherex/a.fits"})
    assert r.status_code == 400

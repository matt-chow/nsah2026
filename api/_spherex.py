"""SPHEREx time-series cutouts from NASA IRSA.

GET /api/spherex?ra=..&dec=..             -> SPHEREx DR1 frames covering that point, sorted by time
GET /api/spherex?ra=..&dec=..&url=<fits>  -> that frame cut out around ra/dec, reprojected north-up,
                                             background-subtracted, as a flat N*N pixel list
ra/dec accept degrees or sexagesimal ("08h55m10.8s", "-7d14m42.5s", "08:55:10.8").
Pure stdlib on purpose: no deps keeps the Vercel function small and cold starts fast.
"""
import csv, io, json, math, re, struct, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlparse

SIA = "https://irsa.ipac.caltech.edu/SIA"
SIZE_ARCMIN = 6
PIX_ARCSEC = 6.15  # SPHEREx native pixel scale
N = round(SIZE_ARCMIN * 60 / PIX_ARCSEC) | 1  # odd, so the target sits on the centre pixel


def fetch(url):
    """IRSA intermittently answers 502/503 'Server busy'; retry those."""
    for attempt in range(3):
        try:
            return urllib.request.urlopen(url, timeout=20)
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 2:
                raise
        except urllib.error.URLError:
            if attempt == 2:
                raise
        time.sleep(1 + attempt)


def parse_angle(s, is_ra):
    s = s.strip()
    if re.fullmatch(r"[-+]?\d+(\.\d*)?", s):
        v = float(s)
    else:
        parts = [float(p) for p in re.findall(r"\d+(?:\.\d*)?", s)]
        if not 1 <= len(parts) <= 3:
            raise ValueError(f"can't read angle {s!r}")
        v = sum(p / 60 ** i for i, p in enumerate(parts)) * (15 if is_ra else 1)
        v = -v if s.startswith("-") else v
    if not (0 <= v < 360 if is_ra else -90 <= v <= 90):
        raise ValueError(f"{'RA' if is_ra else 'Dec'} out of range: {s!r}")
    return v


def check_url(url):
    # Only proxy IRSA SPHEREx files: this endpoint must never fetch arbitrary URLs (SSRF).
    p = urlparse(url)
    if (p.scheme, p.netloc) != ("https", "irsa.ipac.caltech.edu") or not p.path.startswith("/ibe/data/spherex/") \
            or not p.path.endswith(".fits") or ".." in p.path or p.query or p.params or p.fragment:
        raise ValueError("url must be an IRSA SPHEREx FITS file")


def search(ra, dec):
    q = urlencode({"COLLECTION": "spherex_dr1", "POS": f"CIRCLE {ra} {dec} 0.001", "RESPONSEFORMAT": "csv"})
    with fetch(f"{SIA}?{q}") as r:
        rows = list(csv.DictReader(io.StringIO(r.read().decode())))
    frames = [{"url": x["access_url"], "mjd": float(x["t_min"]),
               "band": x["energy_bandpassname"].replace("SPHEREx-", ""),
               "um": [round(float(x["em_min"]) * 1e6, 2), round(float(x["em_max"]) * 1e6, 2)]}
              for x in rows if x["dataproduct_subtype"] == "science"]
    return sorted(frames, key=lambda f: f["mjd"])


def read_header(stream):
    cards = {}
    while True:
        block = stream.read(2880)
        if len(block) < 2880:
            raise ValueError("truncated FITS header")
        for i in range(0, 2880, 80):
            c = block[i:i + 80].decode("ascii", "replace")
            if c.rstrip() == "END":
                return cards
            if c[8:10] == "= ":
                v = c[10:].split("/")[0].strip()
                try:
                    cards[c[:8].strip()] = float(v)
                except ValueError:
                    cards[c[:8].strip()] = v.strip("'").strip()


def read_image(stream):
    """Primary header + IMAGE extension of a SPHEREx L2 file. Stops there, so the
    multi-MB PSF extension that follows is never downloaded."""
    if read_header(stream).get("NAXIS", 0) != 0:
        raise ValueError("unexpected primary data")
    h = read_header(stream)
    if h.get("EXTNAME") != "IMAGE" or h.get("BITPIX") != -32:
        raise ValueError(f"unexpected first extension {h.get('EXTNAME')}")
    w, ht = int(h["NAXIS1"]), int(h["NAXIS2"])
    data = stream.read(w * ht * 4)
    if len(data) < w * ht * 4:
        raise ValueError("truncated FITS data")
    return h, w, ht, struct.unpack(f">{w * ht}f", data)


def make_sky_to_pix(h):
    """ICRS degrees -> 0-based array (x, y) via the frame's TAN-SIP WCS; SIP inverted by fixed-point iteration."""
    a0, d0 = math.radians(h["CRVAL1"]), math.radians(h["CRVAL2"])
    m11, m12 = h["PC1_1"] * h.get("CDELT1", 1.0), h["PC1_2"] * h.get("CDELT1", 1.0)
    m21, m22 = h["PC2_1"] * h.get("CDELT2", 1.0), h["PC2_2"] * h.get("CDELT2", 1.0)
    det = m11 * m22 - m12 * m21
    sip = {ax: [(int(m[1]), int(m[2]), v) for k, v in h.items() if (m := re.fullmatch(ax + r"_(\d+)_(\d+)", k))]
           for ax in "AB"}

    def poly(terms, u, v):
        return sum(c * u ** p * v ** q for p, q, c in terms)

    def to_pix(ra, dec):
        a, d = math.radians(ra), math.radians(dec)
        cosc = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(a - a0)
        xi = math.degrees(math.cos(d) * math.sin(a - a0) / cosc)
        eta = math.degrees((math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(a - a0)) / cosc)
        up, vp = (m22 * xi - m12 * eta) / det, (m11 * eta - m21 * xi) / det
        u, v = up, vp
        for _ in range(20):
            nu, nv = up - poly(sip["A"], u, v), vp - poly(sip["B"], u, v)
            done = abs(nu - u) + abs(nv - v) < 1e-6
            u, v = nu, nv
            if done:
                break
        return u + h["CRPIX1"] - 1, v + h["CRPIX2"] - 1

    return to_pix


def reproject(h, w, ht, img, ra, dec):
    """Resample onto an N x N north-up, east-left grid centred on (ra, dec). None = no data."""
    to_pix = make_sky_to_pix(h)
    s, c, d0 = math.radians(PIX_ARCSEC / 3600), (N - 1) / 2, math.radians(dec)
    out = []
    for r in range(N):
        for col in range(N):
            xi, eta = (c - col) * s, (c - r) * s
            den = math.cos(d0) - eta * math.sin(d0)
            x, y = to_pix(ra + math.degrees(math.atan2(xi, den)),
                          math.degrees(math.atan2(math.sin(d0) + eta * math.cos(d0), math.hypot(xi, den))))
            x0, y0 = math.floor(x), math.floor(y)
            if x0 < 0 or y0 < 0 or x0 + 1 >= w or y0 + 1 >= ht:
                out.append(None)
                continue
            fx, fy, i = x - x0, y - y0, y0 * w + x0
            p = (img[i], img[i + 1], img[i + w], img[i + w + 1])
            out.append(None if any(math.isnan(q) for q in p) else
                       (p[0] * (1 - fx) + p[1] * fx) * (1 - fy) + (p[2] * (1 - fx) + p[3] * fx) * fy)
    good = sorted(v for v in out if v is not None)
    bg = good[len(good) // 2] if good else 0.0
    return [None if v is None else float(f"{v - bg:.4g}") for v in out]


def cutout(url, ra, dec):
    # 1.5x margin so the rotated north-up grid is fully covered.
    with fetch(f"{url}?center={ra},{dec}&size={SIZE_ARCMIN * 1.5}arcmin") as r:
        h, w, ht, img = read_image(r)
    return {"n": N, "mjd": h.get("MJD-AVG"), "pix": reproject(h, w, ht, img, ra, dec)}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        try:
            ra, dec = parse_angle(q["ra"][0], True), parse_angle(q["dec"][0], False)
            url = q["url"][0] if "url" in q else None
            if url:
                check_url(url)
        except (KeyError, ValueError) as e:
            return self._send(400, {"error": f"need ra, dec (and optional SPHEREx url): {e}"})
        try:
            body = cutout(url, ra, dec) if url else {"ra": ra, "dec": dec, "frames": search(ra, dec)}
        except Exception as e:  # IRSA down/busy or an unexpected file layout
            return self._send(502, {"error": f"IRSA request failed: {e}"})
        self._send(200, body)

    def _send(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        # Archive data is immutable: let Vercel's CDN absorb repeat requests. Never cache errors.
        self.send_header("Cache-Control", "public, s-maxage=86400" if code == 200 else "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

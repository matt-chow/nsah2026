"""SPHEREx time-series cutouts from NASA IRSA.

GET /api/spherex?ra=..&dec=..             -> SPHEREx frames covering that point in every release in
                                             COLLECTIONS, sorted by time
GET /api/spherex?ra=..&dec=..&url=<fits>[&size=arcmin]
                                          -> that frame cut out around ra/dec, reprojected north-up,
                                             background-subtracted, as a flat n*n pixel list, plus the
                                             detector, the wavelength at ra/dec and the quality flags there
ra/dec accept degrees or sexagesimal ("08h55m10.8s", "-7d14m42.5s", "08:55:10.8").
Pure stdlib on purpose: no deps keeps the Vercel function small and cold starts fast.
"""
import csv, io, json, math, re, struct, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlparse

SIA = "https://irsa.ipac.caltech.edu/SIA"
# A new data release is one more entry here (its IRSA SIA collection name). An exposure already
# listed by an earlier entry (same obs_id and detector band) is not repeated from a later one.
COLLECTIONS = ("spherex_dr1",)
SIZE_ARCMIN = 6  # default field of view
SIZE_RANGE = (2, 12)  # arcmin; bounds the cutout download and the pure-Python reprojection time
PIX_ARCSEC = 6.15  # SPHEREx native pixel scale
# FLAGS bits that are information, not contamination: FULLSAMPLE (sample history kept) and SOURCE
# (a catalogued source is there, usually the target itself).
INFO_FLAGS = {"FULLSAMPLE", "SOURCE"}


def grid_n(size):
    return round(size * 60 / PIX_ARCSEC) | 1  # odd, so the target sits on the centre pixel


N = grid_n(SIZE_ARCMIN)


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


def parse_size(q):
    size = float(q.get("size", [SIZE_ARCMIN])[0])
    if not SIZE_RANGE[0] <= size <= SIZE_RANGE[1]:
        raise ValueError(f"size must be {SIZE_RANGE[0]}-{SIZE_RANGE[1]} arcmin")
    return size


def check_url(url):
    # Only proxy IRSA SPHEREx files: this endpoint must never fetch arbitrary URLs (SSRF).
    p = urlparse(url)
    if (p.scheme, p.netloc) != ("https", "irsa.ipac.caltech.edu") or not p.path.startswith("/ibe/data/spherex/") \
            or not p.path.endswith(".fits") or ".." in p.path or p.query or p.params or p.fragment:
        raise ValueError("url must be an IRSA SPHEREx FITS file")


def search(ra, dec):
    frames, seen = [], set()
    for coll in COLLECTIONS:
        q = urlencode({"COLLECTION": coll, "POS": f"CIRCLE {ra} {dec} 0.001", "RESPONSEFORMAT": "csv"})
        with fetch(f"{SIA}?{q}") as r:
            rows = list(csv.DictReader(io.StringIO(r.read().decode())))
        for x in rows:
            k = (x["obs_id"], x["energy_bandpassname"])  # obs_id is shared by an exposure's 6 detectors
            if x["dataproduct_subtype"] != "science" or k in seen:
                continue
            seen.add(k)
            frames.append({"url": x["access_url"], "mjd": float(x["t_min"]), "rel": coll,
                           "band": x["energy_bandpassname"].replace("SPHEREx-", ""),
                           "um": [round(float(x["em_min"]) * 1e6, 2), round(float(x["em_max"]) * 1e6, 2)]})
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


def read_plane(stream, name, bitpix, fmt):
    h = read_header(stream)
    if h.get("EXTNAME") != name or h.get("BITPIX") != bitpix:
        raise ValueError(f"expected {name} extension, got {h.get('EXTNAME')}")
    w, ht = int(h["NAXIS1"]), int(h["NAXIS2"])
    data = stream.read(w * ht * 4)
    if len(data) < w * ht * 4:
        raise ValueError("truncated FITS data")
    stream.read(-(w * ht * 4) % 2880)  # block padding
    return h, w, ht, struct.unpack(f">{w * ht}{fmt}", data)


def read_image(stream, flags=False):
    """Primary header + IMAGE (and optionally FLAGS) extension of a SPHEREx L2 file. Stops there,
    so the multi-MB PSF extension that follows is never downloaded."""
    if read_header(stream).get("NAXIS", 0) != 0:
        raise ValueError("unexpected primary data")
    h, w, ht, img = read_plane(stream, "IMAGE", -32, "f")
    if not flags:
        return h, w, ht, img
    fh, fw, fht, flg = read_plane(stream, "FLAGS", 32, "i")
    if (fw, fht) != (w, ht):
        raise ValueError("FLAGS and IMAGE differ in size")
    return h, w, ht, img, fh, flg


def flags_at(fh, w, ht, flg, x, y):
    """Names of the contamination flags set within one pixel of array position (x, y)."""
    bits = 0
    for j in range(round(y) - 1, round(y) + 2):
        for i in range(round(x) - 1, round(x) + 2):
            if 0 <= i < w and 0 <= j < ht:
                bits |= flg[j * w + i]
    names = {int(k[4:]): v for k, v in fh.items() if k.startswith("MSKN") and k[4:].isdigit()}
    return sorted(n for b, n in names.items() if bits >> b & 1 and n not in INFO_FLAGS)


def read_wave_table(tail):
    """(X, Y, VALUES) of the WCS-WAVE binary table found in the last bytes of an L2 file."""
    found = [m.start() for m in re.finditer(rb"XTENSION= *'BINTABLE", tail)]
    if not found or b"WCS-WAVE" not in tail[found[-1]:found[-1] + 2880]:
        raise ValueError("no WCS-WAVE table in the file tail")
    at = found[-1]
    stream = io.BytesIO(tail[at:])
    h = read_header(stream)
    row, cols, off = stream.read(int(h["NAXIS1"])), {}, 0
    for f in range(1, int(h["TFIELDS"]) + 1):
        m = re.fullmatch(r"(\d*)([JE])", str(h[f"TFORM{f}"]))
        if not m:
            raise ValueError(f"unexpected WCS-WAVE column format {h[f'TFORM{f}']}")
        n = int(m[1] or 1)
        cols[h[f"TTYPE{f}"]] = struct.unpack_from(f">{n}{'i' if m[2] == 'J' else 'f'}", row, off)
        off += 4 * n
    xs, ys, vals = cols["X"], cols["Y"], cols["VALUES"]
    if len(vals) != 2 * len(xs) * len(ys):
        raise ValueError("WCS-WAVE VALUES does not match X and Y")
    return xs, ys, vals


def wavelength(h, table, x, y):
    """(um, bandwidth um) at 0-based cutout pixel (x, y) through the 'W' lookup-table WCS: a linear
    offset to the raw detector pixel, then bilinear interpolation in WCS-WAVE (as Astropy's -TAB).
    None outside the table."""
    if h.get("CTYPE1W") != "WAVE-TAB":
        return None
    xs, ys, vals = table
    rx, ry = h["CRVAL1W"] + x + 1 - h["CRPIX1W"], h["CRVAL2W"] + y + 1 - h["CRPIX2W"]
    if not (xs[0] <= rx <= xs[-1] and ys[0] <= ry <= ys[-1]):
        return None
    i = max(k for k in range(len(xs) - 1) if xs[k] <= rx)
    j = max(k for k in range(len(ys) - 1) if ys[k] <= ry)
    tx, ty = (rx - xs[i]) / (xs[i + 1] - xs[i]), (ry - ys[j]) / (ys[j + 1] - ys[j])

    def at(a, b, k):
        return vals[k + 2 * (a + len(xs) * b)]

    return tuple((1 - tx) * (1 - ty) * at(i, j, k) + tx * (1 - ty) * at(i + 1, j, k)
                 + (1 - tx) * ty * at(i, j + 1, k) + tx * ty * at(i + 1, j + 1, k) for k in (0, 1))


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


def reproject(h, w, ht, img, ra, dec, n=N):
    """Resample onto an n x n north-up, east-left grid centred on (ra, dec). None = no data."""
    to_pix = make_sky_to_pix(h)
    s, c, d0 = math.radians(PIX_ARCSEC / 3600), (n - 1) / 2, math.radians(dec)
    out = []
    for r in range(n):
        for col in range(n):
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


def fetch_tail(url, nbytes=23040):
    """The last bytes of the full file (an HTTP range request): where the small WCS-WAVE table sits,
    after the multi-MB PSF extension a cutout would make us download."""
    with fetch(urllib.request.Request(url, headers={"Range": f"bytes=-{nbytes}"})) as r:
        if r.status != 206:
            raise ValueError("archive ignored the range request")
        return r.read()


def cutout(url, ra, dec, size=SIZE_ARCMIN):
    with ThreadPoolExecutor(1) as pool:
        tail = pool.submit(fetch_tail, url)
        # 1.5x margin so the rotated north-up grid is fully covered.
        with fetch(f"{url}?center={ra},{dec}&size={size * 1.5}arcmin") as r:
            h, w, ht, img, fh, flg = read_image(r, flags=True)
        x, y = make_sky_to_pix(h)(ra, dec)
        try:
            um = wavelength(h, read_wave_table(tail.result()), x, y)
        except (OSError, ValueError, KeyError):
            um = None  # unknown stays unknown; the frame is still worth showing
    n = grid_n(size)
    return {"n": n, "mjd": h.get("MJD-AVG"), "det": h.get("DETECTOR"),
            "um": None if um is None else round(um[0], 4), "dum": None if um is None else round(um[1], 4),
            "flags": flags_at(fh, w, ht, flg, x, y), "pix": reproject(h, w, ht, img, ra, dec, n)}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        try:
            ra, dec = parse_angle(q["ra"][0], True), parse_angle(q["dec"][0], False)
            size = parse_size(q)
            url = q["url"][0] if "url" in q else None
            if url:
                check_url(url)
        except (KeyError, ValueError) as e:
            return self._send(400, {"error": f"need ra, dec (and optional SPHEREx url, size): {e}"})
        try:
            body = cutout(url, ra, dec, size) if url else {"ra": ra, "dec": dec, "frames": search(ra, dec)}
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

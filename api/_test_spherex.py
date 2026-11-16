"""Self-checks for the flipbook API (copied from nasa-dan-experiment). Run: python3 api/_test_spherex.py"""
import io, math, struct, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _spherex as sp

# --- coordinate parsing ---
assert abs(sp.parse_angle("08h55m10.831s", True) - 133.79513) < 1e-4
assert abs(sp.parse_angle("-7d14m42.53s", False) + 7.24515) < 1e-4
assert abs(sp.parse_angle("-0 30 00", False) + 0.5) < 1e-9
assert sp.parse_angle("133.795", True) == 133.795
for bad, is_ra in (("400", True), ("-91", False), ("abc", True), ("1 2 3 4", False)):
    try:
        sp.parse_angle(bad, is_ra)
        raise AssertionError(bad)
    except ValueError:
        pass

# --- release handling: every SPHEREx collection, one exposure once, preferred release wins ---
def row(coll, obs, band="D1", sub="science", typ="image", t="61000"):
    return {"obs_collection": coll, "obs_id": obs, "energy_bandpassname": f"SPHEREx-{band}",
            "dataproduct_subtype": sub, "dataproduct_type": typ, "access_url": f"https://x/{coll}/{obs}.fits",
            "t_min": t, "em_min": "7.5e-07", "em_max": "1.1e-06"}
fr = sp.pick_frames([row("spherex_qr3", "a", t="61300"), row("spherex_dr1", "a", t="61300"),
                     row("spherex_qr3", "b", t="61200"), row("spherex_dr1", "b", band="D2", t="61200"),
                     row("spherex_dr1_cube", "c", typ="cube"), row("spherex_dr1", "d", sub="calibration")])
assert [(f["rel"], f["band"]) for f in fr] == [("spherex_dr1", "D2"), ("spherex_qr3", "D1"), ("spherex_dr1", "D1")], fr
assert fr[2]["url"].endswith("spherex_dr1/a.fits") and fr[0]["um"] == [0.75, 1.1]
assert sorted(["spherex_qr3", "spherex_dr2", "spherex_dr1", "spherex_qr10"], key=sp.release_rank) == \
    ["spherex_dr2", "spherex_dr1", "spherex_qr10", "spherex_qr3"]

# --- SSRF guard ---
sp.check_url("https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/x/y.fits")
for bad in ("http://irsa.ipac.caltech.edu/ibe/data/spherex/a.fits", "https://evil.com/ibe/data/spherex/a.fits",
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/../../etc.fits",
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/a.fits?x=1", "https://irsa.ipac.caltech.edu/other/a.fits",
            "https://irsa.ipac.caltech.edu@evil.com/ibe/data/spherex/a.fits"):
    try:
        sp.check_url(bad)
        raise AssertionError(bad)
    except ValueError:
        pass


# --- WCS: synthetic rotated TAN-SIP frame ---
def tan_deproject(ra0, dec0, xi, eta):  # degrees in, degrees out
    a0, d0, xi, eta = map(math.radians, (ra0, dec0, xi, eta))
    den = math.cos(d0) - eta * math.sin(d0)
    return (math.degrees(a0 + math.atan2(xi, den)),
            math.degrees(math.atan2(math.sin(d0) + eta * math.cos(d0), math.hypot(xi, den))))


th, sc = math.radians(30), 6.15 / 3600
H = {"CRVAL1": 133.0, "CRVAL2": -7.0, "CRPIX1": 500.5, "CRPIX2": -300.5,
     "PC1_1": -sc * math.cos(th), "PC1_2": sc * math.sin(th), "PC2_1": sc * math.sin(th), "PC2_2": sc * math.cos(th),
     "A_2_0": 2e-6, "B_0_2": -3e-6, "A_1_1": 1e-6}
to_pix = sp.make_sky_to_pix(H)
x, y = to_pix(133.0, -7.0)
assert abs(x - 499.5) < 1e-6 and abs(y + 301.5) < 1e-6, (x, y)


def pix_to_sky(x, y):  # forward model for the test only
    u, v = x - H["CRPIX1"] + 1, y - H["CRPIX2"] + 1
    up, vp = u + H["A_2_0"] * u * u + H["A_1_1"] * u * v, v + H["B_0_2"] * v * v
    return tan_deproject(133.0, -7.0, H["PC1_1"] * up + H["PC1_2"] * vp, H["PC2_1"] * up + H["PC2_2"] * vp)


for px, py in ((20.3, 40.7), (88.0, 5.0)):
    rx, ry = to_pix(*pix_to_sky(px, py))
    assert abs(rx - px) < 1e-4 and abs(ry - py) < 1e-4, (px, py, rx, ry)

# --- reprojection: a star at the target lands in the centre, a star 1' north lands straight above it ---
W = 90
tra, tdec = pix_to_sky(45.0, 45.0)
nra, ndec = tra, tdec + 1 / 60
img = [0.0] * W * W
for sra, sdec in ((tra, tdec), (nra, ndec)):
    sx, sy = to_pix(sra, sdec)
    for j in range(W):
        for i in range(W):
            img[j * W + i] += math.exp(-((i - sx) ** 2 + (j - sy) ** 2) / 2)
out = sp.reproject(H, W, W, img, tra, tdec)
c = (sp.N - 1) // 2
peak = max(range(len(out)), key=lambda k: out[k] or -1)
assert peak == c * sp.N + c, divmod(peak, sp.N)
above = max(range(c * sp.N), key=lambda k: out[k] or -1)  # brightest pixel in the upper half
r, col = divmod(above, sp.N)
assert col == c and abs((c - r) - 60 / sp.PIX_ARCSEC) < 1, (r, col)


# --- FITS reader: stops before the trailing extension ---
def hdr(cards):
    s = "".join(f"{k:<8}= {v:>20}".ljust(80) for k, v in cards) + "END".ljust(80)
    return s.ljust(-(-len(s) // 2880) * 2880).encode()


body = struct.pack(">4f", 1, 2, 3, float("nan"))
fits = hdr([("SIMPLE", "T"), ("NAXIS", 0)]) + hdr([("XTENSION", "'IMAGE'"), ("EXTNAME", "'IMAGE'"), ("BITPIX", -32),
                                                     ("NAXIS", 2), ("NAXIS1", 2), ("NAXIS2", 2), ("MJD-AVG", 60800.5)])
fits += body.ljust(2880, b"\0") + b"PSF-EXTENSION-NOT-NEEDED"
h, w, ht, data = sp.read_image(io.BytesIO(fits))
assert (w, ht, h["MJD-AVG"]) == (2, 2, 60800.5) and data[:3] == (1, 2, 3) and math.isnan(data[3])

# --- FLAGS after IMAGE: names within one pixel of the target, informational bits left out ---
flg = struct.pack(">4i", 0, 1 << 25, 1 << 21, 0)
fits2 = fits.replace(b"PSF-EXTENSION-NOT-NEEDED", b"") + hdr(
    [("XTENSION", "'IMAGE'"), ("EXTNAME", "'FLAGS'"), ("BITPIX", 32), ("NAXIS", 2), ("NAXIS1", 2), ("NAXIS2", 2),
     ("MSKN0021", "'SOURCE'"), ("MSKN0025", "'STREAK'")]) + flg.ljust(2880, b"\0") + b"PSF"
h, w, ht, data, fh, flags = sp.read_image(io.BytesIO(fits2), flags=True)
assert flags == (0, 1 << 25, 1 << 21, 0)
assert sp.flags_at(fh, w, ht, flags, 0, 0) == ["STREAK"]  # 1 is SOURCE: information, not contamination
assert sp.flags_at(fh, w, ht, flags, 5, 5) == []  # outside the image

# --- WCS-WAVE lookup: a plane in raw detector pixels is recovered exactly by bilinear interpolation ---
xs, ys = (1, 101, 201), (1, 51)
vals = [v for y_ in ys for x_ in xs for v in (1.0 + 0.001 * x_ + 0.0001 * y_, 0.02)]
row = struct.pack(">3i2i12f", *xs, *ys, *vals)
tail = b"junk" * 300 + hdr([("XTENSION", "'BINTABLE'"), ("EXTNAME", "'WCS-WAVE'"), ("NAXIS1", len(row)),
                            ("TFIELDS", 3), ("TTYPE1", "'X'"), ("TFORM1", "'3J'"), ("TTYPE2", "'Y'"),
                            ("TFORM2", "'2J'"), ("TTYPE3", "'VALUES'"), ("TFORM3", "'12E'")]) + row
table = sp.read_wave_table(tail)
W_ = {"CTYPE1W": "WAVE-TAB", "CRVAL1W": 1, "CRVAL2W": 1, "CRPIX1W": -99.0, "CRPIX2W": -9.0}
um, bw = sp.wavelength(W_, table, 30.0, 20.0)  # raw pixel (131, 31)
assert abs(um - (1 + 0.131 + 0.0031)) < 1e-6 and abs(bw - 0.02) < 1e-7, (um, bw)
assert sp.wavelength(W_, table, 500.0, 0.0) is None and sp.wavelength({}, table, 0, 0) is None

# --- field of view bounds ---
assert sp.parse_size({}) == sp.SIZE_ARCMIN and sp.grid_n(sp.SIZE_ARCMIN) == sp.N == 59
for bad in ("1", "13", "nan"):
    try:
        sp.parse_size({"size": [bad]})
        raise AssertionError(bad)
    except ValueError:
        pass
print("ok")

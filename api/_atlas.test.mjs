// Leading underscore keeps Vercel from deploying this as a function. Run: node --test "api/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEpsf, parseCutout } from "./cutout.mjs";
import { parseObservations } from "./observations.mjs";

const L2 =
  "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W19_2B/l2b-v27-2026-198/3/level2_2025W19_2B_0101_1D3_spx_l2b-v27-2026-198.fits";

test("parseObservations keeps science FITS rows, converts metres to µm and sorts by time", () => {
  const csv = [
    "obs_id,dataproduct_subtype,energy_bandpassname,em_min,em_max,t_min,t_max,t_exptime,access_url,obs_collection",
    `b,science,SPHEREx-D6,4.41150e-06,5.00960e-06,60900.5,60900.6,113.5,${L2},spherex_dr1`,
    `a,science,SPHEREx-D3,1.63010e-06,2.43460e-06,60804.1,60804.2,113.5,${L2},spherex_dr1`,
    `c,auxiliary,SPHEREx-D3,1e-06,2e-06,60800,60800.1,1,${L2},spherex_dr1`,
  ].join("\n");
  const { rows, truncated } = parseObservations(csv);
  assert.equal(truncated, false);
  assert.deepEqual(
    rows.map((r) => [r.obsId, r.detector]),
    [
      ["a", 3],
      ["b", 6],
    ],
  );
  assert.ok(Math.abs(rows[0].emMin - 1.6301) < 1e-9);
  assert.throws(() => parseObservations("obs_id,access_url\nx,y"));
});

test("parseCutout accepts IRSA SPHEREx Level 2 images only, with a bounded size", () => {
  const p = (q) => parseCutout(new URLSearchParams(q));
  assert.deepEqual(p(`url=${encodeURIComponent(L2)}&size=0.05`), {
    url: L2,
    size: 0.05,
  });
  for (const url of [
    "https://example.com/x.fits",
    L2.replace("https://", "http://"),
    L2.replace("level2", "level2/../../secret"),
    L2.replace(".fits", ".fits?x=1"),
    "https://irsa.ipac.caltech.edu/ibe/data/wise/level2/x.fits",
  ])
    assert.equal(p(`url=${encodeURIComponent(url)}`), null, url);
  assert.equal(p(`url=${encodeURIComponent(L2)}&size=1`), null);
  assert.equal(p(`url=${encodeURIComponent(L2)}&size=0`), null);
});

function hdu(cards, dataBytes = 0) {
  const text = [...cards, "END"].map((c) => c.padEnd(80)).join("");
  const head = new Uint8Array(Math.ceil(text.length / 2880) * 2880).fill(32);
  for (let i = 0; i < text.length; i++) head[i] = text.charCodeAt(i);
  const data = new Uint8Array(Math.ceil(dataBytes / 2880) * 2880).fill(7);
  return [head, data];
}

test("dropEpsf removes only the EPSF table and refuses truncated files", () => {
  const parts = [
    ...hdu(["SIMPLE  = T", "BITPIX  = 8", "NAXIS   = 0"]),
    ...hdu(
      [
        "XTENSION= 'IMAGE'",
        "BITPIX  = -32",
        "NAXIS   = 2",
        "NAXIS1  = 3",
        "NAXIS2  = 2",
        "EXTNAME = 'IMAGE'",
      ],
      24,
    ),
    ...hdu(
      [
        "XTENSION= 'BINTABLE'",
        "BITPIX  = 8",
        "NAXIS   = 2",
        "NAXIS1  = 3000",
        "NAXIS2  = 2",
        "PCOUNT  = 0",
        "GCOUNT  = 1",
        "EXTNAME = 'EPSF'",
      ],
      6000,
    ),
    ...hdu(
      [
        "XTENSION= 'BINTABLE'",
        "BITPIX  = 8",
        "NAXIS   = 2",
        "NAXIS1  = 10",
        "NAXIS2  = 1",
        "PCOUNT  = 0",
        "GCOUNT  = 1",
        "EXTNAME = 'WCS-WAVE'",
      ],
      10,
    ),
  ];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  const out = dropEpsf(all);
  assert.equal(out.length, all.length - 2880 - 3 * 2880);
  const text = String.fromCharCode(...out);
  assert.ok(!text.includes("'EPSF'"));
  assert.ok(text.includes("'WCS-WAVE'"));
  assert.throws(() => dropEpsf(all.subarray(0, all.length - 2880)));
});

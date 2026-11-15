import assert from 'node:assert/strict';
import test from 'node:test';
import { GAIA_EPOCH_MJD, parseTsv, propagate, toGrid } from './catalog.ts';
import { aperture, centroid, fitLine, fitMotion, MJY_PER_SUM, PIX_ARCSEC } from './measure.ts';

/** Deterministic noise (LCG + Box–Muller), so the known-answer tests never flake. */
function noise(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** n × n grid, row 0 north, column 0 east: a Gaussian of `total` (summed MJy/sr) at (col, row). */
function star(n: number, col: number, row: number, total: number, sigma: number, seed = 1) {
  const g = noise(seed);
  const pix = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      pix[r * n + c] =
        (total / (2 * Math.PI)) * Math.exp(-((c - col) ** 2 + (r - row) ** 2) / 2) + sigma * g();
  return pix;
}

test('centroid recovers an injected offset, with honest errors', () => {
  const n = 21;
  const c = (n - 1) / 2;
  // 0.4 px west (column up) and 0.3 px north (row down)
  const pix = star(n, c + 0.4, c - 0.3, 400, 0.5);
  const m = centroid(pix, n);
  assert.ok(m);
  assert.ok(Math.abs(m.e - -0.4 * PIX_ARCSEC) < 4 * m.se + 0.15 * PIX_ARCSEC, `e ${m.e}`);
  assert.ok(Math.abs(m.n - 0.3 * PIX_ARCSEC) < 4 * m.sn + 0.15 * PIX_ARCSEC, `n ${m.n}`);
  assert.ok(m.se > 0 && m.se < 1, `se ${m.se}`);
});

test('centroid refuses noise and missing pixels', () => {
  const n = 21;
  assert.equal(centroid(star(n, 10, 10, 0, 1, 7), n), null);
  const holed = star(n, 10, 10, 400, 0.5);
  holed[10 * n + 10] = NaN;
  assert.equal(centroid(holed, n), null);
});

test('a straight-line fit returns the slope and its error', () => {
  const f = fitLine([0, 1, 2, 3], [1, 3, 5, 7], [1, 1, 1, 1]);
  assert.ok(Math.abs(f.b - 2) < 1e-12 && Math.abs(f.a - 1) < 1e-12);
  assert.ok(Math.abs(f.sb - 1 / Math.sqrt(5)) < 1e-12); // Σ(t − t̄)² = 5
});

test('motion fit recovers an injected proper motion (injection and recovery)', () => {
  const n = 21;
  const c = (n - 1) / 2;
  const pts = [];
  // 6.15″/yr east, i.e. one pixel per year toward column 0, over a year in 12 exposures
  for (let k = 0; k < 12; k++) {
    const yr = k / 11;
    const m = centroid(star(n, c - yr, c, 600, 0.5, 10 + k), n);
    assert.ok(m);
    pts.push({ mjd: 60500 + yr * 365.25, c: m });
  }
  const mo = fitMotion(pts);
  assert.ok(mo);
  // the first moment in a finite window is biased toward the peak pixel: allow 15 %
  assert.ok(Math.abs(mo.pmE - PIX_ARCSEC) < 0.15 * PIX_ARCSEC + 3 * mo.sE, `pmE ${mo.pmE}`);
  assert.ok(Math.abs(mo.pmN) < 3 * mo.sN + 0.3, `pmN ${mo.pmN}`);
  assert.equal(fitMotion(pts.slice(0, 3)), null);
});

test('aperture recovers the enclosed flux of a known Gaussian', () => {
  const n = 21;
  const ap = aperture(star(n, 10, 10, 1000, 0.2), n, 2);
  assert.ok(ap);
  // a unit-σ Gaussian puts 1 − e^(−2) inside r = 2 (pixel sampling adds a little)
  const expect = 1000 * (1 - Math.exp(-2)) * MJY_PER_SUM;
  assert.ok(Math.abs(ap.mjy - expect) < 0.05 * expect, `${ap.mjy} vs ${expect}`);
  assert.ok(ap.err > 0 && ap.err < 0.02 * expect);
});

test('Gaia rows parse, propagate and land on the grid', () => {
  const tsv = [
    '#comment',
    'RA_ICRS\tDE_ICRS\tpmRA\tpmDE\tGmag',
    'deg\tdeg\tmas/yr\tmas/yr\tmag',
    '-----\t-----\t-----\t-----\t-----',
    '269.44850\t+4.73966\t-801.551\t10362.394\t8.193',
    '269.45\t+4.75\t\t\t20.1',
    '',
  ].join('\n');
  const s = parseTsv(tsv);
  assert.equal(s.length, 2);
  assert.equal(s[1]?.pmra, null);
  const ten = propagate(s[0]!, GAIA_EPOCH_MJD + 10 * 365.25);
  assert.ok(Math.abs((ten.dec - 4.73966) * 3600 - 103.62394) < 1e-6);
  // a star 1 pixel north and 2 east of the centre
  const g = toGrid(
    10 + (2 * 6.15) / 3600 / Math.cos(0.5 * (Math.PI / 180)),
    0.5 + 6.15 / 3600,
    10,
    0.5,
    21,
  );
  assert.ok(Math.abs(g.col - 8) < 1e-3 && Math.abs(g.row - 9) < 1e-3, JSON.stringify(g));
});

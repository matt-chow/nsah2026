import assert from 'node:assert/strict';
import test from 'node:test';
import { ang2pixNest, ang2xyf, tilePixel } from './healpix.ts';

// Reference: Astropy WCS (RA---HPX/DEC--HPX header of SPHEREx DR1 cube tile Norder5/Npix445),
// all_pix2world at 0-based FITS pixel (x, y). Computed 2026-11-14.
const NPIX445 = [
  { x: 0, y: 0, ra: 62.30431189903847, dec: 51.25580694880488 },
  { x: 511, y: 0, ra: 61.19873447386922, dec: 52.79884109210949 },
  { x: 0, y: 511, ra: 60.001085147941836, dec: 49.70543178111776 },
  { x: 511, y: 511, ra: 58.84953425480769, dec: 51.25580694880488 },
  { x: 100, y: 300, ra: 60.71603019538188, dec: 50.64990223939157 },
];

test('cube tile pixels match the Astropy HPX WCS of a real SPHEREx tile', () => {
  for (const p of NPIX445) {
    const fits = tilePixel(5, 9, p.ra, p.dec, false);
    assert.equal(fits.tile, 445);
    assert.equal(fits.offset, p.y * 512 + p.x, `FITS (${p.x}, ${p.y})`);
    // PNG tiles are the same image with rows top-down
    assert.equal(tilePixel(5, 9, p.ra, p.dec, true).offset, (511 - p.y) * 512 + p.x);
  }
});

test('base faces and nested indices follow the HEALPix layout', () => {
  assert.equal(ang2pixNest(0, 0, 0), 4); // equatorial faces 4–7 start at RA 0
  assert.equal(ang2pixNest(0, 90, 0), 5);
  assert.equal(ang2pixNest(0, 45, 89.9), 0); // north polar faces 0–3
  assert.equal(ang2pixNest(0, 45, -89.9), 8); // south polar faces 8–11
  for (const [ra, dec] of [
    [10, 41],
    [266.4, -29],
    [83.8, -5.4],
    [359.99, 89.999],
    [0, -90],
  ] as const) {
    const n = ang2pixNest(12, ra, dec);
    assert.ok(n >= 0 && n < 12 * 4 ** 12);
    // a tile at order 3 with 2^9 pixels is the order-12 index with its low 18 bits dropped
    assert.equal(tilePixel(3, 9, ra, dec, false).tile, Math.floor(n / 4 ** 9));
    assert.equal(ang2pixNest(3, ra, dec), Math.floor(n / 4 ** 9));
  }
  const { ix, iy } = ang2xyf(16384, 270, 66.56);
  assert.ok(ix >= 0 && ix < 16384 && iy >= 0 && iy < 16384);
});

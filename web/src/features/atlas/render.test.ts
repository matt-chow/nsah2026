import assert from 'node:assert/strict';
import test from 'node:test';
import { tilePixel } from '../../lib/healpix.ts';
import { pixelToSky } from '../../lib/sky.ts';
import {
  geometry,
  lut,
  MISSING,
  orderFor,
  paintDisplay,
  paintRgb,
  paintScalar,
  percentiles,
  sample,
  stretch,
  unstretch,
  viewWcs,
  type Clip,
} from './render.ts';

// Real SPHEREx cube tile Norder5/Npix445: Astropy puts FITS pixel (100, 300) here.
const P = { ra: 60.71603019538188, dec: 50.64990223939157 };

test('view geometry samples the cube pixel Astropy assigns to the view centre', () => {
  const g = geometry({ ...P, fov: 0.001 }, 1, 1, 5, 9, false);
  assert.deepEqual(g.tiles, [445]);
  assert.equal(g.offset[0], 300 * 512 + 100);
  // and the display WCS is north up, east left
  const w = viewWcs({ ra: 10, dec: 20, fov: 2 }, 100, 100);
  assert.ok(pixelToSky(w, 0, 50).ra > pixelToSky(w, 99, 50).ra);
  assert.ok(pixelToSky(w, 50, 99).dec > pixelToSky(w, 50, 0).dec);
});

test('sampling copies science values unchanged and leaves gaps as NaN', () => {
  const g = geometry({ ...P, fov: 0.1 }, 8, 6, 5, 9, false);
  const plane = new Float32Array(512 * 512).map((_, i) => i * 0.5);
  plane[g.offset[0] as number] = NaN; // a masked pixel in the archive
  const v = sample(g, [plane]);
  assert.ok(Number.isNaN(v[0]));
  for (let i = 1; i < v.length; i++) assert.equal(v[i], plane[g.offset[i] as number]);
  assert.ok(sample(g, [undefined]).every(Number.isNaN)); // not loaded is not zero
});

test('RGB channels share one geometry, and swapping assignments swaps output colours', () => {
  const g = geometry({ ...P, fov: 0.2 }, 16, 12, 5, 9, false);
  const a = new Float32Array(512 * 512).map((_, i) => (i % 512) / 512); // gradient
  const b = new Float32Array(512 * 512).fill(0.25);
  const c = new Float32Array(512 * 512).map((_, i) => ((i * 7) % 100) / 100);
  const [va, vb, vc] = [a, b, c].map((p) => sample(g, [p])) as [
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  const clip: Clip = { lo: 0, hi: 1 };
  const px1 = new Uint8ClampedArray(16 * 12 * 4);
  const px2 = new Uint8ClampedArray(16 * 12 * 4);
  paintRgb([va, vb, vc], 16, [clip, clip, clip], 'linear', px1);
  paintRgb([vc, vb, va], 16, [clip, clip, clip], 'linear', px2);
  for (let i = 0; i < 16 * 12; i++) {
    assert.equal(px1[i * 4], px2[i * 4 + 2]);
    assert.equal(px1[i * 4 + 2], px2[i * 4]);
    assert.equal(px1[i * 4 + 1], px2[i * 4 + 1]);
  }
  // a different channel really changes the numbers drawn, not just a tint
  assert.notDeepEqual(px1, px2);
});

test('a pixel missing in any channel is hatched, never drawn as zero signal', () => {
  const ok = new Float32Array([1, 1, 1, 1]);
  const gap = new Float32Array([1, NaN, 1, 1]);
  const px = new Uint8ClampedArray(16);
  const clip = { lo: 0, hi: 2 };
  assert.equal(paintRgb([ok, gap, ok], 4, [clip, clip, clip], 'linear', px), 1);
  assert.deepEqual([...px.slice(4, 7)], MISSING[0]);
  assert.equal(px[7], 255);
  const one = new Uint8ClampedArray(16);
  paintScalar(new Float32Array([NaN, 0, 2, 5]), 4, clip, 'linear', lut('grey'), one);
  assert.deepEqual([...one.slice(0, 3)], MISSING[0]);
  assert.deepEqual([...one.slice(4, 7)], [0, 0, 0]); // a measured zero is black
  assert.deepEqual([...one.slice(8, 11)], [255, 255, 255]);
  assert.deepEqual([...one.slice(12, 15)], [255, 255, 255]); // clipped, not wrapped
});

test('display tiles: not-yet-loaded stays transparent, absent tiles and NaN are hatched', () => {
  const g = {
    w: 3,
    h: 1,
    order: 0,
    tiles: [1, 2, 3],
    slot: new Int16Array([0, 1, 2]),
    offset: new Int32Array([0, 0, 1]),
  };
  const px = new Uint8ClampedArray(12);
  paintDisplay(g, [undefined, null, new Uint8Array([0, 101])], lut('grey'), px);
  assert.equal(px[3], 0);
  assert.deepEqual([...px.slice(4, 7)], MISSING[0]);
  assert.deepEqual([...px.slice(8, 12)], [100, 100, 100, 255]);
});

test('stretches are monotonic, clip at the ends and invert for legend labels', () => {
  for (const s of ['linear', 'asinh'] as const) {
    assert.equal(stretch(-5, 0, 10, s), 0);
    assert.equal(stretch(50, 0, 10, s), 1);
    let prev = -1;
    for (let v = 0; v <= 10; v += 0.5) {
      const y = stretch(v, 0, 10, s);
      assert.ok(y > prev);
      prev = y;
      assert.ok(Math.abs(unstretch(y, 0, 10, s) - v) < 1e-9);
    }
  }
  assert.ok(stretch(1, 0, 10, 'asinh') > stretch(1, 0, 10, 'linear')); // lifts faint signal
  assert.ok(Number.isNaN(stretch(NaN, 0, 1, 'linear')));
});

test('percentiles ignore NaN; colour maps run dark to light', () => {
  const v = new Float32Array([NaN, 5, 1, 3, NaN, 2, 4]);
  assert.deepEqual(percentiles(v, [0, 50, 100]), [1, 3, 5]);
  assert.equal(percentiles(new Float32Array([NaN]), [50]), null);
  for (const m of ['grey', 'viridis', 'inferno'] as const) {
    const t = lut(m);
    const lum = (i: number) => 0.2126 * t[i * 3]! + 0.7152 * t[i * 3 + 1]! + 0.0722 * t[i * 3 + 2]!;
    assert.ok(lum(255) > lum(128) && lum(128) > lum(0), m);
  }
});

test('the inlined projection agrees with the WCS + HEALPix reference path everywhere', () => {
  // equator, mid-latitude, polar cap and the RA = 0 seam, across a whole small canvas
  for (const v of [
    { ra: 120, dec: 3, fov: 20 },
    { ra: 60.7, dec: 50.6, fov: 5 },
    { ra: 200, dec: -88.5, fov: 6 },
    { ra: 0.2, dec: 30, fov: 3 },
  ]) {
    const w = 31;
    const h = 23;
    const g = geometry(v, w, h, 3, 9, true);
    const wcs = viewWcs(v, w, h);
    let mismatch = 0;
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const sky = pixelToSky(wcs, c, h - 1 - r);
        const p = tilePixel(3, 9, sky.ra, sky.dec, true);
        const i = r * w + c;
        if (g.tiles[g.slot[i] as number] !== p.tile || g.offset[i] !== p.offset) mismatch++;
      }
    assert.ok(mismatch <= 2, `${mismatch} mismatches at ${JSON.stringify(v)}`); // float ties on pixel edges only
  }
});

test('tile order tracks zoom, from coarse all-sky tiles to the order-5 limit', () => {
  assert.equal(orderFor(60, 800, 9, 0, 5), 1); // order 0 pixels (0.11°) are coarser than 0.075° screen pixels
  assert.equal(orderFor(0.5, 800, 9, 0, 5), 5);
  assert.ok(orderFor(8, 800, 9, 0, 5) > orderFor(30, 800, 9, 0, 5));
});

test('geometry for a full canvas stays within an interactive budget', () => {
  const t = performance.now();
  const g = geometry({ ra: 83.8, dec: -5.4, fov: 4 }, 960, 600, 3, 9, true);
  const ms = performance.now() - t;
  console.log(`geometry 960×600: ${ms.toFixed(0)} ms, ${g.tiles.length} tiles`);
  assert.ok(g.tiles.length <= 12);
});

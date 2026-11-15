import assert from 'node:assert/strict';
import test from 'node:test';
import { ang2pixNest } from '../lib/healpix.ts';
import { domeGeometry, flight, separation, toScreen, toSky } from './projection.ts';

const close = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('the view centre lands mid-screen, north is up and east is left', () => {
  const v = { ra: 90, dec: -66.5607, fov: 10 };
  const c = toScreen(v, 800, 600, 90, -66.5607);
  close(c?.x ?? NaN, 400, 1e-9);
  close(c?.y ?? NaN, 300, 1e-9);
  const north = toScreen(v, 800, 600, 90, -65);
  assert.ok(north && north.y < 300 && Math.abs(north.x - 400) < 1e-6);
  const east = toScreen(v, 800, 600, 91, -66.5607);
  assert.ok(east && east.x < 400);
});

test('the horizontal edge sits half the field of view from the centre', () => {
  for (const fov of [1, 60, 150]) {
    const v = { ra: 200, dec: 10, fov };
    const edge = toSky(v, 1000, 700, 0, 350);
    close(separation(v, { ra: edge.ra, dec: edge.dec, fov }), fov / 2, 1e-9);
  }
});

test('screen → sky → screen round-trips across a wide field', () => {
  const v = { ra: 266.4, dec: -28.9, fov: 120 };
  for (const [x, y] of [
    [10, 10],
    [640, 360],
    [1270, 700],
    [300, 650],
  ] as const) {
    const s = toSky(v, 1280, 720, x, y);
    const p = toScreen(v, 1280, 720, s.ra, s.dec);
    close(p?.x ?? NaN, x, 1e-6);
    close(p?.y ?? NaN, y, 1e-6);
  }
});

test('dome geometry picks the HEALPix tile under each pixel at both orders', () => {
  const v = { ra: 83.82, dec: -5.39, fov: 3 };
  const g = domeGeometry(v, 64, 48, 4, 9);
  for (const [c, r] of [
    [0, 0],
    [32, 24],
    [63, 47],
  ] as const) {
    const s = toSky(v, 64, 48, c + 0.5, r + 0.5);
    const i = r * 64 + c;
    assert.equal(g.tiles[g.slot[i] as number], `4/${ang2pixNest(4, s.ra, s.dec)}`);
    assert.equal(g.tiles[g.slot2[i] as number], `1/${ang2pixNest(1, s.ra, s.dec)}`);
  }
});

test('a flight starts and ends on its endpoints and widens to show both', () => {
  const a = { ra: 83.8, dec: -5.4, fov: 2 };
  const b = { ra: 90, dec: -66.56, fov: 2 };
  const s = flight(a, b, 0);
  const e = flight(a, b, 1);
  close(separation(s, a), 0, 1e-6);
  close(separation(e, b), 0, 1e-6);
  close(e.fov, 2, 1e-9);
  assert.ok(flight(a, b, 0.5).fov > 60);
});

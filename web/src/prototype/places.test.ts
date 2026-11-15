import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toFrame } from './live.ts';
import { parseAngle, parseCoords, TARGETS } from './places.ts';

const near = (a: number | null | undefined, b: number) =>
  assert.ok(a != null && Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test('angles read as degrees or sexagesimal, RA in hours', () => {
  near(parseAngle('133.795', true), 133.795);
  near(parseAngle('08h55m10.8s', true), (8 + 55 / 60 + 10.8 / 3600) * 15);
  near(parseAngle('08:55:10.8', true), (8 + 55 / 60 + 10.8 / 3600) * 15);
  near(parseAngle('−7d14m42.5s', false), -(7 + 14 / 60 + 42.5 / 3600));
  near(parseAngle('-0.5', false), -0.5);
  assert.equal(parseAngle('360', true), null);
  assert.equal(parseAngle('91', false), null);
  assert.equal(parseAngle('barnard', true), null);
  assert.equal(parseAngle('', true), null);
});

test('coordinates split at a comma, a signed Dec or the only space', () => {
  assert.deepEqual(parseCoords('269.4463, 4.7679'), { ra: 269.4463, dec: 4.7679 });
  assert.deepEqual(parseCoords('269.4463 4.7679'), { ra: 269.4463, dec: 4.7679 });
  near(parseCoords('08h55m10.8s -7d14m42.5s')?.dec, -(7 + 14 / 60 + 42.5 / 3600));
  near(parseCoords('08 55 10.8 −07 14 42.5')?.ra, (8 + 55 / 60 + 10.8 / 3600) * 15);
  assert.equal(parseCoords('wise 0855'), null);
});

test('each challenge target matches its baked copy', () => {
  for (const t of TARGETS) {
    const d = JSON.parse(readFileSync(`../data/targets/${t.id}.json`, 'utf8')) as {
      ra: number;
      dec: number;
      band: string;
      cutouts: Record<string, unknown>;
    };
    assert.deepEqual([d.ra, d.dec, d.band], [t.ra, t.dec, t.band], t.id);
    const first = Object.values(d.cutouts)[0];
    assert.ok(toFrame(first), `${t.id} has a readable cutout`);
  }
});

test('cutouts are checked, and missing metadata reads as unknown', () => {
  const f = toFrame({ n: 2, mjd: 60500, pix: [1, null, 3, 4], det: 1, um: 0.8, flags: ['STREAK'] });
  assert.ok(f);
  assert.ok(Number.isNaN(f.pix[1]));
  assert.deepEqual([f.det, f.um, f.dum, f.flags], [1, 0.8, null, ['STREAK']]);
  assert.equal(toFrame({ n: 2, pix: [1, 2, 3] }), null);
  assert.equal(toFrame(null), null);
  assert.equal(toFrame({ n: 1, pix: [0] })?.flags, null);
});

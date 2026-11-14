import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointing, STEPS } from './scan.ts';
import { ANCHORS, FACES, shade, shift, view } from './model.ts';

test('51 pointings sample each of the 102 channels exactly once, short and long together', () => {
  const seen = new Set<number>();
  for (let i = 0; i < STEPS; i++) {
    const [short, long] = pointing(i).samples;
    assert.ok(short && long);
    assert.ok(short.detector <= 3 && long.detector >= 4);
    assert.equal(long.detector, short.detector + 3);
    seen.add(short.index).add(long.index);
  }
  assert.equal(seen.size, 102);
});

test('the schematic camera puts the shields above the bus and turns with yaw', () => {
  const cam = { yaw: 0, pitch: 0, scale: 100 };
  assert.ok(view(ANCHORS.shields, cam).y < view(ANCHORS.bus, cam).y);
  const a = view(ANCHORS.solar, cam);
  const b = view(ANCHORS.solar, { ...cam, yaw: Math.PI });
  assert.ok(Math.sign(a.x) !== Math.sign(b.x));
});

test('the solid schematic lights faces in 0..1 and the exploded view lifts the shields', () => {
  const cam = { yaw: -0.6, pitch: 0.32, scale: 1 };
  for (const f of FACES) {
    const s = shade(f.pts, cam);
    assert.ok(s >= 0 && s <= 1, String(s));
  }
  assert.ok(view(shift(ANCHORS.shields, 'shields', 1), cam).y < view(ANCHORS.shields, cam).y);
  assert.deepEqual(shift(ANCHORS.focal, 'focal', 1), ANCHORS.focal);
});

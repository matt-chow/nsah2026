// Sky Flipbook browser helpers (data/flipbook/*.js): playback scheduling, the shared stretch, and atlas field limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ends, makeStretch, medianImage, nextFrame, nextPending, pack } from '../data/flipbook/playback.js';
import { backdrop } from '../data/flipbook/atlas.js';

const F = s => [...s].map(c => ({ state: { o: 'ok', f: 'failed', p: 'pending', l: 'loading' }[c] }));

test('playback waits for loading frames, skips failed ones, and wraps only when looping', () => {
  assert.equal(nextFrame(F('oofo'), 1, false), 3);
  assert.equal(nextFrame(F('oolo'), 1, false), -1);
  assert.equal(nextFrame(F('ooo'), 2, false), null);
  assert.equal(nextFrame(F('ooo'), 2, true), 0);
  assert.equal(nextFrame(F('fof'), 1, true), 1);
  assert.equal(nextFrame(F('fff'), 0, true), null);
});

test('loading starts at the cursor, wraps, and serves a waited-on frame first', () => {
  assert.equal(nextPending(F('ppoo'), 2, -1), 0);
  assert.equal(nextPending(F('pppp'), 2, -1), 2);
  assert.equal(nextPending(F('pppp'), 0, 3), 3);
  assert.equal(nextPending(F('olfo'), 0, -1), -1);
});

test('blink ends are the first and last loaded frames', () => {
  assert.deepEqual(ends(F('fopof')), [1, 3]);
  assert.equal(ends(F('fpf')), null);
});

test('median image ignores missing pixels, and the stretch keeps no-data distinct', () => {
  const med = medianImage([Float32Array.of(1, NaN, 5), Float32Array.of(3, NaN, 1), Float32Array.of(2, 4, NaN)]);
  assert.deepEqual([...med].map(String), ['2', '4', '5']);
  const s = makeStretch(Float32Array.from({ length: 1000 }, (_, i) => i), null);
  assert.equal(s(NaN), 0);
  assert.equal(s(500), 1);  // background → level 0
  assert.equal(s(999), 255);  // bright end → level 254
  assert.ok(s(700) > s(600));
  assert.deepEqual([...pack(Float32Array.of(NaN, 500), s)], [0, 1]);
});

test('the stretch maps background and bright end onto the atlas levels under the exposure', () => {
  const atlas = Uint8Array.from({ length: 1000 }, (_, i) => (i < 10 ? 0 : 101 + (i % 50)));  // levels 100–149
  const s = makeStretch(Float32Array.from({ length: 1000 }, (_, i) => i), atlas);
  assert.equal(s(500) - 1, 125);
  assert.equal(s(999) - 1, 189);  // contrast floor: at least 64 levels above the background
});

test('the atlas field fits the tile budget for every preset, including near the pole', async () => {
  const urls = [];
  globalThis.fetch = async url => (urls.push(url), new Response('', { status: 404 }));
  for (const [ra, dec] of [[269.4463, 4.7679], [331.0964, -56.8006], [133.76, -7.2422], [76.956, 30.401],
                           [248.167, 66.755], [270, 66.56], [0, 89.9], [45, 41.8]]) {
    urls.length = 0;
    const lv = await backdrop(1024, ra, dec, 1.5, 8);
    assert.ok(urls.length > 0 && urls.length <= 16, `${ra},${dec}: ${urls.length} tiles`);
    assert.ok(lv.every(v => v === 0), 'no tile → every pixel is no-data');
  }
});

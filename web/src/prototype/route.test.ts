import assert from 'node:assert/strict';
import test from 'node:test';
import type { Manifest } from '../types/manifest.ts';
import { holdMs, makeStretch, medianImage } from './live.ts';
import { parseRoute, routeHash } from './route.ts';
import { checkSaved, versionsOf, type CuratedCompare } from './store.ts';

test('routes round-trip through the hash; anything else is the welcome', () => {
  for (const r of ['sky', 'flipbook', 'analysis', 'spacecraft', 'notebook'] as const)
    assert.equal(parseRoute(routeHash(r)), r);
  assert.equal(parseRoute(''), 'welcome');
  assert.equal(parseRoute('#/nowhere'), 'welcome');
  assert.equal(parseRoute('#/sky?x=1'), 'sky');
});

test('elapsed-time playback holds long gaps longer, within the cap; equal does not', () => {
  const mjds = [0, 1, 2, 3, 103];
  assert.equal(holdMs(mjds, 3, 'equal', 4), 250);
  assert.equal(holdMs(mjds, 0, 'elapsed', 4), 250); // a typical one-day gap
  assert.equal(holdMs(mjds, 3, 'elapsed', 4), 1000); // 100 days, capped at 4 steps
  assert.equal(holdMs(mjds, 4, 'elapsed', 4), 250); // wrap-around
});

test('shared stretch: no data stays no data, median maps to the bottom', () => {
  const a = Float32Array.from([1, 2, NaN, 4]);
  const m = medianImage([a, Float32Array.from([3, 2, NaN, 4]), a]);
  assert.deepEqual(
    [...m].map((v) => (Number.isNaN(v) ? 'nan' : v)),
    [1, 2, 'nan', 4],
  );
  const s = makeStretch(Float32Array.from([0, 0, 0, 10]));
  assert.equal(s(NaN), 0);
  assert.equal(s(0), 1);
  assert.equal(s(10), 255);
});

const obs = (id: string, cal: string) => ({
  observation_id: id,
  provenance: { calibration_version: cal },
});
const manifest = (cal: string, tool = '0.4.0') =>
  ({
    schema_version: '1.1.0',
    generated_by: { tool: 'parallax', version: tool, command: '' },
    observations: [obs('a', cal), obs('b', cal)],
    template: { display_png: 't.png' },
    candidates: [{ candidate_id: 'c1' }],
  }) as unknown as Manifest;

test('a saved comparison reports missing visits and changed processing honestly', () => {
  const m = manifest('l2b-v27');
  const saved: CuratedCompare = {
    kind: 'curated',
    placeId: 'sep',
    manifestId: 'sep-d4',
    a: 'a',
    b: 'typical',
    candidate: 'c1',
    mode: 'blink',
    zoom: 1,
    pan: { x: 0, y: 0 },
    versions: versionsOf(m, ['a']),
  };
  assert.deepEqual(checkSaved(saved, m), { missing: [], changed: [] });
  const later = checkSaved({ ...saved, a: 'gone', candidate: 'c9' }, manifest('l2b-v28', '0.5.0'));
  assert.equal(later.missing.length, 1);
  assert.match(later.changed.join(' '), /c9/);
  assert.match(later.changed.join(' '), /0\.4\.0 when saved, now parallax 0\.5\.0/);
  assert.match(checkSaved(saved, manifest('l2b-v28')).changed.join(), /l2b-v27 when saved/);
});

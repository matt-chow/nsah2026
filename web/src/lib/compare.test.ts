import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkPair } from './compare.ts';
import { parseManifest } from './manifest.ts';
import { interval, longDate } from './time.ts';

const load = (id: string) => {
  return parseManifest(
    JSON.parse(
      readFileSync(new URL(`../../../data/manifests/${id}.json`, import.meta.url), 'utf8'),
    ),
  );
};

test('checkPair refuses incompatible pairs in either order, with the pipeline reasons', () => {
  const m = load('synthetic-fixture');
  const [e1, , e3] = m.observations.map((o) => o.observation_id) as [string, string, string];
  for (const [a, b] of [
    [e1, e3],
    [e3, e1],
  ] as const) {
    const r = checkPair(m, a, b);
    assert.equal(r.status, 'incompatible');
    assert.ok('reasons' in r && r.reasons.some((x) => x.includes('detectors')));
  }
  assert.equal(checkPair(m, e1, e1).status, 'same');
  assert.equal(checkPair(m, e1, 'nope').status, 'unknown');
});

test('every pair in the real fields is checked and compatible', () => {
  for (const id of ['nep-d2', 'sep-d4']) {
    const ids = load(id).observations.map((o) => o.observation_id);
    const m = load(id);
    for (const a of ids) for (const b of ids) assert.notEqual(checkPair(m, a, b).status, 'unknown');
  }
});

test('reader-facing dates and intervals', () => {
  assert.equal(longDate(60840), '14 Jun 2025');
  assert.equal(interval(0.5), '12 hours');
  assert.equal(interval(-12), '12 days');
  assert.equal(interval(183), '6 months');
  assert.equal(interval(730.5), '2.0 years');
});

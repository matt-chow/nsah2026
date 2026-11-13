import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isSafeRelativePath, ManifestError, parseManifest } from './manifest.ts';
import { parseDegrees, separationDeg } from './coords.ts';

const fixtureUrl = new URL('../../../data/manifests/synthetic-fixture.json', import.meta.url);
const fixture = () => JSON.parse(readFileSync(fixtureUrl, 'utf-8'));

test('committed synthetic fixture parses and is labelled simulated', () => {
  const m = parseManifest(fixture());
  assert.equal(m.data_kind, 'simulated');
  assert.ok(m.notice?.includes('SIMULATED'));
  assert.equal(m.observations.length, 3);
});

test('rejects unsupported schema, unlabelled simulation, kind mixing, unsafe paths', () => {
  const cases: ((m: Record<string, any>) => void)[] = [
    (m) => (m.schema_version = '2.0.0'),
    (m) => (m.notice = null),
    (m) => (m.observations[0].data_kind = 'real'),
    (m) => (m.observations[0].assets.display_png = '../../etc/x.png'),
    (m) => (m.observations = []),
  ];
  for (const mutate of cases) {
    const m = fixture();
    mutate(m);
    assert.throws(() => parseManifest(m), ManifestError);
  }
  assert.equal(isSafeRelativePath('fixtures/a/b.png'), true);
  assert.equal(isSafeRelativePath('C:/b.png'), false);
});

test('parseDegrees enforces ranges', () => {
  assert.deepEqual(parseDegrees(' 180.5 ', 0, 360, false), { ok: true, value: 180.5 });
  assert.equal(parseDegrees('360', 0, 360, false).ok, false);
  assert.equal(parseDegrees('90', -90, 90, true).ok, true);
  assert.equal(parseDegrees('12h30m', 0, 360, false).ok, false);
});

test('separationDeg', () => {
  assert.ok(Math.abs(separationDeg(0, 0, 90, 0) - 90) < 1e-9);
  assert.ok(Math.abs(separationDeg(359.9, 0, 0.1, 0) - 0.2) < 1e-9);
  assert.ok(Math.abs(separationDeg(10, 89.9, 190, 89.9) - 0.2) < 1e-9);
});

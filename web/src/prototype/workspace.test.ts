import assert from 'node:assert/strict';
import test from 'node:test';
import type { Manifest } from '../types/manifest.ts';
import { checkSaved, type CuratedCompare, type Pin } from './store.ts';
import { artifactSigns, comparePins, pinFacts, qualityChecks } from './workspace.ts';

const ob = (id: string, mjd: number, notes: string[] = ['L2 DQA: Pass']) => ({
  observation_id: id,
  epoch: { mjd_mid: mjd },
  spectral: {
    detector: 4,
    wavelength_center_um: 2.56,
    wavelength_min_um: 2.4,
    wavelength_max_um: 2.7,
  },
  quality: { notes, variance_available: true },
  provenance: { calibration_version: 'l2b-v27' },
});
const candidate = (id: string) => ({
  candidate_id: id,
  status: 'likely_artifact',
  measurements: [
    { name: 'aperture flux change', value: 900, uncertainty: 30, unit: 'uJy' },
    { name: 'wavelength', value: 2.56, uncertainty: null, unit: 'um' },
  ],
  light_curve: [
    { observation_id: 'a', mjd_mid: 1, delta_flux_ujy: 900, uncertainty_ujy: 30 },
    { observation_id: 'b', mjd_mid: 2, delta_flux_ujy: null, uncertainty_ujy: null },
  ],
  evidence: ['peak +30 sigma', 'touches pixels flagged PERSIST', 'reference flux 12 uJy'],
});
const field = (id = 'f', comparisons: unknown[] = []) =>
  ({
    manifest_id: id,
    schema_version: '1.1.0',
    generated_by: { tool: 'parallax', version: '0.4.0', command: '' },
    observations: [ob('a', 1), ob('b', 2, [])],
    template: { observation_ids: ['a', 'b'], display_png: 't.png' },
    differences: [{ observation_id: 'a', status: 'validated', threshold_sigma: 5, reasons: [] }],
    comparisons,
    candidates: [candidate('c1')],
  }) as unknown as Manifest;
const status = (cs: ReturnType<typeof qualityChecks>, id: string) =>
  cs.find((c) => c.id === id)?.status;

test('quality: recorded passes pass, missing checks are not assessed, never passed', () => {
  const m = field();
  const c = m.candidates[0];
  const t = qualityChecks(m, 'a', 'typical', c);
  assert.equal(status(t, 'dqa-A'), 'passed');
  assert.equal(status(t, 'masked'), 'passed');
  assert.equal(status(t, 'pair'), 'passed'); // A is in the typical image
  assert.equal(status(t, 'diff'), 'passed');
  assert.equal(status(t, 'psf'), 'not-assessed');
  assert.equal(status(t, 'catalog'), 'not-assessed');

  const u = qualityChecks(m, 'b', 'a', c);
  assert.equal(status(u, 'dqa-A'), 'not-assessed'); // b has no DQA note
  assert.equal(status(u, 'masked'), 'caution'); // masked on b
  assert.equal(status(u, 'pair'), 'not-assessed'); // the pipeline recorded no check
  assert.equal(status(u, 'diff'), 'not-assessed'); // no difference image for b
  assert.ok(!u.some((x) => x.status === 'passed' && x.id === 'pair'));

  const bad = field('f', [
    { reference_id: 'a', target_id: 'b', status: 'incompatible', reasons: ['different grid'] },
  ]);
  assert.equal(status(qualityChecks(bad, 'a', 'b', c), 'pair'), 'failed');
  assert.equal(status(qualityChecks(m, 'a', 'b', undefined), 'masked'), undefined);
});

test('artifact signs are the pipeline evidence that points at a detector cause', () => {
  assert.deepEqual(artifactSigns(field().candidates[0] as never), [
    'touches pixels flagged PERSIST',
  ]);
});

const pin = (id: string, manifestId: string): Pin => ({
  kind: 'candidate',
  id,
  label: id,
  placeId: 'p',
  manifestId,
  candidate: 'c1',
});

test('pins: same field shares dates and syncs; another field flags wavelength and dates', () => {
  const near = field('near');
  const far = field('far');
  (far.observations as unknown as ReturnType<typeof ob>[]).forEach((o) => {
    o.spectral.detector = 2;
  });
  far.candidates[0]!.measurements[1]!.value = 1.45;
  far.candidates[0]!.light_curve.forEach((l) => (l.mjd_mid += 100));
  const ms = { near, far };
  const a = pinFacts(pin('x', 'near'), ms)!;
  const same = comparePins(a, pinFacts(pin('y', 'near'), ms)!);
  assert.equal(same.syncDates, true);
  assert.ok(!same.issues.some((i) => /wavelength|detector|shared/i.test(i)));
  assert.ok(same.issues.some((i) => /1 of 2 dates masked/.test(i)));

  const other = comparePins(a, pinFacts(pin('z', 'far'), ms)!);
  assert.equal(other.syncDates, false);
  assert.ok(other.issues.some((i) => /Different detectors \(D4 and D2\)/.test(i)));
  assert.ok(other.issues.some((i) => /Different wavelengths/.test(i)));
  assert.ok(other.issues.some((i) => /No shared dates/.test(i)));

  assert.equal(pinFacts(pin('w', 'unloaded'), ms), null);
});

test('pins: an archive region has no measurements and no known wavelength', () => {
  const arch: Pin = {
    kind: 'archive',
    id: 'r',
    label: 'Region',
    compare: {
      kind: 'archive',
      ra: 1,
      dec: 2,
      band: 'D4',
      a: { url: 'u1', mjd: 1, um: [2.4, 2.7] },
      b: { url: 'u2', mjd: 2, um: [2.4, 2.7] },
      mode: 'blink',
      zoom: 1,
    },
  };
  const r = comparePins(pinFacts(pin('x', 'f'), { f: field() })!, pinFacts(arch, {})!);
  assert.equal(r.syncDates, false);
  assert.ok(r.issues.some((i) => /Region: no measurements/.test(i)));
  assert.ok(r.issues.some((i) => /wavelength at this point not known/.test(i)));
});

test('a saved investigation reports a pinned spot that has gone', () => {
  const m = field('f');
  const saved: CuratedCompare = {
    kind: 'curated',
    placeId: 'p',
    manifestId: 'f',
    a: 'a',
    b: 'typical',
    candidate: 'c1',
    mode: 'one',
    zoom: 1,
    pan: { x: 0, y: 0 },
    pins: [{ ...pin('x', 'f'), candidate: 'gone' } as Pin, pin('y', 'other')],
  };
  assert.deepEqual(checkSaved(saved, m).changed, ['the pinned spot gone is no longer listed']);
});

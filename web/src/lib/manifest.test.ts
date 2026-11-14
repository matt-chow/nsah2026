import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  displayTitle,
  isSafeRelativePath,
  ManifestError,
  parseIndex,
  parseManifest,
} from './manifest.ts';
import {
  decodeSigma,
  divergingRgb,
  formatDec,
  formatRa,
  pixelToSky,
  skyToPixel,
  tanWcs,
} from './sky.ts';
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

const read = (rel: string) =>
  JSON.parse(readFileSync(new URL(`../../../data/${rel}`, import.meta.url), 'utf-8'));

test('field index and every real manifest it lists parse; candidates sit on the grid', () => {
  const fields = parseIndex(read('manifests/index.json'));
  assert.ok(fields.some((f) => f.data_kind === 'real'));
  for (const f of fields) {
    const m = parseManifest(read(f.path));
    assert.equal(m.data_kind, f.data_kind);
    if (m.data_kind !== 'real') continue;
    assert.ok(m.observations.every((o) => o.provenance.source_url && o.provenance.source_sha256));
    const w = tanWcs(m.observations[0]!.image.wcs)!;
    for (const c of m.candidates) {
      const p = skyToPixel(w, c.ra_deg, c.dec_deg);
      assert.ok(Math.hypot(p.x - c.pixel_x, p.y - c.pixel_y) < 0.6, c.candidate_id);
    }
  }
});

test('rejects differences and candidates that point at unknown epochs or unsafe paths', () => {
  const real = () => read('manifests/nep-d2.json');
  const cases: ((m: Record<string, any>) => void)[] = [
    (m) => (m.differences[0].observation_id = 'nope'),
    (m) => (m.differences[0].display_png = '/abs.png'),
    (m) => (m.candidates[0].observation_ids = ['nope']),
    (m) => (m.template.display_png = '../x.png'),
  ];
  for (const mutate of cases) {
    const m = real();
    mutate(m);
    assert.throws(() => parseManifest(m), ManifestError);
  }
});

test('TAN pixel/sky round trip, including across RA 0 and near the pole', () => {
  for (const [ra0, dec0] of [
    [270, 66.56],
    [0.01, 0],
    [90, -89.5],
  ] as const) {
    const w = tanWcs({
      CTYPE1: 'RA---TAN',
      CTYPE2: 'DEC--TAN',
      CRPIX1: 74,
      CRPIX2: 74,
      CDELT1: -0.0017,
      CDELT2: 0.0017,
      CRVAL1: ra0,
      CRVAL2: dec0,
    })!;
    const s = pixelToSky(w, 73, 73);
    assert.ok(separationDeg(s.ra, s.dec, ra0, dec0) < 1e-9);
    for (const [x, y] of [
      [0, 0],
      [146, 20],
    ] as const) {
      const sky = pixelToSky(w, x, y);
      const back = skyToPixel(w, sky.ra, sky.dec);
      assert.ok(Math.hypot(back.x - x, back.y - y) < 1e-6);
    }
  }
  assert.equal(tanWcs({ CTYPE1: 'RA---SIN' }), null);
});

test('significance decoding and diverging colour are symmetric and not colour-only', () => {
  assert.equal(decodeSigma(0, 10), null);
  assert.equal(decodeSigma(128, 10), 0);
  assert.equal(decodeSigma(255, 10), 10);
  assert.equal(decodeSigma(1, 10), -10);
  const lum = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  assert.ok(lum(divergingRgb(255)) > lum(divergingRgb(192)));
  assert.ok(lum(divergingRgb(1)) > lum(divergingRgb(64)));
  assert.ok(lum(divergingRgb(128)) < 25);
  assert.equal(formatRa(270), '18h00m00.0s');
  assert.equal(formatDec(-66.5607), '−66°33′39″');
});

test('displayTitle shows microns as µm without touching other words', () => {
  assert.equal(
    displayTitle('North Ecliptic Pole, 1.45 um (SPHEREx detector 2)'),
    'North Ecliptic Pole, 1.45 µm (SPHEREx detector 2)',
  );
  assert.equal(displayTitle('Synthetic fixture: um, drum'), 'Synthetic fixture: um, drum');
});

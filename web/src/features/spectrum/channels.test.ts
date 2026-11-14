import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BANDS, CHANNELS, channelAt } from './channels.ts';

test('102 contiguous channels spanning 0.75–5.0 µm', () => {
  assert.equal(CHANNELS.length, 102);
  assert.ok(Math.abs((CHANNELS[0]?.lo ?? 0) - 0.75) < 1e-9);
  assert.ok(Math.abs((CHANNELS.at(-1)?.hi ?? 0) - 5.0) < 1e-9);
  for (let i = 1; i < CHANNELS.length; i++) {
    const a = CHANNELS[i - 1]!;
    const b = CHANNELS[i]!;
    assert.ok(Math.abs(a.hi - b.lo) < 1e-9 && a.center < b.center);
  }
});

test('the real fields fall in the band of the detector they were taken with', () => {
  const index = JSON.parse(
    readFileSync(new URL('../../../../data/manifests/index.json', import.meta.url), 'utf8'),
  ) as { fields: { data_kind: string; wavelength_um: number; title: string }[] };
  for (const f of index.fields.filter((x) => x.data_kind === 'real')) {
    const det = Number(/detector (\d)/.exec(f.title)?.[1]);
    assert.equal(channelAt(f.wavelength_um)?.detector, det, f.title);
  }
  assert.equal(BANDS.length * 17, 102);
});

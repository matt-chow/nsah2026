import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STATE, readState, writeState, type AtlasState } from './state.ts';

test('atlas links round-trip, and bad values fall back to defaults', () => {
  const s: AtlasState = {
    ...DEFAULT_STATE,
    ra: 266.4168,
    dec: -29.0078,
    fov: 0.75,
    mode: 'rgb',
    frame: 3,
    rgb: [60, 40, 10],
    cmap: 'grey',
    stretch: 'linear',
  };
  const back = readState(writeState(s), 102);
  assert.deepEqual(back, s);
  assert.match(
    writeState(s),
    /^#\/atlas\?ra=266\.4168&dec=-29\.0078&fov=0\.750&mode=rgb&f=3&rgb=60,40,10/,
  );
  const bad = readState('#/atlas?ra=400&dec=-91&fov=0&mode=x&f=102&rgb=1,2&cmap=jet&s=log', 102);
  assert.deepEqual(bad, DEFAULT_STATE);
  assert.deepEqual(readState('#/atlas', 102), DEFAULT_STATE);
});

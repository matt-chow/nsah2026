import assert from 'node:assert/strict';
import test from 'node:test';
import { fitsFile } from '../../lib/fitsFixture.ts';
import {
  bandChannel,
  cubeLayout,
  cubeUrl,
  CUBE_S3,
  frameNear,
  Lru,
  packDisplay,
  parseProperties,
  slot,
  tileUrl,
} from './hips.ts';

// Excerpt of the real IRSA properties file (fetched 2026-11-14).
const PROPS = `obs_title            = SPHEREx DR1 all-sky data cube
#em_min              = Start in spectral coordinates
hips_release_date    = 2026-11-01T01:58Z
hips_order           = 5
hips_order_min       = 0
hips_tile_format     = png
hips_cube_depth      = 102
obs_collection       = SPHEREx DR1
data_cube_bunit3     = um
data_cube_crval3_arr = 0.753 0.771 0.790 0.809 0.828 0.848 0.868 0.889 0.910 0.932 0.955 0.978 1.001 1.025 1.050 1.075 1.102 1.113 1.139 1.167 1.195 1.224 1.254 1.284 1.315 1.346 1.378 1.412 1.446 1.481 1.517 1.554 1.592 1.631 1.656 1.695 1.735 1.775 1.818 1.861 1.905 1.949 1.995 2.041 2.089 2.139 2.189 2.240 2.292 2.345 2.399 2.445 2.506 2.575 2.646 2.719 2.794 2.871 2.951 3.033 3.118 3.204 3.293 3.383 3.476 3.570 3.667 3.768 3.833 3.867 3.901 3.935 3.970 4.005 4.040 4.076 4.112 4.148 4.184 4.220 4.257 4.294 4.331 4.368 4.405 4.435 4.467 4.500 4.533 4.566 4.600 4.635 4.669 4.704 4.739 4.773 4.808 4.843 4.879 4.915 4.951 4.988
t_min                = 60789.75076
t_max                = 61174.49276
hips_pixel_cut       = 0 40
hips_pixel_function  = asinh
obs_description      = 17*(band-1) + (channel-1). Frames 50 and 51 (band 3 channel 17, band 4 channel 1, the dichroic channels) are blank. See the SPHEREx Explanatory Supplement: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf`;

test('layer metadata comes from the properties file, blank frames included', () => {
  const info = parseProperties(PROPS);
  assert.equal(info.wavelengths.length, 102);
  assert.equal(info.wavelengths[0], 0.753);
  assert.equal(info.wavelengths[101], 4.988);
  assert.deepEqual([...info.blank], [50, 51]);
  assert.deepEqual(bandChannel(50), { band: 3, channel: 17 });
  assert.deepEqual(bandChannel(51), { band: 4, channel: 1 });
  assert.deepEqual(bandChannel(0), { band: 1, channel: 1 });
  assert.deepEqual(info.cut, [0, 40]);
  assert.equal(info.pixelFunction, 'asinh');
  assert.equal(info.orderMax, 5);
  // ascending wavelengths, as the description promises
  assert.ok(info.wavelengths.every((w, i) => i === 0 || w > (info.wavelengths[i - 1] as number)));
  assert.equal(frameNear(info, 2.4), 49); // 2.399 µm is frame 50, which is blank
  assert.equal(frameNear(info, 3.29), 62);
  assert.throws(() =>
    parseProperties(PROPS.replace('hips_cube_depth      = 102', 'hips_cube_depth = 101')),
  );
});

test('tile URLs follow the HiPS layout, with no suffix on frame 0', () => {
  assert.equal(tileUrl(3, 100, 0).endsWith('/Norder3/Dir0/Npix100.png'), true);
  assert.equal(tileUrl(5, 12345, 20).endsWith('/Norder5/Dir10000/Npix12345_20.png'), true);
  assert.equal(cubeUrl(CUBE_S3, 445), `${CUBE_S3}/Norder5/Dir0/Npix445_cube.fits`);
});

test('cube layout is validated before any plane is read', () => {
  const primary = {
    cards: [
      'SIMPLE  =                    T',
      'BITPIX  =                    8',
      'NAXIS   =                    0',
      'MJD-BEG =      60906.992220058',
      'MJD-END =      61093.550470469',
    ],
  };
  const image = (n1: number) => ({
    cards: [
      "XTENSION= 'IMAGE   '",
      'BITPIX  =                  -32',
      'NAXIS   =                    3',
      `NAXIS1  =                  ${n1}`,
      'NAXIS2  =                  512',
      'NAXIS3  =                  102',
      "EXTNAME = 'IMAGE   '",
      "BUNIT   = 'MJy/sr  '",
    ],
  });
  const head = fitsFile([primary, image(512)]);
  assert.deepEqual(cubeLayout(head, 102), {
    start: 5760,
    bunit: 'MJy/sr',
    mjdBeg: 60906.992220058,
    mjdEnd: 61093.550470469,
  });
  assert.throws(() => cubeLayout(fitsFile([primary, image(256)]), 102), /512/);
  assert.throws(() => cubeLayout(fitsFile([primary]), 102), /IMAGE/);
});

test('display tiles keep transparent (no-data) pixels distinct from black', () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 0, 0, 0, 0, 255, 254, 254, 254, 255, 128, 128, 128, 255,
  ]);
  assert.deepEqual([...packDisplay(rgba)], [0, 1, 255, 129]);
});

test('LRU evicts the oldest entry and forgets failures so they can retry', async () => {
  const lru = new Lru<number>(2);
  let loads = 0;
  const load = (v: number) => () => (loads++, Promise.resolve(v));
  await lru.get('a', load(1));
  await lru.get('b', load(2));
  await lru.get('a', load(9)); // hit, refreshes a
  await lru.get('c', load(3)); // evicts b
  assert.equal(lru.size, 2);
  assert.equal(await lru.get('a', load(9)), 1);
  assert.equal(await lru.get('b', load(4)), 4);
  assert.equal(loads, 4);
  await assert.rejects(lru.get('x', () => Promise.reject(new Error('aborted'))));
  await Promise.resolve();
  assert.equal(await lru.get('x', load(5)), 5);
});

test('request slots cap concurrency at 4 and never start work that became obsolete', async () => {
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const gates: (() => void)[] = [];
  const job = (i: number) => async () => {
    started.push(i);
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((r) => gates.push(r));
    running--;
    return i;
  };
  const stale = new AbortController();
  const live = new AbortController().signal;
  const all = [0, 1, 2, 3, 4, 5].map((i) => slot(i === 4 ? stale.signal : live, job(i)));
  const settledAll = Promise.allSettled(all);
  stale.abort(); // the view moved on before job 4 got a slot
  await new Promise((r) => setTimeout(r));
  assert.equal(peak, 4);
  while (gates.length) {
    gates.shift()?.();
    await new Promise((r) => setTimeout(r));
  }
  const results = await settledAll;
  assert.equal(results[4]!.status, 'rejected');
  assert.deepEqual(started.sort(), [0, 1, 2, 3, 5]);
  assert.equal(peak, 4);
});

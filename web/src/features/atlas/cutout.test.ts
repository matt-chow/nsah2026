import assert from 'node:assert/strict';
import test from 'node:test';
import { be32, fitsFile } from '../../lib/fitsFixture.ts';
import { flagNames, parseCutout } from './cutout.ts';

// Control points of IRSA's real WCS-WAVE table for detector 3 (1-based raw detector pixels).
const XS = [1, 256, 511, 766, 1021, 1275, 1530, 1785, 2040];
const YS = [1, 36, 71, 105, 140, 141, 379, 617, 855, 1091, 1326, 1564, 1802, 2040];
// A plane in (X, Y) so bilinear interpolation must reproduce it exactly.
const lambda = (x: number, y: number) => 1.6 + 0.0003 * x + 0.0001 * y;

function cutoutFile() {
  const w = 3;
  const h = 2;
  const geo = ['NAXIS  = 2', `NAXIS1 = ${w}`, `NAXIS2 = ${h}`];
  const values: number[] = [];
  for (const y of YS) for (const x of XS) values.push(lambda(x, y), 0.05);
  const table = new Uint8Array([...be32(XS, false), ...be32(YS, false), ...be32(values, true)]);
  const card = (c: string) =>
    c.replace(/^([A-Z0-9_-]+)\s*=\s*/, (_, k: string) => `${k.padEnd(8)}= `);
  return fitsFile(
    [
      { cards: ['SIMPLE = T', 'BITPIX = 8', 'NAXIS  = 0', "VERSION = '7.0.5'"] },
      {
        cards: [
          "XTENSION= 'IMAGE'",
          'BITPIX = -32',
          ...geo,
          "EXTNAME = 'IMAGE'",
          "BUNIT  = 'MJy / sr'",
          "OBSID  = '2025W19_2B_0101_1'",
          "EXPIDN = '202519202010113'",
          'DETECTOR= 3',
          'MJD-AVG= 60804.149220738',
          "DATE-AVG= '2025-05-09T03:34:52.672'",
          'XPOSURE= 113.5826',
          'PSF_FWHM= 7.45',
          "L2DQAFLG= 'Pass'",
          'PC1_1  = 0.0',
          'PC1_2  = -1.0',
          'PC2_1  = 1.0',
          'PC2_2  = 0.0',
          "CTYPE1W= 'WAVE-TAB'",
          'CRPIX1W= -1131',
          'CRPIX2W= -496',
          'CRVAL1W= 1',
          'CRVAL2W= 1',
        ],
        data: be32([1, 2, NaN, 4, 5, 6], true),
      },
      {
        cards: [
          "XTENSION= 'IMAGE'",
          'BITPIX = 32',
          ...geo,
          "EXTNAME = 'FLAGS'",
          "MSKN0000= 'TRANSIENT'",
          "MSKD0000= 'Transient detected during SUR'",
          "MSKN0021= 'SOURCE'",
          "MSKD0021= 'Pixel mapped to a known source'",
        ],
        data: be32([0, 1, 0, 2 ** 21 + 1, 0, 0], false),
      },
      {
        cards: [
          "XTENSION= 'BINTABLE'",
          'BITPIX = 8',
          'NAXIS  = 2',
          `NAXIS1 = ${table.length}`,
          'NAXIS2 = 1',
          'PCOUNT = 0',
          'GCOUNT = 1',
          'TFIELDS= 3',
          "TTYPE1 = 'X'",
          "TFORM1 = '9J'",
          "TTYPE2 = 'Y'",
          "TFORM2 = '14J'",
          "TTYPE3 = 'VALUES'",
          "TFORM3 = '252E'",
          "EXTNAME = 'WCS-WAVE'",
        ],
        data: table,
      },
    ].map((h) => ({ ...h, cards: h.cards.map(card) })),
  );
}

test('a cutout keeps science values, flags and metadata exactly as archived', () => {
  const c = parseCutout(cutoutFile());
  assert.equal(c.w, 3);
  assert.equal(c.h, 2);
  assert.deepEqual([...c.image.slice(0, 2)], [1, 2]);
  assert.ok(Number.isNaN(c.image[2]));
  assert.equal(c.bunit, 'MJy / sr');
  assert.equal(c.detector, 3);
  assert.equal(c.obsId, '2025W19_2B_0101_1');
  assert.equal(c.qa, 'Pass');
  assert.equal(c.softwareVersion, '7.0.5');
  assert.equal(c.variance, null); // absent planes are reported absent, not zero-filled
  assert.deepEqual(flagNames(c.flags[3] as number, c.flagBits), ['TRANSIENT', 'SOURCE']);
  assert.deepEqual(flagNames(c.flags[0] as number, c.flagBits), []);
  // PC rotates +y onto −x: north points along +x, i.e. 90° clockwise from up
  assert.ok(Math.abs(c.northUp - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(c.eastUp) - Math.PI) < 1e-9); // and east points down
});

test('the LVF wavelength follows the per-pixel table, not one number per detector', () => {
  const c = parseCutout(cutoutFile());
  // cutout pixel (x, y), 0-based → raw detector pixel (x + 1 + 1132, y + 1 + 497)
  for (const [x, y] of [
    [0, 0],
    [2, 1],
    [1, 0],
  ] as const) {
    const got = c.lvf(x, y);
    assert.ok(got);
    assert.ok(Math.abs(got.um - lambda(x + 1133, y + 498)) < 1e-6, `${got.um}`);
    assert.ok(Math.abs(got.bandwidth - 0.05) < 1e-7);
  }
  assert.notEqual(c.lvf(0, 0)?.um, c.lvf(2, 1)?.um);
});

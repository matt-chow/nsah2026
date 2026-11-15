import assert from 'node:assert/strict';
import test from 'node:test';
import { be32, fitsFile } from './fitsFixture.ts';
import { dataBytes, decode, imageData, parseHeader, readHdus } from './fits.ts';

const card = (k: string, v: string) => `${k.padEnd(8)}= ${v}`;

test('reads headers, HDU offsets and big-endian images with NaN intact', () => {
  const file = fitsFile([
    {
      cards: [
        card('SIMPLE', 'T'),
        card('BITPIX', '8'),
        card('NAXIS', '0'),
        card('ORIGIN', "'it''s / ok'  / comment"),
      ],
    },
    {
      cards: [
        card('XTENSION', "'IMAGE   '"),
        card('BITPIX', '-32'),
        card('NAXIS', '2'),
        card('NAXIS1', '3'),
        card('NAXIS2', '2'),
        card('EXTNAME', "'IMAGE'"),
        card('BUNIT', "'MJy / sr'"),
        card('CRVAL1', '2.5E+01 / deg'),
      ],
      data: be32([1.5, NaN, -2, 0, 3.25, 1e-30], true),
    },
    {
      cards: [
        card('XTENSION', "'IMAGE   '"),
        card('BITPIX', '32'),
        card('NAXIS', '2'),
        card('NAXIS1', '3'),
        card('NAXIS2', '2'),
        card('EXTNAME', "'FLAGS'"),
      ],
      data: be32([0, 1, 2 ** 30, 0, 512, -1], false),
    },
  ]);
  const hdus = readHdus(file);
  assert.equal(hdus.length, 3);
  assert.equal(hdus[0]!.header.get('ORIGIN'), "it's / ok");
  assert.equal(hdus[1]!.header.get('BUNIT'), 'MJy / sr');
  assert.equal(hdus[1]!.header.get('CRVAL1'), 25);
  assert.equal(hdus[0]!.header.get('SIMPLE'), true);
  assert.equal(hdus[1]!.dataStart, 2880 * 2);
  assert.equal(dataBytes(hdus[1]!.header), 24);
  const img = imageData(file, hdus[1]!);
  assert.ok(img instanceof Float32Array);
  assert.deepEqual(
    [...img].map((v) => (Number.isNaN(v) ? 'NaN' : v)),
    [1.5, 'NaN', -2, 0, 3.25, Math.fround(1e-30)],
  );
  assert.deepEqual([...imageData(file, hdus[2]!)], [0, 1, 2 ** 30, 0, 512, -1]);
});

test('refuses truncated data, scaled images and unknown sample types', () => {
  const file = fitsFile([
    {
      cards: [
        card('SIMPLE', 'T'),
        card('BITPIX', '-32'),
        card('NAXIS', '2'),
        card('NAXIS1', '2'),
        card('NAXIS2', '2'),
        card('BSCALE', '2'),
      ],
      data: be32([1, 2, 3, 4], true),
    },
  ]);
  const [h] = readHdus(file);
  assert.throws(() => imageData(file, h!), /scaled/);
  h!.header.delete('BSCALE');
  assert.throws(() => imageData(file.subarray(0, 2880 + 8), h!), /truncated/);
  assert.throws(() => decode(new Uint8Array(4), 16), /BITPIX/);
  assert.equal(parseHeader(file.subarray(0, 160), 0), null); // no END card yet
});

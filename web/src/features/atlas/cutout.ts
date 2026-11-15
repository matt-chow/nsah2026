// One archived SPHEREx Level 2 exposure, cut out by IRSA around a position (via api/cutout).
// Values are read unchanged from the IMAGE, FLAGS, VARIANCE and ZODI HDUs; the wavelength comes
// from IRSA's own per-pixel lookup table (the 'W' -TAB WCS in WCS-WAVE), never from the
// detector-wide range alone, because SPHEREx's linear variable filters vary across each detector.

import { imageData, readHdus, type Hdu, type Header } from '../../lib/fits.ts';

export interface FlagBit {
  bit: number;
  name: string;
  description: string;
}

export interface Cutout {
  w: number;
  h: number;
  image: Float32Array; // MJy/sr, FITS row order (row 0 = bottom)
  flags: Int32Array;
  variance: Float32Array | null;
  zodi: Float32Array | null;
  bunit: string;
  flagBits: FlagBit[]; // from the MSKNnnnn / MSKDnnnn cards of FLAGS
  obsId: string;
  expId: string;
  detector: number;
  mjdAvg: number;
  dateAvg: string;
  exposure: number; // s
  psfFwhm: number | null; // arcsec
  qa: string; // L2DQAFLG
  softwareVersion: string; // primary VERSION card
  // display helpers from the PC matrix (no SIP): directions of north and east in FITS pixel
  // space, as angles from +y toward +x in radians
  northUp: number;
  eastUp: number;
  lvf: (x: number, y: number) => { um: number; bandwidth: number } | null;
}

const str = (h: Header, k: string) => String(h.get(k) ?? '');
const num = (h: Header, k: string) => {
  const v = h.get(k);
  return typeof v === 'number' ? v : null;
};

export function parseCutout(bytes: Uint8Array): Cutout {
  const hdus = readHdus(bytes);
  const ext = (name: string) => hdus.find((h) => h.header.get('EXTNAME') === name);
  const img = ext('IMAGE');
  const flg = ext('FLAGS');
  if (!img || !flg) throw new Error('cutout lacks IMAGE or FLAGS');
  const h = img.header;
  const w = Number(h.get('NAXIS1'));
  const ht = Number(h.get('NAXIS2'));
  const image = imageData(bytes, img);
  const flags = imageData(bytes, flg);
  if (!(image instanceof Float32Array) || !(flags instanceof Int32Array) || image.length !== w * ht)
    throw new Error('cutout IMAGE/FLAGS have unexpected types or sizes');
  const plane = (hdu: Hdu | undefined) => {
    const a = hdu ? imageData(bytes, hdu) : null;
    return a instanceof Float32Array && a.length === w * ht ? a : null;
  };
  const flagBits: FlagBit[] = [];
  for (const [k, v] of flg.header)
    if (k.startsWith('MSKN')) {
      const bit = Number(k.slice(4));
      flagBits.push({ bit, name: String(v), description: str(flg.header, `MSKD${k.slice(4)}`) });
    }
  const wave = ext('WCS-WAVE');
  const mjd = num(h, 'MJD-AVG');
  const det = num(h, 'DETECTOR');
  if (mjd === null || det === null) throw new Error('cutout lacks MJD-AVG or DETECTOR');
  // north / east are the pixel directions with intermediate world vectors (0, 1) / (1, 0): PC⁻¹
  const [a, b, c, d] = ['PC1_1', 'PC1_2', 'PC2_1', 'PC2_2'].map(
    (k) => num(h, k) ?? (k[2] === k[4] ? 1 : 0),
  ) as [number, number, number, number];
  const det2 = a * d - b * c;
  return {
    w,
    h: ht,
    image,
    flags,
    variance: plane(ext('VARIANCE')),
    zodi: plane(ext('ZODI')),
    bunit: str(h, 'BUNIT'),
    flagBits: flagBits.sort((x, y) => x.bit - y.bit),
    obsId: str(h, 'OBSID'),
    expId: str(h, 'EXPIDN'),
    detector: det,
    mjdAvg: mjd,
    dateAvg: str(h, 'DATE-AVG'),
    exposure: num(h, 'XPOSURE') ?? NaN,
    psfFwhm: num(h, 'PSF_FWHM'),
    qa: str(h, 'L2DQAFLG'),
    softwareVersion: str(hdus[0]?.header ?? new Map(), 'VERSION'),
    northUp: Math.atan2(-b / det2, a / det2),
    eastUp: Math.atan2(d / det2, -c / det2),
    lvf: wave ? lvfLookup(h, wave, bytes) : () => null,
  };
}

/**
 * IRSA's 'W' WCS: cutout pixel → raw detector pixel by a linear offset (CRVALiW + p − CRPIXiW),
 * then bilinear interpolation in the WCS-WAVE table (X, Y control points; VALUES[y][x][λ, Δλ]).
 * Matches Astropy's -TAB evaluation (see atlas cutout tests and docs/SCIENCE.md).
 */
export function lvfLookup(h: Header, wave: Hdu, bytes: Uint8Array) {
  const cards = ['CRPIX1W', 'CRPIX2W', 'CRVAL1W', 'CRVAL2W'].map((k) => num(h, k));
  if (str(h, 'CTYPE1W') !== 'WAVE-TAB' || cards.some((v) => v === null)) return () => null;
  const [cp1, cp2, cv1, cv2] = cards as number[] as [number, number, number, number];
  const cols = tableColumns(wave, bytes);
  const xs = cols.get('X');
  const ys = cols.get('Y');
  const vals = cols.get('VALUES');
  if (!xs || !ys || !vals || vals.length !== xs.length * ys.length * 2) return () => null;
  const locate = (axis: Float32Array | Int32Array, v: number) => {
    let i = 0;
    while (i < axis.length - 2 && v > (axis[i + 1] as number)) i++;
    const a = axis[i] as number;
    const b = axis[i + 1] as number;
    return { i, t: (v - a) / (b - a) };
  };
  return (x: number, y: number) => {
    const rx = cv1 + (x + 1 - cp1); // CDELT 1, PC identity for the W axes
    const ry = cv2 + (y + 1 - cp2);
    if (
      rx < (xs[0] as number) ||
      ry < (ys[0] as number) ||
      rx > (xs.at(-1) as number) ||
      ry > (ys.at(-1) as number)
    )
      return null;
    const X = locate(xs, rx);
    const Y = locate(ys, ry);
    const at = (ix: number, iy: number, k: number) => vals[k + 2 * (ix + xs.length * iy)] as number;
    const bil = (k: number) =>
      (1 - X.t) * (1 - Y.t) * at(X.i, Y.i, k) +
      X.t * (1 - Y.t) * at(X.i + 1, Y.i, k) +
      (1 - X.t) * Y.t * at(X.i, Y.i + 1, k) +
      X.t * Y.t * at(X.i + 1, Y.i + 1, k);
    return { um: bil(0), bandwidth: bil(1) };
  };
}

/** First-row columns of a binary table with only J (int32) and E (float32) array fields. */
function tableColumns(hdu: Hdu, bytes: Uint8Array) {
  const out = new Map<string, Float32Array | Int32Array>();
  const n = Number(hdu.header.get('TFIELDS') ?? 0);
  let off = hdu.dataStart;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let f = 1; f <= n; f++) {
    const m = /^(\d*)([JE])$/.exec(str(hdu.header, `TFORM${f}`));
    if (!m) return new Map();
    const count = Number(m[1] || 1);
    if (off + count * 4 > bytes.length) return new Map();
    const arr = m[2] === 'J' ? new Int32Array(count) : new Float32Array(count);
    for (let i = 0; i < count; i++)
      arr[i] = m[2] === 'J' ? view.getInt32(off + i * 4) : view.getFloat32(off + i * 4);
    out.set(str(hdu.header, `TTYPE${f}`), arr);
    off += count * 4;
  }
  return out;
}

/** Names of the flag bits set in a FLAGS value. */
export const flagNames = (value: number, bits: FlagBit[]) =>
  bits.filter((b) => (value >>> b.bit) & 1).map((b) => b.name);

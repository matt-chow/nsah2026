// Minimal FITS reader (FITS Standard 4.0): header cards, HDU boundaries, and big-endian image
// arrays. Enough for SPHEREx cube planes and Level 2 cutouts; no scaling (BSCALE/BZERO), tables
// or compression, and anything else is refused rather than guessed.

const BLOCK = 2880;
const CARD = 80;

export type Card = string | number | boolean;
export type Header = Map<string, Card>;

export interface Hdu {
  header: Header;
  dataStart: number; // byte offset of the data unit
  dataBytes: number; // unpadded length of the data unit
}

function cardValue(raw: string): Card {
  const s = raw.trim();
  if (s.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'/.exec(s);
    return (m?.[1] ?? '').replace(/''/g, "'").trimEnd();
  }
  const v = s.split('/')[0]?.trim() ?? '';
  if (v === 'T' || v === 'F') return v === 'T';
  const n = Number(v.replace(/D/i, 'E'));
  return v !== '' && Number.isFinite(n) ? n : v;
}

/** Header starting at `start`, or null when END is not inside `bytes` (header incomplete). */
export function parseHeader(
  bytes: Uint8Array,
  start: number,
): { header: Header; end: number } | null {
  const header: Header = new Map();
  for (let i = start; i + CARD <= bytes.length; i += CARD) {
    const card = String.fromCharCode(...bytes.subarray(i, i + CARD));
    const key = card.slice(0, 8).trimEnd();
    if (key === 'END') return { header, end: Math.ceil((i + CARD) / BLOCK) * BLOCK };
    if (card.slice(8, 10) === '= ' && !header.has(key)) header.set(key, cardValue(card.slice(10)));
  }
  return null;
}

export function dataBytes(h: Header): number {
  const naxis = Number(h.get('NAXIS') ?? 0);
  if (naxis === 0) return 0;
  let n = Math.abs(Number(h.get('BITPIX'))) / 8;
  for (let a = 1; a <= naxis; a++) n *= Number(h.get(`NAXIS${a}`));
  return (n + Number(h.get('PCOUNT') ?? 0)) * Number(h.get('GCOUNT') ?? 1);
}

/** Every HDU whose header is complete inside `bytes` (data may be truncated; check before use). */
export function readHdus(bytes: Uint8Array): Hdu[] {
  const out: Hdu[] = [];
  let off = 0;
  while (off < bytes.length) {
    const h = parseHeader(bytes, off);
    if (!h) break;
    const n = dataBytes(h.header);
    out.push({ header: h.header, dataStart: h.end, dataBytes: n });
    off = h.end + Math.ceil(n / BLOCK) * BLOCK;
  }
  return out;
}

/** A 2-D image as numbers; float32 and int32 only, the two types SPHEREx images use. */
export function imageData(bytes: Uint8Array, hdu: Hdu): Float32Array | Int32Array {
  const bitpix = hdu.header.get('BITPIX');
  if (hdu.header.has('BSCALE') || hdu.header.has('BZERO'))
    throw new Error('scaled FITS images are not supported');
  if (hdu.dataStart + hdu.dataBytes > bytes.length) throw new Error('FITS data unit is truncated');
  return decode(bytes.subarray(hdu.dataStart, hdu.dataStart + hdu.dataBytes), bitpix);
}

/** Decode big-endian samples; NaN stays NaN (the FITS blank for floats). */
export function decode(raw: Uint8Array, bitpix: Card | undefined): Float32Array | Int32Array {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = raw.byteLength / 4;
  if (bitpix === -32) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4);
    return out;
  }
  if (bitpix === 32) {
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4);
    return out;
  }
  throw new Error(`unsupported BITPIX ${String(bitpix)}`);
}

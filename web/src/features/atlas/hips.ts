// Archive adapter for the SPHEREx DR1 all-sky HiPS cube (IRSA). Two products of one release:
//   display tiles  8-bit PNG, IRSA's own asinh stretch (visualization), orders 0–5, CORS open
//   cube tiles     float32 FITS, MJy/sr (measurement), order 5 only, ~300 MB each, read here one
//                  1 MiB wavelength plane at a time with HTTP Range requests
// Verified 2026-11-14 against the HiPS `properties` file and an Astropy read of a cube tile.
// Sources: https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/ and
// https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/

import { decode, readHdus, type Header } from '../../lib/fits.ts';

export const HIPS_URL = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
const CUBE_PATH = 'dr1/hips5_cube/hips_20261026';
/** IRSA's on-premises copy (provenance link; it sends no CORS headers). */
export const CUBE_IBE = `https://irsa.ipac.caltech.edu/ibe/data/spherex/${CUBE_PATH}`;
/** IRSA's AWS open-data copy of the same files (byte-identical); it allows CORS Range reads. */
export const CUBE_S3 = `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/${CUBE_PATH}`;
export const CUBE_ORDER = 5;
export const TILE_BITS = 9; // 512 × 512 pixel tiles
const TILE = 2 ** TILE_BITS;
const PLANE_BYTES = TILE * TILE * 4;
const MAX_CONCURRENT = 4;

export interface CubeInfo {
  title: string;
  collection: string;
  release: string; // hips_release_date
  wavelengths: number[]; // µm, one per frame
  blank: Set<number>; // frames IRSA declares all-NaN
  cut: [number, number]; // display tiles: hips_pixel_cut, MJy/sr
  pixelFunction: string; // display tiles: hips_pixel_function
  orderMin: number;
  orderMax: number;
  mjdRange: [number, number]; // t_min, t_max of the input exposures
  description: string;
}

export function parseProperties(text: string): CubeInfo {
  const p = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (m?.[1] && m[2] !== undefined) p.set(m[1], m[2].trim());
  }
  const need = (k: string) => {
    const v = p.get(k);
    if (v === undefined) throw new Error(`HiPS properties lack ${k}`);
    return v;
  };
  const wavelengths = need('data_cube_crval3_arr').split(/\s+/).map(Number);
  if (need('data_cube_bunit3') !== 'um') throw new Error('unexpected spectral unit');
  if (wavelengths.length !== Number(need('hips_cube_depth')) || wavelengths.some((w) => !(w > 0)))
    throw new Error('wavelength list does not match hips_cube_depth');
  const description = p.get('obs_description') ?? '';
  // e.g. "Frames 50 and 51 (band 3 channel 17, band 4 channel 1, the dichroic channels) are blank"
  const blankText = /Frames ([\d, and]+?) \([^)]*\) are blank/.exec(description)?.[1] ?? '';
  const cut = need('hips_pixel_cut').split(/\s+/).map(Number);
  return {
    title: need('obs_title'),
    collection: p.get('obs_collection') ?? 'SPHEREx DR1',
    release: need('hips_release_date'),
    wavelengths,
    blank: new Set(blankText.match(/\d+/g)?.map(Number) ?? []),
    cut: [cut[0] ?? 0, cut[1] ?? 0],
    pixelFunction: p.get('hips_pixel_function') ?? 'linear',
    orderMin: Number(p.get('hips_order_min') ?? 0),
    orderMax: Number(need('hips_order')),
    mjdRange: [Number(p.get('t_min')), Number(p.get('t_max'))],
    description,
  };
}

/** Detector band (1–6) and channel (1–17) of a 0-based frame, per the cube's obs_description. */
export const bandChannel = (frame: number) => ({
  band: Math.floor(frame / 17) + 1,
  channel: (frame % 17) + 1,
});

/** Nearest frame to a wavelength in µm, skipping blank frames. */
export function frameNear(info: CubeInfo, um: number): number {
  let best = 0;
  info.wavelengths.forEach((w, i) => {
    if (!info.blank.has(i) && Math.abs(w - um) < Math.abs((info.wavelengths[best] ?? 0) - um))
      best = i;
  });
  return best;
}

const dir = (npix: number) => `Dir${Math.floor(npix / 10000) * 10000}`;
/** Frame 0 has no suffix; frame f > 0 is `_f` (checked against IRSA, frame 0 suffix is a 404). */
export const tileUrl = (order: number, npix: number, frame: number) =>
  `${HIPS_URL}/Norder${order}/${dir(npix)}/Npix${npix}${frame ? `_${frame}` : ''}.png`;
export const cubeUrl = (base: string, npix: number) =>
  `${base}/Norder${CUBE_ORDER}/${dir(npix)}/Npix${npix}_cube.fits`;

export async function loadProperties(signal: AbortSignal): Promise<CubeInfo> {
  const res = await fetch(`${HIPS_URL}/properties`, { signal });
  if (!res.ok) throw new Error(`IRSA HiPS properties: HTTP ${res.status}`);
  return parseProperties(await res.text());
}

// --- bounded concurrency and caches -------------------------------------------------------

let active = 0;
const waiting: (() => void)[] = [];
export async function slot<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    signal.throwIfAborted(); // obsolete work queued behind newer requests never starts
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Least-recently-used promise cache; failures (including aborts) are dropped so they retry. */
export class Lru<V> {
  private map = new Map<string, Promise<V>>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const p = load();
    p.catch(() => this.map.get(key) === p && this.map.delete(key));
    this.map.set(key, p);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    return p;
  }
  peek(key: string): Promise<V> | undefined {
    return this.map.get(key);
  }
  get size() {
    return this.map.size;
  }
}

// --- display tiles ---------------------------------------------------------------------------

/** Display level + 1 per pixel (1–255); 0 marks a transparent (no-data) pixel. 256 KiB each. */
export type DisplayTile = Uint8Array;
const displayTiles = new Lru<DisplayTile | null>(96);
const settled = new Map<string, DisplayTile | null>(); // synchronous view of finished loads

export const displayKey = (order: number, npix: number, frame: number) =>
  `${order}/${npix}/${frame}`;
export const peekDisplay = (key: string) => settled.get(key);

/** A display tile, or null when IRSA has no tile there (404: outside coverage or blank frame). */
export function loadDisplayTile(order: number, npix: number, frame: number, signal: AbortSignal) {
  const key = displayKey(order, npix, frame);
  return displayTiles.get(key, () =>
    slot(signal, async () => {
      const res = await fetch(tileUrl(order, npix, frame), { signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HiPS tile HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx || bmp.width !== TILE || bmp.height !== TILE)
        throw new Error('unexpected HiPS tile');
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return packDisplay(ctx.getImageData(0, 0, TILE, TILE).data);
    }).then((t) => (settled.set(key, t), trimSettled(), t)),
  );
}

/** Grey PNG pixels to level + 1, with transparent pixels (IRSA's NaN) as 0. */
export function packDisplay(rgba: Uint8ClampedArray): DisplayTile {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++)
    out[i] = (rgba[i * 4 + 3] ?? 0) < 128 ? 0 : Math.min(254, rgba[i * 4] ?? 0) + 1;
  return out;
}

function trimSettled() {
  for (const k of settled.keys()) if (!displayTiles.peek(k)) settled.delete(k);
}

// --- numeric cube planes -----------------------------------------------------------------

export interface Plane {
  npix: number;
  frame: number;
  values: Float32Array; // MJy/sr in FITS order (row 0 = bottom); NaN = no data
  bunit: string;
  mjdBeg: number | null; // earliest and latest input exposure in this tile
  mjdEnd: number | null;
  source: string; // IRSA provenance URL of the cube tile
}

const headers = new Lru<{
  start: number;
  bunit: string;
  mjdBeg: number | null;
  mjdEnd: number | null;
}>(32);
const planes = new Lru<Plane>(16); // 16 MiB
const settledPlanes = new Map<string, Plane>();
export const planeKey = (npix: number, frame: number) => `${npix}/${frame}`;
export const peekPlane = (key: string) => settledPlanes.get(key);

async function range(url: string, from: number, length: number, signal: AbortSignal) {
  const res = await fetch(url, {
    headers: { Range: `bytes=${from}-${from + length - 1}` },
    signal,
  });
  if (res.status !== 206) {
    await res.body?.cancel(); // never stream a whole 300 MB cube tile
    throw new Error(`cube range read: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length !== length) throw new Error('cube range read: short response');
  return buf;
}

/** Where the IMAGE plane data start in a cube tile, validated against what we expect. */
export function cubeLayout(head: Uint8Array, depth: number) {
  const hdus = readHdus(head);
  const img = hdus.find((h) => h.header.get('EXTNAME') === 'IMAGE');
  if (!img) throw new Error('cube tile has no IMAGE extension in its first blocks');
  const h: Header = img.header;
  const ok =
    h.get('BITPIX') === -32 &&
    h.get('NAXIS1') === TILE &&
    h.get('NAXIS2') === TILE &&
    h.get('NAXIS3') === depth &&
    !h.has('BSCALE') &&
    !h.has('BZERO');
  if (!ok) throw new Error('cube tile IMAGE is not 512 × 512 × depth float32');
  const primary = hdus[0]?.header;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    start: img.dataStart,
    bunit: String(h.get('BUNIT') ?? ''),
    mjdBeg: num(primary?.get('MJD-BEG')),
    mjdEnd: num(primary?.get('MJD-END')),
  };
}

export function loadPlane(info: CubeInfo, npix: number, frame: number, signal: AbortSignal) {
  const key = planeKey(npix, frame);
  const url = cubeUrl(CUBE_S3, npix);
  return planes.get(key, () =>
    slot(signal, async () => {
      const layout = await headers.get(String(npix), async () =>
        cubeLayout(await range(url, 0, 2880 * 10, signal), info.wavelengths.length),
      );
      const raw = await range(url, layout.start + frame * PLANE_BYTES, PLANE_BYTES, signal);
      const values = decode(raw, -32) as Float32Array;
      const { bunit, mjdBeg, mjdEnd } = layout;
      return { npix, frame, values, bunit, mjdBeg, mjdEnd, source: cubeUrl(CUBE_IBE, npix) };
    }).then((p) => {
      settledPlanes.set(key, p);
      for (const k of settledPlanes.keys()) if (!planes.peek(k)) settledPlanes.delete(k);
      return p;
    }),
  );
}

// Live SPHEREx exposures through /api/spherex (api/_spherex.py): every exposure IRSA lists at a
// point, and each one reprojected to a north-up grid of 6.15″ pixels around it (6′ by default).
// Display-grade imagery only: bilinear resampling and a median background removed.
// The five challenge targets also have a pre-baked copy in data/targets/ (scripts/bake_targets.py).

import { TARGETS } from './places.ts';

export interface Listed {
  url: string;
  mjd: number;
  band: string; // 'D1'…'D6'
  um: [number, number]; // the detector band's range
  rel?: string; // IRSA collection (data release)
}

export interface LiveFrame {
  n: number;
  mjd: number | null;
  pix: Float32Array; // MJy/sr minus the cutout median; NaN = no data
  det: number | null; // detector 1…6
  um: number | null; // wavelength at the target through the frame's own spectral WCS; null = unknown
  dum: number | null; // bandwidth there
  flags: string[] | null; // contamination flags within one pixel of the target; null = not reported
}

export const SIZES = [4, 6, 9, 12]; // arcmin; the API accepts 2–12
export const DEFAULT_SIZE = 6;

/** 'no-api': this host has no archive functions. 'outage': IRSA or the function failed. */
export class LiveError extends Error {
  kind: 'no-api' | 'outage';
  constructor(kind: 'no-api' | 'outage', message: string) {
    super(message);
    this.kind = kind;
  }
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new LiveError('outage', 'The archive did not answer in time.');
  }
  if (!(r.headers.get('content-type') ?? '').includes('json'))
    throw new LiveError('no-api', 'This copy of the app has no archive connection.');
  const body = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) throw new LiveError('outage', body?.error ?? `The archive answered ${r.status}.`);
  return body;
}

export interface Listing {
  frames: Listed[];
  baked: string | null; // date of the saved copy this listing came from; null = the live archive
}

const listings = new Map<string, Promise<Listing>>();
const key = (ra: number, dec: number) => `${ra.toFixed(5)},${dec.toFixed(5)}`;
const validFrames = (frames: unknown) => {
  if (!Array.isArray(frames)) throw new LiveError('outage', 'Unexpected archive answer.');
  return (frames as Listed[]).filter((f) => typeof f.url === 'string' && Number.isFinite(f.mjd));
};

/** A challenge target's saved copy: its listing, with its baked cutouts put in the frame cache. */
async function baked(ra: number, dec: number): Promise<Listing | null> {
  const t = TARGETS.find((x) => key(x.ra, x.dec) === key(ra, dec));
  if (!t) return null;
  try {
    const r = await fetch(`targets/${t.id}.json`);
    if (!r.ok) return null;
    const d = (await r.json()) as {
      baked: string;
      size_arcmin: number;
      frames: unknown;
      cutouts: Record<string, unknown>;
    };
    for (const [url, c] of Object.entries(d.cutouts)) {
      const f = toFrame(c);
      if (f) frames.set(`${key(ra, dec)}|${d.size_arcmin}|${url}`, f);
    }
    return { frames: validFrames(d.frames), baked: d.baked };
  } catch {
    return null; // no usable saved copy: ask the archive
  }
}

const live = async (ra: number, dec: number): Promise<Listing> => {
  const d = await getJson(
    `api/spherex?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}`,
    new AbortController().signal,
  );
  return { frames: validFrames((d as { frames?: unknown }).frames), baked: null };
};

// the listing is cached and shared, so no one caller's abort may cancel it (only the timeout can)
export function listExposures(ra: number, dec: number): Promise<Listing> {
  const k = key(ra, dec);
  let p = listings.get(k);
  if (!p) {
    p = baked(ra, dec).then((b) => b ?? live(ra, dec));
    listings.set(k, p);
    p.catch(() => listings.delete(k));
    if (listings.size > 8) listings.delete(listings.keys().next().value as string);
  }
  return p;
}

// shortcut: a frame shared by two views is fetched twice if both start it at once; fine at this scale
const frames = new Map<string, LiveFrame>();
const MAX_FRAMES = 600; // ~8 MB of 59×59 float32 grids; a baked target adds up to ~70

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** An API or baked cutout, checked; an older API answer without the metadata reads as unknown. */
export function toFrame(c: unknown): LiveFrame | null {
  const d = c as Record<string, unknown> | null;
  const n = d?.n;
  if (!d || typeof n !== 'number' || !Number.isInteger(n) || !Array.isArray(d.pix)) return null;
  if (d.pix.length !== n * n) return null;
  return {
    n,
    mjd: num(d.mjd),
    pix: Float32Array.from(d.pix as (number | null)[], (v) => v ?? NaN),
    det: num(d.det),
    um: num(d.um),
    dum: num(d.dum),
    flags: Array.isArray(d.flags)
      ? d.flags.filter((x): x is string => typeof x === 'string')
      : null,
  };
}

export const peekFrame = (ra: number, dec: number, url: string, size = DEFAULT_SIZE) =>
  frames.get(`${key(ra, dec)}|${size}|${url}`);

export async function loadFrame(
  ra: number,
  dec: number,
  url: string,
  signal: AbortSignal,
  size = DEFAULT_SIZE,
): Promise<LiveFrame> {
  const k = `${key(ra, dec)}|${size}|${url}`;
  const hit = frames.get(k);
  if (hit) return hit;
  const f = toFrame(
    await getJson(
      `api/spherex?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&size=${size}&url=${encodeURIComponent(url)}`,
      signal,
    ),
  );
  if (!f) throw new LiveError('outage', 'Unexpected exposure data.');
  frames.set(k, f);
  if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value as string);
  return f;
}

// --- display stretch, ported from data/flipbook/playback.js (visualization only) ---

const q = (sorted: Float32Array, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

/** Per-pixel median of equal-length grids (NaN = no data stays NaN). */
export function medianImage(images: Float32Array[]): Float32Array {
  const out = new Float32Array(images[0]?.length ?? 0);
  const v = new Float32Array(images.length);
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (const im of images) if (!Number.isNaN(im[i])) v[m++] = im[i] as number;
    out[i] = m ? (v.subarray(0, m).sort()[m >> 1] as number) : NaN;
  }
  return out;
}

/** One shared stretch: value → 0 (no data) or 1…255; median → 1, 99.7th percentile → 255, sqrt. */
export function makeStretch(median: Float32Array): (x: number) => number {
  const v = median.filter((x) => !Number.isNaN(x)).sort();
  const lo = q(v, 0.5);
  const span = q(v, 0.997) - lo || 1;
  return (x) => {
    if (Number.isNaN(x)) return 0;
    const t = (x - lo) / span;
    return 1 + Math.min(254, Math.max(0, Math.round(254 * Math.sign(t) * Math.sqrt(Math.abs(t)))));
  };
}

/** Paint a grid north-up (row 0 of `pix` is south) through a 256-entry palette; no data hatched. */
export function paintFrame(
  c: HTMLCanvasElement,
  f: LiveFrame,
  stretch: (x: number) => number,
  map: Uint8Array,
) {
  const { n, pix } = f;
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(n, n);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const s = stretch(pix[(n - 1 - row) * n + col] as number);
      const o = (row * n + col) * 4;
      if (s === 0) img.data.set((row + col) & 1 ? [44, 42, 40] : [24, 23, 22], o);
      else {
        const k = Math.round(((s - 1) * 255) / 254) * 3;
        img.data.set([map[k] ?? 0, map[k + 1] ?? 0, map[k + 2] ?? 0], o);
      }
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

export const coverage = (f: LiveFrame) =>
  f.pix.reduce((s, v) => s + (Number.isNaN(v) ? 0 : 1), 0) / f.pix.length;

// --- playback timing ---

export type Timing = 'equal' | 'elapsed';
export const ELAPSED_CAP = 4; // a long gap holds at most this many ordinary steps

/**
 * How long to hold frame i before the next one. Equal: every exposure the same time. Elapsed:
 * proportional to the real time until the next exposure, relative to the typical gap, held
 * between a quarter step and ELAPSED_CAP steps so clusters flash past and long gaps linger.
 */
export function holdMs(mjds: number[], i: number, timing: Timing, perSecond: number): number {
  const step = 1000 / perSecond;
  if (timing === 'equal' || mjds.length < 3) return step;
  const gaps = mjds
    .slice(1)
    .map((m, j) => m - (mjds[j] as number))
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  const typical = gaps[gaps.length >> 1] ?? 0;
  const gap = (mjds[(i + 1) % mjds.length] as number) - (mjds[i] as number);
  if (!(typical > 0) || !(gap > 0)) return step; // wrap-around or simultaneous: one ordinary step
  return step * Math.max(0.25, Math.min(ELAPSED_CAP, gap / typical));
}

export const monthOf = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toISOString().slice(0, 7);

/** Plain-language meaning of the SPHEREx FLAGS bits the API reports (after the FITS MSKD cards). */
export const FLAG_ABOUT: Record<string, string> = {
  TRANSIENT: 'a sudden jump during the exposure, such as a cosmic-ray hit',
  OVERFLOW: 'too bright: the pixel filled up',
  SUR_ERROR: 'an error in on-board processing',
  NONFUNC: 'a pixel that never works',
  DICHROIC: 'low sensitivity from the beam splitter',
  MISSING_DATA: 'data lost on board',
  HOT: 'a hot pixel',
  COLD: 'abnormally low signal',
  PHANMISS: 'a correction for electronic echoes was not applied',
  NONLINEAR: 'too bright to correct reliably',
  PERSIST: 'a leftover image of an earlier bright source',
  OUTLIER: 'an outlier against the other readings',
  CROSSTALK: 'signal leaking in from other pixels',
  GHOST: 'a reflection of a bright source in this exposure',
  GHOST_FPA: 'a reflection of a bright source on another detector',
  GHOST_EXT: 'light from a bright source outside the field',
  STREAK: 'a streak, such as a satellite',
  BLOOM: 'charge spilling from a saturated star',
  SNOWBALL: 'a burst of charge from a particle hit',
  HALO: 'a transient halo',
};

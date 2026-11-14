// Atlas rendering in three separate steps:
//   geometry  which HiPS tile pixel each screen pixel shows (gnomonic view, HEALPix lookup)
//   sample    science values copied unchanged from cube planes (NaN where nothing was measured)
//   paint     display-only mapping: clip, stretch, colour map, RGB assignment
// Nothing in `paint*` feeds back into values, and every channel of a composite shares one
// geometry, so R, G and B are sampled at identical sky positions by construction.

import { interleave, tileOffset, xyf } from '../../lib/healpix.ts';
import type { TanWcs } from '../../lib/sky.ts';

const DEG = Math.PI / 180;

export interface View {
  ra: number; // centre, ICRS degrees
  dec: number;
  fov: number; // width, degrees
}

/** Display WCS of a w × h canvas: north up, east left, square pixels. */
export const viewWcs = (v: View, w: number, h: number): TanWcs => ({
  crpix1: (w + 1) / 2,
  crpix2: (h + 1) / 2,
  cdelt1: -v.fov / w,
  cdelt2: v.fov / w,
  crval1: v.ra,
  crval2: v.dec,
});

/** HEALPix base-pixel width (degrees): sqrt(4π / 12) radians. */
const BASE_DEG = (Math.sqrt(Math.PI / 3) * 180) / Math.PI;

/** Coarsest order whose tile pixels are no larger than a screen pixel (capped at maxOrder). */
export function orderFor(
  fov: number,
  w: number,
  tileBits: number,
  minOrder: number,
  maxOrder: number,
) {
  const screen = fov / w;
  for (let k = minOrder; k < maxOrder; k++) if (BASE_DEG / 2 ** (k + tileBits) <= screen) return k;
  return maxOrder;
}

export interface Geometry {
  w: number;
  h: number;
  order: number;
  tiles: number[]; // distinct HEALPix tiles touched, in first-seen order
  slot: Int16Array; // per screen pixel (row-major, top row first): index into tiles
  offset: Int32Array; // per screen pixel: offset inside that tile's image
}

/**
 * `png` selects the PNG tile row order (top-down) instead of FITS (bottom-up). Same gnomonic
 * projection as `viewWcs` + `pixelToSky`, inlined as a direction vector f + xi·e + eta·n so a
 * 960 × 600 view costs no per-pixel allocation or trigonometry beyond one atan2.
 */
export function geometry(
  v: View,
  w: number,
  h: number,
  order: number,
  tileBits: number,
  png: boolean,
): Geometry {
  const slot = new Int16Array(w * h);
  const offset = new Int32Array(w * h);
  const index = new Map<number, number>();
  const tiles: number[] = [];
  const a0 = v.ra * DEG;
  const d0 = v.dec * DEG;
  const [ca, sa, cd, sd] = [Math.cos(a0), Math.sin(a0), Math.cos(d0), Math.sin(d0)];
  const step = (v.fov / w) * DEG; // tangent-plane radians per screen pixel
  const nside = 2 ** (order + tileBits);
  const side = 2 ** tileBits;
  const mask = side - 1;
  const base = 4 ** order;
  const f = new Int32Array(3);
  let lastTile = -1;
  let lastSlot = 0;
  for (let r = 0; r < h; r++) {
    const eta = ((h - 1) / 2 - r) * step;
    for (let c = 0; c < w; c++) {
      const xi = ((w - 1) / 2 - c) * step; // east is left
      const x = cd * ca - xi * sa - eta * sd * ca;
      const y = cd * sa + xi * ca - eta * sd * sa;
      const z = sd + eta * cd;
      const rxy = Math.sqrt(x * x + y * y);
      const norm = Math.sqrt(rxy * rxy + z * z);
      let tt = Math.atan2(y, x) / (Math.PI / 2);
      if (tt < 0) tt += 4;
      if (tt >= 4) tt -= 4;
      xyf(nside, z / norm, tt, rxy / norm, f);
      const ix = f[1] as number;
      const iy = f[2] as number;
      const tile = (f[0] as number) * base + interleave(ix >> tileBits, iy >> tileBits, order);
      if (tile !== lastTile) {
        let s = index.get(tile);
        if (s === undefined) {
          s = tiles.length;
          if (s > 32767) throw new Error('too many tiles in view');
          index.set(tile, s);
          tiles.push(tile);
        }
        lastTile = tile;
        lastSlot = s;
      }
      slot[r * w + c] = lastSlot;
      offset[r * w + c] = tileOffset(ix & mask, iy & mask, side, png);
    }
  }
  return { w, h, order, tiles, slot, offset };
}

/** Science values per screen pixel; NaN where the plane has no data or has not loaded. */
export function sample(g: Geometry, planes: (Float32Array | undefined)[]): Float32Array {
  const out = new Float32Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) {
    const p = planes[g.slot[i] as number];
    out[i] = p ? (p[g.offset[i] as number] as number) : NaN;
  }
  return out;
}

// --- display mapping ------------------------------------------------------------------------

export type Stretch = 'linear' | 'asinh';
export type ColourMap = 'grey' | 'viridis' | 'inferno';
const ASINH_SOFT = 0.1; // asinh softening, in units of the clip range

/** Value to [0, 1] after clipping to [lo, hi]; NaN stays NaN. */
export function stretch(v: number, lo: number, hi: number, s: Stretch): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)));
  return s === 'linear' ? t : Math.asinh(t / ASINH_SOFT) / Math.asinh(1 / ASINH_SOFT);
}

/** Inverse of `stretch` inside the clip range, for legend tick labels. */
export function unstretch(y: number, lo: number, hi: number, s: Stretch): number {
  const t = s === 'linear' ? y : ASINH_SOFT * Math.sinh(y * Math.asinh(1 / ASINH_SOFT));
  return lo + t * (hi - lo);
}

/** Percentiles of the finite values (sorted subsample of at most 40 000; exact below that). */
export function percentiles(values: Float32Array, ps: number[]): number[] | null {
  const step = Math.max(1, Math.floor(values.length / 40000));
  const s: number[] = [];
  for (let i = 0; i < values.length; i += step) {
    const v = values[i] as number;
    if (Number.isFinite(v)) s.push(v);
  }
  if (s.length === 0) return null;
  s.sort((a, b) => a - b);
  return ps.map((p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))] as number);
}

// matplotlib's perceptually uniform maps, 9 stops each (lightness rises monotonically)
const STOPS: Record<Exclude<ColourMap, 'grey'>, string[]> = {
  viridis: [
    '440154',
    '472d7b',
    '3b528b',
    '2c728e',
    '21918c',
    '28ae80',
    '5ec962',
    'addc30',
    'fde725',
  ],
  inferno: [
    '000004',
    '1f0c48',
    '550f6d',
    '88226a',
    'ba3655',
    'e35933',
    'f98e09',
    'f9cb35',
    'fcffa4',
  ],
};

/** 256-entry RGB lookup table. */
export function lut(map: ColourMap): Uint8Array {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    if (map === 'grey') {
      out.set([i, i, i], i * 3);
      continue;
    }
    const stops = STOPS[map];
    const x = (i / 255) * (stops.length - 1);
    const a = Math.floor(x);
    const b = Math.min(stops.length - 1, a + 1);
    for (let k = 0; k < 3; k++) {
      const ca = parseInt((stops[a] as string).slice(k * 2, k * 2 + 2), 16);
      const cb = parseInt((stops[b] as string).slice(k * 2, k * 2 + 2), 16);
      out[i * 3 + k] = Math.round(ca + (cb - ca) * (x - a));
    }
  }
  return out;
}

/** Missing data: a two-tone hatch that cannot be mistaken for a measured zero (black). */
export const MISSING: [number, number, number][] = [
  [58, 46, 62],
  [34, 28, 38],
];
const hatch = (i: number, w: number) =>
  MISSING[(((i % w) + Math.floor(i / w)) >> 2) & 1] as number[];

function put(px: Uint8ClampedArray, i: number, r: number, g: number, b: number, a = 255) {
  px[i * 4] = r;
  px[i * 4 + 1] = g;
  px[i * 4 + 2] = b;
  px[i * 4 + 3] = a;
}

/**
 * IRSA display tiles: `level + 1` bytes through a colour map. Tiles not yet loaded stay
 * transparent; tiles IRSA lacks (null) and transparent pixels get the missing-data hatch.
 */
export function paintDisplay(
  g: Geometry,
  tiles: (Uint8Array | null | undefined)[],
  map: Uint8Array,
  px: Uint8ClampedArray,
) {
  for (let i = 0; i < g.w * g.h; i++) {
    const t = tiles[g.slot[i] as number];
    if (t === undefined) put(px, i, 0, 0, 0, 0);
    else {
      const b = t ? (t[g.offset[i] as number] as number) : 0;
      if (b === 0) {
        const [r, gg, bb] = hatch(i, g.w) as [number, number, number];
        put(px, i, r, gg, bb);
      } else
        put(
          px,
          i,
          map[(b - 1) * 3] as number,
          map[(b - 1) * 3 + 1] as number,
          map[(b - 1) * 3 + 2] as number,
        );
    }
  }
}

export interface Clip {
  lo: number;
  hi: number;
}

/** One numeric channel through clip, stretch and colour map; NaN gets the hatch. */
export function paintScalar(
  values: Float32Array,
  w: number,
  clip: Clip,
  s: Stretch,
  map: Uint8Array,
  px: Uint8ClampedArray,
) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isNaN(v)) {
      const [r, g, b] = hatch(i, w) as [number, number, number];
      put(px, i, r, g, b);
    } else {
      const k = Math.round(stretch(v, clip.lo, clip.hi, s) * 255) * 3;
      put(px, i, map[k] as number, map[k + 1] as number, map[k + 2] as number);
    }
  }
}

/**
 * False colour: each channel clipped and stretched on its own, then written to R, G or B. A
 * pixel missing in any channel is hatched rather than drawn with that channel at zero, which
 * would invent a colour. Returns how many pixels were missing.
 */
export function paintRgb(
  channels: [Float32Array, Float32Array, Float32Array],
  w: number,
  clips: [Clip, Clip, Clip],
  s: Stretch,
  px: Uint8ClampedArray,
): number {
  let missing = 0;
  const [r, g, b] = channels;
  for (let i = 0; i < r.length; i++) {
    const vr = r[i] as number;
    const vg = g[i] as number;
    const vb = b[i] as number;
    if (Number.isNaN(vr) || Number.isNaN(vg) || Number.isNaN(vb)) {
      missing++;
      const [hr, hg, hb] = hatch(i, w) as [number, number, number];
      put(px, i, hr, hg, hb);
    } else
      put(
        px,
        i,
        Math.round(stretch(vr, clips[0].lo, clips[0].hi, s) * 255),
        Math.round(stretch(vg, clips[1].lo, clips[1].hi, s) * 255),
        Math.round(stretch(vb, clips[2].lo, clips[2].hi, s) * 255),
      );
  }
  return missing;
}

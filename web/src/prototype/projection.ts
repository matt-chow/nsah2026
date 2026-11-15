// Planetarium projection for the prototype dome: stereographic, north up and east left at the
// centre, so wide fields (up to ~150°) stay conformal where the atlas's gnomonic view would
// stretch. Display geometry only; scientific pixel↔sky transforms stay in Astropy.

import { interleave, tileOffset, xyf } from '../lib/healpix.ts';

const DEG = Math.PI / 180;

export interface View {
  ra: number; // centre, ICRS degrees
  dec: number;
  fov: number; // horizontal width, degrees
}

export const FOV_MIN = 0.6;
export const FOV_MAX = 150;
const DEC_LIMIT = 89.9; // the east/north basis is undefined exactly at the poles

export const clampView = (v: View): View => ({
  ra: (((v.ra % 360) + 360) % 360) as number,
  dec: Math.max(-DEC_LIMIT, Math.min(DEC_LIMIT, v.dec)),
  fov: Math.max(FOV_MIN, Math.min(FOV_MAX, v.fov)),
});

/** Centre direction f and its east (e) and north (n) unit vectors. */
function basis(v: View) {
  const a = v.ra * DEG;
  const d = v.dec * DEG;
  const [ca, sa, cd, sd] = [Math.cos(a), Math.sin(a), Math.cos(d), Math.sin(d)];
  return { f: [cd * ca, cd * sa, sd], e: [-sa, ca, 0], n: [-sd * ca, -sd * sa, cd] };
}

/** Plane units (2·tan(θ/2)) per screen pixel, so the view's half-width is fov / 2. */
export const planePerPx = (v: View, w: number) => (2 * Math.tan((v.fov / 4) * DEG)) / (w / 2);

/** Sky position to screen pixels; null when behind the viewer. */
export function toScreen(v: View, w: number, h: number, ra: number, dec: number) {
  const { f, e, n } = basis(v);
  const a = ra * DEG;
  const d = dec * DEG;
  const p = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const dot = (q: number[]) =>
    (p[0] as number) * (q[0] as number) +
    (p[1] as number) * (q[1] as number) +
    (p[2] as number) * (q[2] as number);
  const c = dot(f);
  if (c < -0.5) return null;
  const s = 2 / (1 + c); // stereographic: plane vector = 2·(p − (p·f)f) / (1 + p·f)
  const k = planePerPx(v, w);
  return { x: w / 2 - (dot(e) * s) / k, y: h / 2 - (dot(n) * s) / k };
}

/** Screen pixel to sky position. */
export function toSky(v: View, w: number, h: number, x: number, y: number) {
  const { f, e, n } = basis(v);
  const k = planePerPx(v, w);
  const u = (w / 2 - x) * k;
  const t = (h / 2 - y) * k;
  const r2 = u * u + t * t;
  const c = (4 - r2) / (4 + r2); // cos θ for θ = 2·atan(ρ / 2)
  const q = 4 / (4 + r2); // sin θ / ρ
  const vec = [0, 1, 2].map(
    (i) => c * (f[i] as number) + q * (u * (e[i] as number) + t * (n[i] as number)),
  ) as [number, number, number];
  const ra = (((Math.atan2(vec[1], vec[0]) / DEG) % 360) + 360) % 360;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, vec[2]))) / DEG };
}

const BASE_DEG = Math.sqrt(Math.PI / 3) / DEG; // HEALPix base-pixel width

/** Coarsest HiPS order whose tile pixels are no larger than a screen pixel at the centre. */
export function domeOrder(v: View, w: number, tileBits: number, maxOrder: number) {
  const screen = planePerPx(v, w) / DEG; // near the centre one plane unit ≈ one radian
  for (let k = 0; k < maxOrder; k++) if (BASE_DEG / 2 ** (k + tileBits) <= screen) return k;
  return maxOrder;
}

export interface DomeGeometry {
  w: number;
  h: number;
  order: number;
  coarse: number; // fallback order drawn where `order` tiles have not arrived yet
  tiles: string[]; // `${order}/${npix}`, distinct, first-seen order
  slot: Int16Array; // fine tile per pixel, -1 outside the sky disc
  offset: Int32Array;
  slot2: Int16Array; // coarse tile per pixel
  offset2: Int32Array;
}

/** Which HiPS tile pixel each screen pixel shows, at `order` and a coarser fallback. */
export function domeGeometry(
  v: View,
  w: number,
  h: number,
  order: number,
  tileBits: number,
): DomeGeometry {
  const coarse = Math.max(0, order - 3);
  const drop = order - coarse;
  const n = w * h;
  const slot = new Int16Array(n);
  const offset = new Int32Array(n);
  const slot2 = new Int16Array(n);
  const offset2 = new Int32Array(n);
  const index = new Map<string, number>();
  const tiles: string[] = [];
  const id = (o: number, npix: number) => {
    const key = `${o}/${npix}`;
    let s = index.get(key);
    if (s === undefined) {
      s = tiles.length;
      if (s > 32767) throw new Error('too many tiles in view');
      index.set(key, s);
      tiles.push(key);
    }
    return s;
  };
  const { f, e, n: nn } = basis(v);
  const k = planePerPx(v, w);
  const nside = 2 ** (order + tileBits);
  const side = 2 ** tileBits;
  const mask = side - 1;
  const base = 4 ** order;
  const base2 = 4 ** coarse;
  const out = new Int32Array(3);
  let lastTile = -1;
  let lastSlot = 0;
  let lastTile2 = -1;
  let lastSlot2 = 0;
  for (let r = 0; r < h; r++) {
    const t = (h / 2 - r - 0.5) * k;
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const u = (w / 2 - c - 0.5) * k;
      const r2 = u * u + t * t;
      const cz = (4 - r2) / (4 + r2);
      const q = 4 / (4 + r2);
      const x = cz * (f[0] as number) + q * (u * (e[0] as number) + t * (nn[0] as number));
      const y = cz * (f[1] as number) + q * (u * (e[1] as number) + t * (nn[1] as number));
      const z = cz * (f[2] as number) + q * (u * (e[2] as number) + t * (nn[2] as number));
      let tt = Math.atan2(y, x) / (Math.PI / 2);
      if (tt < 0) tt += 4;
      if (tt >= 4) tt -= 4;
      xyf(nside, z, tt, Math.sqrt(x * x + y * y), out);
      const face = out[0] as number;
      const ix = out[1] as number;
      const iy = out[2] as number;
      const tile = face * base + interleave(ix >> tileBits, iy >> tileBits, order);
      if (tile !== lastTile) {
        lastTile = tile;
        lastSlot = id(order, tile);
      }
      slot[i] = lastSlot;
      offset[i] = tileOffset(ix & mask, iy & mask, side, true);
      const cx = ix >> drop;
      const cy = iy >> drop;
      const tile2 = face * base2 + interleave(cx >> tileBits, cy >> tileBits, coarse);
      if (tile2 !== lastTile2) {
        lastTile2 = tile2;
        lastSlot2 = id(coarse, tile2);
      }
      slot2[i] = lastSlot2;
      offset2[i] = tileOffset(cx & mask, cy & mask, side, true);
    }
  }
  return { w, h, order, coarse, tiles, slot, offset, slot2, offset2 };
}

/** Missing data: a neutral two-tone hatch that cannot be read as a measured dark sky. */
const HATCH = [
  [44, 42, 40],
  [24, 23, 22],
] as const;

/**
 * Display bytes (level + 1, 0 = no data) through a colour table. A tile not yet loaded falls
 * back to the coarse tile, then to transparent; a missing tile (null) or byte 0 is hatched.
 */
export function paintDome(
  g: DomeGeometry,
  tiles: (Uint8Array | null | undefined)[],
  map: Uint8Array,
  px: Uint8ClampedArray,
) {
  for (let i = 0; i < g.w * g.h; i++) {
    let t = tiles[g.slot[i] as number];
    let off = g.offset[i] as number;
    if (t === undefined) {
      t = tiles[g.slot2[i] as number];
      off = g.offset2[i] as number;
    }
    const o = i * 4;
    if (t === undefined) {
      px[o + 3] = 0;
      continue;
    }
    const b = t ? (t[off] as number) : 0;
    if (b === 0) {
      const hc = HATCH[((((i % g.w) + Math.floor(i / g.w)) >> 2) & 1) as 0 | 1];
      px[o] = hc[0];
      px[o + 1] = hc[1];
      px[o + 2] = hc[2];
    } else {
      const m = (b - 1) * 3;
      px[o] = map[m] as number;
      px[o + 1] = map[m + 1] as number;
      px[o + 2] = map[m + 2] as number;
    }
    px[o + 3] = 255;
  }
}

/** Angular distance in degrees. */
export function separation(a: View, b: View) {
  const p = basis(a).f;
  const q = basis(b).f;
  const d =
    (p[0] as number) * (q[0] as number) +
    (p[1] as number) * (q[1] as number) +
    (p[2] as number) * (q[2] as number);
  return Math.acos(Math.max(-1, Math.min(1, d))) / DEG;
}

/**
 * Camera at time t ∈ [0, 1] of a flight: the centre follows the great circle, and the field of
 * view widens mid-flight just enough to keep both ends in sight, so the path explains where the
 * destination is relative to the start.
 */
export function flight(a: View, b: View, t: number): View {
  const pa = basis(a).f;
  const pb = basis(b).f;
  const ang = separation(a, b) * DEG;
  let p: number[];
  if (ang < 1e-9) p = pa;
  else {
    const s = Math.sin(ang);
    const wa = Math.sin((1 - t) * ang) / s;
    const wb = Math.sin(t * ang) / s;
    p = [0, 1, 2].map((i) => wa * (pa[i] as number) + wb * (pb[i] as number));
  }
  const ra = (((Math.atan2(p[1] as number, p[0] as number) / DEG) % 360) + 360) % 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, p[2] as number))) / DEG;
  const peak = Math.min(FOV_MAX, Math.max(a.fov, b.fov, (ang / DEG) * 1.4));
  // log-space zoom, with a bump to `peak` in the middle
  const la = Math.log(a.fov);
  const lb = Math.log(b.fov);
  const lp = Math.log(peak);
  const base = la + (lb - la) * t;
  const bump = Math.max(0, lp - Math.max(la, lb)) * Math.sin(Math.PI * t);
  return clampView({ ra, dec, fov: Math.exp(base + bump) });
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Shareable atlas state in the URL hash: #/atlas?ra=83.82&dec=-5.39&fov=2&mode=values&f=47...
// Anything missing or invalid falls back to a default, so any link opens something sensible.

import type { ColourMap, Stretch } from './render.ts';

export type Mode = 'mosaic' | 'values' | 'rgb';
export interface AtlasState {
  ra: number;
  dec: number;
  fov: number; // degrees across the view
  mode: Mode;
  frame: number; // 0-based cube layer
  rgb: [number, number, number]; // layers for R, G, B
  cmap: ColourMap;
  stretch: Stretch;
}

export const FOV_RANGE: [number, number] = [0.05, 90]; // a gnomonic view stays readable to ~90°
// 1.254 / 2.240 / 3.293 µm: J- and K-band starlight and the 3.3 µm PAH feature. Not 1.102 µm: that
// band-1 edge layer carries strong survey-stripe offsets in the DR1 cube (IRSA display tiles too).
export const RGB_PRESET: [number, number, number] = [62, 47, 22];

export const DEFAULT_STATE: AtlasState = {
  ra: 83.822, // Orion Nebula (M42)
  dec: -5.391,
  fov: 1.5,
  mode: 'mosaic',
  frame: 47,
  rgb: RGB_PRESET,
  cmap: 'inferno',
  stretch: 'asinh',
};

const pick = <T extends string>(v: string | null, ok: readonly T[], d: T) =>
  ok.includes(v as T) ? (v as T) : d;
const num = (v: string | null, lo: number, hi: number, d: number) => {
  const n = v === null || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

export function readState(hash: string, depth: number): AtlasState {
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const d = DEFAULT_STATE;
  const frame = (v: string | undefined, f: number) => num(v ?? null, 0, depth - 1, f) | 0;
  const rgb = (q.get('rgb') ?? '').split(',');
  return {
    ra: num(q.get('ra'), 0, 360, d.ra) % 360,
    dec: num(q.get('dec'), -90, 90, d.dec),
    fov: num(q.get('fov'), FOV_RANGE[0], FOV_RANGE[1], d.fov),
    mode: pick(q.get('mode'), ['mosaic', 'values', 'rgb'] as const, d.mode),
    frame: frame(q.get('f') ?? undefined, d.frame),
    rgb:
      rgb.length === 3
        ? [frame(rgb[0], d.rgb[0]), frame(rgb[1], d.rgb[1]), frame(rgb[2], d.rgb[2])]
        : d.rgb,
    cmap: pick(q.get('cmap'), ['grey', 'viridis', 'inferno'] as const, d.cmap),
    stretch: pick(q.get('s'), ['linear', 'asinh'] as const, d.stretch),
  };
}

export function writeState(s: AtlasState): string {
  const q = new URLSearchParams({
    ra: s.ra.toFixed(4),
    dec: s.dec.toFixed(4),
    fov: s.fov.toPrecision(3),
    mode: s.mode,
    f: String(s.frame),
    rgb: s.rgb.join(','),
    cmap: s.cmap,
    s: s.stretch,
  });
  return `#/atlas?${q.toString().replace(/%2C/g, ',')}`;
}

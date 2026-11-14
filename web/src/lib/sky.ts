// Display-side TAN projection and difference colouring. The manifest WCS is the simple
// north-up TAN grid written by the pipeline (CRPIX/CDELT/CRVAL), so no SIP terms apply here.

const DEG = Math.PI / 180;

export interface TanWcs {
  crpix1: number;
  crpix2: number;
  cdelt1: number;
  cdelt2: number;
  crval1: number;
  crval2: number;
}

export function tanWcs(wcs: Record<string, string | number | boolean>): TanWcs | null {
  const keys = ['CRPIX1', 'CRPIX2', 'CDELT1', 'CDELT2', 'CRVAL1', 'CRVAL2'] as const;
  if (wcs.CTYPE1 !== 'RA---TAN' || wcs.CTYPE2 !== 'DEC--TAN') return null;
  const v = keys.map((k) => wcs[k]);
  if (!v.every((x) => typeof x === 'number')) return null;
  const [crpix1, crpix2, cdelt1, cdelt2, crval1, crval2] = v as number[];
  return { crpix1, crpix2, cdelt1, cdelt2, crval1, crval2 } as TanWcs;
}

/** 0-based FITS pixel (x, y) to ICRS degrees (gnomonic inverse). */
export function pixelToSky(w: TanWcs, x: number, y: number): { ra: number; dec: number } {
  const xi = (x + 1 - w.crpix1) * w.cdelt1 * DEG;
  const eta = (y + 1 - w.crpix2) * w.cdelt2 * DEG;
  const a0 = w.crval1 * DEG;
  const d0 = w.crval2 * DEG;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, den);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den));
  return { ra: (((ra / DEG) % 360) + 360) % 360, dec: dec / DEG };
}

/** ICRS degrees to 0-based FITS pixel (gnomonic forward). */
export function skyToPixel(w: TanWcs, ra: number, dec: number): { x: number; y: number } {
  const a = ra * DEG - w.crval1 * DEG;
  const d = dec * DEG;
  const d0 = w.crval2 * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  const xi = (Math.cos(d) * Math.sin(a)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc;
  return { x: xi / DEG / w.cdelt1 + w.crpix1 - 1, y: eta / DEG / w.cdelt2 + w.crpix2 - 1 };
}

export const formatRa = (deg: number) => {
  const h = deg / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(1).padStart(4, '0')}s`;
};

export const formatDec = (deg: number) => {
  const s = deg < 0 ? '−' : '+';
  const a = Math.abs(deg);
  const dd = Math.floor(a);
  const mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${s}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`;
};

/** Significance in sigma for an encoded byte, or null when masked (0). */
export const decodeSigma = (byte: number, range: number) =>
  byte === 0 ? null : ((byte - 128) / 127) * range;

/**
 * Diverging colour for an encoded significance byte: ink-blue for negative, amber for
 * positive, near-black at zero; masked pixels are a neutral hatch grey. Magnitude also
 * drives lightness, so the map still reads in greyscale.
 */
export function divergingRgb(byte: number): [number, number, number] {
  if (byte === 0) return [52, 48, 44];
  const t = Math.max(-1, Math.min(1, (byte - 128) / 127));
  const m = Math.sqrt(Math.abs(t)); // emphasise faint residuals near the noise level
  const [r, g, b] = t >= 0 ? [242, 163, 58] : [96, 156, 236];
  return [
    Math.round(12 + (r - 12) * m),
    Math.round(14 + (g - 14) * m),
    Math.round(20 + (b - 20) * m),
  ];
}

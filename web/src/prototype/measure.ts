// Measurements on the flipbook's cutout grids (api/_spherex.py): n × n pixels of 6.15″, row 0 north,
// column 0 east, values in MJy/sr minus the cutout median, NaN = no data. These are archive pixel
// values after bilinear reprojection, not the display stretch. The cutouts carry no variance
// plane, so noise is estimated from the pixels themselves (see docs/SCIENCE.md, Assumptions 16–18).

export const PIX_ARCSEC = 6.15;
/** MJy/sr summed over pixels → mJy: one pixel's solid angle in sr, times 1e9 mJy per MJy. */
export const MJY_PER_SUM = (PIX_ARCSEC / 206264.806) ** 2 * 1e9;
const MIN_SNR = 5;
// arcsec added in quadrature: the PSF is undersampled and resampled, so even a bright star's
// moments shift by a fraction of a pixel between exposures; the fit's √χ²ᵣ catches the rest
const CENTROID_FLOOR = 0.3;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Background level and per-pixel noise (1.4826 × MAD) in an annulus around the grid centre. */
function sky(pix: Float32Array, n: number, rin: number, rout: number) {
  const c = (n - 1) / 2;
  const v: number[] = [];
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++) {
      const d = Math.hypot(r - c, col - c);
      const x = pix[r * n + col] as number;
      if (d >= rin && d <= rout && !Number.isNaN(x)) v.push(x);
    }
  if (v.length < 20) return null;
  const bg = median(v);
  return { bg, sigma: 1.4826 * median(v.map((x) => Math.abs(x - bg))), count: v.length };
}

/** East and north offsets from the grid centre, in arcsec, with 1σ errors. */
export interface Centroid {
  e: number;
  n: number;
  se: number;
  sn: number;
  snr: number;
}

/**
 * First-moment centroid of the source nearest the grid centre: the brightest pixel within
 * `search` pixels of the centre, then background-subtracted moments within `r` pixels of it.
 * Error σ²_x = σ² Σ(x − x̄)² / F², background-limited (source photon noise and the pixel
 * correlations from reprojection are not included). Null below SNR 5 or with missing pixels.
 */
export function centroid(pix: Float32Array, n: number, search = 2, r = 2.5): Centroid | null {
  const s = sky(pix, n, 6, 9);
  if (!s || !(s.sigma > 0)) return null;
  const c = (n - 1) / 2;
  let pr = -1;
  let pc = -1;
  for (let y = Math.round(c - search); y <= Math.round(c + search); y++)
    for (let x = Math.round(c - search); x <= Math.round(c + search); x++) {
      const v = pix[y * n + x] as number;
      if (!Number.isNaN(v) && (pr < 0 || v > (pix[pr * n + pc] as number))) [pr, pc] = [y, x];
    }
  if (pr < 0) return null;
  let f = 0;
  let mx = 0;
  let my = 0;
  const pts: [number, number, number][] = [];
  for (let y = Math.floor(pr - r); y <= Math.ceil(pr + r); y++)
    for (let x = Math.floor(pc - r); x <= Math.ceil(pc + r); x++) {
      if (Math.hypot(y - pr, x - pc) > r) continue;
      const v = pix[y * n + x];
      if (v === undefined || Number.isNaN(v)) return null; // a gap would bias the moments
      const w = v - s.bg;
      pts.push([x, y, w]);
      f += w;
      mx += w * x;
      my += w * y;
    }
  const snr = f / (s.sigma * Math.sqrt(pts.length));
  if (!(snr >= MIN_SNR)) return null;
  mx /= f;
  my /= f;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of pts) {
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  return {
    e: (c - mx) * PIX_ARCSEC,
    n: (c - my) * PIX_ARCSEC,
    se: Math.hypot((s.sigma * Math.sqrt(vx) * PIX_ARCSEC) / f, CENTROID_FLOOR),
    sn: Math.hypot((s.sigma * Math.sqrt(vy) * PIX_ARCSEC) / f, CENTROID_FLOOR),
    snr,
  };
}

/** Straight line v = a + b t by weighted least squares; errors scaled up by √χ²ᵣ when it exceeds 1. */
export function fitLine(t: number[], v: number[], s: number[]) {
  let sw = 0;
  let st = 0;
  let sv = 0;
  for (let k = 0; k < t.length; k++) {
    const w = 1 / (s[k] as number) ** 2;
    sw += w;
    st += w * (t[k] as number);
    sv += w * (v[k] as number);
  }
  const t0 = st / sw;
  let stt = 0;
  let stv = 0;
  for (let k = 0; k < t.length; k++) {
    const w = 1 / (s[k] as number) ** 2;
    const dt = (t[k] as number) - t0;
    stt += w * dt * dt;
    stv += w * dt * (v[k] as number);
  }
  const b = stv / stt;
  const a = sv / sw - b * t0;
  let chi2 = 0;
  for (let k = 0; k < t.length; k++)
    chi2 += (((v[k] as number) - a - b * (t[k] as number)) / (s[k] as number)) ** 2;
  const chi2r = t.length > 2 ? chi2 / (t.length - 2) : NaN;
  const scale = chi2r > 1 ? Math.sqrt(chi2r) : 1;
  return { a, b, sb: scale / Math.sqrt(stt), chi2r };
}

export interface Motion {
  pmE: number; // arcsec / year, east
  pmN: number;
  sE: number;
  sN: number;
  total: number;
  sTotal: number;
  chi2r: number;
  used: number;
  years: number; // time span of the exposures used
  track: { mjd: number; e: number; n: number }[];
}

const MIN_POINTS = 4;
const MIN_YEARS = 0.1;

/** Linear sky motion from per-exposure centroids; null when too few or too close in time. */
export function fitMotion(points: { mjd: number; c: Centroid }[]): Motion | null {
  if (points.length < MIN_POINTS) return null;
  const t = points.map((p) => p.mjd / 365.25);
  const years = Math.max(...t) - Math.min(...t);
  if (years < MIN_YEARS) return null;
  const fe = fitLine(
    t,
    points.map((p) => p.c.e),
    points.map((p) => p.c.se),
  );
  const fn = fitLine(
    t,
    points.map((p) => p.c.n),
    points.map((p) => p.c.sn),
  );
  const total = Math.hypot(fe.b, fn.b);
  return {
    pmE: fe.b,
    pmN: fn.b,
    sE: fe.sb,
    sN: fn.sb,
    total,
    // first-order propagation; near zero motion it falls back to the larger axis error
    sTotal: total > 0 ? Math.hypot(fe.b * fe.sb, fn.b * fn.sb) / total : Math.max(fe.sb, fn.sb),
    chi2r: Math.max(fe.chi2r, fn.chi2r),
    used: points.length,
    years,
    track: points.map((p) => ({ mjd: p.mjd, e: p.c.e, n: p.c.n })),
  };
}

/**
 * Aperture sum within `r` pixels of the grid centre minus the annulus median, in mJy, with a
 * background-limited 1σ error. No aperture correction: SPHEREx's PSF spills past a 2-pixel
 * aperture, so this is a relative brightness, not a calibrated total flux.
 */
export function aperture(pix: Float32Array, n: number, r = 2) {
  const s = sky(pix, n, 6, 9);
  if (!s) return null;
  const c = (n - 1) / 2;
  let sum = 0;
  let k = 0;
  for (let y = Math.floor(c - r); y <= Math.ceil(c + r); y++)
    for (let x = Math.floor(c - r); x <= Math.ceil(c + r); x++) {
      if (Math.hypot(y - c, x - c) > r) continue;
      const v = pix[y * n + x];
      if (v === undefined || Number.isNaN(v)) return null;
      sum += v - s.bg;
      k++;
    }
  // pixel noise plus the uncertainty of the subtracted median (√(π/2) σ/√N per pixel)
  const err = s.sigma * Math.sqrt(k + (k * k * Math.PI) / 2 / s.count);
  return { mjy: sum * MJY_PER_SUM, err: err * MJY_PER_SUM };
}

/** a − b per pixel; NaN where either has no data. */
export const difference = (a: Float32Array, b: Float32Array) => a.map((v, k) => v - (b[k] ?? NaN));

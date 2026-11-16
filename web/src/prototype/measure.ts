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

const bilinear = (pix: Float32Array, n: number, x: number, y: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) return NaN;
  const fx = x - x0;
  const fy = y - y0;
  const p = (r: number, c: number) => pix[r * n + c] as number;
  return (
    (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) +
    (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy
  );
};

/**
 * Centre of a saturated star from its unsaturated wings: the point within `search` pixels of the
 * grid centre about which the image is most nearly point-symmetric (mean squared difference
 * between each valid pixel within `r` and its bilinear reflection), ignoring the NaN core.
 * No per-exposure error: the PSF is not exactly symmetric, so fitMotion's empirical mode takes
 * the errors from the scatter of the positions. Null when too few wing pixels survive.
 */
export function wingCentroid(pix: Float32Array, n: number, search = 2, r = 4) {
  const c = (n - 1) / 2;
  const cost = (cx: number, cy: number) => {
    let s = 0;
    let k = 0;
    for (let y = Math.ceil(cy - r); y <= Math.floor(cy + r); y++)
      for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
        if (Math.hypot(x - cx, y - cy) > r) continue;
        const v = pix[y * n + x];
        const w = bilinear(pix, n, 2 * cx - x, 2 * cy - y);
        if (v === undefined || Number.isNaN(v) || Number.isNaN(w)) continue;
        s += (v - w) ** 2;
        k++;
      }
    return k >= 12 ? s / k : Infinity;
  };
  // coarse 0.2 px grid over the search box, then 0.02 px around the best
  let best = { v: Infinity, x: c, y: c };
  for (const [half, stepPx] of [
    [search, 0.2],
    [0.2, 0.02],
  ] as const) {
    const { x: x0, y: y0 } = best;
    for (let dy = -half; dy <= half + 1e-9; dy += stepPx)
      for (let dx = -half; dx <= half + 1e-9; dx += stepPx) {
        const v = cost(x0 + dx, y0 + dy);
        if (v < best.v) best = { v, x: x0 + dx, y: y0 + dy };
      }
  }
  return best.v === Infinity
    ? null
    : { e: (c - best.x) * PIX_ARCSEC, n: (c - best.y) * PIX_ARCSEC };
}

/**
 * Earth's barycentric position in AU, equatorial J2000, from the low-precision solar
 * coordinates of the Astronomical Almanac (~0.01°); heliocentric ≈ barycentric to 0.01 AU.
 * Good to ~1 % of a parallax, far below the centroid scatter. SPHEREx orbits Earth (≪ 1 AU).
 */
export function earthAu(mjd: number): [number, number, number] {
  const d = Math.PI / 180;
  const t = mjd - 51544.5;
  const g = (357.528 + 0.9856003 * t) * d;
  const lam = (280.46 + 0.9856474 * t + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * d;
  const r = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const eps = (23.439 - 4e-7 * t) * d;
  // the Sun seen from Earth, reversed
  return [
    -r * Math.cos(lam),
    -r * Math.cos(eps) * Math.sin(lam),
    -r * Math.sin(eps) * Math.sin(lam),
  ];
}

/** Parallax factors: the east (α cos δ) and north shifts, in units of the parallax, at a date. */
export function parallaxFactors(ra: number, dec: number, mjd: number) {
  const d = Math.PI / 180;
  const [x, y, z] = earthAu(mjd);
  const [sa, ca, sd, cd] = [
    Math.sin(ra * d),
    Math.cos(ra * d),
    Math.sin(dec * d),
    Math.cos(dec * d),
  ];
  return { e: x * sa - y * ca, n: x * ca * sd + y * sa * sd - z * cd };
}

/** Weighted linear least squares: parameters, covariance (not yet χ²-scaled), χ² and dof. */
export function lsq(rows: number[][], y: number[], s: number[]) {
  const m = rows[0]?.length ?? 0;
  const a = Array.from({ length: m }, () => new Array<number>(2 * m).fill(0));
  const b = new Array<number>(m).fill(0);
  rows.forEach((row, k) => {
    const w = 1 / (s[k] as number) ** 2;
    for (let i = 0; i < m; i++) {
      b[i] = (b[i] as number) + w * (row[i] as number) * (y[k] as number);
      for (let j = 0; j < m; j++)
        (a[i] as number[])[j] =
          ((a[i] as number[])[j] as number) + w * (row[i] as number) * (row[j] as number);
    }
  });
  // Gauss–Jordan inverse of the normal matrix, with partial pivoting
  a.forEach((r, i) => (r[m + i] = 1));
  for (let i = 0; i < m; i++) {
    let p = i;
    for (let k = i + 1; k < m; k++)
      if (Math.abs((a[k] as number[])[i] as number) > Math.abs((a[p] as number[])[i] as number))
        p = k;
    [a[i], a[p]] = [a[p] as number[], a[i] as number[]];
    const ri = a[i] as number[];
    const piv = ri[i] as number;
    if (!(Math.abs(piv) > 1e-12)) return null; // degenerate: the data cannot separate the terms
    for (let j = 0; j < 2 * m; j++) ri[j] = (ri[j] as number) / piv;
    for (let k = 0; k < m; k++) {
      if (k === i) continue;
      const rk = a[k] as number[];
      const f = rk[i] as number;
      for (let j = 0; j < 2 * m; j++) rk[j] = (rk[j] as number) - f * (ri[j] as number);
    }
  }
  const cov = a.map((r) => r.slice(m));
  const p = cov.map((r) => r.reduce((t, v, j) => t + v * (b[j] as number), 0));
  let chi2 = 0;
  rows.forEach((row, k) => {
    const model = row.reduce((t, v, j) => t + v * (p[j] as number), 0);
    chi2 += (((y[k] as number) - model) / (s[k] as number)) ** 2;
  });
  return { p, cov, chi2, dof: rows.length - m };
}

/** Straight line v = a + b t by weighted least squares; errors scaled up by √χ²ᵣ when it exceeds 1. */
export function fitLine(t: number[], v: number[], s: number[], empirical = false) {
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
  // empirical: the input errors are only relative weights, so the scatter sets the scale
  const scale = empirical || chi2r > 1 ? Math.sqrt(chi2r) : 1;
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
  empirical: boolean; // errors from the scatter of the positions, not from per-exposure errors
  /** The same positions fitted with parallax as well; null when the data cannot separate it. */
  withParallax: {
    pmE: number;
    pmN: number;
    sE: number;
    sN: number;
    plx: number; // arcsec
    sPlx: number;
    chi2r: number;
  } | null;
}

const MIN_POINTS = 4;
const MIN_YEARS = 0.1;

const MIN_PLX_POINTS = 8;
// SPHEREx sees a point every ~6 months, always near the same two parallax extremes; with fewer
// than three visits parallax and proper motion are degenerate (R Draconis over 0.46 yr gave a
// spurious −5.7 ± 1.9″), so the joint fit waits for about a year
const MIN_PLX_YEARS = 0.9;

/**
 * Linear sky motion from per-exposure centroids; null when too few or too close in time. With
 * the target's ra/dec it also fits position + proper motion + parallax jointly (5 parameters,
 * both axes, Earth's orbit from earthAu), the classic astrometric model without acceleration.
 * `empirical` treats the errors as weights only and scales them by the scatter.
 */
export function fitMotion(
  points: { mjd: number; c: Centroid }[],
  opts: { ra?: number; dec?: number; empirical?: boolean } = {},
): Motion | null {
  const empirical = !!opts.empirical;
  if (points.length < MIN_POINTS) return null;
  const t = points.map((p) => p.mjd / 365.25);
  const years = Math.max(...t) - Math.min(...t);
  if (years < MIN_YEARS) return null;
  const fe = fitLine(
    t,
    points.map((p) => p.c.e),
    points.map((p) => p.c.se),
    empirical,
  );
  const fn = fitLine(
    t,
    points.map((p) => p.c.n),
    points.map((p) => p.c.sn),
    empirical,
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
    empirical,
    withParallax:
      opts.ra === undefined || opts.dec === undefined
        ? null
        : fitParallax(points, opts.ra, opts.dec, empirical),
  };
}

function fitParallax(
  points: { mjd: number; c: Centroid }[],
  ra: number,
  dec: number,
  empirical: boolean,
) {
  if (points.length < MIN_PLX_POINTS) return null;
  const span = Math.max(...points.map((p) => p.mjd)) - Math.min(...points.map((p) => p.mjd));
  if (span / 365.25 < MIN_PLX_YEARS) return null;
  const tm = points.reduce((s, p) => s + p.mjd, 0) / points.length;
  const rows: number[][] = [];
  const y: number[] = [];
  const s: number[] = [];
  for (const p of points) {
    const t = (p.mjd - tm) / 365.25;
    const f = parallaxFactors(ra, dec, p.mjd);
    rows.push([1, 0, t, 0, f.e], [0, 1, 0, t, f.n]);
    y.push(p.c.e, p.c.n);
    s.push(p.c.se, p.c.sn);
  }
  const r = lsq(rows, y, s);
  if (!r || r.dof < 1) return null;
  const chi2r = r.chi2 / r.dof;
  const scale = empirical || chi2r > 1 ? Math.sqrt(chi2r) : 1;
  const err = (k: number) => scale * Math.sqrt((r.cov[k] as number[])[k] as number);
  return {
    pmE: r.p[2] as number,
    pmN: r.p[3] as number,
    sE: err(2),
    sN: err(3),
    plx: r.p[4] as number,
    sPlx: err(4),
    chi2r,
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

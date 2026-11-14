// Celestial-sphere geometry for the globe and the spacecraft schematic: unit vectors, the
// ecliptic and galactic planes, and an orthographic view as seen from inside the sphere
// (east to the left of north, as on the sky). Display only; science coordinates stay in the
// pipeline's Astropy WCS.

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
/** IAU 2006 obliquity of the ecliptic at J2000, degrees. */
export const OBLIQUITY = 23.4392811;

export const radec = (ra: number, dec: number): Vec3 => [
  Math.cos(dec * DEG) * Math.cos(ra * DEG),
  Math.cos(dec * DEG) * Math.sin(ra * DEG),
  Math.sin(dec * DEG),
];

export function toRadec([x, y, z]: Vec3): { ra: number; dec: number } {
  const ra = Math.atan2(y, x) / DEG;
  return { ra: (ra + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point on the ecliptic at ecliptic longitude `lon` (degrees), in ICRS. */
export function ecliptic(lon: number): Vec3 {
  const e = OBLIQUITY * DEG;
  const l = lon * DEG;
  return [Math.cos(l), Math.sin(l) * Math.cos(e), Math.sin(l) * Math.sin(e)];
}

// Galactic → ICRS rotation (transpose of the Hipparcos ICRS → galactic matrix).
const GAL: [Vec3, Vec3, Vec3] = [
  [-0.0548755604, 0.4941094279, -0.867666149],
  [-0.8734370902, -0.44482963, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
];

/** A point at galactic longitude `l` and latitude `b` (degrees), in ICRS. */
export function galactic(l: number, b = 0): Vec3 {
  const g = radec(l, b);
  return [dot(GAL[0], g), dot(GAL[1], g), dot(GAL[2], g)];
}

export interface View {
  ra: number; // view centre, degrees
  dec: number;
}

/** Orthonormal basis at the view centre: forward, east, north. */
function basis(v: View): [Vec3, Vec3, Vec3] {
  const a = v.ra * DEG;
  const d = v.dec * DEG;
  const f: Vec3 = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const e: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const n: Vec3 = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  return [f, e, n];
}

/** Orthographic projection: x right, y up, z > 0 on the visible hemisphere. */
export function project(p: Vec3, v: View): Vec3 {
  const [f, e, n] = basis(v);
  return [-dot(p, e), dot(p, n), dot(p, f)];
}

/** Inverse of `project` for a point on the visible disk (x² + y² ≤ 1). */
export function unproject(x: number, y: number, v: View): { ra: number; dec: number } | null {
  const r2 = x * x + y * y;
  if (r2 > 1) return null;
  const z = Math.sqrt(1 - r2);
  const [f, e, n] = basis(v);
  const p = lin(e, -x, n, y, f, z);
  return toRadec(p);
}

/** Tangent-plane offset (degrees east, degrees north) around a centre, back to the sphere. */
export function offset(ra: number, dec: number, east: number, north: number): Vec3 {
  const [f, e, n] = basis({ ra, dec });
  const p = lin(f, 1, e, east * DEG, n, north * DEG);
  const len = Math.hypot(...p);
  return [p[0] / len, p[1] / len, p[2] / len];
}

/** Angle between two sky positions, degrees. */
export const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;

/** A few of the brightest stars (J2000, degrees), for orientation only. */
export const BRIGHT_STARS: [string, number, number][] = [
  ['Sirius', 101.287, -16.716],
  ['Canopus', 95.988, -52.696],
  ['Arcturus', 213.915, 19.182],
  ['Vega', 279.235, 38.784],
  ['Capella', 79.172, 45.998],
  ['Rigel', 78.634, -8.202],
  ['Procyon', 114.825, 5.225],
  ['Betelgeuse', 88.793, 7.407],
  ['Achernar', 24.429, -57.237],
  ['Altair', 297.696, 8.868],
  ['Aldebaran', 68.98, 16.509],
  ['Antares', 247.352, -26.432],
  ['Spica', 201.298, -11.161],
  ['Pollux', 116.329, 28.026],
  ['Fomalhaut', 344.413, -29.622],
  ['Deneb', 310.358, 45.28],
  ['Regulus', 152.093, 11.967],
  ['Polaris', 37.955, 89.264],
];

/** a·u + b·v + c·w */
const lin = (u: Vec3, a: number, v: Vec3, b: number, w: Vec3, c: number): Vec3 => [
  a * u[0] + b * v[0] + c * w[0],
  a * u[1] + b * v[1] + c * w[1],
  a * u[2] + b * v[2] + c * w[2],
];

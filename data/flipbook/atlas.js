// Sky-atlas backdrop for the flipbook: IRSA's SPHEREx DR1 all-sky HiPS cube display tiles (8-bit PNG,
// IRSA's asinh stretch, CORS open), painted around the target through the atlas's colour maps.
// Visualization only. The cube is a coadd of all DR1 exposures, so it has no time axis.
// This page is plain HTML outside the Vite build, so it can't import the atlas TypeScript. The HEALPix and
// colour-map code below mirrors web/src/lib/healpix.ts and web/src/features/atlas/render.ts; keep them in sync.

const HIPS = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
const ORDER = 5, BITS = 9, W = 2 ** BITS, NSIDE = 2 ** (ORDER + BITS), MAX_TILES = 16, DEG = Math.PI / 180;

const STOPS = {
  inferno: ['000004', '1f0c48', '550f6d', '88226a', 'ba3655', 'e35933', 'f98e09', 'f9cb35', 'fcffa4'],
  viridis: ['440154', '472d7b', '3b528b', '2c728e', '21918c', '28ae80', '5ec962', 'addc30', 'fde725'],
  grey: ['000000', 'ffffff'],
};
/** 256-entry RGB lookup table. */
export function lut(name) {
  const stops = STOPS[name], out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (stops.length - 1), a = Math.floor(x), b = Math.min(stops.length - 1, a + 1);
    for (let k = 0; k < 3; k++) {
      const ca = parseInt(stops[a].slice(k * 2, k * 2 + 2), 16), cb = parseInt(stops[b].slice(k * 2, k * 2 + 2), 16);
      out[i * 3 + k] = Math.round(ca + (cb - ca) * (x - a));
    }
  }
  return out;
}
/** Missing data: the atlas's two-tone hatch, so it can't be mistaken for a measured zero (black). */
export const hatch = (i, w) => ((((i % w) + Math.floor(i / w)) >> 2) & 1 ? [34, 28, 38] : [58, 46, 62]);
/** Packed levels (0 = no data, else display level + 1) into RGBA through a lookup table; no data is hatched. */
export function colour(levels, map, rgba, w) {
  for (let i = 0; i < levels.length; i++) {
    const b = levels[i], h = b ? null : hatch(i, w);
    rgba[i * 4] = b ? map[(b - 1) * 3] : h[0];
    rgba[i * 4 + 1] = b ? map[(b - 1) * 3 + 1] : h[1];
    rgba[i * 4 + 2] = b ? map[(b - 1) * 3 + 2] : h[2];
    rgba[i * 4 + 3] = 255;
  }
}

// HEALPix NESTED ang2pix split into face and (ix, iy) (Górski et al. 2005).
function xyf(z, tt, sth, out) {
  const za = Math.abs(z);
  if (za <= 2 / 3) {
    const t1 = NSIDE * (0.5 + tt), t2 = NSIDE * z * 0.75, jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / NSIDE), ifm = Math.floor(jm / NSIDE);
    out[0] = ifp === ifm ? (ifp % 4) + 4 : ifp < ifm ? ifp % 4 : (ifm % 4) + 8;
    out[1] = jm % NSIDE; out[2] = NSIDE - (jp % NSIDE) - 1;
    return;
  }
  const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt;
  const tmp = za > 0.99 ? (NSIDE * sth) / Math.sqrt((1 + za) / 3) : NSIDE * Math.sqrt(3 * (1 - za));
  const jp = Math.min(NSIDE - 1, Math.floor(tp * tmp)), jm = Math.min(NSIDE - 1, Math.floor((1 - tp) * tmp));
  if (z >= 0) { out[0] = ntt; out[1] = NSIDE - jm - 1; out[2] = NSIDE - jp - 1; }
  else { out[0] = ntt + 8; out[1] = jp; out[2] = jm; }
}
function interleave(x, y, bits) {
  let n = 0;
  for (let b = 0; b < bits; b++) n += (((x >> b) & 1) << (2 * b)) + (((y >> b) & 1) << (2 * b + 1));
  return n;
}

let props = null;
/** Cube layer wavelengths in µm (index = frame = 17·(band−1) + channel−1), from the HiPS properties file. */
export async function wavelengths() {
  props ||= fetch(`${HIPS}/properties`).then(r => {
    if (!r.ok) throw new Error(`HiPS properties HTTP ${r.status}`);
    return r.text();
  }).then(t => (/^data_cube_crval3_arr\s*=\s*(.*)$/m.exec(t)?.[1] ?? '').trim().split(/\s+/).map(Number));
  return props;
}

const tiles = new Map();  // `${npix}/${frame}` -> Promise<Uint8Array | null>, level + 1 per pixel (0 = no data)
function tile(npix, frame) {
  const key = `${npix}/${frame}`;
  if (!tiles.has(key)) {
    if (tiles.size >= 48) tiles.delete(tiles.keys().next().value);  // bound memory: 256 KiB per tile
    tiles.set(key, (async () => {
      const r = await fetch(`${HIPS}/Norder${ORDER}/Dir${Math.floor(npix / 10000) * 10000}/Npix${npix}${frame ? '_' + frame : ''}.png`);
      if (r.status === 404) return null;  // outside coverage
      if (!r.ok) throw new Error(`HiPS tile HTTP ${r.status}`);
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const c = new OffscreenCanvas(W, W), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0); bmp.close();
      const px = g.getImageData(0, 0, W, W).data, out = new Uint8Array(W * W);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] < 128 ? 0 : Math.min(254, px[i * 4]) + 1;  // as hips.ts packDisplay: 255 + 1 would wrap to 0
      return out;
    })().catch(e => { tiles.delete(key); throw e; }));
  }
  return tiles.get(key);
}

/**
 * The atlas layer `frame` as size×size packed display levels (see colour) centred on (ra, dec), north up and east
 * left, azimuthal-equidistant: the middle of each canvas edge is `radiusDeg` from the centre.
 */
export async function backdrop(size, ra, dec, radiusDeg, frame) {
  const n = size * size, slot = new Int32Array(n), off = new Int32Array(n), ids = [], o = new Int32Array(3);
  const sd0 = Math.sin(dec * DEG), cd0 = Math.cos(dec * DEG), scale = (2 * radiusDeg * DEG) / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const e = (size / 2 - x - 0.5) * scale, nn = (size / 2 - y - 0.5) * scale;  // east, north offsets (rad)
    const rho = Math.hypot(e, nn), pa = Math.atan2(e, nn), sr = Math.sin(rho), cr = Math.cos(rho);
    const z = sd0 * cr + cd0 * sr * Math.cos(pa);
    const a = ra * DEG + Math.atan2(Math.sin(pa) * sr, cd0 * cr - sd0 * sr * Math.cos(pa));
    xyf(z, ((((a / DEG) / 90) % 4) + 4) % 4, Math.sqrt(Math.max(0, 1 - z * z)), o);
    const npix = o[0] * 4 ** ORDER + interleave(o[1] >> BITS, o[2] >> BITS, ORDER);
    let k = ids.indexOf(npix);
    if (k < 0) { if (ids.length >= MAX_TILES) throw new Error('field too wide'); k = ids.push(npix) - 1; }
    slot[x + y * size] = k;
    off[x + y * size] = (o[1] % W) * W + (o[2] % W);  // PNG tile row = ix, column = iy (see healpix.ts tileOffset)
  }
  const data = await Promise.all(ids.map(id => tile(id, frame)));
  const levels = new Uint8Array(n);
  for (let i = 0; i < n; i++) levels[i] = data[slot[i]]?.[off[i]] ?? 0;
  return levels;
}

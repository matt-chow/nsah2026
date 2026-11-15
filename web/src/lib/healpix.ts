// HEALPix NESTED indexing for HiPS tiles (Górski et al. 2005; HiPS 1.0, IVOA 2017). Display
// geometry only: it says which tile pixel covers a sky direction, never what the pixel means.

const DEG = Math.PI / 180;

/**
 * The standard ang2pix split into face and (ix, iy) at `nside`, written into `out`, from
 * z = sin(dec), tt = RA / 90° in [0, 4) and sth = cos(dec). Allocation-free for per-pixel use.
 */
export function xyf(nside: number, z: number, tt: number, sth: number, out: Int32Array) {
  const za = Math.abs(z);
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    out[0] = ifp === ifm ? (ifp % 4) + 4 : ifp < ifm ? ifp % 4 : (ifm % 4) + 8;
    out[1] = jm % nside;
    out[2] = nside - (jp % nside) - 1;
    return;
  }
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  // near the poles cos(dec) keeps precision that sqrt(1 - |z|) loses
  const tmp = za > 0.99 ? (nside * sth) / Math.sqrt((1 + za) / 3) : nside * Math.sqrt(3 * (1 - za));
  const jp = Math.min(nside - 1, Math.floor(tp * tmp));
  const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
  if (z >= 0) {
    out[0] = ntt;
    out[1] = nside - jm - 1;
    out[2] = nside - jp - 1;
  } else {
    out[0] = ntt + 8;
    out[1] = jp;
    out[2] = jm;
  }
}

export function ang2xyf(nside: number, ra: number, dec: number) {
  const o = new Int32Array(3);
  xyf(nside, Math.sin(dec * DEG), ((((ra / 90) % 4) + 4) % 4) as number, Math.cos(dec * DEG), o);
  return { face: o[0] as number, ix: o[1] as number, iy: o[2] as number };
}

/** Interleave the low `bits` bits of x (even positions) and y (odd positions). */
export function interleave(x: number, y: number, bits: number) {
  let n = 0;
  for (let b = 0; b < bits; b++) n += (((x >> b) & 1) << (2 * b)) + (((y >> b) & 1) << (2 * b + 1));
  return n;
}

/** NESTED pixel index at `order` (≤ 13 keeps every intermediate inside 2^31). */
export function ang2pixNest(order: number, ra: number, dec: number): number {
  const { face, ix, iy } = ang2xyf(2 ** order, ra, dec);
  return face * 4 ** order + interleave(ix, iy, order);
}

/**
 * Row-major offset of tile-local (u = ix, v = iy) inside a HiPS tile image of side w. Verified
 * against Astropy's HPX WCS on a SPHEREx order-5 cube tile: column = iy, FITS row = w-1-ix
 * (rows stored bottom-up), and the PNG tile is the same image with rows top-down (row = ix).
 */
export const tileOffset = (u: number, v: number, w: number, png: boolean) =>
  (png ? u : w - 1 - u) * w + v;

/** The HiPS tile at `order` (2^tileBits pixels a side) covering (ra, dec), and the pixel offset. */
export function tilePixel(order: number, tileBits: number, ra: number, dec: number, png: boolean) {
  const { face, ix, iy } = ang2xyf(2 ** (order + tileBits), ra, dec);
  const w = 2 ** tileBits;
  const tile = face * 4 ** order + interleave(Math.floor(ix / w), Math.floor(iy / w), order);
  return { tile, offset: tileOffset(ix % w, iy % w, w, png) };
}

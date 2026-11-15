// Pure helpers for the flipbook's exposure playback: the shared display stretch and the frame scheduling.
// Visualization only. Tested by api/_flipbook.test.mjs.

const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** Per-pixel median of equal-length Float32Arrays (NaN = no data stays NaN). */
export function medianImage(images) {
  const out = new Float32Array(images[0].length), v = new Float32Array(images.length);
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (const im of images) if (!Number.isNaN(im[i])) v[m++] = im[i];
    out[i] = m ? v.subarray(0, m).sort()[m >> 1] : NaN;
  }
  return out;
}

/**
 * One display stretch shared by every exposure in a band: value → packed level (0 = no data, else level + 1).
 * The background (median) and bright end (99.7th percentile) of the median exposure map to the same percentiles of
 * the atlas display levels under the exposure footprint, so the inset sits in the backdrop without a brightness
 * seam. Without atlas levels it spans the full 0–255 range. The sqrt keeps faint structure visible.
 */
export function makeStretch(median, atlas) {
  const v = median.filter(x => !Number.isNaN(x)).sort();
  const lo = q(v, 0.5), span = q(v, 0.997) - lo || 1;
  const a = atlas ? atlas.filter(x => x).sort() : [];
  const a0 = a.length >= 32 ? q(a, 0.5) - 1 : 0;
  const a1 = a.length >= 32 ? Math.min(255, Math.max(q(a, 0.997) - 1, a0 + 64)) : 255;  // a flat patch keeps some contrast
  return x => {
    if (Number.isNaN(x)) return 0;
    const t = (x - lo) / span;
    return 1 + Math.min(254, Math.max(0, Math.round(a0 + (a1 - a0) * Math.sign(t) * Math.sqrt(Math.abs(t)))));
  };
}

export const pack = (pix, stretch) => Uint8Array.from(pix, stretch);

/** Next frame to request: a frame playback is waiting on first, then the first pending one from `from` onward. */
export function nextPending(frames, from, want) {
  if (frames[want]?.state === 'pending') return want;
  for (let i = 0; i < frames.length; i++) {
    const j = (from + i) % frames.length;
    if (frames[j].state === 'pending') return j;
  }
  return -1;
}

/**
 * The frame playback shows after k: failed frames are skipped (the status line lists them, with a retry), a frame
 * still loading is waited for (-1) rather than skipped, and the end wraps when looping, else stops (null).
 */
export function nextFrame(frames, k, loop) {
  const n = frames.length;
  for (let i = 1; i <= n; i++) {
    if (k + i >= n && !loop) return null;
    const j = (k + i) % n, s = frames[j].state;
    if (s === 'ok') return j;
    if (s !== 'failed') return -1;
  }
  return null;
}

/** First and last loaded frames, for the first ↔ last blink. */
export function ends(frames) {
  const ok = i => frames[i].state === 'ok';
  let a = 0, b = frames.length - 1;
  while (a < frames.length && !ok(a)) a++;
  while (b >= 0 && !ok(b)) b--;
  return a <= b ? [a, b] : null;
}

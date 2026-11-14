const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/**
 * Plot range covering zero and every point (with its 1σ bar) within k robust deviations of the
 * median; points further out are outliers. k = Infinity covers everything.
 */
export function robustRange(pts: { v: number; e: number }[], k: number) {
  const med = median(pts.map((p) => p.v));
  const spread = Math.max(
    1.4826 * median(pts.map((p) => Math.abs(p.v - med))),
    median(pts.map((p) => p.e)),
  );
  const inner = pts.filter((p) => Math.abs(p.v - med) <= k * spread);
  return {
    lo: Math.min(0, ...inner.map((p) => p.v - p.e)),
    hi: Math.max(0, ...inner.map((p) => p.v + p.e)),
  };
}

import type { Comparison, Manifest } from '../types/manifest.ts';

export type PairCheck =
  | { status: 'same' }
  | { status: 'compatible' }
  | { status: 'incompatible' | 'unknown'; reasons: string[] };

/**
 * The pipeline's verdict on comparing two observations (assess_compatibility, either order).
 * The browser never decides compatibility itself; a missing verdict counts as unknown.
 */
export function checkPair(manifest: Manifest, a: string, b: string): PairCheck {
  if (a === b) return { status: 'same' };
  const c: Comparison | undefined = manifest.comparisons.find(
    (x) =>
      (x.reference_id === a && x.target_id === b) || (x.reference_id === b && x.target_id === a),
  );
  if (!c) return { status: 'unknown', reasons: ['the pipeline recorded no check for this pair'] };
  if (c.status === 'compatible') return { status: 'compatible' };
  return {
    status: c.status,
    reasons: c.reasons.length ? c.reasons : ['the pipeline could not verify this pair'],
  };
}

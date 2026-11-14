// Discovery Arcade logic, kept free of React so it can be tested. Every case is built from the
// published manifests; nothing here invents a detection. Feedback compares the player with the
// pipeline's heuristic triage, which is itself unconfirmed, so it never says "correct".

import type {
  Candidate,
  Comparison,
  Difference,
  Manifest,
  Observation,
} from '../../types/manifest.ts';

export type MissionId = 'appeared' | 'glitch' | 'fair';

export interface FindCase {
  id: string;
  field: Manifest;
  candidate: Candidate;
  observation: Observation;
  diff: Difference;
}

/** Changes worth a second look whose date has a validated change map: real, checkable cases. */
export function findCases(fields: Manifest[]): FindCase[] {
  return fields
    .filter((m) => m.data_kind === 'real' && m.template)
    .flatMap((m) =>
      m.candidates.flatMap((c): FindCase[] => {
        const obsId = c.observation_ids[0];
        const diff = m.differences.find(
          (d) => d.observation_id === obsId && d.status === 'validated',
        );
        const observation = m.observations.find((o) => o.observation_id === obsId);
        return c.status === 'needs_followup' && diff && observation
          ? [{ id: c.candidate_id, field: m, candidate: c, observation, diff }]
          : [];
      }),
    );
}

export type Judgement =
  | { result: 'hit' }
  | { result: 'other'; candidate: Candidate }
  | { result: 'miss'; distance: number };

/** A click in FITS pixels: on the target, on a different marked change, or on neither. */
export function judgeClick(c: FindCase, x: number, y: number, tolerance = 5): Judgement {
  const d = (k: Candidate) => Math.hypot(k.pixel_x - x, k.pixel_y - y);
  const distance = d(c.candidate);
  if (distance <= tolerance) return { result: 'hit' };
  const other = c.field.candidates.find(
    (k) =>
      k !== c.candidate &&
      k.observation_ids.includes(c.observation.observation_id) &&
      d(k) <= tolerance,
  );
  return other ? { result: 'other', candidate: other } : { result: 'miss', distance };
}

/** "Glitch or genuine?" deck: alternate the pipeline's two piles so neither answer is a safe bet. */
export function glitchDeck(fields: Manifest[], size = 6): Candidate[] {
  const all = fields.filter((m) => m.data_kind === 'real').flatMap((m) => m.candidates);
  const artifacts = all.filter((c) => c.status === 'likely_artifact');
  const worth = all.filter((c) => c.status === 'needs_followup');
  const out: Candidate[] = [];
  for (let i = 0; out.length < size && (i < artifacts.length || i < worth.length); i++) {
    // a fixed stride spreads the picks across both fields, deterministically
    const a = artifacts[(i * 7) % Math.max(1, artifacts.length)];
    const w = worth[(i * 5) % Math.max(1, worth.length)];
    for (const c of i % 2 ? [w, a] : [a, w]) if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, size);
}

export type Guess = 'artifact' | 'worth';

export const agrees = (guess: Guess, c: Candidate) =>
  guess === 'artifact' ? c.status === 'likely_artifact' : c.status === 'needs_followup';

export interface FairCase {
  comparison: Comparison;
  a: Observation;
  b: Observation;
}

/** Pairs the pipeline has already judged, with both observations, for "Fair comparison?". */
export function fairCases(m: Manifest): FairCase[] {
  const by = new Map(m.observations.map((o) => [o.observation_id, o]));
  return m.comparisons.flatMap((comparison) => {
    const a = by.get(comparison.reference_id);
    const b = by.get(comparison.target_id);
    return a && b && comparison.status !== 'unknown' ? [{ comparison, a, b }] : [];
  });
}

// Progress: how many times each investigation was finished and which cases were seen. No score.
export const ARCADE_KEY = 'parallax.arcade.v1';

export interface Progress {
  finished: Partial<Record<MissionId, number>>;
  seen: string[];
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readProgress(store: Store | null): Progress {
  try {
    const v = JSON.parse(store?.getItem(ARCADE_KEY) ?? 'null') as Progress | null;
    return v && Array.isArray(v.seen) && typeof v.finished === 'object'
      ? v
      : { finished: {}, seen: [] };
  } catch {
    return { finished: {}, seen: [] };
  }
}

export function finish(p: Progress, mission: MissionId, caseIds: string[]): Progress {
  return {
    finished: { ...p.finished, [mission]: (p.finished[mission] ?? 0) + 1 },
    seen: [...new Set([...p.seen, ...caseIds])],
  };
}

export function writeProgress(store: Store | null, p: Progress) {
  try {
    store?.setItem(ARCADE_KEY, JSON.stringify(p));
  } catch {
    // progress is a convenience; the Arcade works without it
  }
}

/** The first case not yet seen, else start the cycle again. */
export const nextCase = <T extends { id: string }>(cases: T[], seen: string[], after?: string) => {
  const start = after ? cases.findIndex((c) => c.id === after) + 1 : 0;
  const order = [...cases.slice(start), ...cases.slice(0, start)];
  return order.find((c) => !seen.includes(c.id)) ?? order[0] ?? null;
};

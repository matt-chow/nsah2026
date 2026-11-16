// Prototype-only persistence, kept apart from the production journal (parallax.journal.v1).
// Browser storage can be absent or throw (private windows); every access degrades to "nothing".

import type { Manifest } from '../types/manifest.ts';
import type { View } from './projection.ts';

export type CompareMode = 'one' | 'blink' | 'split' | 'fade' | 'change';

/** A comparison inside a curated field: pipeline-checked pairs, validated measurements. */
export interface CuratedCompare {
  kind: 'curated';
  placeId: string;
  manifestId: string;
  a: string; // observation_id
  b: string; // observation_id, or 'typical' for the median template
  candidate: string | null;
  mode: CompareMode;
  zoom: number;
  /** Pan as a fraction of the fitted image width, so it survives a different screen size. */
  pan: { x: number; y: number };
  /** Filled in when saved: what produced the numbers at that moment. */
  versions?: Versions;
  /** Filled in when saved: display colours and the pin tray, so the investigation reopens whole. */
  palette?: string;
  pins?: Pin[];
}

/** A pinned flagged spot or archive region, for a side-by-side comparison of two. */
export type Pin =
  | {
      kind: 'candidate';
      id: string;
      label: string;
      placeId: string;
      manifestId: string;
      candidate: string;
    }
  | { kind: 'archive'; id: string; label: string; compare: ArchiveCompare };

export interface ArchiveFrame {
  url: string;
  mjd: number;
  um: [number, number]; // the detector band's range, not the wavelength at the target
}

/** Two live archive exposures: display imagery only, no pipeline check. */
export interface ArchiveCompare {
  kind: 'archive';
  ra: number;
  dec: number;
  band: string;
  a: ArchiveFrame;
  b: ArchiveFrame;
  mode: CompareMode;
  zoom: number;
  palette?: string;
  pins?: Pin[];
}

export type Compare = CuratedCompare | ArchiveCompare;

export interface Versions {
  schema: string;
  tool: string;
  calibration: string[];
}

export interface FlipTarget {
  ra: number;
  dec: number;
  label: string;
  band: string;
  size?: number; // field of view, arcmin; unset = the player's default
}

export interface Session {
  view: View;
  frame: number;
  palette: string;
  placeId: string | null;
  inspecting: boolean;
  epoch: number;
  compare?: Compare | null;
  flip?: FlipTarget | null;
  pins?: Pin[];
}

export interface Note {
  id: string;
  kind: 'view' | 'visit' | 'comparison';
  title: string;
  detail: string;
  savedAt: string;
  session: Session;
  /** Only on comparisons saved by this version; older notes reopen as plain views. */
  compare?: Compare;
}

const SESSION_KEY = 'parallax.prototype.session.v1';
const NOTES_KEY = 'parallax.prototype.notebook.v1';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readSession(): Session | null {
  const s = read<Session>(SESSION_KEY);
  return s && typeof s.view?.ra === 'number' && typeof s.frame === 'number' ? s : null;
}
export const writeSession = (s: Session) => write(SESSION_KEY, s);

export function readNotes(): Note[] {
  const n = read<Note[]>(NOTES_KEY);
  return Array.isArray(n) ? n.filter((e) => typeof e?.id === 'string' && e.session) : [];
}
export const writeNotes = (n: Note[]) => write(NOTES_KEY, n);

export const readFlag = (key: string) => read<boolean>(`parallax.prototype.${key}`) === true;
export const writeFlag = (key: string, v: boolean) => write(`parallax.prototype.${key}`, v);

export const versionsOf = (m: Manifest, ids: string[]): Versions => ({
  schema: m.schema_version,
  tool: `${m.generated_by.tool} ${m.generated_by.version}`,
  calibration: [
    ...new Set(
      m.observations
        .filter((o) => ids.includes(o.observation_id))
        .map((o) => o.provenance.calibration_version ?? 'unknown'),
    ),
  ].sort(),
});

/**
 * What changed since a curated comparison was saved. Missing visits block reopening it as saved;
 * a newer processing version only warns, because the numbers may differ.
 */
export function checkSaved(
  c: CuratedCompare,
  m: Manifest,
): { missing: string[]; changed: string[] } {
  const ids = new Set(m.observations.map((o) => o.observation_id));
  const missing = [c.a, c.b]
    .filter((id) => id !== 'typical' && !ids.has(id))
    .map((id) => `visit ${id} is no longer in this collection`);
  if (c.b === 'typical' && !m.template) missing.push('the typical (median) image is gone');
  const changed: string[] = [];
  if (c.candidate && !m.candidates.some((x) => x.candidate_id === c.candidate))
    changed.push(`the flagged spot ${c.candidate} is no longer listed`);
  for (const p of c.pins ?? [])
    if (
      p.kind === 'candidate' &&
      p.manifestId === m.manifest_id &&
      !m.candidates.some((x) => x.candidate_id === p.candidate)
    )
      changed.push(`the pinned spot ${p.candidate} is no longer listed`);
  const now = versionsOf(m, [c.a, c.b]);
  const was = c.versions;
  if (was) {
    if (was.tool !== now.tool) changed.push(`processed by ${was.tool} when saved, now ${now.tool}`);
    if (was.calibration.join() !== now.calibration.join())
      changed.push(
        `calibration ${was.calibration.join(', ')} when saved, now ${now.calibration.join(', ')}`,
      );
  }
  return { missing, changed };
}

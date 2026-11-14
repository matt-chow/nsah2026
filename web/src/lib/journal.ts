// The personal field notebook. Entries live in this browser only (localStorage); nothing is
// sent anywhere. Each entry keeps two things apart: the pipeline's record (measurements and
// heuristic triage, copied from the manifest) and the reader's own hypothesis and notes.

import { isoDate } from './time.ts';
import type { Candidate, Manifest, Observation } from '../types/manifest.ts';

export interface JournalEntry {
  id: string;
  kind: 'observation' | 'change' | 'mission';
  saved_utc: string;
  title: string;
  field_id: string;
  field_title: string;
  data_kind: 'real' | 'simulated';
  /** Hash that reopens this view in the observatory. */
  link: string;
  ra_deg: number;
  dec_deg: number;
  wavelength_um: number | null;
  dates: { observation_id: string; mjd_mid: number }[];
  sources: string[];
  release: string | null;
  /** Copied from the manifest: measurements and triage, never edited by the reader. */
  pipeline: { status: string; kind: string; measurements: string[]; evidence: string[] } | null;
  reproduce: string;
  hypothesis: string;
  notes: string;
  outcome: string | null;
  /** Display PNG path relative to the site root, for a thumbnail; absent on older saves. */
  preview?: string;
}

export const JOURNAL_KEY = 'parallax.journal.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readEntries(store: Store | null): JournalEntry[] {
  try {
    const raw = store?.getItem(JOURNAL_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as JournalEntry[]).filter((e) => typeof e?.id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeEntries(store: Store | null, entries: JournalEntry[]): boolean {
  try {
    store?.setItem(JOURNAL_KEY, JSON.stringify(entries));
    return store != null;
  } catch {
    return false; // quota or private mode: the page keeps working, unsaved
  }
}

/** Insert or replace by id, keeping the reader's notes when the pipeline record is refreshed. */
export function upsert(entries: JournalEntry[], e: JournalEntry): JournalEntry[] {
  const old = entries.find((x) => x.id === e.id);
  const merged = old
    ? { ...e, hypothesis: old.hypothesis || e.hypothesis, notes: old.notes || e.notes }
    : e;
  return [merged, ...entries.filter((x) => x.id !== e.id)];
}

const base = (m: Manifest) => ({
  field_id: m.manifest_id,
  field_title: m.title,
  data_kind: m.data_kind,
  release: m.dataset.data_release,
  reproduce: m.generated_by.command,
  saved_utc: new Date().toISOString(),
  hypothesis: '',
  notes: '',
  outcome: null,
});

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));

export function observationEntry(m: Manifest, o: Observation): JournalEntry {
  return {
    ...base(m),
    id: `obs:${o.observation_id}`,
    kind: 'observation',
    title: `${m.target.label}, ${isoDate(o.epoch.mjd_mid)}`,
    link: `#${m.manifest_id}`,
    ra_deg: m.target.ra_deg,
    dec_deg: m.target.dec_deg,
    wavelength_um: o.spectral.wavelength_center_um,
    dates: [{ observation_id: o.observation_id, mjd_mid: o.epoch.mjd_mid }],
    sources: o.provenance.source_url ? [o.provenance.source_url] : [],
    preview: o.assets.display_png,
    pipeline: null,
  };
}

export function changeEntry(m: Manifest, c: Candidate): JournalEntry {
  const obs = m.observations.filter((o) => c.observation_ids.includes(o.observation_id));
  return {
    ...base(m),
    id: `cand:${c.candidate_id}`,
    kind: 'change',
    title: `Change ${c.candidate_id.split('-').at(-1)} in ${m.target.label}`,
    link: `#${m.manifest_id}/${c.candidate_id.split('-').at(-1)}`,
    ra_deg: c.ra_deg,
    dec_deg: c.dec_deg,
    wavelength_um: obs[0]?.spectral.wavelength_center_um ?? null,
    dates: obs.map((o) => ({ observation_id: o.observation_id, mjd_mid: o.epoch.mjd_mid })),
    sources: obs.flatMap((o) => (o.provenance.source_url ? [o.provenance.source_url] : [])),
    ...(obs[0] ? { preview: obs[0].assets.display_png } : {}),
    pipeline: {
      status: c.status,
      kind: c.kind,
      measurements: c.measurements.map(
        (x) =>
          `${x.name}: ${fmt(x.value)}${x.uncertainty != null ? ` ± ${fmt(x.uncertainty)}` : ''} ${x.unit}`,
      ),
      evidence: c.evidence,
    },
  };
}

/** A self-contained, reproducible summary: coordinates, dates, sources, record, hypothesis. */
export function toMarkdown(entries: JournalEntry[], origin: string): string {
  const out = [
    '# PARALLAX field notebook',
    '',
    'Exported from PARALLAX. "Pipeline record" is copied from the published manifest',
    '(heuristic triage, unconfirmed). "My hypothesis" is the reader\'s own and is not verified.',
  ];
  for (const e of entries) {
    out.push(
      '',
      `## ${e.title}`,
      '',
      ...(e.data_kind === 'simulated' ? ['**SIMULATED DATA: not a NASA observation.**', ''] : []),
      `- Reopen: ${origin}${e.link}`,
      `- Position (ICRS): RA ${e.ra_deg.toFixed(5)}°, Dec ${e.dec_deg.toFixed(5)}°`,
      ...(e.wavelength_um != null ? [`- Wavelength: ${e.wavelength_um.toFixed(3)} µm`] : []),
      ...e.dates.map(
        (d) => `- Date: ${isoDate(d.mjd_mid)} (MJD ${d.mjd_mid.toFixed(5)}), ${d.observation_id}`,
      ),
      ...e.sources.map((s) => `- Archive source: ${s}`),
      ...(e.release ? [`- Release: ${e.release}`] : []),
      `- Reproduce: \`${e.reproduce}\``,
      `- Saved: ${e.saved_utc}`,
    );
    if (e.pipeline)
      out.push(
        '',
        `**Pipeline record** (${e.pipeline.status}, ${e.pipeline.kind}; unconfirmed)`,
        '',
        ...e.pipeline.measurements.map((x) => `- ${x}`),
        ...e.pipeline.evidence.map((x) => `- ${x}`),
      );
    if (e.outcome) out.push('', `**My conclusion:** ${e.outcome}`);
    if (e.hypothesis) out.push('', `**My hypothesis (not verified):** ${e.hypothesis}`);
    if (e.notes) out.push('', `**Notes:** ${e.notes}`);
  }
  return out.join('\n') + '\n';
}

import type { FieldSummary, Manifest } from '../types/manifest.ts';

export const SUPPORTED_SCHEMA = '1.1.0';

export class ManifestError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Trust-boundary check for fetched manifests. Full validation happens in the Python pipeline
 * (`parallax validate`); this guards the fields the UI depends on, plus the integrity rules
 * whose violation would mislead a viewer (simulation labelling, asset paths).
 */
export function parseManifest(raw: unknown): Manifest {
  const fail = (msg: string): never => {
    throw new ManifestError(msg);
  };
  if (!isObj(raw)) return fail('manifest is not a JSON object');
  if (raw.schema_version !== SUPPORTED_SCHEMA)
    fail(`unsupported schema_version ${String(raw.schema_version)}; expected ${SUPPORTED_SCHEMA}`);
  if (raw.data_kind !== 'real' && raw.data_kind !== 'simulated') fail('invalid data_kind');
  if (raw.data_kind === 'simulated' && typeof raw.notice !== 'string')
    fail('simulated manifest is missing its notice');
  const t = raw.target;
  if (!isObj(t) || !isNum(t.ra_deg) || !isNum(t.dec_deg)) fail('invalid target');
  if (!Array.isArray(raw.observations) || raw.observations.length === 0)
    fail('manifest has no observations');
  for (const o of raw.observations as unknown[]) {
    if (!isObj(o) || typeof o.observation_id !== 'string') fail('invalid observation');
    const obs = o as Record<string, unknown>;
    if (obs.data_kind !== raw.data_kind) fail(`${obs.observation_id}: data_kind mismatch`);
    const a = obs.assets;
    if (!isObj(a) || typeof a.display_png !== 'string' || !isSafeRelativePath(a.display_png))
      fail(`${obs.observation_id}: invalid display asset path`);
    const e = obs.epoch;
    if (!isObj(e) || !isNum(e.mjd_mid)) fail(`${obs.observation_id}: invalid epoch`);
  }
  if (
    !Array.isArray(raw.comparisons) ||
    !Array.isArray(raw.candidates) ||
    !Array.isArray(raw.differences)
  )
    fail('comparisons, differences and candidates must be arrays');
  const ids = new Set(
    (raw.observations as { observation_id: string }[]).map((o) => o.observation_id),
  );
  const tmpl = raw.template;
  if (tmpl != null && (!isObj(tmpl) || !isSafePath(tmpl.display_png)))
    fail('invalid template display asset path');
  for (const d of raw.differences as unknown[]) {
    if (!isObj(d) || !ids.has(d.observation_id as string)) fail('difference for unknown epoch');
    const diff = d as Record<string, unknown>;
    if (!isSafePath(diff.display_png) || !isNum(diff.display_range_sigma))
      fail(`${String(diff.difference_id)}: invalid display asset`);
    if (diff.status !== 'validated' && diff.status !== 'visualization_only')
      fail(`${String(diff.difference_id)}: invalid status`);
  }
  for (const c of raw.candidates as unknown[]) {
    if (!isObj(c) || !isNum(c.pixel_x) || !isNum(c.pixel_y) || !Array.isArray(c.light_curve))
      fail('invalid candidate');
    const cand = c as Record<string, unknown>;
    if (!(cand.observation_ids as string[]).every((id) => ids.has(id)))
      fail(`${String(cand.candidate_id)}: refers to an unknown epoch`);
  }
  return raw as unknown as Manifest;
}

const isSafePath = (v: unknown) => typeof v === 'string' && isSafeRelativePath(v);

export function parseIndex(raw: unknown): FieldSummary[] {
  if (!isObj(raw) || !Array.isArray(raw.fields)) throw new ManifestError('invalid field index');
  for (const f of raw.fields as unknown[]) {
    if (!isObj(f) || !isSafePath(f.path) || !isNum(f.ra_deg) || !isNum(f.dec_deg))
      throw new ManifestError('invalid field index entry');
  }
  return raw.fields as FieldSummary[];
}

export function isSafeRelativePath(p: string): boolean {
  return !p.startsWith('/') && !p.includes(':') && !p.split(/[\\/]/).some((s) => s === '..');
}

async function getJson(url: string, what: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new ManifestError(`could not load ${what} (HTTP ${res.status})`);
  return res.json();
}

export const loadManifest = async (url: string, signal?: AbortSignal) =>
  parseManifest(await getJson(url, 'manifest', signal));

export const loadIndex = async (url: string, signal?: AbortSignal) =>
  parseIndex(await getJson(url, 'field index', signal));

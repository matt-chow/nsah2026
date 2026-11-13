import type { Manifest } from '../types/manifest.ts';

export const SUPPORTED_SCHEMA = '1.0.0';

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
  if (!Array.isArray(raw.comparisons) || !Array.isArray(raw.candidates))
    fail('comparisons and candidates must be arrays');
  return raw as unknown as Manifest;
}

export function isSafeRelativePath(p: string): boolean {
  return !p.startsWith('/') && !p.includes(':') && !p.split(/[\\/]/).some((s) => s === '..');
}

export async function loadManifest(url: string, signal?: AbortSignal): Promise<Manifest> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new ManifestError(`could not load manifest (${res.status})`);
  return parseManifest(await res.json());
}

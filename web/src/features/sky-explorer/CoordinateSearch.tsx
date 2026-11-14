import { memo, useId, useState, type FormEvent } from 'react';
import { parseDegrees, separationDeg } from '../../lib/coords.ts';
import type { FieldSummary } from '../../types/manifest.ts';

interface Props {
  fields: FieldSummary[];
  onFound: (field: FieldSummary, ra: number, dec: number) => void;
}

type Result = { kind: 'idle' } | { kind: 'busy' } | { kind: 'msg'; text: string; tone?: 'error' };

interface ArchiveCount {
  collection: string;
  exposures: number;
  truncated: boolean;
}

/** Bounded metadata-only lookup through the optional serverless proxy (IRSA has no CORS). */
async function archiveLookup(ra: number, dec: number): Promise<ArchiveCount[] | null> {
  try {
    const res = await fetch(`api/sia?ra=${ra}&dec=${dec}`, { signal: AbortSignal.timeout(25000) });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const body = (await res.json()) as { collections?: ArchiveCount[] };
    return Array.isArray(body.collections) ? body.collections : null;
  } catch {
    return null;
  }
}

export const CoordinateSearch = memo(function CoordinateSearch({ fields, onFound }: Props) {
  const id = useId();
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = parseDegrees(ra, 0, 360, false);
    const d = parseDegrees(dec, -90, 90, true);
    if (!r.ok || !d.ok)
      return setResult({
        kind: 'msg',
        tone: 'error',
        text: !r.ok ? `RA: ${r.error} (0 to 360)` : `Dec: ${(d as { error: string }).error}`,
      });
    const hit = fields.find(
      (f) => separationDeg(r.value, d.value, f.ra_deg, f.dec_deg) * 3600 <= f.radius_arcsec * 0.98,
    );
    if (hit) {
      setResult({ kind: 'msg', text: `Inside ${hit.title}. Marked with a crosshair.` });
      return onFound(hit, r.value, d.value);
    }
    if (!navigator.onLine)
      return setResult({
        kind: 'msg',
        text: 'No prepared field covers this position, and you are offline.',
      });
    setResult({ kind: 'busy' });
    const counts = await archiveLookup(r.value, d.value);
    if (!counts)
      return setResult({
        kind: 'msg',
        text: 'No prepared field covers this position. The live archive lookup is not available on this deployment.',
      });
    const n = counts.reduce((s, c) => s + c.exposures, 0);
    const more = counts.some((c) => c.truncated) ? '+' : '';
    setResult({
      kind: 'msg',
      text:
        n === 0
          ? 'IRSA lists no SPHEREx exposures at this position in DR1 or QR3.'
          : `IRSA lists ${n}${more} SPHEREx exposures here (${counts
              .filter((c) => c.exposures)
              .map((c) => `${c.collection} ${c.exposures}${c.truncated ? '+' : ''}`)
              .join(
                ', ',
              )}). No prepared field covers it yet, so there is nothing to compare: the offline pipeline builds one with "parallax build-field <name> --ra ${r.value} --dec ${d.value} --detector <1-6> --title <title>".`,
    });
  }

  return (
    <form className="search" onSubmit={onSubmit} noValidate aria-label="Find a sky position">
      <label htmlFor={`${id}-ra`} className="visually-hidden">
        Right ascension, degrees
      </label>
      <input
        id={`${id}-ra`}
        inputMode="decimal"
        placeholder="RA °"
        autoComplete="off"
        spellCheck={false}
        value={ra}
        onChange={(e) => setRa(e.target.value)}
      />
      <label htmlFor={`${id}-dec`} className="visually-hidden">
        Declination, degrees
      </label>
      <input
        id={`${id}-dec`}
        inputMode="decimal"
        placeholder="Dec °"
        autoComplete="off"
        spellCheck={false}
        value={dec}
        onChange={(e) => setDec(e.target.value)}
      />
      <button type="submit" disabled={result.kind === 'busy'}>
        {result.kind === 'busy' ? 'Searching…' : 'Find'}
      </button>
      <p
        className={`search-result${result.kind === 'msg' && result.tone ? ' error' : ''}`}
        aria-live="polite"
      >
        {result.kind === 'msg' ? result.text : result.kind === 'busy' ? 'Asking IRSA…' : ''}
      </p>
    </form>
  );
});

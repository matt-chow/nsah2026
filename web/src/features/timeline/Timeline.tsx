import { memo, useState, type CSSProperties } from 'react';
import type { PairCheck } from '../../lib/compare.ts';
import { interval, isoDate, longDate } from '../../lib/time.ts';
import type { Difference, Observation } from '../../types/manifest.ts';

interface Props {
  observations: Observation[]; // sorted by epoch
  differences: Map<string, Difference>;
  selectedId: string;
  onSelect: (id: string) => void;
  highlight: Set<string>; // epochs where the selected candidate was detected
  referenceId: string | null;
  comparingDates: boolean;
  onReferenceSelect: (id: string) => void;
  getCompatibility: (id: string, role: 'A' | 'B') => PairCheck;
  quiet: boolean; // true while frames animate: no screen-reader announcement per frame
}

/**
 * A calibrated ruler places each visit at its true time; leader lines run down to evenly spaced,
 * touch-sized date buttons, so clustered visits stay readable and easy to hit.
 */
export const Timeline = memo(function Timeline(props: Props) {
  const {
    observations,
    differences,
    selectedId,
    onSelect,
    highlight,
    quiet,
    referenceId,
    onReferenceSelect,
    getCompatibility,
  } = props;
  const [chosenRole, setRole] = useState<'A' | 'B'>('A');
  const role = props.comparingDates ? chosenRole : 'A';
  const n = Math.max(1, observations.length);
  const t0 = observations[0]?.epoch.mjd_mid ?? 0;
  const t1 = observations.at(-1)?.epoch.mjd_mid ?? t0;
  const span = Math.max(1, t1 - t0);
  const at = observations.findIndex((o) => o.observation_id === selectedId);
  const sel = observations[at];
  const prev = observations[at - 1];
  // ruler runs from the first slot centre to the last, so the end leaders are vertical
  const truePct = (mjd: number) => ((0.5 + ((mjd - t0) / span) * (n - 1)) / n) * 100;
  const slotPct = (i: number) => ((i + 0.5) / n) * 100;
  const years = [];
  for (let y = new Date(isoDate(t0)).getUTCFullYear() + 1; ; y++) {
    const mjd = Date.UTC(y, 0, 1) / 86400000 + 40587;
    if (mjd > t1) break;
    years.push({ y, mjd });
  }
  const months = [];
  for (let d = new Date(isoDate(t0)); ; ) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const mjd = d.getTime() / 86400000 + 40587;
    if (mjd > t1) break;
    months.push(mjd);
  }

  return (
    <section className="timeline" aria-label="Observation dates" data-tour="timeline">
      <div className="timeline-head">
        <h2>Observation timeline</h2>
        <div className="segmented" role="group" aria-label="Timeline selection target">
          <button type="button" aria-pressed={role === 'A'} onClick={() => setRole('A')}>
            Set A
          </button>
          <button
            type="button"
            aria-pressed={role === 'B'}
            disabled={!props.comparingDates}
            title={
              props.comparingDates
                ? 'Choose the reference date'
                : 'Change maps use the pipeline’s combined reference'
            }
            onClick={() => setRole('B')}
          >
            Set B
          </button>
        </div>
      </div>
      <p className="small dim">
        Ruler: elapsed time · A: observation · B:{' '}
        {referenceId ? 'dated reference' : 'combined typical sky'} · ◆: selected lead · ×:
        comparison unavailable
      </p>
      <div className="timeline-scroll">
        <div className="timeline-inner" style={{ '--n': n } as CSSProperties}>
          <div className="timeline-ruler" aria-hidden="true">
            {months.map((mjd) => (
              <span key={mjd} className="ruler-month" style={{ left: `${truePct(mjd)}%` }} />
            ))}
            {years.map(({ y, mjd }) => (
              <span key={y} className="ruler-year mono" style={{ left: `${truePct(mjd)}%` }}>
                {y}
              </span>
            ))}
            {observations.map((o) => (
              <span
                key={o.observation_id}
                data-reference={o.observation_id === referenceId || undefined}
                className="ruler-visit"
                data-on={o.observation_id === selectedId || undefined}
                data-hit={highlight.has(o.observation_id) || undefined}
                style={{ left: `${truePct(o.epoch.mjd_mid)}%` }}
              />
            ))}
          </div>
          <svg
            className="timeline-leaders"
            viewBox="0 0 100 10"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {observations.map((o, i) => (
              <line
                key={o.observation_id}
                x1={truePct(o.epoch.mjd_mid)}
                y1={0}
                x2={slotPct(i)}
                y2={10}
                data-on={o.observation_id === selectedId || undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="timeline-dates" role="group" aria-label={`Choose date ${role}`}>
            {observations.map((o, i) => {
              const d = differences.get(o.observation_id);
              const date = longDate(o.epoch.mjd_mid);
              const check = props.comparingDates ? getCompatibility(o.observation_id, role) : null;
              const unavailable = check?.status === 'incompatible' || check?.status === 'unknown';
              const isA = o.observation_id === selectedId;
              const isB = o.observation_id === referenceId;
              return (
                <button
                  key={o.observation_id}
                  type="button"
                  className="epoch"
                  aria-pressed={role === 'A' ? isA : isB}
                  data-a={isA || undefined}
                  data-b={isB || undefined}
                  data-unavailable={unavailable || undefined}
                  data-hit={highlight.has(o.observation_id) || undefined}
                  onClick={() => (role === 'A' ? onSelect : onReferenceSelect)(o.observation_id)}
                  title={`${date} · ${check?.status ?? `change map: ${d?.status ?? 'not evaluated'}`}${check && 'reasons' in check ? `: ${check.reasons.join('; ')}` : ''} · ${o.observation_id}${d ? ` · difference ${d.status.replace('_', ' ')}` : ''}`}
                >
                  <span className="epoch-tags" aria-hidden="true">
                    {isA ? 'A ' : ''}
                    {isB ? 'B ' : ''}
                    {highlight.has(o.observation_id) ? '◆ ' : ''}
                    {unavailable ? '×' : ''}
                  </span>
                  <span className="visually-hidden">
                    Date {i + 1}, {isA ? 'observation A, ' : ''}
                    {isB ? 'reference B, ' : ''}
                    {unavailable ? `comparison ${check?.status}, ` : ''}
                  </span>
                  <span className="epoch-day mono">{date.replace(/ \d{4}$/, '')}</span>
                  <span className="epoch-meta mono">
                    {date.slice(-4)} · {o.provenance.data_release ?? 'SIM'}
                  </span>
                  {highlight.has(o.observation_id) && (
                    <span className="visually-hidden">, selected change detected</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {sel && (
        <div className="timeline-caption small">
          <p aria-live={quiet ? 'off' : 'polite'}>
            <span className="mono">A</span> {longDate(sel.epoch.mjd_mid)}
            <span className="dim">
              {' '}
              · date {at + 1} of {observations.length}
              {prev
                ? ` · ${interval(sel.epoch.mjd_mid - prev.epoch.mjd_mid)} after the previous`
                : ' · the first'}
            </span>
          </p>
          <details>
            <summary>Why are the dates unevenly spaced?</summary>
            <p className="dim">
              The ruler shows true time. SPHEREx passes over this field many times, but only the
              visits that caught it on the same detector at nearly the same wavelength can be
              compared fairly. Up to ten of those are kept, spread through time where the archive
              allows, so some months have several and some none.
            </p>
          </details>
        </div>
      )}
    </section>
  );
});

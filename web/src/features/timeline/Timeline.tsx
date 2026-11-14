import { memo, type CSSProperties } from 'react';
import { interval, isoDate, longDate } from '../../lib/time.ts';
import type { Difference, Observation } from '../../types/manifest.ts';

interface Props {
  observations: Observation[]; // sorted by epoch
  differences: Map<string, Difference>;
  selectedId: string;
  onSelect: (id: string) => void;
  highlight: Set<string>; // epochs where the selected candidate was detected
  quiet: boolean; // true while frames animate: no screen-reader announcement per frame
}

/**
 * A calibrated ruler places each visit at its true time; leader lines run down to evenly spaced,
 * touch-sized date buttons, so clustered visits stay readable and easy to hit.
 */
export const Timeline = memo(function Timeline(props: Props) {
  const { observations, differences, selectedId, onSelect, highlight, quiet } = props;
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
  for (let d = new Date(isoDate(t0)); ;) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const mjd = d.getTime() / 86400000 + 40587;
    if (mjd > t1) break;
    months.push(mjd);
  }

  return (
    <section className="timeline" aria-label="Observation dates" data-tour="timeline">
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
          <div className="timeline-dates" role="group" aria-label="Choose date A">
            {observations.map((o, i) => {
              const d = differences.get(o.observation_id);
              const date = longDate(o.epoch.mjd_mid);
              return (
                <button
                  key={o.observation_id}
                  type="button"
                  className="epoch"
                  aria-pressed={o.observation_id === selectedId}
                  data-hit={highlight.has(o.observation_id) || undefined}
                  onClick={() => onSelect(o.observation_id)}
                  title={`${date} · ${o.observation_id}${d ? ` · difference ${d.status.replace('_', ' ')}` : ''}`}
                >
                  <span className="visually-hidden">Date {i + 1}, </span>
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

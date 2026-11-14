import { memo } from 'react';
import { isoDate } from '../../lib/time.ts';
import type { Difference, Observation } from '../../types/manifest.ts';

interface Props {
  observations: Observation[]; // sorted by epoch
  differences: Map<string, Difference>;
  selectedId: string;
  onSelect: (id: string) => void;
  highlight: Set<string>; // epochs where the selected candidate was detected
}

/** Epochs placed on a true time axis, so gaps between SPHEREx visits read as gaps. */
export const Timeline = memo(function Timeline(props: Props) {
  const { observations, differences, selectedId, onSelect, highlight } = props;
  const t0 = observations[0]?.epoch.mjd_mid ?? 0;
  const t1 = observations.at(-1)?.epoch.mjd_mid ?? t0;
  const span = Math.max(1, t1 - t0);
  const pos = (mjd: number) => `${(((mjd - t0) / span) * 100).toFixed(2)}%`;
  const years = [];
  for (let y = new Date(isoDate(t0)).getUTCFullYear() + 1; ; y++) {
    const mjd = Date.UTC(y, 0, 1) / 86400000 + 40587;
    if (mjd > t1) break;
    years.push({ y, mjd });
  }

  return (
    <section className="timeline" aria-label="Epochs" data-tour="timeline">
      <div className="timeline-track">
        {years.map(({ y, mjd }) => (
          <span key={y} className="timeline-year mono" style={{ left: pos(mjd) }}>
            {y}
          </span>
        ))}
        {observations.map((o, i) => {
          const d = differences.get(o.observation_id);
          const on = o.observation_id === selectedId;
          return (
            <button
              key={o.observation_id}
              type="button"
              className="epoch"
              style={{ left: pos(o.epoch.mjd_mid) }}
              aria-pressed={on}
              data-hit={highlight.has(o.observation_id) || undefined}
              onClick={() => onSelect(o.observation_id)}
              title={`${o.observation_id}${d ? ` · difference ${d.status.replace('_', ' ')}` : ''}`}
            >
              <span className="epoch-stem" aria-hidden="true" />
              <span className="epoch-label mono">
                <span className="visually-hidden">Epoch {i + 1}, </span>
                {isoDate(o.epoch.mjd_mid).slice(5)}
                <span className="epoch-meta">{o.provenance.data_release ?? 'SIM'}</span>
              </span>
              {highlight.has(o.observation_id) && (
                <span className="visually-hidden">, selected candidate detected</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
});

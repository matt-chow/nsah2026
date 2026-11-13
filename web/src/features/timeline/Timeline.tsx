import { memo } from 'react';
import type { Observation } from '../../types/manifest.ts';

interface Props {
  observations: Observation[]; // sorted by epoch
  selectedId: string;
  onSelect: (id: string) => void;
}

export const Timeline = memo(function Timeline({ observations, selectedId, onSelect }: Props) {
  const t0 = observations[0]?.epoch.mjd_mid ?? 0;
  return (
    <section className="panel" aria-labelledby="timeline-h">
      <h2 id="timeline-h">Epochs</h2>
      <ol className="epochs">
        {observations.map((o) => (
          <li key={o.observation_id}>
            <button
              type="button"
              aria-pressed={o.observation_id === selectedId}
              onClick={() => onSelect(o.observation_id)}
            >
              <span className="mono">
                MJD {o.epoch.mjd_mid.toFixed(3)} {o.epoch.time_scale.toUpperCase()}
              </span>
              <span className="muted">
                +{((o.epoch.mjd_mid - t0) * 24).toFixed(1)} h · D{o.spectral.detector ?? '?'} ·{' '}
                {o.spectral.wavelength_center_um.toFixed(3)} µm
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
});

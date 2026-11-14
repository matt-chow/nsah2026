import { memo } from 'react';
import { ObservationDetails } from '../../components/ObservationDetails.tsx';
import type { PairCheck } from '../../lib/compare.ts';
import { isoDate } from '../../lib/time.ts';
import type { Difference, Manifest, Observation } from '../../types/manifest.ts';

interface Props {
  manifest: Manifest;
  observations: Observation[];
  differences: Map<string, Difference>;
  epoch: Observation;
  refName: string;
  pair: PairCheck;
  onSelectEpoch: (id: string) => void;
}

/** Per-epoch calibration and provenance for readers who want the numbers behind every view. */
export const AnalyzePanel = memo(function AnalyzePanel(props: Props) {
  const { manifest, observations, differences, epoch, refName, pair, onSelectEpoch } = props;
  return (
    <section className="analyze" aria-labelledby="analyze-h">
      <h2 id="analyze-h">Comparison checks</h2>
      <p className="small">
        A: <span className="mono">{isoDate(epoch.epoch.mjd_mid)}</span> · B: {refName} ·{' '}
        <strong className={`pair ${pair.status}`}>
          {pair.status === 'same' ? 'same image' : pair.status}
        </strong>
        {'reasons' in pair && <span className="dim"> ({pair.reasons.join('; ')})</span>}
      </p>
      <p className="small dim">
        Verdicts come from the pipeline&apos;s compatibility check (detector, wavelength, units,
        calibration, pixel scale, common grid); the browser only displays them.
      </p>
      <div className="table-scroll">
        <table className="calib mono">
          <caption className="visually-hidden">Per-epoch calibration</caption>
          <thead>
            <tr>
              <th scope="col">Epoch (UTC)</th>
              <th scope="col">Rel.</th>
              <th scope="col">λ µm</th>
              <th scope="col">k</th>
              <th scope="col">floor</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {observations.map((o) => {
              const d = differences.get(o.observation_id);
              return (
                <tr key={o.observation_id} aria-current={o === epoch || undefined}>
                  <th scope="row">
                    <button
                      type="button"
                      className="link"
                      onClick={() => onSelectEpoch(o.observation_id)}
                    >
                      {isoDate(o.epoch.mjd_mid)}
                    </button>
                  </th>
                  <td>{o.provenance.data_release ?? 'SIM'}</td>
                  <td>{o.spectral.wavelength_center_um.toFixed(4)}</td>
                  <td>{d ? d.noise_scale.toFixed(2) : '—'}</td>
                  <td>{d ? d.error_floor_fraction.toFixed(2) : '—'}</td>
                  <td className={d?.status === 'validated' ? '' : 'dim'}>
                    {d ? d.status.replace('_', ' ') : 'not run'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small dim">
        k rescales the archive variance so faint-pixel noise has unit width; floor is the fractional
        error added for star-shaped mismatch. Numbers are withheld wherever the difference is not
        validated.
      </p>
      <details className="meta" open>
        <summary>Observation A: metadata and provenance</summary>
        <ObservationDetails obs={epoch} />
        {manifest.alignment && <p className="small dim">{manifest.alignment}</p>}
        {manifest.template && <p className="small dim mono">{manifest.template.method}</p>}
      </details>
    </section>
  );
});

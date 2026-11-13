import { memo, type ReactNode } from 'react';
import type { Observation } from '../types/manifest.ts';

const fmt = (v: number | null | undefined, digits: number, unit = '') =>
  v == null ? 'not available' : `${v.toFixed(digits)}${unit}`;

export const ObservationDetails = memo(function ObservationDetails({ obs }: { obs: Observation }) {
  const { epoch, spectral, image, quality, provenance, assets } = obs;
  const rows: [string, ReactNode][] = [
    ['Observation', <span className="mono">{obs.observation_id}</span>],
    ['Data', obs.data_kind === 'simulated' ? 'Simulated' : 'Real observation'],
    ['Mid-exposure', `MJD ${epoch.mjd_mid.toFixed(5)} (${epoch.time_scale.toUpperCase()})`],
    ['Exposure', fmt(epoch.exposure_s, 1, ' s')],
    ['Detector', spectral.detector ?? 'unknown'],
    [
      'Wavelength',
      `${spectral.wavelength_center_um.toFixed(3)} µm (${spectral.wavelength_min_um.toFixed(3)}–${spectral.wavelength_max_um.toFixed(3)}, ${spectral.basis})`,
    ],
    ['Image', `${image.width_px} × ${image.height_px} px at ${image.pixel_scale_arcsec}″/px`],
    ['Units', image.units],
    [
      'Flags / variance',
      `${quality.flags_available ? 'yes' : 'no'} / ${quality.variance_available ? 'yes' : 'no'}`,
    ],
    ['Masked fraction', fmt(quality.masked_fraction, 3)],
    ['Calibration', provenance.calibration_version ?? 'unknown'],
    [
      'Source',
      provenance.source_url ? (
        <a href={provenance.source_url} rel="noreferrer" target="_blank">
          {provenance.source_id}
        </a>
      ) : (
        provenance.source_id
      ),
    ],
    ['Processing', <span className="mono">{provenance.processing}</span>],
    ['Display stretch', `${assets.display_stretch} (display only, not for measurement)`],
  ];
  return (
    <section className="panel" aria-labelledby="details-h">
      <h2 id="details-h">Metadata</h2>
      <dl className="details">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {quality.notes.length > 0 && (
        <ul className="reasons">
          {quality.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
});

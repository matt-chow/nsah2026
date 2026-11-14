import { memo, useState } from 'react';
import { formatDec, formatRa } from '../../lib/sky.ts';
import { isoDate } from '../../lib/time.ts';
import type { Candidate, CandidateKind, Manifest } from '../../types/manifest.ts';
import { LightCurve } from './LightCurve.tsx';

export const STATUS_LABEL: Record<Candidate['status'], string> = {
  unreviewed: 'Unreviewed',
  needs_followup: 'Needs follow-up',
  known_object: 'Known object',
  likely_artifact: 'Likely artifact',
  rejected: 'Rejected',
};

const KIND: Record<CandidateKind, { label: string; plain: string }> = {
  new_source_like: {
    label: 'New-source-like',
    plain: 'Brighter than the other epochs at a position with no steady source.',
  },
  variable_like: {
    label: 'Variable-like',
    plain: 'A steady source that was brighter or fainter in this epoch.',
  },
  dipole_like: {
    label: 'Dipole-like',
    plain: 'Paired positive and negative residuals, as left by motion or misalignment.',
  },
  artifact_like: {
    label: 'Artifact-like',
    plain: 'A sharp single-pixel spike, flagged pixels, or a flux change below 3σ.',
  },
};

export function Glyph({ kind }: { kind: CandidateKind }) {
  const d = {
    new_source_like: <circle cx="8" cy="8" r="5" />,
    variable_like: <rect x="3" y="3" width="10" height="10" />,
    dipole_like: <path d="M8 2l6 6-6 6-6-6z" />,
    artifact_like: <path d="M4 4l8 8M12 4l-8 8" />,
  }[kind];
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      {d}
    </svg>
  );
}

const peak = (c: Candidate) => c.measurements.find((m) => m.name === 'peak significance')?.value;

interface ListProps {
  manifest: Manifest;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const CandidateList = memo(function CandidateList(props: ListProps) {
  const { manifest, selectedId, onSelect } = props;
  const all = manifest.candidates;
  const followup = all.filter((c) => c.status === 'needs_followup');
  const [filter, setFilter] = useState<'followup' | 'all'>(followup.length ? 'followup' : 'all');
  const shown = filter === 'followup' ? followup : all;
  const date = new Map(manifest.observations.map((o) => [o.observation_id, o.epoch.mjd_mid]));

  if (all.length === 0)
    return (
      <section className="candidates" aria-labelledby="cand-h">
        <h2 id="cand-h">Residuals</h2>
        <p className="empty">
          {manifest.differences.length === 0
            ? 'Change detection has not been run on this field, so nothing here has been evaluated.'
            : 'No residual passed the detection threshold in any epoch.'}
        </p>
      </section>
    );

  return (
    <section className="candidates" aria-labelledby="cand-h" data-tour="candidates">
      <div className="candidates-head">
        <h2 id="cand-h">Residuals</h2>
        <div className="segmented" role="group" aria-label="Filter residuals">
          <button
            type="button"
            aria-pressed={filter === 'followup'}
            onClick={() => setFilter('followup')}
          >
            Needs follow-up <span className="mono">{followup.length}</span>
          </button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All <span className="mono">{all.length}</span>
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="empty">
          Nothing needs follow-up here: every residual is classed as a likely artifact.{' '}
          <button type="button" className="link" onClick={() => setFilter('all')}>
            Show all {all.length}
          </button>
        </p>
      ) : (
        <ol className="cand-list">
          {shown.map((c) => {
            const p = peak(c);
            return (
              <li key={c.candidate_id}>
                <button
                  type="button"
                  aria-pressed={c.candidate_id === selectedId}
                  onClick={() => onSelect(c.candidate_id)}
                >
                  <Glyph kind={c.kind} />
                  <span className="cand-id mono">{c.candidate_id.split('-').at(-1)}</span>
                  <span className="cand-kind">{KIND[c.kind].label}</span>
                  <span className="cand-sig mono">
                    {p == null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}σ`}
                  </span>
                  <span className="cand-date mono">
                    {isoDate(date.get(c.observation_ids[0] ?? '') ?? 0)}
                    {c.observation_ids.length > 1 ? ` +${c.observation_ids.length - 1}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});

const UNIT: Record<string, string> = { uJy: 'µJy', um: 'µm', sigma: 'σ', px: 'px' };

interface ReportProps {
  candidate: Candidate;
  manifest: Manifest;
  activeEpochId: string;
  onSelectEpoch: (id: string) => void;
}

// Pipeline strings are ASCII; set them with the report's typography.
const tidy = (s: string) => s.replace(/\+\/-/g, '±').replace(/\buJy\b/g, 'µJy');

/** The candidate's evidence, set as a fixed-column triage note. */
export const EvidenceReport = memo(function EvidenceReport(props: ReportProps) {
  const { candidate: c, manifest, activeEpochId, onSelectEpoch } = props;
  const obs = new Map(manifest.observations.map((o) => [o.observation_id, o]));
  const diffs = c.observation_ids.map((id) =>
    manifest.differences.find((d) => d.observation_id === id),
  );
  const validated = diffs.every((d) => d?.status === 'validated');
  const wl = c.measurements.find((m) => m.name === 'wavelength');

  return (
    <article className="report" aria-labelledby="report-h" data-tour="evidence">
      <header className="report-head">
        <h2 id="report-h" className="mono">
          {c.candidate_id}
        </h2>
        <p className={`stamp ${c.status}`}>{STATUS_LABEL[c.status]} · unconfirmed</p>
      </header>
      <dl className="report-rows mono">
        <div>
          <dt>Class</dt>
          <dd>
            <Glyph kind={c.kind} /> {KIND[c.kind].label}
          </dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {formatRa(c.ra_deg)} {formatDec(c.dec_deg)}
            <span className="dim"> ICRS</span>
          </dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>
            {c.observation_ids.map((id) => (
              <button key={id} type="button" className="link" onClick={() => onSelectEpoch(id)}>
                {isoDate(obs.get(id)?.epoch.mjd_mid ?? 0)}
              </button>
            ))}
          </dd>
        </div>
        {wl && (
          <div>
            <dt>Band</dt>
            <dd>
              {wl.value.toFixed(3)} µm
              <span className="dim">
                {' '}
                detector {obs.get(c.observation_ids[0] ?? '')?.spectral.detector}
              </span>
            </dd>
          </div>
        )}
      </dl>
      <p className="report-plain">{KIND[c.kind].plain}</p>

      <LightCurve candidate={c} activeEpochId={activeEpochId} onSelectEpoch={onSelectEpoch} />

      <table className="measure mono">
        <caption className="visually-hidden">Measurements</caption>
        <tbody>
          {c.measurements
            .filter((m) => m.name !== 'wavelength')
            .map((m) => (
              <tr key={m.name}>
                <th scope="row">{m.name}</th>
                <td>
                  {validated || m.unit === 'px' ? (
                    <>
                      {m.value.toFixed(m.unit === 'sigma' ? 1 : 0)}
                      {m.uncertainty != null && (
                        <span className="dim"> ± {m.uncertainty.toFixed(0)}</span>
                      )}{' '}
                      <span className="dim">{UNIT[m.unit] ?? m.unit}</span>
                    </>
                  ) : (
                    <span className="dim">withheld: comparison not validated</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <section aria-label="Evidence">
        <h3>Evidence</h3>
        <ul className="report-list">
          {c.evidence.map((e) => (
            <li key={e}>{tidy(e)}</li>
          ))}
        </ul>
      </section>
      <details className="report-more">
        <summary>Caveats and method</summary>
        <ul className="report-list">
          {c.caveats.map((e) => (
            <li key={e}>{tidy(e)}</li>
          ))}
          {diffs.map(
            (d) =>
              d && (
                <li key={d.difference_id}>
                  Difference {d.status.replace('_', ' ')}: noise scale k = {d.noise_scale}, error
                  floor {d.error_floor_fraction} × template
                  {d.reasons.length > 0 && ` (${d.reasons.join('; ')})`}.
                </li>
              ),
          )}
        </ul>
        <p className="mono small dim">{c.method}</p>
      </details>
      <p className="report-foot">
        A residual in archive images, not a confirmed astronomical object. Confirming it needs an
        independent detection.
      </p>
    </article>
  );
});

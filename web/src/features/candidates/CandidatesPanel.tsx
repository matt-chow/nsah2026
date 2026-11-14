import { memo, useState } from 'react';
import { formatDec, formatRa } from '../../lib/sky.ts';
import { Term } from '../../components/Term.tsx';
import { isoDate, longDate } from '../../lib/time.ts';
import type { Candidate, CandidateKind, Manifest } from '../../types/manifest.ts';
import { LightCurve } from './LightCurve.tsx';

export const STATUS_LABEL: Record<Candidate['status'], string> = {
  unreviewed: 'Unreviewed',
  needs_followup: 'Needs follow-up',
  known_object: 'Known object',
  likely_artifact: 'Likely artifact',
  rejected: 'Rejected',
};

export const KIND: Record<CandidateKind, { label: string; plain: string }> = {
  new_source_like: {
    label: 'New-source-like',
    plain: 'Light appeared on one date where the other dates show nothing steady.',
  },
  variable_like: {
    label: 'Variable-like',
    plain: 'A star or galaxy that is always there, but was brighter or fainter on this date.',
  },
  dipole_like: {
    label: 'Dipole-like',
    plain:
      'A bright patch beside a dark one: the mark of something moving, or of images slightly out of line.',
  },
  artifact_like: {
    label: 'Artifact-like',
    plain: 'A one-pixel spike, damaged pixels, or a change too small to trust (under 3σ).',
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

/** What a newcomer would call it; the triage class stays in Analyze. */
export function plainKind(c: Candidate) {
  if (c.kind === 'new_source_like') return 'Appeared';
  if (c.kind === 'variable_like') return (peak(c) ?? 0) >= 0 ? 'Brightened' : 'Faded';
  if (c.kind === 'dipole_like') return 'Shifted or misaligned';
  return 'Likely glitch';
}

const PLAIN_STATUS: Record<Candidate['status'], string> = {
  ...STATUS_LABEL,
  needs_followup: 'Worth a second look',
  likely_artifact: 'Probably an artifact',
};

interface ListProps {
  manifest: Manifest;
  plain?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const CandidateList = memo(function CandidateList(props: ListProps) {
  const { manifest, selectedId, onSelect, plain = false } = props;
  const title = plain ? 'What changed?' : 'Residuals';
  const all = manifest.candidates;
  const followup = all.filter((c) => c.status === 'needs_followup');
  const [filter, setFilter] = useState<'followup' | 'all'>(followup.length ? 'followup' : 'all');
  const shown = filter === 'followup' ? followup : all;
  const date = new Map(manifest.observations.map((o) => [o.observation_id, o.epoch.mjd_mid]));

  if (all.length === 0)
    return (
      <section className="candidates" aria-labelledby="cand-h">
        <h2 id="cand-h">{title}</h2>
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
        <h2 id="cand-h">{title}</h2>
        <div className="segmented" role="group" aria-label="Filter residuals">
          <button
            type="button"
            aria-pressed={filter === 'followup'}
            onClick={() => setFilter('followup')}
          >
            {plain ? 'Worth a second look' : 'Needs follow-up'}{' '}
            <span className="mono">{followup.length}</span>
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
                  <span className="cand-kind">{plain ? plainKind(c) : KIND[c.kind].label}</span>
                  <span className="cand-sig mono">
                    {p == null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}σ`}
                  </span>
                  <span className="cand-date mono">
                    {(plain ? longDate : isoDate)(date.get(c.observation_ids[0] ?? '') ?? 0)}
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

interface SummaryProps {
  candidate: Candidate;
  manifest: Manifest;
  activeEpochId: string;
  onSelectEpoch: (id: string) => void;
  onAnalyze: () => void;
}

/** The selected change in plain words, with one headline number and its uncertainty. */
export const ChangeSummary = memo(function ChangeSummary(props: SummaryProps) {
  const { candidate: c, manifest, activeEpochId, onSelectEpoch, onAnalyze } = props;
  const n = manifest.observations.length;
  const first = manifest.observations.find((o) => o.observation_id === c.observation_ids[0]);
  const validated = c.observation_ids.every(
    (id) => manifest.differences.find((d) => d.observation_id === id)?.status === 'validated',
  );
  const flux = c.measurements.find((m) => m.name === 'aperture flux change');
  const p = peak(c);
  return (
    <article className="summary" aria-labelledby="summary-h" data-tour="evidence">
      <header className="summary-head">
        <h3 id="summary-h">
          <Glyph kind={c.kind} /> {plainKind(c)}
          {first && <span className="dim"> · {longDate(first.epoch.mjd_mid)}</span>}
        </h3>
        <p className={`stamp ${c.status}`}>{PLAIN_STATUS[c.status]} · unconfirmed</p>
      </header>
      <p>{KIND[c.kind].plain}</p>
      <p>
        Seen on {c.observation_ids.length} of {n} dates.{' '}
        {validated && p != null ? (
          <>
            Strength: <Term k="confidence">{Math.abs(p).toFixed(1)}σ</Term> above the noise
            {flux?.uncertainty != null && (
              <>
                ; extra light{' '}
                <span className="mono">
                  {flux.value.toFixed(0)} ± {flux.uncertainty.toFixed(0)} µJy
                </span>
              </>
            )}
            .
          </>
        ) : (
          <>Numbers are withheld: this comparison failed its noise check.</>
        )}
      </p>
      <LightCurve candidate={c} activeEpochId={activeEpochId} onSelectEpoch={onSelectEpoch} />
      <p className="small">
        <strong>Reading the chart:</strong> each mark is one date, left to right in time. Height is
        how much brighter (up) or fainter (down) this spot was than usual; the dashed line is “no
        change”. The vertical bar through each mark is its <Term k="uncertainty">uncertainty</Term>:
        if it reaches the dashed line, that date may show no change at all. Squares mark the dates
        where the change was strong enough to flag; × marks a date with no usable pixels here. Click
        a mark to view that date.
      </p>
      <p className="small dim">
        A spot that changed in archive images, not a confirmed object. Seeing it again, with another
        telescope or a later SPHEREx visit, is what would confirm it.{' '}
        <button type="button" className="link" onClick={onAnalyze}>
          Full evidence and caveats
        </button>
      </p>
    </article>
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

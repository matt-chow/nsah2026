import { memo } from 'react';
import type { Candidate } from '../../types/manifest.ts';

const LABEL: Record<Candidate['status'], string> = {
  unreviewed: 'Unreviewed',
  needs_followup: 'Needs follow-up',
  known_object: 'Known object',
  likely_artifact: 'Likely artifact',
  rejected: 'Rejected',
};

export const CandidatesPanel = memo(function CandidatesPanel({
  candidates,
}: {
  candidates: Candidate[];
}) {
  return (
    <section className="panel" aria-labelledby="candidates-h">
      <h2 id="candidates-h">Candidates</h2>
      {candidates.length === 0 ? (
        <p className="muted">
          No candidates. Change detection has not been run on this dataset, so nothing here has been
          evaluated.
        </p>
      ) : (
        <ul className="list">
          {candidates.map((c) => (
            <li key={c.candidate_id}>
              <span className="badge unknown">{LABEL[c.status]}</span>{' '}
              <span className="mono">{c.candidate_id}</span>
              <span className="muted small"> via {c.method}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Candidates are unconfirmed until independently verified.</p>
    </section>
  );
});

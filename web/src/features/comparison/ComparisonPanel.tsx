import { memo } from 'react';
import type { Comparison } from '../../types/manifest.ts';

interface Props {
  selectedId: string;
  comparisons: Comparison[];
}

const LABEL = { compatible: 'Compatible', incompatible: 'Unavailable', unknown: 'Unverified' };

/** Shows pipeline-computed comparability. The browser never re-derives it. */
export const ComparisonPanel = memo(function ComparisonPanel({ selectedId, comparisons }: Props) {
  const rows = comparisons.filter(
    (c) => c.reference_id === selectedId || c.target_id === selectedId,
  );
  return (
    <section className="panel" aria-labelledby="comparison-h">
      <h2 id="comparison-h">Comparisons</h2>
      {rows.length === 0 ? (
        <p className="muted">No other epochs to compare with.</p>
      ) : (
        <ul className="list">
          {rows.map((c) => {
            const other = c.reference_id === selectedId ? c.target_id : c.reference_id;
            return (
              <li key={`${c.reference_id}|${c.target_id}`}>
                <span className={`badge ${c.status}`}>{LABEL[c.status]}</span>{' '}
                <span className="mono">{other}</span>
                {c.reasons.length > 0 && (
                  <ul className="reasons">
                    {c.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">
        Only compatible pairs may be blinked or subtracted. Blink view is not in this build.
      </p>
    </section>
  );
});

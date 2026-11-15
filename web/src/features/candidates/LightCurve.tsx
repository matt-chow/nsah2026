import { memo, useState } from 'react';
import { isoDate } from '../../lib/time.ts';
import type { Candidate } from '../../types/manifest.ts';
import { robustRange } from './scale.ts';

interface Props {
  candidate: Candidate;
  activeEpochId: string;
  onSelectEpoch: (id: string) => void;
}

const W = 340;
const H = 160;
const PAD = { l: 44, r: 10, t: 18, b: 22 };

/**
 * Aperture flux change at the candidate position in every epoch, with 1σ bars.
 * When one epoch dwarfs the rest, the typical-range scale pins it to the edge with its value
 * printed, so the others stay readable; "Fit all" restores one linear scale. Nothing is hidden.
 */
export const LightCurve = memo(function LightCurve(props: Props) {
  const { candidate, activeEpochId, onSelectEpoch } = props;
  const [fitAll, setFitAll] = useState(false);
  const pts = candidate.light_curve;
  const valid = pts.flatMap((p) =>
    p.delta_flux_ujy != null && p.uncertainty_ujy != null
      ? [{ v: p.delta_flux_ujy, e: p.uncertainty_ujy }]
      : [],
  );
  if (valid.length === 0) return <p className="muted">No unmasked epochs at this position.</p>;
  const full = robustRange(valid, Infinity);
  const typical = robustRange(valid, 5);
  const hasOutliers = typical.lo > full.lo || typical.hi < full.hi;
  const { lo, hi } = fitAll || !hasOutliers ? full : typical;
  const t0 = pts[0]?.mjd_mid ?? 0;
  const t1 = pts.at(-1)?.mjd_mid ?? t0;
  const x = (mjd: number) => PAD.l + ((mjd - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const yRaw = (v: number) => PAD.t + ((hi - v) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b);
  const y = (v: number) => Math.min(H - PAD.b, Math.max(PAD.t, yRaw(v)));
  const hits = new Set(candidate.observation_ids);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
  const off = valid.filter((p) => p.v > hi || p.v < lo).length;

  return (
    <figure className="lightcurve">
      {hasOutliers && (
        <div className="segmented lc-scale" role="group" aria-label="Light-curve scale">
          <button type="button" aria-pressed={!fitAll} onClick={() => setFitAll(false)}>
            Typical range
          </button>
          <button type="button" aria-pressed={fitAll} onClick={() => setFitAll(true)}>
            Fit all
          </button>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${candidate.candidate_id}-lc`}>
        <title id={`${candidate.candidate_id}-lc`}>
          {`Flux change at this position, ${valid.length} of ${pts.length} epochs measured; detected in ${hits.size}.${off ? ` ${off} off the scale shown, value printed at the edge.` : ''}`}
        </title>
        <line className="lc-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
        {[hi, 0, lo]
          // drop labels that would collide with a neighbour (e.g. lo ≈ 0)
          .filter((v, i, a) => i === 0 || a.slice(0, i).every((u) => Math.abs(y(u) - y(v)) > 12))
          .map((v) => (
            <text key={v} className="lc-tick" x={PAD.l - 6} y={y(v) + 3} textAnchor="end">
              {fmt(v)}
            </text>
          ))}
        <text className="lc-tick" x={PAD.l} y={H - 4}>
          {isoDate(t0)}
        </text>
        <text className="lc-tick" x={W - PAD.r} y={H - 4} textAnchor="end">
          {isoDate(t1)}
        </text>
        {pts.map((p) => {
          const cx = x(p.mjd_mid);
          const active = p.observation_id === activeEpochId;
          const hit = hits.has(p.observation_id);
          const select = () => onSelectEpoch(p.observation_id);
          if (p.delta_flux_ujy == null || p.uncertainty_ujy == null)
            return (
              <text key={p.observation_id} className="lc-masked" x={cx} y={H - PAD.b - 2}>
                ×
              </text>
            );
          const v = p.delta_flux_ujy;
          const e = p.uncertainty_ujy;
          const above = v > hi;
          const below = v < lo;
          const cy = y(v);
          return (
            <g
              key={p.observation_id}
              className={`lc-point${hit ? ' hit' : ''}${active ? ' active' : ''}`}
              onClick={select}
            >
              <rect className="lc-hit" x={cx - 9} y={0} width={18} height={H - PAD.b} />
              <line x1={cx} x2={cx} y1={y(v + e)} y2={y(v - e)} />
              {above || below ? (
                <>
                  <path
                    className="lc-off"
                    d={
                      above
                        ? `M${cx - 5} ${cy + 6}L${cx} ${cy - 2}L${cx + 5} ${cy + 6}Z`
                        : `M${cx - 5} ${cy - 6}L${cx} ${cy + 2}L${cx + 5} ${cy - 6}Z`
                    }
                  />
                  <text
                    className="lc-off-label"
                    x={cx + (cx > W - 70 ? -8 : 8)}
                    y={above ? cy + 4 : cy}
                    textAnchor={cx > W - 70 ? 'end' : 'start'}
                  >
                    {`${fmt(v)} ±${fmt(e)}`}
                  </text>
                </>
              ) : hit ? (
                <rect x={cx - 4} y={cy - 4} width={8} height={8} />
              ) : (
                <circle cx={cx} cy={cy} r={3} />
              )}
              {active && <circle className="lc-ring" cx={cx} cy={cy} r={8} />}
            </g>
          );
        })}
      </svg>
      <details className="lc-data">
        <summary>Dates and measured values (select a date)</summary>
        <ul>
          {pts.map((p) => (
            <li key={p.observation_id}>
              <button
                type="button"
                aria-pressed={p.observation_id === activeEpochId}
                onClick={() => onSelectEpoch(p.observation_id)}
              >
                {isoDate(p.mjd_mid)} ·{' '}
                {p.delta_flux_ujy == null || p.uncertainty_ujy == null
                  ? 'No usable measurement'
                  : `${p.delta_flux_ujy.toFixed(1)} ± ${p.uncertainty_ujy.toFixed(1)} µJy`}
                {hits.has(p.observation_id) ? ' · flagged' : ''}
              </button>
            </li>
          ))}
        </ul>
      </details>
      <figcaption className="muted small">
        Flux change vs. the other epochs, µJy, ±1σ. Squares: epochs where the residual crossed the
        detection threshold; dots: the rest; ring: the epoch on screen. × marks a masked epoch.
        {off > 0 &&
          ` Triangles: ${off === 1 ? 'one epoch is' : `${off} epochs are`} beyond this scale; the measured value ±1σ is printed beside it.`}
      </figcaption>
    </figure>
  );
});

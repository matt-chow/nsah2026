import { memo } from 'react';
import { isoDate } from '../../lib/time.ts';
import type { Candidate } from '../../types/manifest.ts';

interface Props {
  candidate: Candidate;
  activeEpochId: string;
  onSelectEpoch: (id: string) => void;
}

const W = 340;
const H = 150;
const PAD = { l: 44, r: 8, t: 10, b: 22 };

/** Aperture flux change at the candidate position in every epoch, with 1σ bars. */
export const LightCurve = memo(function LightCurve(props: Props) {
  const { candidate, activeEpochId, onSelectEpoch } = props;
  const pts = candidate.light_curve;
  const valid = pts.flatMap((p) =>
    p.delta_flux_ujy != null && p.uncertainty_ujy != null
      ? [{ v: p.delta_flux_ujy, e: p.uncertainty_ujy }]
      : [],
  );
  if (valid.length === 0) return <p className="muted">No unmasked epochs at this position.</p>;
  const lo = Math.min(0, ...valid.map((p) => p.v - p.e));
  const hi = Math.max(0, ...valid.map((p) => p.v + p.e));
  const t0 = pts[0]?.mjd_mid ?? 0;
  const t1 = pts.at(-1)?.mjd_mid ?? t0;
  const x = (mjd: number) => PAD.l + ((mjd - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b);
  const hits = new Set(candidate.observation_ids);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));

  return (
    <figure className="lightcurve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${candidate.candidate_id}-lc`}>
        <title id={`${candidate.candidate_id}-lc`}>
          {`Flux change at this position, ${valid.length} of ${pts.length} epochs measured; detected in ${hits.size}.`}
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
          if (p.delta_flux_ujy == null || p.uncertainty_ujy == null)
            return (
              <text key={p.observation_id} className="lc-masked" x={cx} y={H - PAD.b - 2}>
                ×
              </text>
            );
          const cy = y(p.delta_flux_ujy);
          return (
            <g
              key={p.observation_id}
              className={`lc-point${hit ? ' hit' : ''}${active ? ' active' : ''}`}
              onClick={() => onSelectEpoch(p.observation_id)}
            >
              <line
                x1={cx}
                x2={cx}
                y1={y(p.delta_flux_ujy + p.uncertainty_ujy)}
                y2={y(p.delta_flux_ujy - p.uncertainty_ujy)}
              />
              {hit ? (
                <rect x={cx - 4} y={cy - 4} width={8} height={8} />
              ) : (
                <circle cx={cx} cy={cy} r={3} />
              )}
              {active && <circle className="lc-ring" cx={cx} cy={cy} r={8} />}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted small">
        Flux change vs. the other epochs, µJy, ±1σ. Squares: epochs where the residual crossed the
        detection threshold; dots: the rest; ring: the epoch on screen. × marks a masked epoch.
      </figcaption>
    </figure>
  );
});

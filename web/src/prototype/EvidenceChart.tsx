import { isoDate } from '../lib/time.ts';
import type { Candidate, Observation } from '../types/manifest.ts';

interface Props {
  candidate: Candidate;
  observations: Observation[];
  active: number;
  onSelect: (i: number) => void;
}

const W = 360;
const H = 176;
const PAD = { l: 52, r: 12, t: 16, b: 34 };
const GAP_DAYS = 60; // a pause in visits longer than this is drawn as a break in the axis

const fmt = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en')}`;

/**
 * Brightness change at one spot, one point per visit, evenly spaced in visit order (dates are
 * labelled and long pauses marked) so clustered visits stay readable. One linear scale that
 * always includes the event, ±1σ bars, masked visits marked rather than dropped.
 */
export function EvidenceChart({ candidate, observations, active, onSelect }: Props) {
  const pts = observations.map((o) => {
    const p = candidate.light_curve.find((l) => l.observation_id === o.observation_id);
    return {
      v: p?.delta_flux_ujy ?? null,
      e: p?.uncertainty_ujy ?? null,
      mjd: o.epoch.mjd_mid,
    };
  });
  const vals = pts.flatMap((p) => (p.v != null && p.e != null ? [p.v - p.e, p.v + p.e] : []));
  if (vals.length === 0) return <p className="note">No unmasked visits at this spot.</p>;
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const [y0, y1] = [lo - pad, hi + pad];
  const n = pts.length;
  const x = (i: number) => PAD.l + ((i + 0.5) / n) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((y1 - v) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const big = (p: (typeof pts)[number]) => p.v != null && p.e != null && Math.abs(p.v) > 5 * p.e;
  const breaks = pts.flatMap((p, i) => {
    const prev = pts[i - 1];
    return prev && p.mjd - prev.mjd > GAP_DAYS ? [{ i, days: p.mjd - prev.mjd }] : [];
  });
  // extremes and zero, dropping an extreme that would print on top of the zero label
  const ticks = [y0 + pad, 0, y1 - pad].filter((t) => t === 0 || Math.abs(y(t) - y(0)) > 14);
  const summary = pts
    .map((p, i) =>
      p.v == null
        ? `${isoDate(p.mjd)}: masked`
        : `${isoDate(p.mjd)}: ${fmt(p.v)} ± ${Math.round(p.e ?? 0)}${i === active ? ' (shown)' : ''}`,
    )
    .join('; ');
  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Brightness change per visit, microjanskys: ${summary}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'axis-zero' : 'axis-grid'}
            />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {breaks.map((b) => (
          <g key={b.i} className="axis-break">
            <line
              x1={(x(b.i) + x(b.i - 1)) / 2}
              x2={(x(b.i) + x(b.i - 1)) / 2}
              y1={PAD.t}
              y2={H - PAD.b}
            />
            <text x={(x(b.i) + x(b.i - 1)) / 2} y={PAD.t - 4} textAnchor="middle" className="tick">
              {Math.round(b.days / 30)} months later
            </text>
          </g>
        ))}
        {pts.map((p, i) => {
          const cx = x(i);
          const isActive = i === active;
          return (
            <g key={i} className={`pt${isActive ? ' is-active' : ''}${big(p) ? ' is-big' : ''}`}>
              {isActive && (
                <rect
                  x={cx - 12}
                  y={PAD.t}
                  width={24}
                  height={H - PAD.t - PAD.b}
                  className="active-band"
                />
              )}
              {p.v == null || p.e == null ? (
                <text x={cx} y={y(0) + 4} textAnchor="middle" className="masked">
                  ×
                </text>
              ) : (
                <>
                  <line x1={cx} x2={cx} y1={y(p.v - p.e)} y2={y(p.v + p.e)} className="err" />
                  {big(p) ? (
                    <rect x={cx - 4} y={y(p.v) - 4} width={8} height={8} className="dot" />
                  ) : (
                    <circle cx={cx} cy={y(p.v)} r={3.5} className="dot" />
                  )}
                  {big(p) && (
                    <text x={cx + 8} y={y(p.v) + 4} className="val">
                      {fmt(p.v)}
                    </text>
                  )}
                </>
              )}
              <text x={cx} y={H - PAD.b + 14} textAnchor="middle" className="tick">
                {i + 1}
              </text>
              <rect
                x={cx - 14}
                y={0}
                width={28}
                height={H}
                className="hit"
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                aria-label={`Show visit ${i + 1}, ${isoDate(p.mjd)}, as image A`}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(i);
                }}
              >
                <title>{`Visit ${i + 1}, ${isoDate(p.mjd)}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={PAD.l} y={H - 4} className="tick">
          Visit
        </text>
      </svg>
      <figcaption>
        Change in brightness at this spot (µJy) compared with its typical value. Bars show ±1σ
        uncertainty; squares mark visits more than 5σ from typical; × marks a masked visit.
      </figcaption>
    </figure>
  );
}

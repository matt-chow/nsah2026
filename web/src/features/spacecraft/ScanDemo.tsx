import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { illustrativeFlux, pointing, STEPS } from './scan.ts';

// geometry of the drawing, in SVG units
const DET_W = 46;
const DET_H = 150;
const GAP = 6;
const ARRAY_W = DET_W * 3 + GAP * 2;
const PLOT = { x: 360, y: 20, w: 300, h: 150 };
const LOG_MIN = Math.log(0.75);
const LOG_MAX = Math.log(5);
const px = (um: number) => PLOT.x + ((Math.log(um) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * PLOT.w;
const FMAX = illustrativeFlux(0.75);
const py = (f: number) => PLOT.y + PLOT.h - (f / FMAX) * PLOT.h * 0.92;

/** Plays only after a press; the timer exists only while playing. */
export function ScanDemo() {
  const [n, setN] = useState(0); // pointings taken
  const [wantPlay, setPlaying] = useState(false);
  const done = n >= STEPS;
  const playing = wantPlay && !done;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setN((k) => Math.min(STEPS, k + 1)), 140);
    return () => clearInterval(t);
  }, [playing]);

  const now = n > 0 ? pointing(n - 1) : null;
  const samples = Array.from({ length: n }, (_, i) => pointing(i).samples).flat();

  return (
    <figure className="scan-demo panel">
      <div className="scan-head">
        <span className="schematic-tag">Illustration, not SPHEREx data</span>
        <div className="scan-controls">
          <button
            type="button"
            className="primary"
            onClick={() => (done ? (setN(0), setPlaying(true)) : setPlaying(!playing))}
          >
            <Icon name={playing ? 'pause' : 'play'} />{' '}
            {playing ? 'Pause' : done ? 'Replay' : 'Play'}
          </button>
          <button type="button" onClick={() => setN((k) => Math.min(STEPS, k + 1))} disabled={done}>
            <Icon name="step" /> One pointing
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setN(0);
            }}
            disabled={n === 0}
          >
            <Icon name="reset" /> Reset
          </button>
        </div>
      </div>

      <svg
        viewBox="0 0 680 230"
        className="scan-svg"
        role="img"
        aria-label={`Pointing ${n} of ${STEPS}: ${samples.length} of 102 colours measured.`}
      >
        <defs>
          <linearGradient id="lvf" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--rail-2)" />
            <stop offset="1" stopColor="var(--cyan)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {[0, 1].map((a) => (
          <g key={a} transform={`translate(${10 + a * (ARRAY_W + 24)} 20)`}>
            {[0, 1, 2].map((d) => (
              <rect
                key={d}
                x={d * (DET_W + GAP)}
                y={0}
                width={DET_W}
                height={DET_H}
                fill="url(#lvf)"
                stroke={now?.column === d ? 'var(--signal)' : 'var(--hair-2)'}
              />
            ))}
            {[0, 1, 2].map((d) => (
              <text key={d} x={d * (DET_W + GAP) + DET_W / 2} y={DET_H + 16} className="svg-label">
                {a * 3 + d + 1}
              </text>
            ))}
            <text x={ARRAY_W / 2} y={DET_H + 34} className="svg-label">
              {a ? '2.42–5.0 µm' : '0.75–2.42 µm'}
            </text>
            {now && (
              <circle
                cx={now.column * (DET_W + GAP) + DET_W / 2}
                cy={DET_H - now.row * DET_H}
                r={4}
                fill="var(--paper)"
              />
            )}
          </g>
        ))}

        <g className="svg-axis">
          <line x1={PLOT.x} y1={PLOT.y + PLOT.h} x2={PLOT.x + PLOT.w} y2={PLOT.y + PLOT.h} />
          {[1, 2, 3, 4, 5].map((um) => (
            <text key={um} x={px(um)} y={PLOT.y + PLOT.h + 16} className="svg-label">
              {um}
            </text>
          ))}
          <text x={PLOT.x + PLOT.w / 2} y={PLOT.y + PLOT.h + 34} className="svg-label">
            wavelength (µm)
          </text>
          <line x1={PLOT.x} y1={PLOT.y} x2={PLOT.x} y2={PLOT.y + PLOT.h} />
          <text x={PLOT.x + 6} y={PLOT.y + 4} className="svg-label" textAnchor="start">
            brighter
          </text>
        </g>
        {samples.map((c, i) => (
          <circle
            key={c.index}
            cx={px(c.center)}
            cy={py(illustrativeFlux(c.center))}
            r={i >= samples.length - 2 ? 3.5 : 2.2}
            fill={i >= samples.length - 2 ? 'var(--signal)' : 'var(--cyan)'}
          />
        ))}
      </svg>

      <figcaption className="small">
        <span className="mono">
          Pointing {n} of {STEPS} · {samples.length} of 102 colours
        </span>
        <span className="dim">
          {done
            ? ' · Complete. The dips near 3.0 and 4.3 µm are the kind of fingerprint ice leaves.'
            : ' · Each pointing moves the star across the filters; both arrays see it at once.'}
        </span>
        <span className="dim block">
          Shading only marks where wavelength rises across each filter; infrared has no visible
          colour. The brightness curve is invented for teaching.
        </span>
      </figcaption>
    </figure>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { CompareMode } from './store.ts';

export interface ModeOption {
  id: CompareMode;
  label: string;
  about: string;
  /** Why the mode is unavailable for this pair; shown next to the control. */
  unavailable?: string | undefined;
}

export const BASE_MODES: ModeOption[] = [
  { id: 'one', label: 'A only', about: 'Image A on its own.' },
  {
    id: 'blink',
    label: 'Blink',
    about: 'Swaps A and B in the same place. Anything that changed catches the eye.',
  },
  { id: 'split', label: 'Split', about: 'A left of the line, B right of it. Move the line.' },
  { id: 'fade', label: 'Fade', about: 'Blends from A to B.' },
];

/**
 * A and B stacked on the same grid, so framing is always shared. Draws copies of the source
 * canvases; nothing here touches the data.
 */
export function CompareLayers(props: {
  a: HTMLCanvasElement | null;
  b: HTMLCanvasElement | null;
  mode: CompareMode;
  showB: boolean;
  mix: number;
  label: string;
}) {
  const ca = useRef<HTMLCanvasElement>(null);
  const cb = useRef<HTMLCanvasElement>(null);
  useEffect(() => copy(props.a, ca.current), [props.a]);
  useEffect(() => copy(props.b, cb.current), [props.b]);
  const { mode, mix } = props;
  const style =
    mode === 'blink'
      ? { opacity: props.showB ? 1 : 0 }
      : mode === 'split'
        ? { clipPath: `inset(0 0 0 ${mix * 100}%)` }
        : mode === 'fade'
          ? { opacity: mix }
          : { opacity: 0 };
  return (
    <>
      <canvas ref={ca} role="img" aria-label={props.label} />
      <canvas ref={cb} className="layer-b" style={style} aria-hidden="true" />
      {mode === 'split' && (
        <span className="split-line" style={{ left: `${mix * 100}%` }} aria-hidden="true" />
      )}
    </>
  );
}

function copy(src: HTMLCanvasElement | null, dst: HTMLCanvasElement | null) {
  if (!src || !dst) return;
  dst.width = src.width;
  dst.height = src.height;
  dst.getContext('2d')?.drawImage(src, 0, 0);
}

/** Mode choice plus the one control each mode needs. Blink steps by hand under reduced motion. */
export function CompareControls(props: {
  modes: ModeOption[];
  mode: CompareMode;
  onMode: (m: CompareMode) => void;
  showB: boolean;
  onShowB: (b: boolean) => void;
  mix: number;
  onMix: (v: number) => void;
  reduced: boolean;
  aLabel: string;
  bLabel: string;
}) {
  const { mode, showB, onShowB } = props;
  const [auto, setAuto] = useState(!props.reduced);
  const latest = useRef({ showB, onShowB });
  useEffect(() => {
    latest.current = { showB, onShowB };
  });
  useEffect(() => {
    if (mode !== 'blink' || !auto) return;
    // 0.7 s per image: well under three flashes a second
    const t = setInterval(() => latest.current.onShowB(!latest.current.showB), 700);
    return () => clearInterval(t);
  }, [mode, auto]);
  const current = props.modes.find((m) => m.id === mode);
  const blocked = props.modes.filter((m) => m.unavailable);
  return (
    <div className="cmp-controls">
      <div className="seg" role="radiogroup" aria-label="How to compare">
        {props.modes.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            disabled={!!m.unavailable}
            aria-describedby={m.unavailable ? `why-${m.id}` : undefined}
            onClick={() => props.onMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {blocked.map((m) => (
        <p key={m.id} id={`why-${m.id}`} className="note">
          <strong>{m.label} unavailable:</strong> {m.unavailable}
        </p>
      ))}
      <p className="note">{current?.about}</p>
      {mode === 'blink' && (
        <div className="row">
          <button aria-pressed={auto} onClick={() => setAuto(!auto)}>
            {auto ? 'Pause blink' : 'Blink automatically'}
          </button>
          <button
            onClick={() => onShowB(!showB)}
            aria-label={`Showing ${showB ? 'B' : 'A'}; switch`}
          >
            Showing {showB ? 'B' : 'A'} · switch
          </button>
        </div>
      )}
      {(mode === 'split' || mode === 'fade') && (
        <label className="slider">
          <span className="ends muted">
            <span>A · {props.aLabel}</span>
            <span>B · {props.bLabel}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(props.mix * 100)}
            aria-label={mode === 'split' ? 'Split position' : 'Blend from A to B'}
            aria-valuetext={`${Math.round(props.mix * 100)}% B`}
            onChange={(e) => props.onMix(Number(e.target.value) / 100)}
          />
        </label>
      )}
    </div>
  );
}

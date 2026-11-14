import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export interface TourStep {
  target: string; // data-tour value
  title: string;
  body: string;
  run?: () => void;
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

/** Non-modal guided walk-through: each step drives the workspace, then points at the result. */
export function Tour({ steps, onClose }: Props) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i] as TourStep; // i stays within steps

  useEffect(() => {
    step.run?.();
  }, [step]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      setBox(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = window.setTimeout(measure, 80); // after the step's state change has rendered
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useEffect(() => cardRef.current?.focus(), [i]);

  const last = i === steps.length - 1;
  const narrow = window.innerWidth < 900;
  const style: CSSProperties =
    box && !narrow
      ? {
          top: Math.min(Math.max(12, box.top + 12), window.innerHeight - 260),
          // beside the target (right, else left); never on top of it
          left:
            box.right + 360 < window.innerWidth
              ? box.right + 16
              : Math.max(12, box.left - 352 - 16),
        }
      : {};

  return (
    <>
      {box && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={{
            top: box.top - 4,
            left: box.left - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
        />
      )}
      <div
        ref={cardRef}
        className={`tour-card${narrow ? ' docked' : ''}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-h"
        aria-describedby="tour-b"
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <p className="tour-count mono">
          {i + 1} / {steps.length}
        </p>
        <h2 id="tour-h">{step.title}</h2>
        <p id="tour-b">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="link" onClick={onClose}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => (last ? onClose() : setI(i + 1))}
          >
            {last ? 'Start exploring' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}

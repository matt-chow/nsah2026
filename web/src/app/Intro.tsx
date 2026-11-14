import { useEffect, useRef } from 'react';
import type { FieldSummary } from '../types/manifest.ts';

interface Props {
  fields: FieldSummary[] | null;
  leaving: boolean;
  onEnter: (tour: boolean) => void;
}

/** Deterministic starfield (mulberry32), so every visit shows the same sky. */
function stars(n: number, seed: number) {
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    x: rand(),
    y: rand(),
    depth: rand() ** 2, // most stars far away
    warm: rand() < 0.18,
  }));
}

/**
 * Illustrative backdrop: layered stars that shift by depth (parallax) as time passes.
 * It is labelled as illustration; real data starts in the workspace.
 */
function Starfield({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const field = stars(900, 2026);
    const reduce = still || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = reduce ? 0 : (now - t0) / 1000;
      for (const s of field) {
        const drift = t * (2 + s.depth * 14); // near stars move faster
        const x = (((s.x * w + drift) % w) + w) % w;
        const y = s.y * h;
        const r = 0.4 + s.depth * 1.5;
        ctx.globalAlpha = 0.25 + s.depth * 0.75;
        ctx.fillStyle = s.warm ? '#f2c38a' : '#e9e4d8';
        ctx.fillRect(x, y, r, r);
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const onResize = () => reduce && requestAnimationFrame(draw);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [still]);
  return <canvas ref={ref} className="intro-stars" aria-hidden="true" />;
}

export function Intro({ fields, leaving, onEnter }: Props) {
  const real = fields?.filter((f) => f.data_kind === 'real') ?? [];
  const epochs = real.reduce((s, f) => s + f.observations, 0);
  return (
    <div className={`intro${leaving ? ' leaving' : ''}`}>
      <Starfield still={leaving} />
      <div className="intro-copy">
        <h1 className="intro-title">PARALLAX</h1>
        <p className="intro-lede">
          NASA's SPHEREx telescope maps the whole sky in infrared every six months. Line up its
          images of the same patch of sky, taken months apart, and anything that changed stands out.
        </p>
        <p className="intro-body">
          Blink between real archive epochs, look at what is left after subtracting the steady sky,
          and judge each change for yourself, with its numbers and caveats.
        </p>
        <div className="intro-actions">
          <button type="button" className="primary" onClick={() => onEnter(false)} autoFocus>
            Open the workspace
          </button>
          <button type="button" onClick={() => onEnter(true)}>
            Take the one-minute tour
          </button>
        </div>
        {real.length > 0 && (
          <p className="intro-facts mono">
            {real.length} fields · {epochs} epochs · SPHEREx DR1 + QR3 via IRSA
          </p>
        )}
      </div>
      <p className="intro-credit">
        Background stars are illustrative. Every image in the workspace is real SPHEREx data unless
        it is labelled simulated.
      </p>
    </div>
  );
}

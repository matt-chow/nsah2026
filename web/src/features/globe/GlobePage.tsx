import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageProps } from '../../app/App.tsx';
import { Icon } from '../../components/Icon.tsx';
import {
  BRIGHT_STARS,
  ecliptic,
  galactic,
  offset,
  project,
  radec,
  unproject,
  type Vec3,
  type View,
} from '../../lib/sphere.ts';
import type { FieldSummary } from '../../types/manifest.ts';
import '../../styles/pages.css';

const ZOOM_MIN = 0.9;
const ZOOM_MAX = 60;
const HOME: View = { ra: 270, dec: 30 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name);
const clampDec = (d: number) => Math.max(-89.9, Math.min(89.9, d));
const wrap = (ra: number) => ((ra % 360) + 360) % 360;

interface Frame {
  w: number;
  h: number;
  r: number; // sphere radius in CSS px
}

const radius = (w: number, h: number, z: number) => Math.min(w, h) * 0.46 * z;

/** Lines are sampled densely and broken where they pass behind the sphere. */
function polyline(ctx: CanvasRenderingContext2D, pts: Vec3[], v: View, f: Frame) {
  let pen = false;
  ctx.beginPath();
  for (const p of pts) {
    const [x, y, z] = project(p, v);
    if (z < 0) {
      pen = false;
      continue;
    }
    const sx = f.w / 2 + x * f.r;
    const sy = f.h / 2 - y * f.r;
    if (pen) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
    pen = true;
  }
  ctx.stroke();
}

const sample = (n: number, fn: (t: number) => Vec3) =>
  Array.from({ length: n + 1 }, (_, i) => fn(i / n));

/** The four corners of a field's square cutout; half-side is the index radius. */
const corners = (f: FieldSummary): Vec3[] => {
  const s = f.radius_arcsec / 3600;
  return (
    [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
      [-s, -s],
    ] as const
  ).map(([e, n]) => offset(f.ra_deg, f.dec_deg, e, n));
};

export function GlobePage({ fields }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ ...HOME });
  const zoom = useRef(1);
  const frame = useRef<Frame>({ w: 0, h: 0, r: 0 });
  const raf = useRef(0);
  const [hover, setHover] = useState<FieldSummary | null>(null);
  const [selected, setSelected] = useState<FieldSummary | null>(null);
  const [pointer, setPointer] = useState<{ ra: number; dec: number } | null>(null);
  const [zoomShown, setZoomShown] = useState(1);
  const state = useRef({ hover, selected, fields });
  useEffect(() => {
    state.current = { hover, selected, fields };
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const f = frame.current;
    const v = view.current;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const ink = {
      rail: css('--rail'),
      hair: css('--hair-2'),
      cyan: css('--cyan'),
      paper: css('--paper'),
      dim: css('--paper-dim'),
      signal: css('--signal'),
      mono: `11px ${css('--mono')}`,
      label: `600 12px ${css('--sans')}`,
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.w, f.h);
    const cx = f.w / 2;
    const cy = f.h / 2;
    const at = (p: Vec3) => {
      const [x, y, z] = project(p, v);
      return { sx: cx + x * f.r, sy: cy - y * f.r, z };
    };

    // the sphere, seen from inside
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, f.r, 0, Math.PI * 2);
    ctx.fillStyle = ink.rail;
    ctx.fill();
    ctx.clip();

    // RA/Dec grid every 30°
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.hair;
    for (let dec = -60; dec <= 60; dec += 30)
      polyline(
        ctx,
        sample(180, (t) => radec(t * 360, dec)),
        v,
        f,
      );
    for (let ra = 0; ra < 360; ra += 30)
      polyline(
        ctx,
        sample(90, (t) => radec(ra, -90 + t * 180)),
        v,
        f,
      );

    // reference planes: illustrative overlays in cyan
    ctx.strokeStyle = ink.cyan;
    ctx.globalAlpha = 0.75;
    polyline(
      ctx,
      sample(360, (t) => ecliptic(t * 360)),
      v,
      f,
    );
    ctx.setLineDash([5, 5]);
    polyline(
      ctx,
      sample(360, (t) => galactic(t * 360)),
      v,
      f,
    );
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // grid labels: hours along the equator, degrees along the central meridian
    ctx.font = ink.mono;
    ctx.fillStyle = ink.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let ra = 0; ra < 360; ra += 30) {
      const p = at(radec(ra, 0));
      if (p.z > 0.15) ctx.fillText(`${ra / 15}h`, p.sx, p.sy - 9);
    }
    for (let dec = -60; dec <= 60; dec += 30) {
      const p = at(radec(v.ra, dec));
      if (p.z > 0.15 && dec !== 0) ctx.fillText(`${dec > 0 ? '+' : ''}${dec}°`, p.sx + 20, p.sy);
    }

    // bright stars, for orientation only
    ctx.textAlign = 'left';
    for (const [name, ra, dec] of BRIGHT_STARS) {
      const p = at(radec(ra, dec));
      if (p.z <= 0) continue;
      ctx.fillStyle = ink.paper;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink.dim;
      ctx.fillText(name, p.sx + 6, p.sy);
    }

    // SPHEREx fields: the true footprint, plus a ring so they stay findable at whole-sky scale
    const { hover: hv, selected: sel, fields: fs } = state.current;
    for (const fld of fs ?? []) {
      const p = at(radec(fld.ra_deg, fld.dec_deg));
      if (p.z <= 0) continue;
      const sim = fld.data_kind === 'simulated';
      const on = fld.manifest_id === hv?.manifest_id || fld.manifest_id === sel?.manifest_id;
      const color = sim ? ink.dim : ink.signal;
      ctx.strokeStyle = color;
      ctx.lineWidth = on ? 2 : 1.5;
      ctx.setLineDash(sim ? [3, 3] : []);
      polyline(ctx, corners(fld), v, f);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, on ? 11 : 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = ink.label;
      ctx.fillText(
        sim ? 'Simulated test field' : (fld.title.split(',')[0] ?? fld.title),
        p.sx + 15,
        p.sy - 1,
      );
    }
    ctx.restore();

    // horizon
    ctx.strokeStyle = ink.hair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, f.r, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  }, [draw]);

  // size the backing store to the box (DPR capped at 2); redraw only on change
  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      frame.current = { w: width, h: height, r: radius(width, height, zoom.current) };
      draw();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [draw]);

  useEffect(schedule, [hover, selected, fields, schedule]);

  const applyZoom = (z: number) => {
    zoom.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const f = frame.current;
    frame.current = { ...f, r: radius(f.w, f.h, zoom.current) };
  };

  const setZoom = useCallback(
    (z: number) => {
      applyZoom(z);
      setZoomShown(zoom.current);
      schedule();
    },
    [schedule],
  );

  const rotate = useCallback(
    (dRa: number, dDec: number) => {
      const v = view.current;
      view.current = { ra: wrap(v.ra + dRa), dec: clampDec(v.dec + dDec) };
      schedule();
    },
    [schedule],
  );

  /** Ease to a target view; jumps under reduced motion. */
  const flyTo = useCallback(
    (target: View, z: number) => {
      cancelAnimationFrame(raf.current);
      if (reduced()) {
        view.current = target;
        setZoom(z);
        return;
      }
      const from = { ...view.current, z: zoom.current };
      const dRa = ((target.ra - from.ra + 540) % 360) - 180;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 900);
        const k = 1 - Math.pow(1 - t, 3);
        view.current = { ra: wrap(from.ra + dRa * k), dec: from.dec + (target.dec - from.dec) * k };
        applyZoom(from.z * Math.pow(z / from.z, k));
        draw();
        if (t < 1) raf.current = requestAnimationFrame(step);
        else setZoomShown(zoom.current);
      };
      raf.current = requestAnimationFrame(step);
    },
    [draw, setZoom],
  );

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? new DOMRect();
    const f = frame.current;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, x: (sx - f.w / 2) / f.r, y: -(sy - f.h / 2) / f.r };
  };

  const hit = (sx: number, sy: number) => {
    const f = frame.current;
    let best: FieldSummary | null = null;
    let bestD = 16;
    for (const fld of fields ?? []) {
      const [x, y, z] = project(radec(fld.ra_deg, fld.dec_deg), view.current);
      if (z <= 0) continue;
      const d = Math.hypot(f.w / 2 + x * f.r - sx, f.h / 2 - y * f.r - sy);
      if (d < bestD) [best, bestD] = [fld, d];
    }
    return best;
  };

  // drag turns the sky; release keeps a little momentum unless motion is reduced
  const drag = useRef<{
    x: number;
    y: number;
    t: number;
    vx: number;
    vy: number;
    moved: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    cancelAnimationFrame(raf.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toLocal(e);
    setPointer(unproject(p.x, p.y, view.current));
    const d = drag.current;
    if (!d) {
      setHover(hit(p.sx, p.sy));
      return;
    }
    const k = 180 / Math.PI / frame.current.r;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const now = performance.now();
    const dt = Math.max(1, now - d.t);
    d.vx = (dx * k) / dt;
    d.vy = (dy * k) / dt;
    d.moved += Math.abs(dx) + Math.abs(dy);
    Object.assign(d, { x: e.clientX, y: e.clientY, t: now });
    rotate(dx * k, dy * k);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved < 4) {
      const p = toLocal(e);
      const f = hit(p.sx, p.sy);
      if (f) setSelected(f);
      return;
    }
    if (reduced() || performance.now() - d.t > 80) return;
    let { vx, vy } = d;
    let last = performance.now();
    const coast = (now: number) => {
      const dt = now - last;
      last = now;
      rotate(vx * dt, vy * dt);
      vx *= Math.pow(0.995, dt);
      vy *= Math.pow(0.995, dt);
      // the loop ends by itself once the sky has settled
      if (Math.hypot(vx, vy) > 0.0005) raf.current = requestAnimationFrame(coast);
    };
    raf.current = requestAnimationFrame(coast);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 6 / zoom.current;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => rotate(step, 0),
      ArrowRight: () => rotate(-step, 0),
      ArrowUp: () => rotate(0, step),
      ArrowDown: () => rotate(0, -step),
      '+': () => setZoom(zoom.current * 1.4),
      '=': () => setZoom(zoom.current * 1.4),
      '-': () => setZoom(zoom.current / 1.4),
      '0': () => flyTo(HOME, 1),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  };

  // non-passive so zooming the globe does not also scroll the page
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(zoom.current * Math.exp(-e.deltaY * 0.0015));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const go = (f: FieldSummary) => {
    setSelected(f);
    flyTo({ ra: f.ra_deg, dec: f.dec_deg }, 40);
  };

  const size = selected ? ((selected.radius_arcsec * 2) / 60).toFixed(1) : '';

  return (
    <main className="page globe-page">
      <header className="page-head">
        <h1>The sky SPHEREx maps</h1>
        <p className="lede">
          SPHEREx photographs the entire sky every six months. This globe is the sky as seen from
          Earth, with the fields PARALLAX has pulled from the NASA archive. Drag to turn it, scroll
          or use the buttons to zoom, and pick a field to open its observations.
        </p>
      </header>

      <div className="globe-layout">
        <div className="globe-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label="Celestial globe. Arrow keys turn it, plus and minus zoom, 0 returns to the whole sky. The same fields are listed beside the globe."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onPointerLeave={() => {
              setHover(null);
              setPointer(null);
            }}
            onKeyDown={onKeyDown}
            style={{ cursor: hover ? 'pointer' : 'grab' }}
          />
          {hover && hover.manifest_id !== selected?.manifest_id && (
            <p className="globe-tip">
              {hover.title}
              <span className="dim"> · click to select</span>
            </p>
          )}
          <div className="globe-tools">
            <button type="button" onClick={() => setZoom(zoom.current * 1.6)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => setZoom(zoom.current / 1.6)} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => flyTo(HOME, 1)}>
              <Icon name="reset" /> Whole sky
            </button>
          </div>
          <p className="globe-readout mono small" aria-hidden="true">
            {pointer
              ? `RA ${pointer.ra.toFixed(2)}°  Dec ${pointer.dec >= 0 ? '+' : ''}${pointer.dec.toFixed(2)}°`
              : 'ICRS · seen from inside, east left'}
            <span className="dim"> · ×{zoomShown.toFixed(1)}</span>
          </p>
        </div>

        <aside className="globe-side">
          <h2>Fields in this release</h2>
          {!fields && <p className="dim">Loading the field index…</p>}
          <ul className="field-cards">
            {fields?.map((f) => (
              <li key={f.manifest_id}>
                <button
                  type="button"
                  className="field-card"
                  aria-pressed={selected?.manifest_id === f.manifest_id}
                  data-kind={f.data_kind}
                  onClick={() => go(f)}
                >
                  <strong>{f.title}</strong>
                  <span className="mono small dim">
                    RA {f.ra_deg.toFixed(3)}° · Dec {f.dec_deg.toFixed(3)}°
                  </span>
                  {f.data_kind === 'simulated' && (
                    <span className="sim-tag">Simulated, not NASA data</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <section className="field-detail" aria-live="polite">
              <h3>{selected.title}</h3>
              <dl className="facts">
                <dt>Data</dt>
                <dd>
                  {selected.data_kind === 'real'
                    ? `Real SPHEREx images, ${selected.data_release}`
                    : 'Simulated test data'}
                </dd>
                <dt>Wavelength</dt>
                <dd className="mono">{selected.wavelength_um.toFixed(3)} µm</dd>
                <dt>Size</dt>
                <dd className="mono">
                  {size}′ × {size}′
                </dd>
                <dt>Dates</dt>
                <dd className="mono">{selected.observations}</dd>
                <dt>Marked changes</dt>
                <dd className="mono">{selected.candidates}</dd>
              </dl>
              <a className="button-link" href={`#${selected.manifest_id}`}>
                Open in the observatory <Icon name="arrow" />
              </a>
            </section>
          )}

          <details className="depth">
            <summary>Why are the fields at the ecliptic poles?</summary>
            <p>
              SPHEREx circles Earth over the poles and sweeps the sky in strips that all cross the
              ecliptic poles. Those two patches are photographed far more often than anywhere else,
              which makes them the best place to look for things that change.
            </p>
          </details>

          <ul className="globe-legend small">
            <li>
              <span className="key key-field" aria-hidden="true" /> SPHEREx field (real data)
            </li>
            <li>
              <span className="key key-sim" aria-hidden="true" /> Simulated test field
            </li>
            <li>
              <span className="key key-ecl" aria-hidden="true" /> Ecliptic, the Sun&apos;s yearly
              path
            </li>
            <li>
              <span className="key key-gal" aria-hidden="true" /> Plane of the Milky Way
            </li>
          </ul>
          <p className="small dim">
            Grid every 30° (2 h of right ascension). Star positions are J2000 and shown only for
            orientation; they are not SPHEREx data. Field rings are enlarged so they can be found;
            zoom in to see the true square footprint. Constellation figures are left out because
            they are not part of the data.
          </p>
        </aside>
      </div>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { ANCHORS, view, WIRES, type Camera, type Part } from './model.ts';
import { ScanDemo } from './ScanDemo.tsx';
import '../../styles/pages.css';

const HOME: Camera = { yaw: -0.6, pitch: 0.32, scale: 1 };
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name);

const SPOTS: { part: Part; title: string; plain: string; depth: string }[] = [
  {
    part: 'shields',
    title: 'Photon shields',
    plain:
      'Three nested cones block sunlight and the warm glow of Earth. Infrared is heat, so a warm telescope would drown out the faint sky it is trying to see.',
    depth:
      'The shields and radiators cool the telescope passively, with no refrigerator or coolant, to around 80 K (−193 °C); the long-wavelength detectors run colder still.',
  },
  {
    part: 'telescope',
    title: 'Telescope',
    plain:
      'A small 20 cm telescope with a very wide view: each picture covers about 3.5° × 11.3° of sky, roughly 7 × 22 full Moons.',
    depth:
      'Each pixel spans 6.15 arcseconds. SPHEREx trades sharpness for coverage: it is built to map everything rather than zoom in on one thing.',
  },
  {
    part: 'focal',
    title: 'Detectors and filters',
    plain:
      'Six infrared detectors sit behind filters whose colour changes smoothly from one edge to the other. Where a star lands on a detector decides which wavelength is measured.',
    depth:
      'Two focal-plane assemblies share the light through a dichroic beam splitter: bands 1–3 cover 0.75–2.42 µm and bands 4–6 cover 2.42–5.0 µm. Each is a 2048 × 2048 mercury-cadmium-telluride (HgCdTe) array with a linear variable filter on top.',
  },
  {
    part: 'bus',
    title: 'Spacecraft bus',
    plain:
      'The body of the spacecraft: computers, pointing control, power and the radio that sends pictures home.',
    depth:
      'It points the telescope in a careful sequence of small steps so that, over months, every patch of sky is seen through every part of the filters.',
  },
  {
    part: 'solar',
    title: 'Solar panel',
    plain:
      'A single fixed panel faces the Sun and powers everything. The shields stay between the Sun and the telescope at all times.',
    depth:
      'Because the panel and shields must always face roughly sunward, the survey sweeps the sky in great circles as the orbit carries the spacecraft around Earth.',
  },
];

export function SpacecraftPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>(HOME);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<Part>('focal');
  const [failed, setFailed] = useState(false);
  const base = Math.min(size.w, size.h) * 0.24;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // one draw per camera, size or selection change; nothing runs while idle
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      setFailed(true);
      return;
    }
    if (!size.w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, (size.w / 2) * dpr, (size.h / 2) * dpr);
    const c = { ...cam, scale: base * cam.scale };
    const cyan = css('--cyan');
    const signal = css('--signal');
    ctx.lineJoin = 'round';
    for (const w of WIRES) {
      const on = w.part === active;
      ctx.strokeStyle = on ? signal : cyan;
      ctx.globalAlpha = on ? 0.95 : 0.4;
      ctx.lineWidth = on ? 1.6 : 1;
      ctx.beginPath();
      w.pts.forEach((p, i) => {
        const s = view(p, c);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [cam, size, base, active]);

  const turn = useCallback(
    (dYaw: number, dPitch: number) =>
      setCam((c) => ({
        ...c,
        yaw: c.yaw + dYaw,
        pitch: Math.max(-1.2, Math.min(1.4, c.pitch + dPitch)),
      })),
    [],
  );
  const zoom = useCallback(
    (k: number) => setCam((c) => ({ ...c, scale: Math.max(0.6, Math.min(2.6, c.scale * k)) })),
    [],
  );

  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.0015));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const spot = SPOTS.find((s) => s.part === active) ?? (SPOTS[0] as (typeof SPOTS)[number]);
  const c = { ...cam, scale: base * cam.scale };

  return (
    <main className="page craft-page">
      <header className="page-head">
        <h1>Inside SPHEREx</h1>
        <p className="lede">
          A small, cold telescope that photographs the whole sky in 102 infrared colours. Turn the
          model and pick a part to see what it does and why it matters for finding changes.
        </p>
      </header>

      <div className="craft-layout">
        <div className="craft-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label="Schematic SPHEREx spacecraft. Drag or use arrow keys to turn it, plus and minus to zoom, 0 to reset. The labelled parts are buttons."
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              turn((e.clientX - d.x) * 0.008, (e.clientY - d.y) * 0.008);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const keys: Record<string, () => void> = {
                ArrowLeft: () => turn(-0.12, 0),
                ArrowRight: () => turn(0.12, 0),
                ArrowUp: () => turn(0, -0.1),
                ArrowDown: () => turn(0, 0.1),
                '+': () => zoom(1.2),
                '=': () => zoom(1.2),
                '-': () => zoom(1 / 1.2),
                '0': () => setCam(HOME),
              };
              const fn = keys[e.key];
              if (!fn) return;
              e.preventDefault();
              fn();
            }}
          />
          {!failed &&
            size.w > 0 &&
            SPOTS.map((s, i) => {
              const p = view(ANCHORS[s.part], c);
              return (
                <button
                  key={s.part}
                  type="button"
                  className="hotspot"
                  aria-pressed={s.part === active}
                  data-far={p.depth > 0.5}
                  style={{ left: size.w / 2 + p.x, top: size.h / 2 + p.y }}
                  onClick={() => setActive(s.part)}
                >
                  <span className="mono">{i + 1}</span>
                  <span className="visually-hidden">{s.title}</span>
                </button>
              );
            })}
          <span className="schematic-tag stage-tag">Schematic</span>
          <div className="globe-tools">
            <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => setCam(HOME)}>
              <Icon name="reset" /> Reset view
            </button>
          </div>
          {failed && (
            <p className="stage-fallback">
              This browser cannot draw the model. Every part is described in the list beside it.
            </p>
          )}
        </div>

        <aside className="craft-side">
          <ol className="part-list">
            {SPOTS.map((s, i) => (
              <li key={s.part}>
                <button
                  type="button"
                  aria-pressed={s.part === active}
                  onClick={() => setActive(s.part)}
                >
                  <span className="mono dim">{i + 1}</span> {s.title}
                </button>
              </li>
            ))}
          </ol>
          <section className="panel part-detail" aria-live="polite">
            <h2>{spot.title}</h2>
            <p>{spot.plain}</p>
            <details className="depth">
              <summary>More detail</summary>
              <p>{spot.depth}</p>
            </details>
          </section>
          <p className="small dim">
            Schematic illustration. Proportions are approximate; this is not an engineering model.
            Facts from NASA/JPL mission material and Crill et al. 2020.
          </p>
        </aside>
      </div>

      <section className="craft-survey">
        <div className="page-head">
          <h2 className="section-title">How a sky survey becomes a spectrum</h2>
          <p className="lede">
            SPHEREx circles Earth over the poles about 15 times a day, about 700 km up. It steps
            across the sky so each star is photographed many times, each time landing on a different
            part of the colour-graded filters. After six months the whole sky has been seen in all
            102 colours; the two-year mission does this four times.
          </p>
        </div>
        <ScanDemo />
      </section>
    </main>
  );
}

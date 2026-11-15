import { useEffect, useRef, useState } from 'react';
import {
  ANCHORS,
  FACES,
  shade,
  shift,
  view,
  WIRES,
  type Camera,
  type Part,
} from '../features/spacecraft/model.ts';
import { BANDS } from '../features/spectrum/channels.ts';

const HOME: Camera = { yaw: -0.6, pitch: 0.32, scale: 1 };

// copied from features/spacecraft/SpacecraftPage.tsx; move to a shared module on integration
const MATERIAL: Record<Part, [number, number, number]> = {
  shields: [233, 225, 208],
  telescope: [130, 168, 171],
  focal: [201, 144, 88],
  bus: [70, 98, 124],
  solar: [96, 128, 162],
};
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
const FOCUS: Partial<Record<Part, Camera>> = {
  focal: { yaw: -0.3, pitch: 0.9, scale: 1.9 },
  telescope: { yaw: -0.4, pitch: 0.6, scale: 1.5 },
};

/** The spacecraft as a schematic. Draws once per change; nothing runs while idle or hidden. */
export function Spacecraft(props: {
  active: boolean;
  reduced: boolean;
  onWavelengths: () => void;
  onFlipbook: (band: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>(HOME);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<Part | null>(null);
  const [explode, setExplode] = useState(0);
  const [failed, setFailed] = useState(false);
  const [demo, setDemo] = useState(0); // LVF demo: which position along the detector
  const base = Math.min(size.w, size.h) * 0.24;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return setFailed(true);
    if (!size.w || !props.active) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, (size.w / 2) * dpr, (size.h / 2) * dpr);
    const c = { ...cam, scale: base * cam.scale * (1 - 0.22 * explode) };
    const inner = active === 'telescope' || active === 'focal';
    const faces = FACES.map((f) => {
      const pts = f.pts.map((p) => shift(p, f.part, explode));
      const s = pts.map((p) => view(p, c));
      return {
        part: f.part,
        s,
        depth: s.reduce((a, p) => a + p.depth, 0) / s.length,
        lit: shade(pts, c),
      };
    }).sort((a, b) => b.depth - a.depth);
    for (const f of faces) {
      const k = 0.28 + 0.72 * f.lit;
      const [r, g, b] = MATERIAL[f.part];
      ctx.fillStyle = `rgb(${r * k},${g * k},${b * k})`;
      ctx.strokeStyle = 'rgba(10,9,8,0.4)';
      ctx.globalAlpha =
        f.part === 'shields' && inner && explode < 0.5
          ? 0.2
          : active && f.part !== active
            ? 0.55
            : 1;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      f.s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#f0a840';
    ctx.lineWidth = 1.4;
    for (const w of WIRES) {
      if (w.part !== active) continue;
      ctx.beginPath();
      w.pts.forEach((p, i) => {
        const s = view(shift(p, w.part, explode), c);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
    }
  }, [cam, size, base, active, explode, props.active]);

  // ease between cameras; jumps under reduced motion
  const camRef = useRef(cam);
  useEffect(() => {
    camRef.current = cam;
  });
  function moveTo(to: Camera, toExplode = explode) {
    if (props.reduced) {
      setCam(to);
      setExplode(toExplode);
      return;
    }
    const from = camRef.current;
    const e0 = explode;
    let t0 = -1; // the first frame's timestamp
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const k = Math.min(1, (now - t0) / 500);
      const t = 1 - 2 ** (-10 * k);
      setCam({
        yaw: from.yaw + (to.yaw - from.yaw) * t,
        pitch: from.pitch + (to.pitch - from.pitch) * t,
        scale: from.scale + (to.scale - from.scale) * t,
      });
      setExplode(e0 + (toExplode - e0) * t);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function focus(p: Part) {
    setActive(p);
    moveTo(FOCUS[p] ?? { ...HOME, scale: 1.2 }, p === 'focal' ? 1 : explode);
  }
  const overview = () => (setActive(null), moveTo(HOME, 0));

  const turn = (dy: number, dp: number) =>
    setCam((c) => ({ ...c, yaw: c.yaw + dy, pitch: Math.max(-1.2, Math.min(1.4, c.pitch + dp)) }));
  const drag = useRef<{ x: number; y: number } | null>(null);
  const spot = SPOTS.find((s) => s.part === active);
  const c = { ...cam, scale: base * cam.scale * (1 - 0.22 * explode) };
  const band = BANDS[Math.min(BANDS.length - 1, Math.floor(demo / 17))];

  return (
    <div className="craft" aria-labelledby="craft-h">
      <header className="flip-head">
        <h1 id="craft-h">Spacecraft</h1>
        <p className="muted">How SPHEREx takes the pictures you have been looking at.</p>
      </header>
      <div className="craft-body">
        <div className="craft-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label="Schematic SPHEREx spacecraft. Drag or use the arrow keys to turn it. The parts are listed as buttons."
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
              const k: Record<string, [number, number]> = {
                ArrowLeft: [-0.12, 0],
                ArrowRight: [0.12, 0],
                ArrowUp: [0, -0.1],
                ArrowDown: [0, 0.1],
              };
              const d = k[e.key];
              if (!d) return;
              e.preventDefault();
              turn(...d);
            }}
          />
          {!failed &&
            size.w > 0 &&
            SPOTS.map((s, i) => {
              const p = view(shift(ANCHORS[s.part], s.part, explode), c);
              return (
                <button
                  key={s.part}
                  className="hotspot"
                  aria-pressed={s.part === active}
                  aria-label={s.title}
                  data-far={p.depth > 0.5 ? '' : undefined}
                  style={{ left: size.w / 2 + p.x, top: size.h / 2 + p.y }}
                  onClick={() => focus(s.part)}
                >
                  {i + 1}
                </button>
              );
            })}
          <span className="flip-tag">Schematic · not its orientation at any observation</span>
          <div className="zoom zoom-text craft-tools" role="group" aria-label="Model view">
            <button onClick={overview} disabled={!active && explode === 0}>
              Overview
            </button>
            <button onClick={() => moveTo(cam, explode > 0.5 ? 0 : 1)} aria-pressed={explode > 0.5}>
              {explode > 0.5 ? 'Assemble' : 'Pull apart'}
            </button>
            <button onClick={() => (setActive(null), setCam(HOME), setExplode(0))}>Reset</button>
          </div>
          {failed && (
            <p className="flip-state">
              This browser cannot draw the model; every part is listed beside it.
            </p>
          )}
        </div>

        <div className="flip-panel">
          <ol className="parts">
            {SPOTS.map((s, i) => (
              <li key={s.part}>
                <button aria-pressed={s.part === active} onClick={() => focus(s.part)}>
                  <span className="muted">{i + 1}</span> {s.title}
                </button>
              </li>
            ))}
          </ol>
          <section className="block" aria-live="polite">
            {spot ? (
              <>
                <h2>{spot.title}</h2>
                <p>{spot.plain}</p>
                <details>
                  <summary>More detail</summary>
                  <p>{spot.depth}</p>
                </details>
              </>
            ) : (
              <p className="note">Choose a numbered part to look closer.</p>
            )}
          </section>

          {active === 'focal' && band && (
            <section className="block" aria-labelledby="lvf-h">
              <h2 id="lvf-h">Demo: one detector, many wavelengths</h2>
              <div className="lvf" aria-hidden="true">
                {BANDS.map((b) => (
                  <span key={b.detector} data-on={b === band ? '' : undefined}>
                    D{b.detector}
                  </span>
                ))}
              </div>
              <label className="slider">
                <span>Where the light lands, across all six detectors</span>
                <input
                  type="range"
                  min={0}
                  max={BANDS.length * 17 - 1}
                  value={demo}
                  aria-valuetext={`Detector ${band.detector}`}
                  onChange={(e) => setDemo(Number(e.target.value))}
                />
              </label>
              <p>
                Detector {band.detector} covers {band.min}–{band.max} µm. Move across it and the
                filter passes a slightly longer wavelength at each step, so a star stepped across
                the detector is measured at many wavelengths.
              </p>
              <p className="note">
                Illustrative and labelled so: the published band ranges, not a map of real pixel
                positions on any detector.
              </p>
              <div className="row">
                <button onClick={props.onWavelengths}>Change the sky’s wavelength</button>
                <button onClick={() => props.onFlipbook(`D${band.detector}`)}>
                  Real D{band.detector} exposures in the Flipbook
                </button>
              </div>
            </section>
          )}
          <p className="note">
            Schematic illustration; proportions are approximate. Facts from NASA/JPL mission
            material and Crill et al. 2020.
          </p>
        </div>
      </div>
    </div>
  );
}

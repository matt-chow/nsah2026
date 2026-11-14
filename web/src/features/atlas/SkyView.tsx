import { memo, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDec, formatRa, pixelToSky, skyToPixel } from '../../lib/sky.ts';
import type { FieldSummary } from '../../types/manifest.ts';
import {
  bandChannel,
  CUBE_ORDER,
  displayKey,
  loadDisplayTile,
  loadPlane,
  peekDisplay,
  TILE_BITS,
  type CubeInfo,
  type Plane,
} from './hips.ts';
import {
  geometry,
  lut,
  orderFor,
  paintDisplay,
  paintRgb,
  paintScalar,
  percentiles,
  sample,
  unstretch,
  viewWcs,
  type Clip,
  type Geometry,
  type View,
} from './render.ts';
import { FOV_RANGE, type AtlasState } from './state.ts';

const MAX_VALUE_TILES = 4; // cube tiles per layer (1 MiB each) a numeric view may read
export const MAX_VALUE_FOV = 3; // degrees; wider views would touch more than a few cube tiles
const AUTO_CLIP = [1, 99.5]; // percentiles

export const layerLabel = (info: CubeInfo, f: number) => {
  const { band, channel } = bandChannel(f);
  return `${(info.wavelengths[f] ?? NaN).toFixed(3)} µm · band ${band}, channel ${channel}`;
};

type Status = { tone: 'busy' | 'ok' | 'warn' | 'error'; text: string };
interface Shown {
  view: View;
  g: Geometry;
  tiles?: (Uint8Array | null | undefined)[]; // mosaic
  values?: Float32Array[]; // one per channel (values: 1, rgb: 3)
}

/** A request cancelled by a superseded render is retried once for the render that still wants it. */
async function fresh<T>(signal: AbortSignal, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (signal.aborted || !(e instanceof DOMException && e.name === 'AbortError')) throw e;
    return load();
  }
}

const clampFov = (f: number) => Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], f));

interface Props {
  info: CubeInfo;
  state: AtlasState;
  fields: FieldSummary[] | null;
  onView: (v: View) => void;
}

export const SkyView = memo(function SkyView({ info, state, fields, onView }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef<{ canvas: HTMLCanvasElement; view: View } | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const readoutRef = useRef<HTMLOutputElement>(null);
  const dragRef = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const pendingRef = useRef<View | null>(null);
  const wheelTimer = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [status, setStatus] = useState<Status>({ tone: 'busy', text: 'Preparing the view…' });
  const [clips, setClips] = useState<Clip[]>([]);
  const [manualClip, setManualClip] = useState<Clip | null>(null);
  const [sources, setSources] = useState<Plane[]>([]);
  const [tooWide, setTooWide] = useState(false);
  const { ra, dec, fov, mode, frame, rgb, cmap, stretch } = state;
  const [r0, g0, b0] = rgb;

  // a hand-set clip belongs to one layer; changing layer or mode returns to automatic
  const layerKey = `${mode}/${frame}`;
  const [clipLayer, setClipLayer] = useState(layerKey);
  if (clipLayer !== layerKey) {
    setClipLayer(layerKey);
    setManualClip(null);
  }

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.min(1100, Math.round(el.clientWidth));
      setSize((s) =>
        s.w === w ? s : { w, h: Math.max(300, Math.min(620, Math.round(w * 0.58))) },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Instant feedback while dragging or zooming: the last full render, moved and scaled. */
  function preview(v: View) {
    const ctx = canvasRef.current?.getContext('2d');
    const snap = snapRef.current;
    const { w, h } = size;
    if (!ctx || !snap || snap.canvas.width !== w || snap.canvas.height !== h) return;
    const p = skyToPixel(viewWcs(snap.view, w, h), v.ra, v.dec);
    const cx = p.x;
    const cy = h - 1 - p.y;
    if (!Number.isFinite(cx) || Math.abs(cx) > 10 * w || Math.abs(cy) > 10 * h) return;
    const s = snap.view.fov / v.fov;
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(s, 0, 0, s, (w - 1) / 2 - s * cx, (h - 1) / 2 - s * cy);
    ctx.drawImage(snap.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w, h } = size;
    if (!canvas || !ctx || w === 0) return;
    const view: View = { ra, dec, fov };
    const ctrl = new AbortController();
    const { signal } = ctrl;
    preview(view);

    const finish = (img: ImageData, shown: Shown) => {
      if (signal.aborted) return;
      ctx.putImageData(img, 0, 0);
      drawOverlay(ctx, view, w, h, fields);
      const snap = snapRef.current?.canvas ?? document.createElement('canvas');
      snap.width = w;
      snap.height = h;
      snap.getContext('2d')?.drawImage(canvas, 0, 0);
      snapRef.current = { canvas: snap, view };
      shownRef.current = shown;
    };

    const render = async () => {
      const img = ctx.createImageData(w, h);
      if (mode === 'mosaic') {
        setTooWide(false);
        setSources([]);
        const order = orderFor(fov, w, TILE_BITS, info.orderMin, info.orderMax);
        const g = geometry(view, w, h, order, TILE_BITS, true);
        const map = lut(cmap);
        const keys = g.tiles.map((t) => displayKey(order, t, frame));
        const blank = info.blank.has(frame);
        let raf = 0;
        const paint = () => {
          raf = 0;
          const tiles = keys.map((k) => (blank ? null : peekDisplay(k)));
          paintDisplay(g, tiles, map, img.data);
          finish(img, { view, g, tiles });
        };
        paint();
        if (blank) {
          setStatus({
            tone: 'warn',
            text: `Layer ${frame} (${layerLabel(info, frame)}) is blank in this release: IRSA publishes no data for the dichroic channels. Hatching marks the absence; it is not dark sky.`,
          });
          return;
        }
        const todo = g.tiles.filter((_, i) => peekDisplay(keys[i] as string) === undefined);
        let done = 0;
        let failed = 0;
        const report = () =>
          setStatus(
            failed
              ? {
                  tone: 'error',
                  text: `${failed} of ${g.tiles.length} tiles failed to load from IRSA. Pan or zoom to retry.`,
                }
              : done < todo.length
                ? {
                    tone: 'busy',
                    text: `Loading ${todo.length - done} of ${g.tiles.length} mosaic tiles from IRSA…`,
                  }
                : {
                    tone: 'ok',
                    text: `IRSA display mosaic, order ${order}, ${g.tiles.length} tile${g.tiles.length === 1 ? '' : 's'}.`,
                  },
          );
        report();
        await Promise.all(
          todo.map((t) =>
            fresh(signal, () => loadDisplayTile(order, t, frame, signal)).then(
              () => {
                done++;
                if (!signal.aborted && !raf) raf = requestAnimationFrame(paint);
              },
              () => {
                if (!signal.aborted) failed++;
              },
            ),
          ),
        );
        if (!signal.aborted) report();
        return;
      }

      // numeric modes: float32 cube planes, order 5 only
      const frames = mode === 'values' ? [frame] : [r0, g0, b0];
      const wide = fov > MAX_VALUE_FOV;
      const g = wide ? null : geometry(view, w, h, CUBE_ORDER, TILE_BITS, false);
      if (!g || g.tiles.length > MAX_VALUE_TILES) {
        setTooWide(true);
        setSources([]);
        ctx.clearRect(0, 0, w, h);
        snapRef.current = null;
        shownRef.current = null;
        setStatus({
          tone: 'warn',
          text: `Measured values are read from 1 MiB cube tiles, at most ${MAX_VALUE_TILES} per layer. This view needs ${g ? g.tiles.length : 'more'}; zoom in (≤ ${MAX_VALUE_FOV}°) to load them.`,
        });
        return;
      }
      setTooWide(false);
      const blanks = frames.filter((f) => info.blank.has(f));
      if (blanks.length) {
        ctx.clearRect(0, 0, w, h);
        shownRef.current = null;
        setSources([]);
        setStatus({
          tone: 'warn',
          text: `${blanks.map((f) => layerLabel(info, f)).join(' and ')}: blank in this release (dichroic channel), so there is nothing to measure. Choose another layer.`,
        });
        return;
      }
      const total = frames.length * g.tiles.length;
      let done = 0;
      setStatus({
        tone: 'busy',
        text: `Reading ${total} layer tile${total === 1 ? '' : 's'} (1 MiB each) from IRSA's cube…`,
      });
      let planes: Plane[][];
      try {
        planes = await Promise.all(
          frames.map((f) =>
            Promise.all(
              g.tiles.map((t) =>
                fresh(signal, () => loadPlane(info, t, f, signal)).then((p) => {
                  done++;
                  if (!signal.aborted)
                    setStatus({
                      tone: 'busy',
                      text: `Read ${done} of ${total} layer tiles (1 MiB each)…`,
                    });
                  return p;
                }),
              ),
            ),
          ),
        );
      } catch (e) {
        if (!signal.aborted)
          setStatus({
            tone: 'error',
            text: `IRSA's cube could not be read (${e instanceof Error ? e.message : String(e)}). Try again shortly.`,
          });
        return;
      }
      if (signal.aborted) return;
      const values = planes.map((ps) =>
        sample(
          g,
          ps.map((p) => p.values),
        ),
      );
      const auto = values.map((v) => {
        const p = percentiles(v, AUTO_CLIP);
        return p ? { lo: p[0] as number, hi: p[1] as number } : null;
      });
      if (auto.some((c) => c === null)) {
        ctx.clearRect(0, 0, w, h);
        paintScalar(values[0] as Float32Array, w, { lo: 0, hi: 1 }, stretch, lut(cmap), img.data);
        finish(img, { view, g, values });
        setClips([]);
        setSources(planes.flat());
        setStatus({
          tone: 'warn',
          text: 'The archive has no measured values anywhere in this view at this layer (hatched). This is missing coverage, not a measurement of zero.',
        });
        return;
      }
      const used = auto as Clip[];
      let missing = 0;
      if (mode === 'values') {
        const c = manualClip ?? (used[0] as Clip);
        paintScalar(values[0] as Float32Array, w, c, stretch, lut(cmap), img.data);
        for (const v of values[0] as Float32Array) if (Number.isNaN(v)) missing++;
        setClips([c]);
      } else {
        missing = paintRgb(
          values as [Float32Array, Float32Array, Float32Array],
          w,
          used as [Clip, Clip, Clip],
          stretch,
          img.data,
        );
        setClips(used);
      }
      finish(img, { view, g, values });
      setSources(planes.flat());
      const pct = (100 * missing) / (w * h);
      setStatus({
        tone: 'ok',
        text: `Measured surface brightness, ${g.tiles.length} cube tile${g.tiles.length === 1 ? '' : 's'}${missing ? `; ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of the view has no data (hatched)` : ''}.`,
      });
    };

    const t = window.setTimeout(() => void render(), 60);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview reads the latest size itself
  }, [ra, dec, fov, mode, frame, r0, g0, b0, cmap, stretch, size, info, fields, manualClip]);

  // --- interaction: previews move the last image; the committed view triggers a full render ---

  const current = () => pendingRef.current ?? { ra, dec, fov };
  const commit = (v: View) => {
    pendingRef.current = null;
    onView({
      ra: ((v.ra % 360) + 360) % 360,
      dec: Math.max(-90, Math.min(90, v.dec)),
      fov: clampFov(v.fov),
    });
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const s = r && r.width ? size.w / r.width : 1;
    return { x: (e.clientX - (r?.left ?? 0)) * s, y: (e.clientY - (r?.top ?? 0)) * s };
  };
  /** The view whose centre is the sky at screen point (x, y) of view v. */
  const centredAt = (v: View, x: number, y: number, f = v.fov): View => {
    const sky = pixelToSky(viewWcs(v, size.w, size.h), x, size.h - 1 - y);
    return { ...sky, fov: f };
  };

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ...local(e), view: current(), moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    const d = dragRef.current;
    if (d) {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const v = centredAt(d.view, (size.w - 1) / 2 - dx, (size.h - 1) / 2 - dy);
      pendingRef.current = v;
      preview(v);
      return;
    }
    readout(p.x, p.y);
  }
  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved && pendingRef.current) commit(pendingRef.current);
    else {
      const p = local(e);
      commit(centredAt(d.view, p.x, p.y)); // click: centre the view (and the search position) here
    }
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = current();
      const f = clampFov(v.fov * 1.15 ** (e.deltaY / (e.deltaMode ? 1 : 100)));
      const p = local(e);
      // keep the sky under the cursor fixed: the new centre sits (f / fov) of the way from it
      const k = f / v.fov;
      const c = { x: (size.w - 1) / 2, y: (size.h - 1) / 2 };
      const next = centredAt(v, p.x + (c.x - p.x) * k, p.y + (c.y - p.y) * k, f);
      pendingRef.current = next;
      preview(next);
      clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(
        () => pendingRef.current && commit(pendingRef.current),
        150,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const v = current();
    const step = 0.1 * size.w;
    const c = { x: (size.w - 1) / 2, y: (size.h - 1) / 2 };
    const moves: Record<string, () => View> = {
      ArrowLeft: () => centredAt(v, c.x - step, c.y),
      ArrowRight: () => centredAt(v, c.x + step, c.y),
      ArrowUp: () => centredAt(v, c.x, c.y - step),
      ArrowDown: () => centredAt(v, c.x, c.y + step),
      '+': () => ({ ...v, fov: v.fov / 1.5 }),
      '=': () => ({ ...v, fov: v.fov / 1.5 }),
      '-': () => ({ ...v, fov: v.fov * 1.5 }),
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    commit(m());
  }

  /** Hover readout, written straight to the DOM: no React state per pointer move. */
  function readout(x: number, y: number) {
    const out = readoutRef.current;
    const s = shownRef.current;
    if (!out) return;
    if (!s || s.g.w !== size.w || x < 0 || y < 0 || x >= size.w || y >= size.h)
      return void (out.textContent = '');
    const sky = pixelToSky(viewWcs(s.view, size.w, size.h), x, size.h - 1 - y);
    const i = Math.floor(y) * size.w + Math.floor(x);
    const where = `RA ${formatRa(sky.ra)}  Dec ${formatDec(sky.dec)}  (${sky.ra.toFixed(4)}°, ${sky.dec.toFixed(4)}°)`;
    let what = '';
    if (s.tiles) {
      const t = s.tiles[s.g.slot[i] as number];
      const b = t ? (t[s.g.offset[i] as number] as number) : t === null ? 0 : -1;
      what =
        b < 0
          ? 'loading'
          : b === 0
            ? 'no data'
            : `display level ${b - 1} of 254 (picture only, not a measurement)`;
    } else if (s.values) {
      const fmt = (v: number) => (Number.isNaN(v) ? 'no data' : `${v.toPrecision(4)} MJy/sr`);
      const fr = mode === 'values' ? [frame] : [r0, g0, b0];
      what = s.values
        .map(
          (v, k) =>
            `${mode === 'rgb' ? `${'RGB'[k]} ` : ''}${(info.wavelengths[fr[k] as number] ?? NaN).toFixed(3)} µm: ${fmt(v[i] as number)}`,
        )
        .join('  ·  ');
    }
    out.textContent = `${where}  —  ${what}`;
  }

  const nav = (v: View) => commit(v);
  return (
    <div className="atlas-view">
      <div className="atlas-canvas" ref={wrapRef} style={{ height: size.h || undefined }}>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          tabIndex={0}
          aria-label={`Sky map centred on RA ${ra.toFixed(4)}°, Dec ${dec.toFixed(4)}°, ${fov.toPrecision(3)}° wide. Drag or use arrow keys to pan, scroll or plus and minus to zoom, click to centre.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (dragRef.current = null)}
          onPointerLeave={() =>
            !dragRef.current && readoutRef.current && (readoutRef.current.textContent = '')
          }
          onKeyDown={onKeyDown}
        />
        {tooWide && (
          <div className="atlas-overlay">
            <p>
              Measured values need a narrower view: at most {MAX_VALUE_FOV}° wide and touching at
              most 4 cube tiles.
            </p>
            <button type="button" className="primary" onClick={() => nav({ ra, dec, fov: 1.5 })}>
              Zoom to 1.5°
            </button>
          </div>
        )}
        <span className="atlas-cross" aria-hidden="true" />
      </div>
      <div className="atlas-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          onClick={() => nav({ ra, dec, fov: clampFov(fov / 1.5) })}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => nav({ ra, dec, fov: clampFov(fov * 1.5) })}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="mono">
          {fov < 1 ? `${(fov * 60).toPrecision(3)}′` : `${fov.toPrecision(3)}°`} wide
        </span>
      </div>
      <output ref={readoutRef} className="atlas-readout mono" aria-live="off" />
      <p className={`atlas-status ${status.tone}`} role="status" aria-live="polite">
        {status.tone === 'busy' && <span className="spinner" aria-hidden="true" />} {status.text}
      </p>
      <Legend info={info} state={state} clips={clips} manual={manualClip} onClip={setManualClip} />
      {sources.length > 0 && <Sources planes={sources} />}
    </div>
  );
});

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  v: View,
  w: number,
  h: number,
  fields: FieldSummary[] | null,
) {
  const wcs = viewWcs(v, w, h);
  ctx.save();
  ctx.font = '12px "IBM Plex Mono", monospace';
  for (const f of fields ?? []) {
    if (f.data_kind !== 'real') continue;
    const p = skyToPixel(wcs, f.ra_deg, f.dec_deg);
    const r = f.radius_arcsec / 3600 / (v.fov / w);
    const x = p.x;
    const y = h - 1 - p.y;
    if (!Number.isFinite(x) || x < -r || x > w + r || y < -r || y > h + r) continue;
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.95)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, 6), 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120, 220, 255, 0.95)';
    ctx.fillText(`${f.manifest_id}: prepared time series`, x + Math.max(r, 6) + 4, y);
  }
  ctx.restore();
}

const Legend = memo(function Legend({
  info,
  state,
  clips,
  manual,
  onClip,
}: {
  info: CubeInfo;
  state: AtlasState;
  clips: Clip[];
  manual: Clip | null;
  onClip: (c: Clip | null) => void;
}) {
  const map = lut(state.cmap);
  const stops = Array.from({ length: 9 }, (_, i) => {
    const k = Math.round((i / 8) * 255) * 3;
    return `rgb(${map[k]},${map[k + 1]},${map[k + 2]}) ${(i / 8) * 100}%`;
  });
  const bar = (
    <span
      className="legend-bar"
      style={{ background: `linear-gradient(to right, ${stops.join(',')})` }}
    />
  );
  const missing = (
    <span className="legend-missing">
      <span className="hatch-swatch" aria-hidden="true" /> no data (not zero)
    </span>
  );
  if (state.mode === 'mosaic')
    return (
      <div className="atlas-legend">
        <p className="legend-kind">Visualization</p>
        {bar}
        <div className="legend-ticks mono">
          <span>{info.cut[0]}</span>
          <span>{info.cut[1]} MJy/sr</span>
        </div>
        <p className="legend-note">
          IRSA's pre-rendered 8-bit tiles ({info.pixelFunction} stretch, cut {info.cut[0]}–
          {info.cut[1]} MJy/sr), recoloured here. Brightness is a picture, not a measurement: switch
          to <em>Measured values</em> for numbers.
        </p>
        {missing}
      </div>
    );
  if (state.mode === 'rgb')
    return (
      <div className="atlas-legend">
        <p className="legend-kind">Visualization of measured values</p>
        <p className="legend-rgb-title">Infrared wavelengths mapped to visible colours.</p>
        <ul className="legend-rgb mono">
          {(['R', 'G', 'B'] as const).map((c, k) => (
            <li key={c}>
              <span className={`rgb-dot ${c}`} aria-hidden="true" /> {c} ={' '}
              {layerLabel(info, state.rgb[k] as number)}
              {clips[k] &&
                ` · clip ${clips[k].lo.toPrecision(3)}–${clips[k].hi.toPrecision(3)} MJy/sr`}
            </li>
          ))}
        </ul>
        <p className="legend-note">
          Each channel is clipped to its own {AUTO_CLIP[0]}st–{AUTO_CLIP[1]}th percentile in this
          view, then {state.stretch}-stretched, so colours compare brightness <em>within</em> a
          channel, not between them. A pixel missing in any channel is hatched.
        </p>
        {missing}
      </div>
    );
  const c = clips[0];
  return (
    <div className="atlas-legend">
      <p className="legend-kind">Measurement · {layerLabel(info, state.frame)}</p>
      {bar}
      {c && (
        <div className="legend-ticks mono">
          {[0, 0.25, 0.5, 0.75, 1].map((y) => (
            <span key={y}>{unstretch(y, c.lo, c.hi, state.stretch).toPrecision(3)}</span>
          ))}
        </div>
      )}
      <p className="legend-note">
        Surface brightness in MJy/sr,{' '}
        {manual
          ? 'your clip'
          : `clipped to the ${AUTO_CLIP[0]}st–${AUTO_CLIP[1]}th percentile of this view`}
        , {state.stretch} stretch. Values outside the clip are drawn at the ends of the bar but kept
        unchanged in the readout.
      </p>
      {c && (
        <ClipEditor key={`${c.lo}/${c.hi}`} clip={c} manual={manual !== null} onClip={onClip} />
      )}
      {missing}
    </div>
  );
});

function ClipEditor({
  clip,
  manual,
  onClip,
}: {
  clip: Clip;
  manual: boolean;
  onClip: (c: Clip | null) => void;
}) {
  const [lo, setLo] = useState(clip.lo.toPrecision(4));
  const [hi, setHi] = useState(clip.hi.toPrecision(4));
  const valid = Number(lo) < Number(hi) && lo.trim() !== '' && hi.trim() !== '';
  return (
    <form
      className="clip-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onClip({ lo: Number(lo), hi: Number(hi) });
      }}
    >
      <label>
        Low{' '}
        <input
          className="mono"
          inputMode="decimal"
          value={lo}
          onChange={(e) => setLo(e.target.value)}
        />
      </label>
      <label>
        High{' '}
        <input
          className="mono"
          inputMode="decimal"
          value={hi}
          onChange={(e) => setHi(e.target.value)}
        />
      </label>
      <button type="submit" disabled={!valid}>
        Apply clip
      </button>
      {manual && (
        <button type="button" onClick={() => onClip(null)}>
          Auto
        </button>
      )}
    </form>
  );
}

const Sources = memo(function Sources({ planes }: { planes: Plane[] }) {
  const tiles = [...new Map(planes.map((p) => [p.npix, p])).values()];
  const mjd = planes.flatMap((p) => [p.mjdBeg, p.mjdEnd]).filter((m): m is number => m !== null);
  return (
    <details className="atlas-sources">
      <summary>
        Provenance: {tiles.length} cube tile{tiles.length === 1 ? '' : 's'}, unit {planes[0]?.bunit}
      </summary>
      <ul className="mono">
        {tiles.map((p) => (
          <li key={p.npix}>
            <a href={p.source} rel="noreferrer">
              {p.source.split('/').slice(-3).join('/')}
            </a>
          </li>
        ))}
      </ul>
      {mjd.length > 0 && (
        <p>
          Inputs observed MJD {Math.min(...mjd).toFixed(2)} – {Math.max(...mjd).toFixed(2)}. Each
          cube pixel combines many exposures across that span: it is one spectral image, not a time
          series.
        </p>
      )}
    </details>
  );
});

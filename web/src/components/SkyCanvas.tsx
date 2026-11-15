import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon.tsx';
import { loadImage } from '../lib/imageCache.ts';
import {
  decodeSigma,
  divergingRgb,
  formatDec,
  formatRa,
  pixelToSky,
  type TanWcs,
} from '../lib/sky.ts';
import type { Candidate, CandidateKind } from '../types/manifest.ts';

export type Layer =
  | { kind: 'image'; src: string }
  | { kind: 'overlay'; src: string; over: string; opacity: number }
  | { kind: 'split'; src: string; over: string; at: number; labels: [string, string] }
  | { kind: 'difference'; src: string; range: number };

/** Display-only brightness/contrast on the archive PNG; never applied to difference maps. */
export const STRETCH = {
  archive: { label: 'As archived', filter: 'none' },
  faint: { label: 'Bring out faint detail', filter: 'brightness(1.7) contrast(1.15)' },
  bright: { label: 'Tame bright stars', filter: 'brightness(0.8) contrast(1.5)' },
} as const;
export type Stretch = keyof typeof STRETCH;

interface Props {
  layer: Layer;
  label: string;
  width: number; // grid size in pixels (all layers share it)
  height: number;
  wcs: TanWcs | null;
  candidates: Candidate[];
  activeEpochId: string;
  selectedId: string | null;
  onPick: (id: string) => void;
  pin: { x: number; y: number } | null;
  focus: { x: number; y: number; nonce: number } | null;
  pixelScale: number; // arcsec per image pixel
  stretch: Stretch;
  loupe: boolean;
  /** Any click (or Enter, at the view centre) as a FITS pixel position, for point-and-click tasks. */
  onPoint?: (x: number, y: number) => void;
}

const NICE_ARCSEC = [10, 20, 30, 60, 120, 300, 600, 900];
/** Longest round angle whose bar fits in about 120 screen px. */
function scaleBar(arcsecPerScreenPx: number) {
  const a = [...NICE_ARCSEC].reverse().find((n) => n / arcsecPerScreenPx <= 120) ?? 10;
  return { px: a / arcsecPerScreenPx, text: a >= 60 ? `${a / 60}′` : `${a}″` };
}

type View = { scale: number; cx: number; cy: number }; // cx/cy: image px at the canvas centre
type Source = CanvasImageSource & { width: number; height: number };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 64;
const colourised = new Map<string, Promise<HTMLCanvasElement>>();

/** Recolour the encoded significance PNG once per URL; returns a canvas of the same size. */
function diffCanvas(src: string): Promise<HTMLCanvasElement> {
  let p = colourised.get(src);
  if (!p) {
    p = loadImage(src).then((img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = divergingRgb(px[i] ?? 0);
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      return c;
    });
    colourised.set(src, p);
    p.catch(() => colourised.delete(src));
  }
  return p;
}

/** Raw significance bytes, kept for the cursor readout in difference mode. */
const bytesCache = new Map<string, Promise<Uint8ClampedArray>>();
function diffBytes(src: string): Promise<Uint8ClampedArray> {
  let p = bytesCache.get(src);
  if (!p) {
    p = loadImage(src).then((img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    });
    bytesCache.set(src, p);
    p.catch(() => bytesCache.delete(src));
  }
  return p;
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: CandidateKind,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  if (kind === 'new_source_like') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (kind === 'variable_like') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else if (kind === 'dipole_like') {
    ctx.moveTo(x, y - r * 1.25);
    ctx.lineTo(x + r * 1.25, y);
    ctx.lineTo(x, y + r * 1.25);
    ctx.lineTo(x - r * 1.25, y);
    ctx.closePath();
  } else {
    const d = r * 0.8;
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
  }
  ctx.stroke();
}

export const SkyCanvas = memo(function SkyCanvas(props: Props) {
  const { layer, label, width, height, wcs, candidates, activeEpochId, selectedId, onPick } = props;
  const { pixelScale, stretch, loupe } = props;
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === wrapRef.current) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      setFullscreenError('Fullscreen is unavailable in this browser. You can still zoom and pan.');
    }
  };
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sources, setSources] = useState<{ key: string; a: Source; b: Source | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [readout, setReadout] = useState<string>('');
  const sigRef = useRef<Uint8ClampedArray | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const key =
    layer.kind === 'overlay' || layer.kind === 'split'
      ? `${layer.src}|${layer.over}`
      : `${layer.kind}:${layer.src}`;

  useEffect(() => {
    let live = true;
    const a: Promise<Source> =
      layer.kind === 'difference' ? diffCanvas(layer.src) : loadImage(layer.src);
    const b: Promise<Source | null> =
      layer.kind === 'overlay' || layer.kind === 'split'
        ? loadImage(layer.over)
        : Promise.resolve(null);
    Promise.all([a, b]).then(
      ([ia, ib]) => live && (setSources({ key, a: ia, b: ib }), setFailed(null)),
      () => live && setFailed(key),
    );
    if (layer.kind === 'difference')
      diffBytes(layer.src).then(
        (d) => live && (sigRef.current = d),
        () => {},
      );
    else sigRef.current = null;
    return () => {
      live = false;
    };
    // key captures every field of layer that changes the sources
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fit = useCallback(
    (w: number, h: number): View => ({
      scale: Math.max(MIN_ZOOM, Math.min(w / width, h / height) * 0.96),
      cx: width / 2,
      cy: height / 2,
    }),
    [width, height],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      setSize({ w, h });
      setView((v) => v ?? (w > 0 ? fit(w, h) : null));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  // Display rows are flipped (PNG row 0 = top = highest FITS row).
  const toScreen = useCallback(
    (v: View, fx: number, fy: number) => ({
      x: size.w / 2 + (fx + 0.5 - v.cx) * v.scale,
      y: size.h / 2 + (height - fy - 0.5 - v.cy) * v.scale,
    }),
    [size, height],
  );
  const toFits = useCallback(
    (v: View, sx: number, sy: number) => {
      const ix = v.cx + (sx - size.w / 2) / v.scale;
      const iy = v.cy + (sy - size.h / 2) / v.scale;
      return { x: ix - 0.5, y: height - iy - 0.5, ix, iy };
    },
    [size, height],
  );

  const { focus } = props;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!focus) return;
    const from = viewRef.current;
    const to = {
      scale: Math.max(from?.scale ?? 1, Math.min(size.w, size.h) / 40),
      cx: focus.x + 0.5,
      cy: height - focus.y - 0.5,
    };
    if (!from || matchMedia('(prefers-reduced-motion: reduce)').matches) return setView(to);
    // one bounded glide (700 ms, exponential ease-out); it stops itself, so no idle loop
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const e = k === 1 ? 1 : 1 - 2 ** (-10 * k);
      setView({
        scale: from.scale * (to.scale / from.scale) ** e,
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
      });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [focus, height, size.w, size.h]);

  const current = sources?.key === key ? sources : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !current || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size.w, size.h);
    const x0 = size.w / 2 - view.cx * view.scale;
    const y0 = size.h / 2 - view.cy * view.scale;
    const w = width * view.scale;
    const h = height * view.scale;
    const filter = layer.kind === 'difference' ? 'none' : STRETCH[stretch].filter;
    ctx.filter = filter;
    ctx.drawImage(current.a, x0, y0, w, h);
    if (current.b && layer.kind === 'overlay') {
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(current.b, x0, y0, w, h);
      ctx.globalAlpha = 1;
    }
    const splitX = Math.round(size.w * (layer.kind === 'split' ? layer.at : 0));
    if (current.b && layer.kind === 'split') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, size.w - splitX, size.h);
      ctx.clip();
      ctx.drawImage(current.b, x0, y0, w, h);
      ctx.restore();
    }
    ctx.filter = 'none';
    ctx.strokeStyle = 'rgba(233, 225, 208, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, width * view.scale + 1, height * view.scale + 1);

    const r = Math.max(5, Math.min(14, view.scale * 1.6));
    for (const c of candidates) {
      if (c.candidate_id === selectedId) continue;
      const p = toScreen(view, c.pixel_x, c.pixel_y);
      const here = c.observation_ids.includes(activeEpochId);
      ctx.lineWidth = here ? 1.75 : 1;
      ctx.setLineDash(here ? [] : [2, 3]);
      ctx.strokeStyle = here ? 'rgba(233, 225, 208, 0.95)' : 'rgba(233, 225, 208, 0.45)';
      drawGlyph(ctx, c.kind, p.x, p.y, r);
    }
    ctx.setLineDash([]);
    const sel = candidates.find((c) => c.candidate_id === selectedId);
    if (sel) {
      const p = toScreen(view, sel.pixel_x, sel.pixel_y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(11, 13, 18, 0.85)';
      drawGlyph(ctx, sel.kind, p.x, p.y, r + 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#d9a571';
      drawGlyph(ctx, sel.kind, p.x, p.y, r + 4);
      // reticle ticks keep the selection findable even where the glyph sits on a bright star
      ctx.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        ctx.moveTo(p.x + dx * (r + 8), p.y + dy * (r + 8));
        ctx.lineTo(p.x + dx * (r + 16), p.y + dy * (r + 16));
      }
      ctx.stroke();
    }
    if (layer.kind === 'split') {
      ctx.fillStyle = 'rgba(217, 165, 113, 0.9)';
      ctx.fillRect(splitX - 1, 0, 2, size.h);
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'top';
      for (const [text, x, align] of [
        [layer.labels[0], splitX - 10, 'right'],
        [layer.labels[1], splitX + 10, 'left'],
      ] as const) {
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(5, 8, 15, 0.82)';
        ctx.fillRect(align === 'right' ? x - tw - 6 : x - 6, 8, tw + 12, 20);
        ctx.textAlign = align;
        ctx.fillStyle = '#e9e1d0';
        ctx.fillText(text, x, 13);
      }
      ctx.textAlign = 'start';
    }
    if (loupe && cursor) {
      // 8x+ magnifier under the cursor, unsmoothed so single pixels can be inspected
      const f = toFits(view, cursor.x, cursor.y);
      if (f.ix >= 0 && f.iy >= 0 && f.ix < width && f.iy < height) {
        const R = 64;
        const z = Math.max(8, view.scale * 3);
        const cx = Math.min(size.w - R - 8, cursor.x + R + 24);
        const cy = Math.max(R + 8, cursor.y - R - 24);
        const src =
          layer.kind === 'split' && cursor.x >= splitX && current.b ? current.b : current.a;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#05080f';
        ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        ctx.filter = filter;
        ctx.drawImage(src, cx - f.ix * z, cy - f.iy * z, width * z, height * z);
        ctx.filter = 'none';
        ctx.strokeStyle = 'rgba(217, 165, 113, 0.9)';
        ctx.lineWidth = 1;
        const px = cx - (f.ix % 1) * z;
        const py = cy - (f.iy % 1) * z;
        ctx.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, z, z);
        ctx.restore();
        ctx.strokeStyle = 'rgba(233, 225, 208, 0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (props.pin) {
      const p = toScreen(view, props.pin.x, props.pin.y);
      ctx.strokeStyle = '#e9e1d0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 18, p.y);
      ctx.lineTo(p.x - 6, p.y);
      ctx.moveTo(p.x + 6, p.y);
      ctx.lineTo(p.x + 18, p.y);
      ctx.moveTo(p.x, p.y - 18);
      ctx.lineTo(p.x, p.y - 6);
      ctx.moveTo(p.x, p.y + 6);
      ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();
    }
  }, [
    view,
    current,
    size,
    layer,
    width,
    height,
    candidates,
    selectedId,
    activeEpochId,
    toScreen,
    toFits,
    props.pin,
    stretch,
    loupe,
    cursor,
  ]);

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) =>
      setView((v) => {
        if (!v) return v;
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.scale * factor));
        const ax = sx ?? size.w / 2;
        const ay = sy ?? size.h / 2;
        // keep the image point under (ax, ay) fixed
        const ix = v.cx + (ax - size.w / 2) / v.scale;
        const iy = v.cy + (ay - size.h / 2) / v.scale;
        return {
          scale,
          cx: ix - (ax - size.w / 2) / scale,
          cy: iy - (ay - size.h / 2) / scale,
        };
      }),
    [size],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const updateReadout = (sx: number, sy: number) => {
    if (!view) return;
    const f = toFits(view, sx, sy);
    if (f.ix < 0 || f.iy < 0 || f.ix >= width || f.iy >= height) return setReadout('');
    const parts = [`x ${f.x.toFixed(1)}  y ${f.y.toFixed(1)}`];
    if (wcs) {
      const s = pixelToSky(wcs, f.x, f.y);
      parts.push(`${formatRa(s.ra)} ${formatDec(s.dec)}`);
    }
    const bytes = sigRef.current;
    if (layer.kind === 'difference' && bytes) {
      const b = bytes[(Math.floor(f.iy) * width + Math.floor(f.ix)) * 4] ?? 0;
      const sig = decodeSigma(b, layer.range);
      parts.push(sig == null ? 'masked' : `${sig >= 0 ? '+' : '−'}${Math.abs(sig).toFixed(1)}σ`);
    }
    setReadout(parts.join('   '));
  };

  const pick = (sx: number, sy: number) => {
    if (!view) return;
    let best: { id: string; d: number } | null = null;
    for (const c of candidates) {
      const p = toScreen(view, c.pixel_x, c.pixel_y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < 16 && (!best || d < best.d)) best = { id: c.candidate_id, d };
    }
    if (best) onPick(best.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = 40;
    const pan = (dx: number, dy: number) =>
      setView((v) => v && { ...v, cx: v.cx + dx / v.scale, cy: v.cy + dy / v.scale });
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(-step, 0),
      ArrowRight: () => pan(step, 0),
      ArrowUp: () => pan(0, -step),
      ArrowDown: () => pan(0, step),
      '+': () => zoomAt(1.25),
      '=': () => zoomAt(1.25),
      '-': () => zoomAt(0.8),
      '0': () => setView(fit(size.w, size.h)),
      ...(props.onPoint && view
        ? { Enter: () => props.onPoint?.(view.cx - 0.5, height - view.cy - 0.5) }
        : {}),
    };
    const act = actions[e.key];
    if (act) {
      e.preventDefault();
      e.stopPropagation(); // arrows pan here instead of stepping epochs
      act();
    }
  };

  const loading = !current && failed !== key;
  return (
    <div className="sky" ref={wrapRef} data-tour="canvas">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        aria-describedby="sky-keyboard-help"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          updateReadout(e.clientX - rect.left, e.clientY - rect.top);
          if (loupe) setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          d.moved = true;
          d.x = e.clientX;
          d.y = e.clientY;
          setView((v) => v && { ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const rect = e.currentTarget.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            if (props.onPoint && view) {
              const p = toFits(view, sx, sy);
              props.onPoint(p.x, p.y);
            }
            pick(sx, sy);
          }
        }}
        onPointerLeave={() => {
          setReadout('');
          setCursor(null);
        }}
      />
      <p id="sky-keyboard-help" className="visually-hidden">
        Arrow keys pan the image; plus and minus zoom; zero fits the full image. Use the marked
        changes list to select a spot without pointing at the image.
      </p>
      {view && (
        <div className="sky-scale mono" aria-hidden="true">
          <span className="sky-compass">N ↑ E ←</span>
          <span className="sky-bar" style={{ width: scaleBar(pixelScale / view.scale).px }} />
          {scaleBar(pixelScale / view.scale).text}
        </div>
      )}
      <div className="sky-zoom" role="group" aria-label="Image navigation">
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title="Fullscreen image · Escape to exit"
        >
          <Icon name="fullscreen" />
        </button>
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button type="button" onClick={() => setView(fit(size.w, size.h))} aria-label="Fit image">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
      </div>
      <output className="sky-readout mono" aria-live="off">
        {readout || (view ? `${(view.scale * 100).toFixed(0)}% · drag to pan, scroll to zoom` : '')}
      </output>
      {fullscreenError && (
        <p className="sky-status" role="status">
          {fullscreenError}
        </p>
      )}
      {loading && <p className="sky-status">Loading image…</p>}
      {failed === key && (
        <p className="sky-status error" role="alert">
          This image could not be loaded. Check your connection and select the epoch again.
        </p>
      )}
    </div>
  );
});

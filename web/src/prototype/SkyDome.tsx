import { useEffect, useRef, useState, type ReactNode } from 'react';
import { displayKey, loadDisplayTile, peekDisplay, TILE_BITS } from '../features/atlas/hips.ts';
import { lut } from '../features/atlas/render.ts';
import { clampView, domeGeometry, domeOrder, paintDome, toSky, type View } from './projection.ts';

export type Palette = 'ivory' | 'grey' | 'inferno' | 'viridis';
export const PALETTES: { id: Palette; label: string }[] = [
  { id: 'ivory', label: 'Ivory' },
  { id: 'grey', label: 'Grey' },
  { id: 'inferno', label: 'Inferno' },
  { id: 'viridis', label: 'Viridis' },
];

const tables = new Map<Palette, Uint8Array>();
/** 256-entry RGB table; display only, the tile bytes underneath never change. */
export function paletteTable(p: Palette): Uint8Array {
  let t = tables.get(p);
  if (!t) {
    if (p === 'ivory') {
      t = new Uint8Array(768);
      for (let i = 0; i < 256; i++)
        t.set(
          [236, 228, 211].map((c) => Math.round((c * i) / 255)),
          i * 3,
        );
    } else t = lut(p);
    tables.set(p, t);
  }
  return t;
}

const MAX_ORDER = 5;
const MAX_PIXELS = 1_600_000; // at rest; ~40 ms of geometry on an ordinary laptop

export interface DomeStatus {
  loading: number;
  failed: number;
}

interface Props {
  view: View;
  frame: number;
  palette: Palette;
  /** Lower-resolution, cached-tiles-only rendering while the camera moves. */
  moving?: boolean;
  /** Fraction of CSS resolution to render at rest (backgrounds use less). */
  resolution?: number;
  label: string;
  onView?: ((v: View, dragging: boolean) => void) | undefined;
  onSize?: (w: number, h: number) => void;
  onStatus?: (s: DomeStatus) => void;
  className?: string;
  children?: ReactNode;
}

/**
 * The SPHEREx all-sky HiPS on a stereographic dome. Renders only when the view, band, palette
 * or a tile arrival changes; there is no idle loop.
 */
export function SkyDome(props: Props) {
  const { view, frame, palette, moving = false, resolution = 1, label, onView, onSize } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const onStatus = useRef(props.onStatus);
  const latest = useRef({ view, onView, size });
  useEffect(() => {
    onStatus.current = props.onStatus;
    latest.current = { view, onView, size };
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => onSize?.(size.w, size.h), [size, onSize]);

  // geometry + paint; tiles that arrive later repaint through the same geometry
  useEffect(() => {
    const c = canvas.current;
    if (!c || size.w === 0 || size.h === 0) return;
    const fast = moving || dragging;
    let scale = fast ? Math.min(resolution, 1 / 3) : resolution;
    if (size.w * size.h * scale * scale > MAX_PIXELS)
      scale = Math.sqrt(MAX_PIXELS / (size.w * size.h));
    const w = Math.max(1, Math.round(size.w * scale));
    const h = Math.max(1, Math.round(size.h * scale));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const order = domeOrder(view, w, TILE_BITS, MAX_ORDER);
    const g = domeGeometry(view, w, h, order, TILE_BITS);
    const keys = g.tiles.map((t) => {
      const [o, n] = t.split('/').map(Number) as [number, number];
      return { o, n, key: displayKey(o, n, frame) };
    });
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const img = ctx.createImageData(w, h);
    const map = paletteTable(palette);
    let raf = 0;
    const paint = () => {
      raf = 0;
      paintDome(
        g,
        keys.map((k) => peekDisplay(k.key)),
        map,
        img.data,
      );
      ctx.putImageData(img, 0, 0);
    };
    paint();
    const ac = new AbortController();
    let loading = 0;
    let failed = 0;
    const report = () => onStatus.current?.({ loading, failed });
    for (const k of keys) {
      if (peekDisplay(k.key) !== undefined) continue;
      if (fast && k.o !== g.coarse) continue; // moving: fetch only the few coarse tiles
      loading++;
      // a tile shared with another dome rejects if that dome aborted it; the cache drops it, so ask again once
      loadDisplayTile(k.o, k.n, frame, ac.signal)
        .catch((e: unknown) => {
          if ((e as Error)?.name === 'AbortError' && !ac.signal.aborted)
            return loadDisplayTile(k.o, k.n, frame, ac.signal);
          throw e;
        })
        .then(() => {
          if (!ac.signal.aborted && !raf) raf = requestAnimationFrame(paint);
        })
        .catch(() => {
          if (!ac.signal.aborted) failed++;
        })
        .finally(() => {
          loading--;
          if (!ac.signal.aborted) report();
        });
    }
    report();
    return () => {
      ac.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view, frame, palette, size, moving, dragging, resolution]);

  // pan (drag), zoom (wheel, pinch), keyboard
  useEffect(() => {
    const el = box.current;
    if (!el || !onView) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { view: View; x: number; y: number; dist: number } | null = null;
    let moved = false;
    const emit = (v: View, drag: boolean) => latest.current.onView?.(clampView(v), drag);
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || pointers.size >= 2) return; // ignore a third finger
      if ((e.target as HTMLElement).closest('button, a, input, [data-no-drag]')) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      const p = local(e);
      start = { view: latest.current.view, x: p.x, y: p.y, dist: spread() };
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, local(e));
      const { w, h } = latest.current.size;
      if (pointers.size === 2) {
        const d = spread();
        moved = true;
        setDragging(true);
        if (start.dist > 0 && d > 0)
          emit({ ...latest.current.view, fov: (start.view.fov * start.dist) / d }, true);
        return;
      }
      const p = local(e);
      if (Math.hypot(p.x - start.x, p.y - start.y) < 3) return; // a click, not a drag
      moved = true;
      setDragging(true);
      const centre = toSky(start.view, w, h, w / 2 - (p.x - start.x), h / 2 - (p.y - start.y));
      emit({ ...start.view, ra: centre.ra, dec: centre.dec }, true);
    };
    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        start = p ? { view: latest.current.view, x: p.x, y: p.y, dist: 0 } : null;
        return;
      }
      start = null;
      setDragging(false);
      if (moved) emit(latest.current.view, false);
      moved = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, size: s } = latest.current;
      const r = el.getBoundingClientRect();
      const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
      const next = clampView({ ...v, fov: v.fov * f });
      const k = 1 - next.fov / v.fov; // keep the sky under the cursor roughly in place
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const c = toSky(v, s.w, s.h, s.w / 2 + (x - s.w / 2) * k, s.h / 2 + (y - s.h / 2) * k);
      emit({ ...next, ra: c.ra, dec: c.dec }, false);
    };
    const key = (e: KeyboardEvent) => {
      const v = latest.current.view;
      const step = v.fov * 0.1;
      const cosd = Math.max(0.05, Math.cos((v.dec * Math.PI) / 180));
      const moves: Record<string, Partial<View>> = {
        ArrowUp: { dec: v.dec + step },
        ArrowDown: { dec: v.dec - step },
        ArrowLeft: { ra: v.ra + step / cosd },
        ArrowRight: { ra: v.ra - step / cosd },
        '+': { fov: v.fov / 1.4 },
        '=': { fov: v.fov / 1.4 },
        '-': { fov: v.fov * 1.4 },
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      emit({ ...v, ...m }, false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('keydown', key);
    };
  }, [onView]);

  return (
    <div
      ref={box}
      className={`dome ${props.className ?? ''}`}
      data-interactive={onView ? '' : undefined}
      data-dragging={dragging ? '' : undefined}
      tabIndex={onView ? 0 : undefined}
      role={onView ? 'application' : 'img'}
      aria-roledescription={onView ? 'sky view' : undefined}
      aria-label={label}
    >
      <canvas ref={canvas} className="dome-canvas" aria-hidden="true" />
      {props.children}
    </div>
  );
}

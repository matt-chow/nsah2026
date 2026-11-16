import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BANDS } from '../features/spectrum/channels.ts';
import { formatDec, formatRa } from '../lib/sky.ts';
import { gaiaStars, propagate, toGrid, type Star } from './catalog.ts';
import { MeasurePanel, SpectrumPanel } from './FlipTools.tsx';
import {
  coverage,
  DEFAULT_SIZE,
  FLAG_ABOUT,
  holdMs,
  listExposures,
  LiveError,
  loadFrame,
  makeDiffStretch,
  makeStretch,
  medianImage,
  monthOf,
  paintFrame,
  peekFrame,
  SIZES,
  type Listed,
  type Listing,
  type LiveFrame,
  type Timing,
} from './live.ts';
import { difference } from './measure.ts';
import { parseCoords, TARGETS } from './places.ts';
import { paletteTable, type Palette } from './SkyDome.tsx';
import type { ArchiveCompare, FlipTarget } from './store.ts';

const SkyPanel = lazy(() => import('./SkyPanel.tsx'));

const WINDOW = 12; // frames fetched ahead of the one shown; nothing further is downloaded
const ALL_CAP = 150; // "load all" stops here
const CONCURRENCY = 4;
const STRETCH_FROM = 6; // frames that set the shared stretch
const SPEEDS = [2, 4, 8];

type ListState =
  { kind: 'loading' } | { kind: 'ready'; listing: Listing } | { kind: 'error'; e: LiveError };
type ViewMode = 'frames' | 'stack' | 'diff' | '3d';
type Tab = 'about' | 'measure' | 'spectrum' | 'compare' | 'sky';
const TABS: { id: Tab; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'measure', label: 'Measure' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'compare', label: 'Compare' },
  { id: 'sky', label: 'Sky map' },
];
type Stars = { key: string; stars: Star[] | null }; // null = the catalogue failed

const date = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const range = (b: string) => {
  const x = BANDS.find((d) => `D${d.detector}` === b);
  return x ? `${x.min.toFixed(2)}–${x.max.toFixed(2)} µm` : '';
};
const release = (rel?: string) => (rel ? rel.replace(/^spherex_/, '').toUpperCase() : 'DR1');
const sameSpot = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) =>
  a.ra.toFixed(5) === b.ra.toFixed(5) && a.dec.toFixed(5) === b.dec.toFixed(5);
type Range = readonly [number, number];
const rangeText = (r: Range) => `${r[0].toFixed(2)}–${r[1].toFixed(2)} µm`;
/** A detector band cut into quarters: narrower wavelength windows to play on their own. */
const quarters = (b: string): Range[] => {
  const x = BANDS.find((d) => `D${d.detector}` === b);
  if (!x) return [];
  const w = (x.max - x.min) / 4;
  return [0, 1, 2, 3].map((k) => [x.min + k * w, x.min + (k + 1) * w] as const);
};
const sameRange = (a: Range | null, b: Range | null) =>
  !!a && !!b && a[0].toFixed(2) === b[0].toFixed(2) && a[1].toFixed(2) === b[1].toFixed(2);

// The view beyond the point (Prototype owns ra/dec/band/fov): ?view=stack|diff&frame=N&wl=lo-hi,
// read once when the page opens so a shared link shows what its sender saw
const linked = (() => {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(q.get('wl') ?? '');
  const frame = Number(q.get('frame'));
  const wl = m ? ([Number(m[1]), Number(m[2])] as const) : null;
  return {
    mode: (['stack', 'diff', '3d'] as const).find((x) => x === q.get('view')) ?? null,
    frame: Number.isInteger(frame) && frame >= 1 ? frame - 1 : null,
    wl: wl && wl[0] < wl[1] ? wl : null,
  };
})();

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, select, textarea, [role="radio"], [role="tab"]');

/**
 * Every exposure the archive lists at one point, in one detector band, played in time order.
 * The picture is display imagery; the Measure and Spectrum tabs work on the archive pixel values.
 */
export function Flipbook(props: {
  target: FlipTarget;
  active: boolean;
  palette: Palette;
  reduced: boolean;
  onTarget: (t: FlipTarget) => void;
  planetarium?: ReactNode; // the app's window on the planetarium, above the tools
  onCompare: (c: ArchiveCompare) => void;
  announce: (s: string) => void;
}) {
  const { ra, dec, band } = props.target;
  const size = props.target.size ?? DEFAULT_SIZE;
  const setTarget = (t: Partial<FlipTarget>) => props.onTarget({ ...props.target, ...t });
  const [attempt, setAttempt] = useState(0);
  // keyed by the request, so a new point or retry reads as loading without a reset
  const listKey = `${ra},${dec},${attempt}`;
  const [result, setResult] = useState<{ key: string; state: ListState } | null>(null);
  const listing: ListState = result?.key === listKey ? result.state : { kind: 'loading' };
  const [month, setMonth] = useState('all');
  const [index, setIndex] = useState(linked.frame ?? 0);
  const [playing, setPlaying] = useState(!props.reduced && linked.frame === null);
  // only exposures that saw the ring within this wavelength window; null = any
  const [wl, setWl] = useState<Range | null>(linked.wl);
  const [speed, setSpeed] = useState(4);
  const [timing, setTiming] = useState<Timing>('equal');
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<ViewMode>(linked.mode ?? 'frames');
  const [tab, setTab] = useState<Tab>('about');
  const [showStars, setShowStars] = useState(false);
  const [stars, setStars] = useState<Stars | null>(null);
  const [fetchAll, setFetchAll] = useState(!!linked.wl); // a window needs every wavelength known
  const [markA, setMarkA] = useState<Listed | null>(null);
  const [tick, setTick] = useState(0); // a frame arrived
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stretch, setStretch] = useState<{ key: string; fn: (x: number) => number } | null>(null);

  // a new point: the listing, the place in it and the comparison mark start over
  useEffect(() => {
    if (!props.active) return;
    const ac = new AbortController();
    listExposures(ra, dec).then(
      (l) =>
        !ac.signal.aborted && setResult({ key: listKey, state: { kind: 'ready', listing: l } }),
      (e: unknown) =>
        !ac.signal.aborted &&
        setResult({
          key: listKey,
          state: {
            kind: 'error',
            e: e instanceof LiveError ? e : new LiveError('outage', 'The archive request failed.'),
          },
        }),
    );
    return () => ac.abort();
  }, [ra, dec, listKey, props.active]);
  const pointKey = `${ra},${dec}`;
  const [seenPoint, setSeenPoint] = useState(pointKey);
  if (seenPoint !== pointKey) {
    setSeenPoint(pointKey);
    setIndex(0);
    setMarkA(null);
    setMonth('all');
    setWl(null);
    setFetchAll(false);
  }

  const all = useMemo(
    () =>
      result?.key === listKey && result.state.kind === 'ready' ? result.state.listing.frames : [],
    [result, listKey],
  );
  const baked = listing.kind === 'ready' ? listing.listing.baked : null;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of all) c[f.band] = (c[f.band] ?? 0) + 1;
    return c;
  }, [all]);
  const inBand = useMemo(
    () => all.filter((f) => f.band === band).sort((a, b) => a.mjd - b.mjd),
    [all, band],
  );
  const months = useMemo(() => [...new Set(inBand.map((f) => monthOf(f.mjd)))], [inBand]);
  // the wavelength at the ring is only known once an exposure loads, so a window keeps the
  // exposures known to fall in it and grows as the rest arrive
  const inWindow = (f: Listed) => {
    const um = wl && peekFrame(ra, dec, f.url, size)?.um;
    return !wl || (um != null && um >= wl[0] && um < wl[1]);
  };
  const list = useMemo(
    () => inBand.filter((f) => (month === 'all' || monthOf(f.mjd) === month) && inWindow(f)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` marks a cache arrival
    [inBand, month, wl, wl && tick, ra, dec, size],
  );
  const i = Math.min(index, Math.max(0, list.length - 1));
  const cur = list[i];
  const peek = (url: string) => peekFrame(ra, dec, url, size);
  const failKey = (url: string) => `${size}|${url}`;
  const isFailed = (url: string) => failed.has(failKey(url));

  // fetch only a window ahead of the frame shown (or all, on request); leaving it cancels.
  // A wavelength window fetches the whole band, since it cannot tell which exposures it keeps.
  const source = wl ? inBand : list;
  const want = useMemo(() => {
    const out: string[] = [];
    const span = fetchAll ? Math.min(ALL_CAP, source.length) : Math.min(WINDOW, source.length);
    for (let k = 0; k < span; k++) {
      const f = source[(i + k) % source.length];
      if (f) out.push(f.url);
    }
    return out;
  }, [source, i, fetchAll]);
  const inflight = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const flying = inflight.current;
    if (!props.active) {
      for (const ac of flying.values()) ac.abort();
      flying.clear();
      return;
    }
    for (const [k, ac] of flying)
      if (!want.some((url) => failKey(url) === k)) {
        ac.abort();
        flying.delete(k);
      }
    for (const url of want) {
      const k = failKey(url);
      if (flying.size >= CONCURRENCY) break;
      if (flying.has(k) || peek(url) || failed.has(k)) continue;
      const ac = new AbortController();
      flying.set(k, ac);
      loadFrame(ra, dec, url, ac.signal, size).then(
        () => {
          flying.delete(k);
          setTick((t) => t + 1);
        },
        () => {
          flying.delete(k);
          if (!ac.signal.aborted) setFailed((f) => new Set(f).add(k));
        },
      );
    }
  });
  useEffect(() => {
    const flying = inflight.current;
    return () => {
      for (const ac of flying.values()) ac.abort();
    };
  }, []);

  const loaded = inBand.filter((f) => peek(f.url)).length;
  const failures = inBand.filter((f) => isFailed(f.url)).length;
  const frame: LiveFrame | undefined = cur && peek(cur.url);
  // the frames of this list, parallel to it; recomputed when one arrives
  const listFrames = useMemo(
    () => list.map((f) => peekFrame(ra, dec, f.url, size)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` marks a cache arrival
    [list, ra, dec, size, tick],
  );

  // one display stretch for the whole band, from the first few frames that arrive
  const stretchKey = `${pointKey}|${band}|${size}`;
  if (stretch?.key !== stretchKey) {
    const ready = inBand
      .map((f) => peek(f.url))
      .filter((f): f is LiveFrame => !!f)
      .slice(0, STRETCH_FROM);
    if (ready.length >= Math.min(STRETCH_FROM, inBand.length) && ready.length > 0)
      setStretch({ key: stretchKey, fn: makeStretch(medianImage(ready.map((f) => f.pix))) });
  }
  const shared = stretch?.key === stretchKey ? stretch.fn : null;

  // the median of every loaded exposure in the list: what stays put
  const stackOf = listFrames.filter((f): f is LiveFrame => !!f);
  const stack = useMemo(
    () =>
      (mode === 'stack' || mode === 'diff') && stackOf.length >= 3
        ? medianImage(stackOf.map((f) => f.pix))
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the count changes
    [mode, stackOf.length, list],
  );
  const shown = useMemo(
    () =>
      mode === 'stack' && stack
        ? { n: frame?.n ?? stack.length ** 0.5, pix: stack }
        : mode === 'diff' && stack && frame
          ? { n: frame.n, pix: difference(frame.pix, stack) }
          : mode === 'frames'
            ? frame
            : undefined,
    [mode, stack, frame],
  );

  useEffect(() => {
    const c = canvas.current;
    if (!c || !shown || !props.active) return;
    if (mode === 'diff') paintFrame(c, shown, makeDiffStretch(shown.pix), 'diverging');
    else paintFrame(c, shown, shared ?? makeStretch(shown.pix), paletteTable(props.palette));
  }, [shown, mode, shared, props.palette, props.active]);

  // Gaia DR3 markers, an overlay only: fetched once per point, moved to each exposure's date
  const starKey = `${pointKey}|${size}`;
  useEffect(() => {
    if (!showStars || !props.active || stars?.key === starKey) return;
    gaiaStars(ra, dec, size).then(
      (s) => setStars({ key: starKey, stars: s }),
      () => setStars({ key: starKey, stars: null }),
    );
  }, [showStars, props.active, starKey, stars?.key, ra, dec, size]);
  const starList = stars?.key === starKey ? stars.stars : null;
  const n = shown?.n ?? frame?.n ?? 0;
  const epoch = mode === 'stack' ? null : (frame?.mjd ?? cur?.mjd ?? null);
  const marks =
    showStars && starList && n && epoch !== null
      ? starList.flatMap((s) => {
          const p = propagate(s, epoch);
          const g = toGrid(p.ra, p.dec, ra, dec, n);
          const fast = Math.hypot(s.pmra ?? 0, s.pmdec ?? 0) > 200; // mas/yr
          return g.col > -1 && g.col < n && g.row > -1 && g.row < n ? [{ ...g, fast, s }] : [];
        })
      : [];

  // playback holds each frame, then moves on only once the next one has arrived or failed
  const mjds = useMemo(() => list.map((f) => f.mjd), [list]);
  const next = list[(i + 1) % list.length];
  const nextReady = !!next && (!!peek(next.url) || isFailed(next.url));
  const animating = playing && (mode === 'frames' || mode === 'diff');
  useEffect(() => {
    if (!animating || !props.active || !nextReady || list.length < 2) return;
    const t = setTimeout(
      () => {
        let k = (i + 1) % list.length;
        while (failed.has(`${size}|${list[k]?.url ?? ''}`) && k !== i) k = (k + 1) % list.length;
        setIndex(k);
      },
      holdMs(mjds, i, timing, speed),
    );
    return () => clearTimeout(t);
  }, [animating, props.active, nextReady, i, list, mjds, timing, speed, failed, size]);
  if (!props.active && playing) setPlaying(false);

  const step = (d: number) => {
    setPlaying(false);
    setIndex((i + d + list.length) % list.length);
  };

  // Space plays or pauses, arrows step; never while typing or in a control with its own keys
  const len = list.length;
  useEffect(() => {
    if (!props.active || len === 0) return;
    const on = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        setPlaying(false);
        setIndex((k) => (Math.min(k, len - 1) + d + len) % len);
      } else if (
        e.key === ' ' &&
        !(e.target instanceof HTMLElement && e.target.closest('button, a'))
      ) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [props.active, len]);

  // the view, in the address bar for sharing: no frame number while playing or stacked
  useEffect(() => {
    if (!props.active) return;
    const u = new URL(location.href);
    const set = (k: string, v: string | null) =>
      v === null ? u.searchParams.delete(k) : u.searchParams.set(k, v);
    set('view', mode === 'frames' ? null : mode);
    set('frame', playing || mode === 'stack' || mode === '3d' || len === 0 ? null : String(i + 1));
    set('wl', wl ? `${wl[0].toFixed(2)}-${wl[1].toFixed(2)}` : null);
    if (u.href !== location.href) history.replaceState(history.state, '', u);
  }, [props.active, mode, playing, i, len, wl, ra, dec]);

  const cov = frame ? coverage(frame) : null;
  const unsupported = typeof AbortSignal.any !== 'function';
  const named = TARGETS.find((t) => sameSpot(t, props.target));
  // the three.js page in data/flipbook, its own panel hidden; t= lets it use the saved copy
  const src3d = `flipbook/index.html?${new URLSearchParams({ embed: '1', ra: String(ra), dec: String(dec), band, ...(named ? { t: named.id } : {}) })}`;

  let state: { title: string; body: string; retry?: boolean; wide?: boolean } | null = null;
  if (unsupported)
    state = {
      title: 'This browser cannot run the Flipbook',
      body: 'It needs a recent browser (AbortSignal.any). The prepared fields still open from the sky.',
    };
  else if (listing.kind === 'loading')
    state = {
      title: 'Asking the SPHEREx archive…',
      body: 'Listing every exposure covering this point.',
    };
  else if (listing.kind === 'error')
    state =
      listing.e.kind === 'no-api'
        ? {
            title: 'No archive connection here',
            body: 'This copy of the app runs without the small archive functions. The five challenge targets above, the two prepared fields and your notebook still work.',
          }
        : {
            title: 'The archive is not answering',
            body: `${listing.e.message} The five challenge targets above, the two prepared fields and your notebook still work.`,
            retry: true,
          };
  else if (all.length === 0)
    state = {
      title: 'No SPHEREx exposures cover this point yet',
      body: 'The archive lists none here. SPHEREx is still mapping the sky; this does not mean nothing is there.',
    };
  else if (inBand.length === 0)
    state = {
      title: `No ${band} exposures here`,
      body: 'Choose another detector band; the counts show what the archive has.',
    };
  else if (wl && list.length === 0)
    state = {
      title:
        loaded + failures < Math.min(ALL_CAP, inBand.length)
          ? `Checking which ${band} exposures saw ${rangeText(wl)}…`
          : `No ${band} exposure saw this point at ${rangeText(wl)}`,
      body: 'Each exposure sees the ring at its own wavelength, known once it loads.',
      wide: true,
    };

  const bandSelect = (
    <label className="field band-pick">
      <span>Detector</span>
      <select
        value={band}
        onChange={(e) => (
          setTarget({ band: e.target.value }),
          setIndex(0),
          setMonth('all'),
          setWl(null)
        )}
      >
        {BANDS.map((b) => {
          const id = `D${b.detector}`;
          return (
            <option key={id} value={id}>
              {id} · {range(id)}
              {listing.kind === 'ready' ? ` · ${counts[id] ?? 0}` : ''}
            </option>
          );
        })}
      </select>
    </label>
  );

  const starNote = !showStars
    ? ''
    : stars?.key !== starKey
      ? 'Loading Gaia stars…'
      : !starList
        ? 'The Gaia catalogue service (VizieR) is not answering; markers are unavailable.'
        : mode === 'stack'
          ? 'Gaia markers are hidden on the stack, which has no single date.'
          : `${marks.length} Gaia DR3 stars, moved to this exposure’s date${marks.some((m) => m.fast) ? '; fast movers have a ring' : ''}.`;

  return (
    <div className="flip" aria-labelledby="flip-h">
      <header className="flip-head">
        <h1 id="flip-h">Watch the sky move</h1>
        <p className="muted">
          {props.target.label} · RA {formatRa(ra)}, Dec {formatDec(dec)} (ICRS) ·{' '}
          {baked ? `saved copy of the archive, ${baked}` : 'live SPHEREx archive'}
        </p>
        <TargetBar
          current={props.target}
          onGo={(t) => {
            setPlaying(!props.reduced);
            props.onTarget(t);
          }}
        />
      </header>

      <div className="flip-body">
        <div className="flip-stage">
          {state ? (
            <div className="flip-state" role={listing.kind === 'error' ? 'alert' : 'status'}>
              <h2>{state.title}</h2>
              <p>{state.body}</p>
              {state.retry && <button onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
              {inBand.length === 0 && all.length > 0 && bandSelect}
              {state.wide && (
                <button onClick={() => (setWl(null), setIndex(0))}>Show every wavelength</button>
              )}
            </div>
          ) : (
            <>
              <div className="flip-tools">
                {bandSelect}
                <div className="seg" role="radiogroup" aria-label="Picture">
                  {(
                    [
                      ['frames', 'Each exposure'],
                      ['stack', 'Stacked'],
                      ['diff', 'Changes'],
                      ['3d', '3D sky'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="radio"
                      aria-checked={mode === id}
                      onClick={() => setMode(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {mode !== '3d' && (
                  <button
                    className="toggle"
                    aria-pressed={showStars}
                    onClick={() => setShowStars(!showStars)}
                  >
                    Gaia stars
                  </button>
                )}
              </div>

              {mode === '3d' ? (
                <>
                  <iframe
                    key={src3d}
                    className="flip-3d"
                    src={src3d}
                    title={`3D sky: every ${band} exposure of ${props.target.label} played overhead, over the SPHEREx all-sky map`}
                  />
                  <p className="flip-caption note">
                    Every {band} exposure plays overhead in time order, over the SPHEREx all-sky
                    map; the landscape is decoration. Drag to look around, scroll to zoom. Display
                    only, not a measurement.{' '}
                    <a href={src3d.replace('embed=1&', '')} target="_blank" rel="noreferrer">
                      Open full screen
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <div className="flip-frame">
                    <canvas
                      ref={canvas}
                      role="img"
                      style={{ transform: `scale(${zoom})` }}
                      aria-label={
                        mode === 'stack'
                          ? `Median of ${stackOf.length} ${band} exposures. The ring marks the position searched for.`
                          : cur
                            ? `${mode === 'diff' ? 'Change from the median in e' : 'E'}xposure ${i + 1} of ${list.length}, ${date(cur.mjd)}, detector ${band}. The ring marks the position searched for.`
                            : ''
                      }
                    />
                    {marks.length > 0 && (
                      <svg
                        className="flip-marks"
                        viewBox={`0 0 ${n} ${n}`}
                        style={{ transform: `scale(${zoom})` }}
                        aria-hidden
                      >
                        {marks.map((m, k) => (
                          <g key={k} transform={`translate(${m.col + 0.5} ${m.row + 0.5})`}>
                            <rect x={-0.9} y={-0.9} width={1.8} height={1.8} />
                            {m.fast && <circle r={2.2} />}
                          </g>
                        ))}
                      </svg>
                    )}
                    <span
                      className="flip-aim"
                      style={{ transform: `scale(${zoom})` }}
                      aria-hidden
                    />
                    {!shown && (
                      <p className="flip-wait" role="status">
                        {mode !== 'frames' && !stack
                          ? 'Waiting for at least three exposures to stack…'
                          : cur && isFailed(cur.url)
                            ? 'This exposure failed to load; it is skipped in playback.'
                            : 'Loading this exposure…'}
                      </p>
                    )}
                    <span className="flip-tag">
                      {mode === 'diff'
                        ? 'Display only · amber brighter, blue fainter than usual'
                        : mode === 'stack'
                          ? `Display only · median of ${stackOf.length}`
                          : 'Archive imagery · display only'}
                    </span>
                    <span className="flip-compass" aria-hidden>
                      N ↑ E ←
                    </span>
                  </div>

                  {mode !== 'stack' && (
                    <div className="transport">
                      <button
                        className="icon-btn"
                        onClick={() => step(-1)}
                        aria-label="Previous exposure"
                      >
                        ‹
                      </button>
                      <button
                        className="play"
                        aria-pressed={playing}
                        onClick={() => setPlaying(!playing)}
                      >
                        {playing ? 'Pause' : 'Play'}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => step(1)}
                        aria-label="Next exposure"
                      >
                        ›
                      </button>
                      <label className="scrub">
                        <span className="sr-only">Timeline</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, list.length - 1)}
                          value={i}
                          aria-valuetext={cur ? `Exposure ${i + 1}, ${date(cur.mjd)}` : ''}
                          onChange={(e) => (setPlaying(false), setIndex(Number(e.target.value)))}
                        />
                      </label>
                      <span className="count data">
                        {i + 1}/{list.length}
                      </span>
                    </div>
                  )}

                  <div className="flip-caption">
                    {mode === 'stack' ? (
                      <p>
                        <strong>
                          {stackOf.length} {band} exposures stacked
                        </strong>
                        <span className="muted">
                          {' '}
                          · {list[0] ? date(list[0].mjd) : ''} to{' '}
                          {list.at(-1) ? date((list.at(-1) as Listed).mjd) : ''}
                        </span>
                      </p>
                    ) : (
                      <p>
                        <strong>{cur ? date(cur.mjd) : ''}</strong>
                        <span className="muted">
                          {' '}
                          · {release(cur?.rel)} · {frame?.det ? `detector ${frame.det}` : band}
                          {frame?.um != null
                            ? ` · ${frame.um.toFixed(3)} µm at the ring`
                            : ` · ${range(band)}`}
                          {cov !== null && cov < 0.98
                            ? ` · partial: ${Math.round(cov * 100)}% of the square has data`
                            : ''}
                        </span>
                      </p>
                    )}
                    {frame && mode !== 'stack' && <FlagLine flags={frame.flags} />}
                    {starNote && (
                      <p className="muted" aria-live="polite">
                        {starNote}
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flip-panel">
          {props.planetarium}
          <div className="tabs" role="tablist" aria-label="Tools">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`ft-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="ft-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const k = TABS.findIndex((x) => x.id === tab);
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!d) return;
                  const nt = TABS[(k + d + TABS.length) % TABS.length] as (typeof TABS)[number];
                  setTab(nt.id);
                  document.getElementById(`ft-${nt.id}`)?.focus();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div id="ft-panel" role="tabpanel" aria-labelledby={`ft-${tab}`} className="tab-body">
            {tab === 'about' && (
              <>
                <section className="block" aria-labelledby="what-h">
                  <h2 id="what-h">What you are seeing</h2>
                  {named && <p>{named.about}</p>}
                  <p className="note">
                    Each square is one SPHEREx exposure of the same {size}′ patch of sky, north up
                    and east left, centred on the ring. Brighter means more infrared light; the
                    colours are a display palette, not what the eye would see. Anything that shifts
                    between exposures either moved on the sky or is a detector effect: the flag line
                    under the picture says when an exposure is affected at the ring.
                  </p>
                </section>
                <section className="block next" aria-labelledby="next-h">
                  <h2 id="next-h">Try next</h2>
                  <ul className="next-list">
                    <li>
                      <button className="link" onClick={() => setMode('diff')}>
                        Show only what changes
                      </button>
                      <span className="note"> Each exposure minus the median of all of them.</span>
                    </li>
                    <li>
                      <button className="link" onClick={() => setTab('measure')}>
                        Measure whether it moves
                      </button>
                      <span className="note"> A speed across the sky, with its uncertainty.</span>
                    </li>
                    <li>
                      <button className="link" onClick={() => setTab('spectrum')}>
                        See its spectrum
                      </button>
                      <span className="note"> Brightness at 0.75–5 µm from all six detectors.</span>
                    </li>
                    <li>
                      <button className="link" onClick={() => setShowStars(true)}>
                        Mark the known stars
                      </button>
                      <span className="note">
                        {' '}
                        Gaia’s catalogue, moved to each exposure’s date.
                      </span>
                    </li>
                  </ul>
                  <p className="note">
                    Keys: Space plays or pauses, ← and → step through the exposures.
                  </p>
                </section>
                <section className="block" aria-labelledby="band-h">
                  <h2 id="band-h">Why the detector matters</h2>
                  <p className="note">
                    SPHEREx has six detectors, D1 (0.75 µm) to D6 (5 µm). One detector is not one
                    wavelength: its filter changes colour across it, so two {band} exposures can see
                    this point at different wavelengths. The caption gives the wavelength at the
                    ring for each exposure, from its own calibration.
                  </p>
                </section>
                {!state && (
                  <details className="block">
                    <summary>Playback and framing</summary>
                    <div className="seg" role="radiogroup" aria-label="Speed">
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          role="radio"
                          aria-checked={speed === s}
                          onClick={() => setSpeed(s)}
                        >
                          {s} per second
                        </button>
                      ))}
                    </div>
                    <div className="seg" role="radiogroup" aria-label="Timing">
                      {(['equal', 'elapsed'] as const).map((t) => (
                        <button
                          key={t}
                          role="radio"
                          aria-checked={timing === t}
                          onClick={() => setTiming(t)}
                        >
                          {t === 'equal' ? 'Equal steps' : 'Real gaps'}
                        </button>
                      ))}
                    </div>
                    <p className="note">
                      {timing === 'equal'
                        ? 'Every exposure gets the same time on screen, however far apart they were taken.'
                        : 'Longer pauses where months passed between exposures (at most four steps), quick ones for exposures taken close together. Still not to scale.'}
                    </p>
                    <div className="row">
                      <label className="field">
                        <span>Field of view</span>
                        <select
                          value={size}
                          onChange={(e) => (
                            setTarget({ size: Number(e.target.value) }),
                            setZoom(1)
                          )}
                        >
                          {SIZES.map((s) => (
                            <option key={s} value={s}>
                              {s}′ square ({Math.round((s * 60) / 6.15)} pixels across)
                            </option>
                          ))}
                        </select>
                      </label>
                      <button aria-pressed={zoom > 1} onClick={() => setZoom(zoom > 1 ? 1 : 2)}>
                        {zoom > 1 ? 'Fit' : 'Zoom 2×'}
                      </button>
                    </div>
                    <label className="field">
                      <span>Wavelength at the ring</span>
                      <select
                        value={wl ? rangeText(wl) : 'any'}
                        onChange={(e) => {
                          const r =
                            [...quarters(band), ...(wl ? [wl] : [])].find(
                              (q) => rangeText(q) === e.target.value,
                            ) ?? null;
                          setWl(r);
                          setIndex(0);
                          if (r) setFetchAll(true);
                        }}
                      >
                        <option value="any">Any ({range(band)})</option>
                        {wl && !quarters(band).some((q) => sameRange(q, wl)) && (
                          <option value={rangeText(wl)}>{rangeText(wl)} (from the link)</option>
                        )}
                        {quarters(band).map((q) => (
                          <option key={rangeText(q)} value={rangeText(q)}>
                            {rangeText(q)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="note">
                      A narrower window plays only the exposures that saw this point at nearly the
                      same colour, so Stacked and Changes compare like with like. It loads every{' '}
                      {band} exposure to read their wavelengths.
                    </p>
                    <label className="field">
                      <span>Month</span>
                      <select
                        value={month}
                        onChange={(e) => (setMonth(e.target.value), setIndex(0))}
                      >
                        <option value="all">
                          All {wl ? list.length : inBand.length} exposures
                        </option>
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {m} · {inBand.filter((f) => monthOf(f.mjd) === m).length}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="note" aria-live="polite">
                      The {baked ? `listing saved on ${baked}` : 'archive'} has {all.length}{' '}
                      exposures here in all detectors, {inBand.length} in {band}. Loaded {loaded}
                      {failures ? `, ${failures} failed` : ''}
                      {fetchAll ? '' : `; only the next ${WINDOW} are fetched`}. Framing is locked:
                      every exposure is reprojected to the same {size}′ square (one SPHEREx pixel is
                      6.15″).
                      {baked && size !== DEFAULT_SIZE
                        ? ' The saved copy holds 6′ squares; other sizes load from the live archive.'
                        : ''}
                    </p>
                  </details>
                )}
              </>
            )}

            {tab === 'measure' &&
              (state ? (
                <p className="note">Measurements need exposures; none are showing.</p>
              ) : (
                <MeasurePanel
                  ra={ra}
                  dec={dec}
                  band={band}
                  list={list}
                  frames={listFrames}
                  allLoaded={fetchAll || loaded + failures >= inBand.length}
                  onLoadAll={() => setFetchAll(true)}
                />
              ))}

            {tab === 'spectrum' &&
              (all.length ? (
                <SpectrumPanel ra={ra} dec={dec} all={all} />
              ) : (
                <p className="note">A spectrum needs the archive listing for this point.</p>
              ))}

            {tab === 'compare' && (
              <>
                <section className="block" aria-labelledby="mode-h">
                  <h2 id="mode-h">Stacked and Changes</h2>
                  <p className="note">
                    <strong>Stacked</strong> shows the median of every loaded exposure: what stays
                    put, with less noise. <strong>Changes</strong> shows each exposure minus that
                    median: amber where it is brighter than usual, blue where fainter. A moving star
                    leaves an amber–blue pair; a star that varies turns amber or blue in place. Both
                    are display only. The exposures see slightly different wavelengths and blur, so
                    bright stars always leave some residue: that alone is not a change.
                  </p>
                  <div className="row">
                    <button onClick={() => setMode('stack')}>Show stacked</button>
                    <button onClick={() => setMode('diff')}>Show changes</button>
                  </div>
                </section>
                {!state && (
                  <section className="block" aria-labelledby="cmp-h">
                    <h2 id="cmp-h">Blink two exposures</h2>
                    {markA && cur && markA.url !== cur.url ? (
                      <>
                        <p>
                          A is {date(markA.mjd)}; B would be this one, {date(cur.mjd)}.
                        </p>
                        <div className="row">
                          <button
                            className="primary"
                            onClick={() =>
                              props.onCompare({
                                kind: 'archive',
                                ra,
                                dec,
                                band,
                                a: { url: markA.url, mjd: markA.mjd, um: markA.um },
                                b: { url: cur.url, mjd: cur.mjd, um: cur.um },
                                mode: 'blink',
                                zoom: 1,
                              })
                            }
                          >
                            Compare these two
                          </button>
                          <button className="quiet" onClick={() => setMarkA(null)}>
                            Clear A
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="note">
                          Mark this exposure as A, step to another, then blink them or view them
                          side by side.
                        </p>
                        <button
                          disabled={!cur}
                          onClick={() => {
                            if (!cur) return;
                            setMarkA(cur);
                            props.announce(`Marked ${date(cur.mjd)} as A.`);
                          }}
                        >
                          {markA ? 'A is this exposure' : 'Mark as A'}
                        </button>
                      </>
                    )}
                  </section>
                )}
              </>
            )}

            {tab === 'sky' && (
              <Suspense fallback={<p role="status">Loading the sky map…</p>}>
                <SkyPanel ra={ra} dec={dec} sizeArcmin={size} band={band} />
              </Suspense>
            )}
          </div>

          <p className="note">
            NASA/IPAC IRSA SPHEREx Level 2 images, reprojected for display (bilinear, median
            background removed). The picture is not a measurement; the Measure and Spectrum tabs
            work on the archive pixel values and give their uncertainties.
          </p>
        </div>
      </div>
    </div>
  );
}

function FlagLine({ flags }: { flags: string[] | null }) {
  if (flags === null) return <p className="muted">Quality flags not reported for this exposure.</p>;
  if (flags.length === 0) return <p className="muted">No contamination flags at the ring.</p>;
  return (
    <p className="flip-flags">
      <span aria-hidden>⚑ </span>Flagged at the ring:{' '}
      {flags.map((f, k) => (
        <span key={f}>
          {k > 0 && ', '}
          <abbr title={FLAG_ABOUT[f] ?? f}>{f}</abbr>
          {FLAG_ABOUT[f] && <span className="muted"> ({FLAG_ABOUT[f]})</span>}
        </span>
      ))}
    </p>
  );
}

/** The challenge's five test targets, and any coordinates or target name. */
function TargetBar(props: { current: FlipTarget; onGo: (t: FlipTarget) => void }) {
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="flip-targets">
      <div className="chips" role="group" aria-label="Challenge targets">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            className="chip"
            aria-pressed={sameSpot(t, props.current)}
            onClick={() => props.onGo({ ra: t.ra, dec: t.dec, label: t.name, band: t.band })}
          >
            {t.name}
          </button>
        ))}
      </div>
      <form
        className="flip-go"
        onSubmit={(e) => {
          e.preventDefault();
          const text = q.trim().toLowerCase();
          const t = TARGETS.find(
            (x) => x.name.toLowerCase() === text || x.aliases.some((a) => a === text),
          );
          if (t) return props.onGo({ ra: t.ra, dec: t.dec, label: t.name, band: t.band });
          const c = parseCoords(q);
          if (!c)
            return setError(
              'Enter RA and Dec, in degrees (133.795 -7.245) or hours and degrees (08h55m10.8s -7d14m42.5s).',
            );
          setError('');
          props.onGo({ ...c, label: 'Your coordinates', band: props.current.band });
        }}
      >
        <label htmlFor="flip-q" className="sr-only">
          Coordinates (RA Dec) or target name
        </label>
        <input
          id="flip-q"
          autoComplete="off"
          placeholder="RA Dec, e.g. 08h55m10.8s −7d14m42.5s"
          value={q}
          aria-invalid={!!error}
          aria-describedby={error ? 'flip-q-err' : undefined}
          onChange={(e) => (setQ(e.target.value), setError(''))}
        />
        <button type="submit">Go</button>
        {error && (
          <p id="flip-q-err" className="note" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { frameNear, loadProperties, type CubeInfo } from '../features/atlas/hips.ts';
import { loadIndex, loadManifest } from '../lib/manifest.ts';
import { formatDec, formatRa } from '../lib/sky.ts';
import type { FieldSummary, Manifest } from '../types/manifest.ts';
import { Dock, Locator } from './Dock.tsx';
import { useEscape } from './escape.ts';
import type { Challenge, Rect } from './Inspect.tsx';
import {
  HOME,
  parseAngle,
  PLACES,
  placeView,
  search,
  TARGETS,
  type Place,
  type Target,
} from './places.ts';
import { clampView, easeInOut, flight, separation, toScreen, type View } from './projection.ts';
import { parseRoute, routeHash, type Route } from './route.ts';
import { PALETTES, SkyDome, type DomeStatus, type Palette } from './SkyDome.tsx';
import { play, setSound } from './sound.ts';
import {
  checkSaved,
  readFlag,
  readNotes,
  readSession,
  writeFlag,
  writeNotes,
  writeSession,
  type ArchiveCompare as ArchiveState,
  type Compare,
  type CuratedCompare,
  type FlipTarget,
  type Note,
  type Session,
} from './store.ts';

// heavy views load only when first opened
const Flipbook = lazy(() => import('./Flipbook.tsx').then((m) => ({ default: m.Flipbook })));
const Inspect = lazy(() => import('./Inspect.tsx').then((m) => ({ default: m.Inspect })));
const Spacecraft = lazy(() => import('./Spacecraft.tsx').then((m) => ({ default: m.Spacecraft })));
const ArchiveCompare = lazy(() =>
  import('./ArchiveCompare.tsx').then((m) => ({ default: m.ArchiveCompare })),
);

type Panel = 'search' | 'light' | null;
const LABEL: Record<Route, string> = {
  welcome: 'Return to sky',
  sky: 'Return to sky',
  flipbook: 'Back to Flipbook',
  analysis: 'Back to analysis',
  spacecraft: 'Back to Spacecraft',
  notebook: 'Back to Notebook',
};
const freshCompare = (p: Place, m: Manifest): CuratedCompare => ({
  kind: 'curated',
  placeId: p.id,
  manifestId: m.manifest_id,
  a: m.observations[0]?.observation_id ?? '',
  b: m.template ? 'typical' : (m.observations[1]?.observation_id ?? ''),
  candidate: p.field?.featured ?? null,
  mode: 'one',
  zoom: 1,
  pan: { x: 0, y: 0 },
});

const STOPS = [
  { um: 1.25, about: 'Closest to visible light; mostly starlight.' },
  { um: 2.24, about: 'Dust begins to turn see-through.' },
  { um: 3.29, about: 'Includes a glow from tiny dust grains in gas clouds.' },
  { um: 4.6, about: 'Near the longest wavelengths SPHEREx measures.' },
];
const DEFAULT_FRAME = 47; // 2.24 µm, the atlas default

const reducedQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const canRender = () =>
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function' &&
  !!document.createElement('canvas').getContext('2d');

// a route in the address (reload, shared link, Back) resumes the session; with no route at all
// the front door is the Flipbook, at ?ra=&dec=(&band=) or on Barnard's Star. #/ is the welcome.
const linked = parseRoute(typeof location === 'undefined' ? '' : location.hash);
const saved0 = readSession();
const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const qRa = parseAngle(query.get('ra') ?? '', true);
const qDec = parseAngle(query.get('dec') ?? '', false);
const qBand = query.get('band') ?? '';
const landing = TARGETS[0] as Target;
const linkedFlip: FlipTarget | null =
  qRa !== null && qDec !== null
    ? {
        ra: qRa,
        dec: qDec,
        label: 'Linked coordinates',
        band: /^D[1-6]$/.test(qBand) ? qBand : 'D1',
      }
    : null;
const firstRoute: Route =
  linkedFlip || (linked === 'welcome' && !location.hash.startsWith('#/')) ? 'flipbook' : linked;
const resume = firstRoute !== 'welcome' ? saved0 : null;
const firstFlip: FlipTarget | null =
  linkedFlip ??
  (firstRoute === 'flipbook' && !location.hash
    ? { ra: landing.ra, dec: landing.dec, label: landing.name, band: landing.band }
    : null);
const resumePlace = PLACES.find((p) => p.id === resume?.placeId) ?? null;

export function Prototype() {
  const [nav, setNav] = useState<{ route: Route; from: Route | null }>({
    route: firstRoute,
    from: null,
  });
  const route = nav.route;
  const [saved] = useState(readSession);
  const [view, setView] = useState<View>(() => (resume ? clampView(resume.view) : HOME));
  const [moving, setMoving] = useState(false);
  const [frame, setFrame] = useState(resume?.frame ?? DEFAULT_FRAME);
  const [prevFrame, setPrevFrame] = useState<number | null>(null);
  const [palette, setPalette] = useState<Palette>(() =>
    PALETTES.some((p) => p.id === resume?.palette) ? (resume?.palette as Palette) : 'ivory',
  );
  const [place, setPlace] = useState<Place | null>(resumePlace);
  const [arrived, setArrived] = useState(!!resumePlace);
  const [from, setFrom] = useState<Rect | null>(null);
  const [compare, setCompare] = useState<Compare | null>(resume?.compare ?? null);
  const [reopened, setReopened] = useState<CuratedCompare | null>(null);
  const [flip, setFlip] = useState<FlipTarget | null>(firstFlip ?? resume?.flip ?? null);
  const [mounted, setMounted] = useState<Set<Route>>(() => new Set([firstRoute]));
  const [dockOpen, setDockOpen] = useState(
    () => typeof matchMedia !== 'function' || matchMedia('(min-width: 761px)').matches,
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [notes, setNotes] = useState<Note[]>(readNotes);
  const [sound, setSoundOn] = useState(() => readFlag('sound'));
  const [hint, setHint] = useState(() => !readFlag('hint-dismissed'));
  const [invites, setInvites] = useState<Record<string, boolean>>({});
  const [challenge, setChallenge] = useState<Challenge>(null);
  const [cube, setCube] = useState<CubeInfo | null | 'error'>(null);
  const [fields, setFields] = useState<FieldSummary[]>([]);
  const [manifests, setManifests] = useState<Record<string, Manifest | 'error'>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [status, setStatus] = useState<DomeStatus>({ loading: 0, failed: 0 });
  const [announcement, setAnnouncement] = useState('');
  const [back, setBack] = useState<{ view: View; place: Place | null } | null>(null);
  const [reduced, setReduced] = useState(reducedQuery);
  const [supported] = useState(canRender);
  const flightRef = useRef(0);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const onSize = useCallback((w: number, h: number) => setSize({ w, h }), []);
  const domeRef = useRef<HTMLDivElement>(null);

  // routes live in the hash; history.state remembers where each view was opened from
  useEffect(() => {
    history.replaceState({ route: firstRoute, from: null }, '', routeHash(firstRoute));
    const pop = (e: PopStateEvent) => {
      const r = parseRoute(location.hash);
      const st = e.state as { from?: Route | null } | null;
      setNav({ route: r, from: st?.from ?? null });
      setMounted((s) => (s.has(r) ? s : new Set(s).add(r)));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });
  const go = useCallback((r: Route, replace = false) => {
    const cur = navRef.current;
    if (r === cur.route) return;
    const st = { route: r, from: replace ? cur.from : cur.route };
    if (replace) history.replaceState(st, '', routeHash(r));
    else history.pushState(st, '', routeHash(r));
    setNav(st);
    setMounted((s) => (s.has(r) ? s : new Set(s).add(r)));
    setPanel(null);
  }, []);
  // the Flipbook's point is shareable as ?ra=&dec=&band=; other views drop it (it would win on reload)
  useEffect(() => {
    const u = new URL(location.href);
    u.search =
      route === 'flipbook' && flip
        ? new URLSearchParams({
            ra: flip.ra.toFixed(5),
            dec: flip.dec.toFixed(5),
            band: flip.band,
          }).toString()
        : '';
    if (u.href !== location.href) history.replaceState(history.state, '', u);
  }, [route, flip]);
  /** Contextual back: to the view this one was opened from, through history when it matches. */
  function leave() {
    const origin = nav.from && nav.from !== 'welcome' ? nav.from : 'sky';
    const st = history.state as { from?: Route | null } | null;
    if (st?.from === origin) history.back();
    else go(origin);
  }

  // a saved "sound on" waits for the first gesture, which browsers require before audio
  useEffect(() => {
    if (!sound) return;
    const on = () => setSound(true);
    window.addEventListener('pointerdown', on, { once: true });
    window.addEventListener('keydown', on, { once: true });
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [sound]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadProperties(ac.signal).then(setCube, () => !ac.signal.aborted && setCube('error'));
    loadIndex('manifests/index.json', ac.signal).then(
      (f) => setFields(f.filter((x) => x.data_kind === 'real')),
      () => undefined,
    );
    return () => ac.abort();
  }, []);

  const info = cube && cube !== 'error' ? cube : null;
  const um = info?.wavelengths[frame];

  // a field's manifest loads only once that place is chosen
  const manifestId =
    compare?.kind === 'curated' && route === 'analysis'
      ? compare.manifestId
      : place?.field?.manifest;
  useEffect(() => {
    if (!manifestId || manifests[manifestId]) return;
    const ac = new AbortController();
    loadManifest(`manifests/${manifestId}.json`, ac.signal).then(
      (m) => setManifests((s) => ({ ...s, [manifestId]: m })),
      () => !ac.signal.aborted && setManifests((s) => ({ ...s, [manifestId]: 'error' })),
    );
    return () => ac.abort();
  }, [manifestId, manifests]);
  const manifest = manifestId ? manifests[manifestId] : undefined;

  // session: saved quietly whenever the camera settles or the selection changes
  const session = (): Session => ({
    view,
    frame,
    palette,
    placeId: place?.id ?? null,
    inspecting: route === 'analysis',
    epoch: 0,
    compare,
    flip,
  });
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  useEffect(() => {
    if (route === 'welcome' || moving) return;
    const t = setTimeout(() => writeSession(sessionRef.current()), 400);
    return () => clearTimeout(t);
  }, [route, moving, view, frame, palette, place, compare, flip]);

  const announce = useCallback((s: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(s));
  }, []);

  const fly = useCallback(
    (to: View, done?: () => void) => {
      const id = ++flightRef.current;
      const a = viewRef.current;
      const target = clampView(to);
      if (reduced || separation(a, target) < 1e-6) {
        setView(target);
        done?.();
        return;
      }
      const dur = Math.min(1600, 700 + separation(a, target) * 8);
      const t0 = performance.now();
      setMoving(true);
      const step = (now: number) => {
        if (id !== flightRef.current) return;
        const t = Math.min(1, (now - t0) / dur);
        setView(flight(a, target, easeInOut(t)));
        if (t < 1) requestAnimationFrame(step);
        else {
          setMoving(false);
          setView(target);
          done?.();
        }
      };
      requestAnimationFrame(step);
    },
    [reduced],
  );

  const onDomeView = useCallback((v: View, dragging: boolean) => {
    flightRef.current++; // the visitor took the controls: stop any flight
    setMoving(dragging);
    setView(v);
    if (dragging) setHint(false);
  }, []);

  // phones: the place sheet covers the lower half, so frame the target in the upper part of the sky
  const framed = (p: Place): View => {
    const v = placeView(p);
    return size.w > 0 && size.w < 760 ? { ...v, dec: v.dec - (0.22 * size.h * v.fov) / size.w } : v;
  };

  function goTo(p: Place, opts?: { inspect?: boolean }) {
    play('select');
    setBack({ view: viewRef.current, place });
    setPlace(p);
    setArrived(false);
    setPanel(null);
    setChallenge(null);
    announce(`Travelling to ${p.name}.`);
    fly(framed(p), () => {
      setArrived(true);
      play('arrive');
      announce(`Arrived at ${p.name}.`);
      if (opts?.inspect) openInspect(p);
    });
  }

  function goToCoords(ra: number, dec: number) {
    setBack({ view: viewRef.current, place });
    setPlace(null);
    setPanel(null);
    announce(`Travelling to RA ${ra}°, Dec ${dec}°.`);
    fly({ ra, dec, fov: Math.min(viewRef.current.fov, 6) });
  }

  function start(kind: 'explore' | 'visit' | 'infrared' | 'continue') {
    go('sky');
    if (kind === 'continue' && saved) {
      setView(clampView(saved.view));
      setFrame(saved.frame);
      setPalette(
        PALETTES.some((p) => p.id === saved.palette) ? (saved.palette as Palette) : 'ivory',
      );
      const p = PLACES.find((x) => x.id === saved.placeId) ?? null;
      setPlace(p);
      setArrived(!!p);
      setCompare(saved.compare ?? null);
      setFlip(saved.flip ?? null);
      if (saved.inspecting && saved.compare) go('analysis');
      return;
    }
    setView(HOME);
    if (kind === 'visit') setPanel('search');
    if (kind === 'infrared') {
      const orion = PLACES.find((p) => p.id === 'orion');
      if (orion) {
        setPlace(orion);
        setView({ ...placeView(orion), fov: 30 });
        fly(placeView(orion), () => setArrived(true));
      }
      setPanel('light');
    }
  }

  /** An older note, or a saved view: back to that spot on the sky. */
  function restore(s: Session) {
    const p = PLACES.find((x) => x.id === s.placeId) ?? null;
    go('sky');
    setFrame(s.frame);
    setPlace(p);
    setArrived(false);
    fly(clampView(s.view), () => setArrived(!!p));
  }

  /** A saved comparison reopens exactly, or says plainly what can no longer be shown. */
  function reopen(c: Compare) {
    if (c.kind === 'curated') {
      const p = PLACES.find((x) => x.id === c.placeId);
      if (p) setPlace(p);
      setArrived(true);
      setReopened(c);
    } else setReopened(null);
    setCompare(c);
    setFrom(null);
    go('analysis');
  }

  function save(kind: Note['kind'], title: string, detail: string, c?: Compare) {
    const note: Note = {
      id: `${Date.now()}`,
      kind,
      title,
      detail,
      savedAt: new Date().toISOString(),
      session: session(),
      ...(c ? { compare: c } : {}),
    };
    const next = [note, ...notes].slice(0, 50);
    setNotes(next);
    const ok = writeNotes(next);
    play('save');
    announce(
      ok
        ? `Saved to notebook: ${title}.`
        : 'Saved for this visit only; browser storage is unavailable.',
    );
  }

  // field footprints from the index (curated fields are north-up TAN squares of ±radius)
  const footprints = useMemo(
    () =>
      fields.map((f) => {
        const r = f.radius_arcsec / 3600;
        const cos = Math.cos((f.dec_deg * Math.PI) / 180);
        // shortcut: corners as RA/Dec offsets, fine for 0.25° fields away from the exact pole
        const pts = [
          [r, r],
          [-r, r],
          [-r, -r],
          [r, -r],
        ].map(([e, n]) => ({ ra: f.ra_deg + (e as number) / cos, dec: f.dec_deg + (n as number) }));
        return { f, pts, place: PLACES.find((p) => p.field?.manifest === f.manifest_id) };
      }),
    [fields],
  );
  const project = (ra: number, dec: number) => toScreen(view, size.w, size.h, ra, dec);
  const visible = (p: { x: number; y: number } | null) =>
    !!p && p.x > -40 && p.y > -40 && p.x < size.w + 40 && p.y < size.h + 40;

  function footprintRect(p: Place, v: View): Rect | null {
    const fp = footprints.find((x) => x.place?.id === p.id);
    const box = domeRef.current?.getBoundingClientRect();
    if (!fp || !box) return null;
    const pts = fp.pts.map((q) => toScreen(v, size.w, size.h, q.ra, q.dec));
    if (pts.some((q) => !q)) return null;
    const xs = pts.map((q) => q?.x ?? 0);
    const ys = pts.map((q) => q?.y ?? 0);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x: box.left + x, y: box.top + y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function openInspect(p: Place, v = view, ch: Challenge = challenge) {
    const m = p.field ? manifests[p.field.manifest] : undefined;
    if (!m || m === 'error') return;
    setFrom(footprintRect(p, v));
    setReopened(null);
    // the comparison in progress at this field survives leaving and coming back
    setCompare((c) => {
      const base = c?.kind === 'curated' && c.placeId === p.id ? c : freshCompare(p, m);
      return ch
        ? { ...base, candidate: ch.candidate, mode: 'one', zoom: 1, pan: { x: 0, y: 0 } }
        : base;
    });
    go('analysis');
    play('select');
    announce(`Opened the observation at ${p.name}.`);
  }
  const flipHere = (band?: string): FlipTarget => ({
    ra: place ? place.ra : view.ra,
    dec: place ? place.dec : view.dec,
    label: place ? place.name : 'Sky centre',
    band: band ?? flip?.band ?? 'D2',
  });
  function openFlipbook(band?: string) {
    setFlip(flipHere(band));
    go('flipbook');
  }

  function requestInspect(p: Place, ch: Challenge = null) {
    const target = framed(p);
    setChallenge(ch);
    if (place?.id === p.id && arrived && separation(view, target) < view.fov * 0.2 && view.fov < 3)
      openInspect(p, view, ch);
    else {
      setPlace(p);
      setArrived(false);
      fly(target, () => {
        setArrived(true);
        openInspect(p, target, ch);
      });
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (route !== 'sky') return;
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setPanel('search');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [route]);
  useEscape(panel !== null, () => setPanel(null));
  const placeCard = route === 'sky' && !!place && arrived && !panel;
  useEscape(placeCard, () => setPlace(null));

  // analysis needs something to analyse; an empty one (e.g. a stale link) falls back to the sky
  useEffect(() => {
    if (route === 'analysis' && !compare) go('sky', true);
  }, [route, compare, go]);

  if (route === 'welcome')
    return <Welcome saved={saved} supported={supported} reduced={reduced} onStart={start} />;

  const where = place ? place.name : `RA ${formatRa(view.ra)}, Dec ${formatDec(view.dec)}`;
  const nearest = PLACES.map((p) => ({ p, d: separation(view, placeView(p)) })).sort(
    (a, b) => a.d - b.d,
  )[0];
  const width = view.fov >= 10 ? `${Math.round(view.fov)}°` : `${view.fov.toFixed(1)}°`;
  const fp = place ? footprints.find((x) => x.place?.id === place.id) : undefined;
  const curPlace =
    compare?.kind === 'curated' ? PLACES.find((p) => p.id === compare.placeId) : undefined;
  const saveCheck =
    reopened && manifest && manifest !== 'error' ? checkSaved(reopened, manifest) : null;
  const backLabel = LABEL[nav.from && nav.from !== 'welcome' ? nav.from : 'sky'];

  return (
    <div
      className="proto"
      data-route={route}
      data-inspecting={route === 'analysis' ? '' : undefined}
    >
      <header className="topbar">
        <button className="wordmark" onClick={() => go('welcome')} aria-label="PARALLAX home">
          Parallax
        </button>
        <p className="where" aria-live="polite">
          {where}
        </p>
        <nav className="tools" aria-label="Tools">
          {route === 'sky' && (
            <>
              <button
                aria-expanded={panel === 'search'}
                onClick={() => setPanel(panel === 'search' ? null : 'search')}
              >
                Search
              </button>
              <button
                aria-expanded={panel === 'light'}
                onClick={() => setPanel(panel === 'light' ? null : 'light')}
              >
                Light{um ? <span className="wide"> {um.toFixed(2)} µm</span> : null}
              </button>
            </>
          )}
          <button
            aria-pressed={sound}
            onClick={() => {
              setSound(!sound);
              setSoundOn(!sound);
              writeFlag('sound', !sound);
              if (!sound) play('select');
            }}
          >
            Sound {sound ? 'on' : 'off'}
          </button>
        </nav>
      </header>

      <main
        className="sky"
        ref={domeRef}
        hidden={route !== 'sky' && route !== 'analysis'}
        aria-hidden={route === 'analysis' ? true : undefined}
      >
        {supported && cube !== 'error' ? (
          <SkyDome
            view={view}
            frame={frame}
            palette={palette}
            moving={moving}
            label={`Infrared sky at ${um?.toFixed(2) ?? '…'} µm, centred on ${where}, ${width} wide. Arrow keys look around; plus and minus zoom.`}
            onView={route === 'sky' ? onDomeView : undefined}
            onSize={onSize}
            onStatus={setStatus}
          >
            <svg className="fp-layer" width={size.w} height={size.h} aria-hidden="true">
              {footprints.map(({ f, pts }) => {
                const s = pts.map((q) => project(q.ra, q.dec));
                if (s.some((q) => !visible(q))) return null;
                const xs = s.map((q) => q?.x ?? 0);
                const span = Math.max(...xs) - Math.min(...xs);
                const c = project(f.ra_deg, f.dec_deg);
                return span < 12 && c ? (
                  <rect
                    key={f.manifest_id}
                    x={c.x - 6}
                    y={c.y - 6}
                    width={12}
                    height={12}
                    className="fp"
                  />
                ) : (
                  <polygon
                    key={f.manifest_id}
                    points={s.map((q) => `${q?.x},${q?.y}`).join(' ')}
                    className="fp"
                  />
                );
              })}
            </svg>
            {fp && manifest && manifest !== 'error' && manifest.template && arrived && !moving && (
              <FieldImage
                src={manifest.template.display_png}
                pts={fp.pts.map((q) => project(q.ra, q.dec))}
              />
            )}
            {PLACES.map((p) => {
              const s = project(p.ra, p.dec);
              if (!visible(s) || !s) return null;
              const here = place?.id === p.id;
              return (
                <button
                  key={p.id}
                  className="marker"
                  data-here={here ? '' : undefined}
                  data-field={p.field ? '' : undefined}
                  style={{ transform: `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)` }}
                  onClick={() => goTo(p)}
                >
                  <span className="marker-dot" aria-hidden="true" />
                  <span className="marker-name">{p.name}</span>
                </button>
              );
            })}
          </SkyDome>
        ) : (
          <div className="unsupported" role="alert">
            <h2>
              {supported
                ? 'The all-sky map is out of reach'
                : 'This browser cannot draw the sky map'}
            </h2>
            <p>
              {supported
                ? 'IRSA’s SPHEREx map did not answer. Check your connection and reload.'
                : 'It needs OffscreenCanvas and createImageBitmap.'}{' '}
              The two curated fields are stored with this app and still open.
            </p>
            <div className="row">
              {PLACES.filter((p) => p.field).map((p) => (
                <button key={p.id} onClick={() => (setPlace(p), setArrived(true))}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="legend" aria-label="Map key">
          <span>
            <i className="sw sw-hatch" aria-hidden="true" /> No data at this wavelength
          </span>
          <span>
            <i className="sw sw-fp" aria-hidden="true" /> Time-lapse field
          </span>
        </div>

        <div className="orient">
          <div className="compass" aria-hidden="true">
            <span className="n">N</span>
            <span className="e">E</span>
          </div>
          <p className="coords">
            {formatRa(view.ra)} · {formatDec(view.dec)}
            <span className="muted">
              {' '}
              · {width} wide
              {nearest && nearest.d < Math.max(view.fov, 8) && !place
                ? ` · near ${nearest.p.name}`
                : ''}
            </span>
          </p>
          <div className="row" role="group" aria-label="View">
            <button onClick={() => fly({ ...view, fov: view.fov / 1.6 })} aria-label="Zoom in">
              +
            </button>
            <button onClick={() => fly({ ...view, fov: view.fov * 1.6 })} aria-label="Zoom out">
              −
            </button>
            {back && (
              <button
                onClick={() => {
                  const b = back;
                  setBack(null);
                  setPlace(b.place);
                  setArrived(false);
                  fly(b.view, () => setArrived(!!b.place));
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                setPlace(null);
                setBack({ view, place });
                fly(HOME);
              }}
            >
              Reset view
            </button>
          </div>
        </div>

        <p className="sky-status" role="status">
          {cube === null
            ? 'Connecting to the SPHEREx all-sky map at NASA/IPAC IRSA…'
            : status.failed > 0
              ? `${status.failed} sky tile${status.failed > 1 ? 's' : ''} failed to load.`
              : status.loading > 0 && !moving
                ? 'Loading sky…'
                : ''}
        </p>

        {hint && !place && (
          <div className="hint">
            <p>Drag to look around. Scroll or pinch to zoom. Choose a name to travel there.</p>
            <button
              className="quiet"
              aria-label="Dismiss tip"
              onClick={() => {
                setHint(false);
                writeFlag('hint-dismissed', true);
              }}
            >
              Got it
            </button>
          </div>
        )}

        {placeCard && place && (
          <aside className="place" aria-labelledby="place-h">
            <button className="close" onClick={() => setPlace(null)} aria-label="Close details">
              ×
            </button>
            <h2 id="place-h">{place.name}</h2>
            <p>{place.about}</p>
            <p className="note">
              SPHEREx all-sky map{um ? ` at ${um.toFixed(2)} µm` : ''} ·{' '}
              {info?.collection ?? 'SPHEREx'}
            </p>
            {place.field ? (
              <>
                {manifest === 'error' && <p role="alert">The curated field could not be loaded.</p>}
                <div className="row">
                  <button
                    className="primary"
                    disabled={!manifest || manifest === 'error'}
                    onClick={() => requestInspect(place)}
                  >
                    {manifest ? 'Open the observation' : 'Loading observation…'}
                  </button>
                  <button
                    onClick={() => save('view', place.name, `Sky view, ${um?.toFixed(2)} µm`)}
                  >
                    Save view
                  </button>
                </div>
                <p className="note">
                  The amber square is the observation: 15′ across,{' '}
                  {fields.find((f) => f.manifest_id === place.field?.manifest)?.observations ?? 10}{' '}
                  visits.
                </p>
                {!invites[place.id] && (
                  <aside className="invite">
                    <p>
                      <strong>Challenge</strong> · real data. Something here changed between visits.
                      Can you find it?
                    </p>
                    <div className="row">
                      <button
                        onClick={() =>
                          requestInspect(place, {
                            kind: 'find',
                            candidate: place.field?.featured ?? '',
                          })
                        }
                        disabled={!manifest || manifest === 'error'}
                      >
                        Try it
                      </button>
                      <button
                        className="quiet"
                        onClick={() => setInvites((s) => ({ ...s, [place.id]: true }))}
                      >
                        Not now
                      </button>
                    </div>
                  </aside>
                )}
              </>
            ) : (
              <>
                <div className="row">
                  <button className="primary" onClick={() => setPanel('light')}>
                    Change the light
                  </button>
                  <button
                    onClick={() => save('view', place.name, `Sky view, ${um?.toFixed(2)} µm`)}
                  >
                    Save view
                  </button>
                </div>
                <p className="note">
                  No time-lapse here. This app’s repeated visits cover two small fields at the
                  ecliptic poles.{' '}
                  <button className="link" onClick={() => goTo(PLACES[0] as Place)}>
                    Go to one
                  </button>
                </p>
              </>
            )}
            <button className="link" onClick={() => openFlipbook()}>
              Every archive exposure here, in time order (Flipbook)
            </button>
          </aside>
        )}
      </main>

      {panel === 'search' && (
        <SearchPanel
          onPlace={(p) => goTo(p)}
          onCoords={goToCoords}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'light' && (
        <aside className="drawer" aria-labelledby="lightd-h">
          <button className="close" onClick={() => setPanel(null)} aria-label="Close">
            ×
          </button>
          <h2 id="lightd-h">Infrared light</h2>
          {info ? (
            <>
              <p className="big-um">
                {um?.toFixed(2)} <span>µm</span>
              </p>
              <label className="slider">
                <span className="sr-only">Wavelength</span>
                <input
                  type="range"
                  min={0}
                  max={info.wavelengths.length - 1}
                  value={frame}
                  aria-valuetext={`${um?.toFixed(2)} micrometres`}
                  onChange={(e) => {
                    let f = Number(e.target.value);
                    if (info.blank.has(f)) f = frameNear(info, info.wavelengths[f] ?? 1);
                    setPrevFrame(frame);
                    setFrame(f);
                  }}
                />
                <span className="ends muted">
                  <span>{info.wavelengths[0]?.toFixed(2)} µm</span>
                  <span>{info.wavelengths.at(-1)?.toFixed(2)} µm</span>
                </span>
              </label>
              <p className="note">
                A real change: each step loads a different SPHEREx map, measured in that light.
              </p>
              <div className="stops">
                {STOPS.map((s) => {
                  const f = frameNear(info, s.um);
                  return (
                    <button
                      key={s.um}
                      aria-pressed={frame === f}
                      onClick={() => {
                        setPrevFrame(frame);
                        setFrame(f);
                        play('select');
                        announce(`Showing ${info.wavelengths[f]?.toFixed(2)} micrometres.`);
                      }}
                    >
                      <strong>{info.wavelengths[f]?.toFixed(2)} µm</strong>
                      <span>{s.about}</span>
                    </button>
                  );
                })}
              </div>
              {prevFrame !== null && prevFrame !== frame && (
                <button onClick={() => (setFrame(prevFrame), setPrevFrame(frame))}>
                  Flip back to {info.wavelengths[prevFrame]?.toFixed(2)} µm
                </button>
              )}
              <h3>Colours</h3>
              <div className="seg" role="radiogroup" aria-label="Display colours">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={palette === p.id}
                    onClick={() => setPalette(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="note">
                Display only: changes how brightness is coloured on screen, not the light or the
                data. Brightness uses IRSA’s display scaling ({info.pixelFunction}, {info.cut[0]}–
                {info.cut[1]} MJy/sr).
              </p>
              {info.blank.size > 0 && (
                <p className="note">
                  {info.blank.size} of {info.wavelengths.length} channels are empty in this map and
                  are skipped.
                </p>
              )}
            </>
          ) : (
            <p role="status">
              {cube === 'error' ? 'Wavelength list unavailable.' : 'Loading wavelengths…'}
            </p>
          )}
        </aside>
      )}
      {route === 'notebook' && (
        <section className="notebook view" aria-labelledby="nb-h">
          <h1 id="nb-h">Notebook</h1>
          {notes.length === 0 ? (
            <p className="note">
              Nothing saved yet. Use “Save view”, “Save this visit” or “Save comparison” as you
              explore. Notes stay in this browser.
            </p>
          ) : (
            <ul className="notes">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    className="note-open"
                    onClick={() => (n.compare ? reopen(n.compare) : restore(n.session))}
                  >
                    <strong>{n.title}</strong>
                    <span className="muted">{n.detail}</span>
                    <span className="muted">
                      {n.compare
                        ? 'Comparison · reopens in analysis'
                        : n.kind === 'comparison'
                          ? 'Comparison (older note) · opens the sky there'
                          : n.kind === 'visit'
                            ? 'Visit'
                            : 'View'}{' '}
                      ·{' '}
                      {new Date(n.savedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </button>
                  <button
                    className="quiet"
                    aria-label={`Remove ${n.title}`}
                    onClick={() => {
                      const next = notes.filter((x) => x.id !== n.id);
                      setNotes(next);
                      writeNotes(next);
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mounted.has('flipbook') && (
        <div className="view-host" hidden={route !== 'flipbook'}>
          <Suspense fallback={<p role="status">Loading the Flipbook…</p>}>
            <Flipbook
              target={flip ?? flipHere()}
              active={route === 'flipbook'}
              palette={palette}
              reduced={reduced}
              onTarget={setFlip}
              onCompare={(c) => {
                setCompare(c);
                setReopened(null);
                go('analysis');
              }}
              announce={announce}
            />
          </Suspense>
        </div>
      )}

      {mounted.has('spacecraft') && (
        <div className="view-host" hidden={route !== 'spacecraft'}>
          <Suspense fallback={<p role="status">Loading the spacecraft…</p>}>
            <Spacecraft
              active={route === 'spacecraft'}
              reduced={reduced}
              onWavelengths={() => {
                go('sky');
                setPanel('light');
              }}
              onFlipbook={(b) => openFlipbook(b)}
            />
          </Suspense>
        </div>
      )}

      {route !== 'sky' && route !== 'analysis' && (
        <Locator
          view={view}
          frame={frame}
          palette={palette}
          where={where}
          onSky={() => go('sky')}
        />
      )}

      {route === 'analysis' &&
        compare?.kind === 'curated' &&
        (manifest && manifest !== 'error' && curPlace ? (
          saveCheck && saveCheck.missing.length > 0 ? (
            <div className="inspect inspect-loading" role="alert">
              <h2>This saved comparison can’t be reopened as saved</h2>
              <ul>
                {saveCheck.missing.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => (setCompare(freshCompare(curPlace, manifest)), setReopened(null))}
                >
                  Open the field as it is now
                </button>
                <button onClick={leave}>{backLabel}</button>
              </div>
            </div>
          ) : (
            <Suspense fallback={<p role="status">Loading the observation…</p>}>
              <Inspect
                place={curPlace}
                manifest={manifest}
                frame={frame}
                palette={palette}
                onPalette={setPalette}
                state={compare}
                onState={(p) => setCompare((c) => (c?.kind === 'curated' ? { ...c, ...p } : c))}
                notice={saveCheck?.changed ?? []}
                from={from}
                reduced={reduced}
                challenge={challenge}
                onChallenge={setChallenge}
                announce={announce}
                onSave={save}
                returnLabel={backLabel}
                onReturn={(then) => {
                  setChallenge(null);
                  if (then === 'wavelengths') {
                    go('sky');
                    setPanel('light');
                  } else leave();
                }}
              />
            </Suspense>
          )
        ) : (
          <div className="inspect inspect-loading" role="status">
            {manifest === 'error' || (manifest && !curPlace)
              ? 'The observation could not be loaded.'
              : 'Loading the observation…'}
            <button onClick={leave}>{backLabel}</button>
          </div>
        ))}

      {route === 'analysis' && compare?.kind === 'archive' && (
        <Suspense fallback={<p role="status">Loading the comparison…</p>}>
          <ArchiveCompare
            state={compare}
            onState={(p: Partial<ArchiveState>) =>
              setCompare((c) => (c?.kind === 'archive' ? { ...c, ...p } : c))
            }
            palette={palette}
            reduced={reduced}
            returnLabel={backLabel}
            onReturn={leave}
            onSave={(t, d) => save('comparison', t, d, compare)}
          />
        </Suspense>
      )}

      <Dock
        route={route}
        open={dockOpen}
        onOpen={setDockOpen}
        onGo={(r) => (r === 'flipbook' ? openFlipbook() : go(r))}
        notes={notes.length}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** The curated field's median image, placed in its footprint by the projected corners. */
function FieldImage({ src, pts }: { src: string; pts: ({ x: number; y: number } | null)[] }) {
  const [tl, tr, , bl] = pts; // NE, NW, SW, SE order from the footprint → screen TL, TR, BR, BL
  if (!tl || !tr || !bl) return null;
  const n = 147;
  const m = [
    (tr.x - tl.x) / n,
    (tr.y - tl.y) / n,
    (bl.x - tl.x) / n,
    (bl.y - tl.y) / n,
    tl.x,
    tl.y,
  ];
  if (Math.abs(m[0] as number) * n < 40) return null;
  return (
    <img
      className="field-img"
      src={src}
      alt=""
      width={n}
      height={n}
      style={{ transform: `matrix(${m.join(',')})` }}
    />
  );
}

function SearchPanel(props: {
  onPlace: (p: Place) => void;
  onCoords: (ra: number, dec: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const r = search(q);
  const list = r.kind === 'places' ? r.places : [];
  return (
    <aside className="drawer search" aria-labelledby="search-h">
      <button className="close" onClick={props.onClose} aria-label="Close">
        ×
      </button>
      <h2 id="search-h">Go somewhere</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (r.kind === 'coords') props.onCoords(r.ra, r.dec);
          else if (list[active]) props.onPlace(list[active]);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Place name or coordinates
        </label>
        <input
          id="q"
          autoFocus
          autoComplete="off"
          placeholder="Orion, M31, or 83.8 −5.4"
          value={q}
          role="combobox"
          aria-expanded={list.length > 0}
          aria-controls="q-list"
          aria-activedescendant={list[active] ? `q-${list[active].id}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const d = e.key === 'ArrowDown' ? 1 : -1;
            setActive((a) => Math.max(0, Math.min(list.length - 1, a + d)));
          }}
        />
      </form>
      {r.kind === 'coords' ? (
        <p className="note" role="status">
          Press Enter to go to RA {r.ra}°, Dec {r.dec}° (ICRS).
        </p>
      ) : list.length === 0 ? (
        <p className="note" role="status">
          No curated place called “{q}”. Try a name below, or decimal coordinates like 83.8 −5.4.
          Looking up any object name needs an external catalogue, which this prototype does not use.
        </p>
      ) : (
        <ul id="q-list" role="listbox" className="results" aria-label="Places">
          {list.map((p, i) => (
            <li
              key={p.id}
              id={`q-${p.id}`}
              role="option"
              aria-selected={i === active}
              onClick={() => props.onPlace(p)}
            >
              <strong>{p.name}</strong>
              <span className="muted">{p.field ? 'Time-lapse: 10 visits' : 'All-sky map'}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Welcome(props: {
  saved: Session | null;
  supported: boolean;
  reduced: boolean;
  onStart: (k: 'explore' | 'visit' | 'infrared' | 'continue') => void;
}) {
  const savedPlace = PLACES.find((p) => p.id === props.saved?.placeId);
  return (
    <div className="welcome">
      {props.supported && (
        <div className="welcome-sky" data-still={props.reduced ? '' : undefined} aria-hidden="true">
          <SkyDome
            view={{ ra: 266.4, dec: -28.9, fov: 140 }}
            frame={DEFAULT_FRAME}
            palette="ivory"
            resolution={0.5}
            label=""
          />
        </div>
      )}
      <main className="welcome-body">
        <p className="wordmark-lg">Parallax</p>
        <h1>The sky in infrared, as SPHEREx sees it</h1>
        <p className="lede">
          Real observations from NASA’s SPHEREx space telescope. Look around, visit a place, or
          change the kind of light you see by.
        </p>
        <div className="choices">
          {props.saved && (
            <button className="primary choice" onClick={() => props.onStart('continue')}>
              Continue exploring
              <span>{savedPlace ? savedPlace.name : 'Where you left off'}</span>
            </button>
          )}
          <button
            className={`choice ${props.saved ? '' : 'primary'}`}
            onClick={() => props.onStart('explore')}
          >
            Explore the sky
            <span>Look around freely</span>
          </button>
          <button className="choice" onClick={() => props.onStart('visit')}>
            Visit somewhere interesting
            <span>Nebulae, galaxies, and two spots watched over time</span>
          </button>
          <button className="choice" onClick={() => props.onStart('infrared')}>
            Experiment with infrared
            <span>See one place in different light</span>
          </button>
        </div>
        <p className="welcome-foot muted">
          Imagery: SPHEREx DR1 all-sky map, NASA/IPAC IRSA. Prototype for design review.
        </p>
      </main>
    </div>
  );
}

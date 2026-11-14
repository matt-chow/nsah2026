import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { SkyCanvas, STRETCH, type Layer, type Stretch } from '../components/SkyCanvas.tsx';
import { Icon } from '../components/Icon.tsx';
import { Term } from '../components/Term.tsx';
import { AnalyzePanel } from '../features/analysis/AnalyzePanel.tsx';
import {
  CandidateList,
  ChangeSummary,
  EvidenceReport,
  Glyph,
  plainKind,
} from '../features/candidates/CandidatesPanel.tsx';
import { buildStory, DiscoverPanel, storyCandidate } from '../features/discover/DiscoverPanel.tsx';
import { BookmarkButton } from '../features/journal/BookmarkButton.tsx';
import { CoordinateSearch } from '../features/sky-explorer/CoordinateSearch.tsx';
import { Timeline } from '../features/timeline/Timeline.tsx';
import { checkPair, type PairCheck } from '../lib/compare.ts';
import { loadImage } from '../lib/imageCache.ts';
import { changeEntry, observationEntry } from '../lib/journal.ts';
import { displayTitle, loadIndex, loadManifest } from '../lib/manifest.ts';
import { skyToPixel, tanWcs } from '../lib/sky.ts';
import { isoDate, longDate } from '../lib/time.ts';
import type { FieldSummary, Manifest, Observation } from '../types/manifest.ts';
import { Intro } from './Intro.tsx';
import { SiteNav, type Section } from './SiteNav.tsx';
import { ViewGuide } from './ViewGuide.tsx';

// Everything beyond the observatory loads on first visit, so the science viewer stays light.
const named = <K extends string>(load: () => Promise<Record<K, ComponentType<PageProps>>>, k: K) =>
  lazy(() => load().then((m) => ({ default: m[k] })));
export interface PageProps {
  fields: FieldSummary[] | null;
}
const PAGES: Record<
  Exclude<Section, 'observatory'>,
  LazyExoticComponent<ComponentType<PageProps>>
> = {
  sky: named(() => import('../features/globe/GlobePage.tsx'), 'GlobePage'),
  spacecraft: named(() => import('../features/spacecraft/SpacecraftPage.tsx'), 'SpacecraftPage'),
  spectrum: named(() => import('../features/spectrum/SpectrumPage.tsx'), 'SpectrumPage'),
  journal: named(() => import('../features/journal/JournalPage.tsx'), 'JournalPage'),
  arcade: named(() => import('../features/arcade/ArcadePage.tsx'), 'ArcadePage'),
};

const BASE = import.meta.env.BASE_URL;
const DEMO_FIELD = 'nep-d2';

export type Tab = 'discover' | 'explore' | 'analyze';
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'discover', label: 'Discover', hint: 'A guided investigation in five steps' },
  { id: 'explore', label: 'Explore', hint: 'Compare any two dates yourself' },
  { id: 'analyze', label: 'Analyze', hint: 'Measurements, calibration and provenance' },
];

type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: T };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** `#/sky` names a page; `#nep-d2/c012` opens a field (and change) in the observatory. */
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const page = h.startsWith('/') ? h.slice(1).split('/')[0] : '';
  const section: Section = page && page in PAGES ? (page as Section) : 'observatory';
  const [field, cand] = section === 'observatory' ? h.split('/') : [];
  return { section, field: field || null, cand: cand || null };
}

const seenIntro = () => {
  try {
    return sessionStorage.getItem('parallax.intro') === '1';
  } catch {
    return false;
  }
};

export function App() {
  const [index, setIndex] = useState<Load<FieldSummary[]>>({ status: 'loading' });
  const [fieldId, setFieldId] = useState(() => readHash().field ?? DEMO_FIELD);
  const [loaded, setLoaded] = useState<Load<Manifest> & { path?: string }>({ status: 'loading' });
  const [section, setSection] = useState<Section>(() => readHash().section);
  const [intro, setIntro] = useState<'shown' | 'leaving' | 'gone'>(() =>
    seenIntro() || readHash().field || readHash().section !== 'observatory' ? 'gone' : 'shown',
  );
  const [tab, setTab] = useState<Tab>(() => (readHash().cand ? 'explore' : 'discover'));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    loadIndex(`${BASE}manifests/index.json`, ctrl.signal).then(
      (value) => setIndex({ status: 'ready', value }),
      (e: unknown) => !ctrl.signal.aborted && setIndex({ status: 'error', message: errText(e) }),
    );
    return () => ctrl.abort();
  }, [retry]);

  const summary =
    index.status === 'ready' ? index.value.find((f) => f.manifest_id === fieldId) : undefined;
  const path = summary?.path ?? (index.status === 'ready' ? index.value[0]?.path : undefined);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    loadManifest(`${BASE}${path}`, ctrl.signal).then(
      (value) => setLoaded({ status: 'ready', value, path }),
      (e: unknown) =>
        !ctrl.signal.aborted && setLoaded({ status: 'error', message: errText(e), path }),
    );
    return () => ctrl.abort();
  }, [path, retry]);

  const manifest: Load<Manifest> = loaded.path === path ? loaded : { status: 'loading' };

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      if (h.field) setFieldId(h.field);
      if (h.section !== 'observatory') {
        setIntro('gone');
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const enter = (to: Tab) => {
    try {
      sessionStorage.setItem('parallax.intro', '1');
    } catch {
      /* private mode: the intro simply shows again next visit */
    }
    setTab(to);
    if (to === 'discover') setFieldId(DEMO_FIELD);
    const instant = reducedMotion();
    setIntro(instant ? 'gone' : 'leaving');
    if (!instant) window.setTimeout(() => setIntro('gone'), 900);
  };

  const failure =
    index.status === 'error'
      ? index.message
      : manifest.status === 'error'
        ? manifest.message
        : null;

  const Page = section === 'observatory' ? null : PAGES[section];
  return (
    <div className="app">
      <SiteNav
        section={section}
        fieldId={fieldId}
        inert={intro !== 'gone' && section === 'observatory'}
      />
      {intro !== 'gone' && section === 'observatory' && (
        <Intro
          fields={index.status === 'ready' ? index.value : null}
          leaving={intro === 'leaving'}
          onEnter={enter}
        />
      )}
      {!online && (
        <p className="banner offline" role="status">
          You are offline. Images already viewed stay available; anything new will load when you
          reconnect.
        </p>
      )}
      {Page ? (
        <Suspense
          fallback={
            <div className="state" role="status">
              <span className="spinner" aria-hidden="true" /> Opening…
            </div>
          }
        >
          <Page fields={index.status === 'ready' ? index.value : null} />
        </Suspense>
      ) : failure ? (
        <div className="state error" role="alert">
          <h2>The observations could not be loaded</h2>
          <p>{failure}</p>
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            Try again
          </button>
        </div>
      ) : manifest.status === 'ready' && index.status === 'ready' ? (
        <Workspace
          key={manifest.value.manifest_id}
          manifest={manifest.value}
          fields={index.value}
          onField={setFieldId}
          tab={tab}
          onTab={setTab}
          inert={intro !== 'gone'}
        />
      ) : (
        <div className="state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading the sky field…
        </div>
      )}
    </div>
  );
}

type Mode = 'blink' | 'overlay' | 'split' | 'difference';
const MODES: { id: Mode; label: string; key: string }[] = [
  { id: 'blink', label: 'Switch dates', key: 'B' },
  { id: 'overlay', label: 'Fade', key: 'F' },
  { id: 'split', label: 'Split', key: 'S' },
  { id: 'difference', label: 'Highlight changes', key: 'D' },
];

interface WorkspaceProps {
  manifest: Manifest;
  fields: FieldSummary[];
  onField: (id: string) => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  inert: boolean;
}

function Workspace({ manifest, fields, onField, tab, onTab, inert }: WorkspaceProps) {
  const observations = useMemo(
    () => [...manifest.observations].sort((a, b) => a.epoch.mjd_mid - b.epoch.mjd_mid),
    [manifest],
  );
  const differences = useMemo(
    () => new Map(manifest.differences.map((d) => [d.observation_id, d])),
    [manifest],
  );
  const chapters = useMemo(() => buildStory(manifest, observations), [manifest, observations]);
  const hasDiff = differences.size > 0;
  const first = observations[0] as Observation; // parseManifest guarantees one
  const wcs = useMemo(() => tanWcs(first.image.wcs), [first]);

  const initialCand = readHash().cand;
  const initial = manifest.candidates.find((c) => c.candidate_id.endsWith(initialCand ?? '\0'));
  const [candId, setCandId] = useState<string | null>(initial?.candidate_id ?? null);
  const [sheet, setSheet] = useState(true);
  const [epochId, setEpochId] = useState(initial?.observation_ids[0] ?? first.observation_id);
  const [refId, setRefId] = useState<string>(
    manifest.template ? 'template' : (observations[1] ?? first).observation_id,
  );
  const [mode, setMode] = useState<Mode>(initial && hasDiff ? 'difference' : 'blink');
  const [chapter, setChapter] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [lapse, setLapse] = useState<string[] | null>(null); // time-lapse frame ids
  const [opacity, setOpacity] = useState(0.5);
  const [splitAt, setSplitAt] = useState(0.5);
  const [stretch, setStretch] = useState<Stretch>('archive');
  const [loupe, setLoupe] = useState(false);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number; nonce: number } | null>(
    initial ? { x: initial.pixel_x, y: initial.pixel_y, nonce: 0 } : null,
  );

  const epochIdx = observations.findIndex((o) => o.observation_id === epochId);
  const epoch = observations[epochIdx] ?? first;
  const cand = manifest.candidates.find((c) => c.candidate_id === candId) ?? null;
  const diff = differences.get(epoch.observation_id);
  const refObs = observations.find((x) => x.observation_id === refId);
  const ref =
    refId === 'template' && manifest.template
      ? {
          src: manifest.template.display_png,
          name: `typical sky (median of ${observations.length} dates)`,
        }
      : {
          src: (refObs ?? first).assets.display_png,
          name: longDate((refObs ?? first).epoch.mjd_mid),
        };
  // The template is built by the pipeline from the field's compatible set, so it is comparable.
  const pair: PairCheck =
    refId === 'template' ? { status: 'compatible' } : checkPair(manifest, epochId, refId);
  const comparable = pair.status === 'compatible' || pair.status === 'same';
  const comparing = mode !== 'difference';

  useEffect(() => {
    location.replace(`#${manifest.manifest_id}${candId ? `/${candId.split('-').at(-1)}` : ''}`);
  }, [manifest.manifest_id, candId]);

  useEffect(() => {
    if (!playing || mode !== 'blink' || !comparable) return;
    const id = window.setInterval(() => setShowRef((s) => !s), 650);
    return () => window.clearInterval(id);
  }, [playing, mode, comparable]);

  // Time-lapse plays only dates the pipeline judged comparable with the current one, in date order.
  const lapseFrames = useMemo(
    () =>
      observations
        .filter((o) => {
          const s = checkPair(manifest, o.observation_id, epochId).status;
          return s === 'same' || s === 'compatible';
        })
        .map((o) => o.observation_id),
    [observations, manifest, epochId],
  );
  const skipped = observations.length - (lapse ?? lapseFrames).length;

  useEffect(() => {
    if (!lapse) return;
    const id = window.setInterval(
      () => setEpochId((e) => lapse[(lapse.indexOf(e) + 1) % lapse.length] ?? e),
      800,
    );
    return () => window.clearInterval(id);
  }, [lapse]);

  const toggleLapse = useCallback(() => {
    if (lapse) return setLapse(null);
    setPlaying(false);
    setShowRef(false);
    // decode every frame up front so playback never waits on the network
    for (const id of lapseFrames) {
      const png =
        mode === 'difference'
          ? differences.get(id)?.display_png
          : observations.find((o) => o.observation_id === id)?.assets.display_png;
      if (png) loadImage(`${BASE}${png}`).catch(() => {});
    }
    setLapse(lapseFrames);
  }, [lapse, lapseFrames, mode, differences, observations]);

  const selectCandidate = useCallback(
    (id: string | null) => {
      setCandId(id);
      if (id) setSheet(true);
      const c = manifest.candidates.find((x) => x.candidate_id === id);
      if (!c) return;
      setPlaying(false);
      setLapse(null);
      setShowRef(false);
      setEpochId((e) => (c.observation_ids.includes(e) ? e : (c.observation_ids[0] ?? e)));
      setFocus({ x: c.pixel_x, y: c.pixel_y, nonce: Date.now() });
    },
    [manifest],
  );

  // Discover drives the shared viewer: each chapter sets the view it talks about.
  const goChapter = (i: number) => {
    const n = Math.max(0, Math.min(chapters.length - 1, i));
    const v = chapters[n]?.view;
    setChapter(n);
    if (!v) return;
    setLapse(null);
    setMode(v.mode === 'difference' && !hasDiff ? 'blink' : v.mode);
    setEpochId(v.epochId);
    setShowRef(false);
    setPlaying(v.playing && !reducedMotion());
    if (manifest.template) setRefId('template');
    if (v.candId) selectCandidate(v.candId);
    else setCandId(null);
  };

  const step = useCallback(
    (d: number) => {
      const i = Math.max(0, Math.min(observations.length - 1, epochIdx + d));
      const o = observations[i];
      if (o) setEpochId(o.observation_id);
    },
    [epochIdx, observations],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        inert ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t.closest('input, select, textarea, [role=dialog], [popover]')
      )
        return;
      const order = manifest.candidates;
      const ci = order.findIndex((c) => c.candidate_id === candId);
      const pickAt = (n: number) => {
        const c = order[(n + order.length) % order.length];
        if (c) selectCandidate(c.candidate_id);
      };
      const keys: Record<string, () => void> = {
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        b: () => setMode('blink'),
        f: () => setMode('overlay'),
        s: () => setMode('split'),
        d: () => hasDiff && setMode('difference'),
        l: () => setLoupe((x) => !x),
        ' ': () => {
          if (mode !== 'blink') setMode('blink');
          setLapse(null);
          setPlaying((p) => !p);
        },
        p: toggleLapse,
        r: () => mode === 'blink' && setShowRef((s) => !s),
        j: () => pickAt(ci + 1),
        k: () => pickAt(ci - 1),
        Escape: () => setCandId(null),
      };
      const act = keys[e.key];
      if (act && !(e.key === ' ' && t.closest('button, a, summary'))) {
        e.preventDefault();
        act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inert, manifest, candId, step, hasDiff, mode, selectCandidate, toggleLapse]);

  const aSrc = `${BASE}${epoch.assets.display_png}`;
  const bSrc = `${BASE}${ref.src}`;
  const aLabel = `A · ${longDate(epoch.epoch.mjd_mid)}`;
  const layer: Layer =
    mode === 'difference' && diff
      ? { kind: 'difference', src: `${BASE}${diff.display_png}`, range: diff.display_range_sigma }
      : !comparable
        ? { kind: 'image', src: aSrc }
        : mode === 'overlay'
          ? { kind: 'overlay', src: aSrc, over: bSrc, opacity }
          : mode === 'split'
            ? {
                kind: 'split',
                src: aSrc,
                over: bSrc,
                at: splitAt,
                labels: [aLabel, `B · ${refId === 'template' ? 'typical sky' : ref.name}`],
              }
            : { kind: 'image', src: mode === 'blink' && showRef ? bSrc : aSrc };

  const showing =
    mode === 'difference'
      ? `What changed on ${longDate(epoch.epoch.mjd_mid)}, compared with the typical sky of the other dates`
      : !comparable
        ? `${longDate(epoch.epoch.mjd_mid)} only (comparison refused)`
        : mode === 'overlay'
          ? `${longDate(epoch.epoch.mjd_mid)} with ${ref.name} faded in at ${Math.round(opacity * 100)}%`
          : mode === 'split'
            ? `${longDate(epoch.epoch.mjd_mid)} on the left, ${ref.name} on the right`
            : showRef
              ? `B: ${ref.name}`
              : `A: ${longDate(epoch.epoch.mjd_mid)}`;

  const plain = tab !== 'analyze';
  const storyCand = useMemo(() => storyCandidate(manifest), [manifest]);

  return (
    <div className="workspace" data-tab={tab} inert={inert}>
      <header className="topbar">
        <div className="workspace-title">
          <h1>{displayTitle(manifest.target.label).split(',')[0]}</h1>
          <p>
            {manifest.data_kind === 'real' ? 'SPHEREx observations' : 'SIMULATED observations'} ·{' '}
            {observations.length} dates · {first.spectral.wavelength_center_um.toFixed(2)} µm
          </p>
        </div>
        <nav className="tabs" aria-label="Mode">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              title={t.hint}
              onClick={() => {
                onTab(t.id);
                if (t.id === 'discover' && tab !== 'discover') goChapter(chapter);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="workspace-actions">
          <details className="field-picker">
            <summary>Change field</summary>
            <div className="field-picker-body">
              <label className="field-select">
                <span className="visually-hidden">Sky field</span>
                <select value={manifest.manifest_id} onChange={(e) => onField(e.target.value)}>
                  {fields.map((f) => (
                    <option key={f.manifest_id} value={f.manifest_id}>
                      {f.data_kind === 'simulated' ? 'SIMULATED · ' : ''}
                      {displayTitle(f.title)}
                    </option>
                  ))}
                </select>
              </label>
              <CoordinateSearch
                fields={fields}
                onFound={(f, ra, dec) => {
                  if (f.manifest_id !== manifest.manifest_id) return onField(f.manifest_id);
                  const p = wcs && skyToPixel(wcs, ra, dec);
                  if (p) {
                    setPin(p);
                    setFocus({ ...p, nonce: Date.now() });
                  }
                }}
              />
            </div>
          </details>
          <button
            type="button"
            aria-expanded={sheet}
            aria-controls="observatory-inspector"
            onClick={() => setSheet((open) => !open)}
          >
            <Icon name="inspector" /> {sheet ? 'Hide inspector' : 'Show inspector'}
          </button>
          <button type="button" className="topbar-keys" popoverTarget="keys">
            Keys
          </button>
        </div>
      </header>
      <div id="keys" popover="auto" className="keys">
        <h2>Keyboard</h2>
        <dl className="mono">
          {[
            ['← →', 'previous / next date'],
            ['B F S D', 'switch, fade, split, highlight changes'],
            ['Space', 'start or stop switching'],
            ['P', 'play all dates as a time-lapse'],
            ['R', 'flip to date B once'],
            ['L', 'pixel loupe on / off'],
            ['J K', 'next / previous change'],
            ['Esc', 'clear selection'],
            ['+ − 0', 'zoom in, out, fit (image focused)'],
            ['Arrows', 'pan (image focused)'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {manifest.data_kind === 'simulated' && (
        <p className="banner simulated" role="note">
          <strong>SIMULATED DATA.</strong>{' '}
          {(manifest.notice ?? '').replace(/^SIMULATED DATA\.\s*/, '')}
        </p>
      )}

      <main className="stage" data-tab={tab} data-inspector={sheet}>
        <section className="viewer" aria-label="Sky viewer">
          {tab === 'discover' && (
            <section className="investigation-task" aria-label="Current investigation task">
              <div aria-live="polite">
                <p className="small dim">
                  Step {chapter + 1} of {chapters.length} · {chapters[chapter]?.title}
                </p>
                <p>{chapters[chapter]?.task}</p>
              </div>
              <div className="task-actions">
                <button
                  type="button"
                  disabled={chapter === 0}
                  onClick={() => goChapter(chapter - 1)}
                >
                  Previous step
                </button>
                {chapter < chapters.length - 1 ? (
                  <button type="button" onClick={() => goChapter(chapter + 1)}>
                    Next step
                  </button>
                ) : (
                  <button type="button" onClick={() => onTab('explore')}>
                    Explore this field
                  </button>
                )}
              </div>
            </section>
          )}
          <div className="viewer-bar" role="group" aria-label="Comparison tools">
            <div className="segmented" role="group" aria-label="View" data-tour="modes">
              {MODES.map((m) => {
                const off = m.id === 'difference' && !hasDiff;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={mode === m.id}
                    aria-keyshortcuts={m.key}
                    onClick={() => setMode(m.id)}
                    disabled={off}
                    title={
                      off
                        ? 'Change detection has not been run on this field'
                        : `${m.label} (${m.key})`
                    }
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            {mode === 'blink' && comparable && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setLapse(null);
                    setPlaying((p) => !p);
                  }}
                  aria-pressed={playing}
                >
                  <Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause A/B' : 'Play A/B'}
                </button>
                <button type="button" onClick={() => setShowRef((s) => !s)} disabled={playing}>
                  <Icon name="switch" /> Flip A/B
                </button>
              </>
            )}
            <button
              type="button"
              aria-pressed={lapse != null}
              aria-keyshortcuts="P"
              onClick={toggleLapse}
              disabled={!lapse && lapseFrames.length < 2}
              title={
                lapseFrames.length < 2
                  ? 'No other date can be compared fairly with this one'
                  : `Step through ${lapseFrames.length} dates in order (P)${skipped ? `; ${skipped} left out as not comparable` : ''}`
              }
            >
              <Icon name={lapse ? 'pause' : 'play'} />{' '}
              {lapse ? 'Pause timeline' : 'Play dates in order'}
            </button>
            {mode === 'overlay' && comparable && (
              <label className="slider">
                <span>Image B opacity</span>
                <input
                  aria-valuetext={`${Math.round(opacity * 100)}% image B, ${Math.round((1 - opacity) * 100)}% image A`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
            )}
            {mode === 'split' && comparable && (
              <label className="slider">
                <span>Divider</span>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={splitAt}
                  aria-valuetext={`${Math.round(splitAt * 100)}% image A on the left`}
                  onChange={(e) => setSplitAt(Number(e.target.value))}
                />
              </label>
            )}
            <details className="display-settings">
              <summary>
                <Icon name="settings" /> Display
              </summary>
              <div className="display-settings-body">
                <label className="ref-select">
                  <span>Display</span>
                  <select
                    value={stretch}
                    onChange={(e) => setStretch(e.target.value as Stretch)}
                    disabled={mode === 'difference'}
                    title={
                      mode === 'difference'
                        ? 'The change map keeps its fixed σ scale'
                        : 'Visualization only: measurements never use the display image'
                    }
                  >
                    {Object.entries(STRETCH).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-pressed={loupe}
                  aria-keyshortcuts="L"
                  onClick={() => setLoupe((x) => !x)}
                  title="Magnify single pixels under the pointer (L)"
                >
                  Loupe
                </button>
                <p className="small dim">
                  Visualization only. Display settings do not change measurements.
                </p>
              </div>
            </details>
          </div>

          {tab !== 'discover' && (
            <div className="pair-bar">
              <label className="ref-select">
                <span>Observation A</span>
                <select value={epochId} onChange={(e) => setEpochId(e.target.value)}>
                  {observations.map((o) => (
                    <option key={o.observation_id} value={o.observation_id}>
                      {longDate(o.epoch.mjd_mid)} · {o.provenance.data_release ?? 'SIM'}
                    </option>
                  ))}
                </select>
              </label>
              {comparing ? (
                <label className="ref-select">
                  <span>Compare with B</span>
                  <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                    {manifest.template && (
                      <option value="template">Combined typical sky (median of all dates)</option>
                    )}
                    {observations.map((o) => (
                      <option key={o.observation_id} value={o.observation_id}>
                        {longDate(o.epoch.mjd_mid)} · {o.provenance.data_release ?? 'SIM'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="small dim">
                  Reference: combined typical sky of the other {observations.length - 1} dates
                </p>
              )}
            </div>
          )}

          <div className="comparison-context" aria-label="Comparison context">
            <p aria-live={lapse || playing ? 'off' : 'polite'}>{showing}</p>
            {comparing && (
              <p className="small dim">
                A: {longDate(epoch.epoch.mjd_mid)} · B: {ref.name}.{' '}
                {comparable ? 'Fair comparison' : 'Comparison unavailable — showing A only'}.
              </p>
            )}
          </div>
          {cand && tab !== 'analyze' && (
            <p className="selection-context" aria-live={lapse || playing ? 'off' : 'polite'}>
              <Glyph kind={cand.kind} /> Selected {cand.candidate_id.split('-').at(-1)} ·{' '}
              {plainKind(cand)} · unconfirmed. Showing {longDate(epoch.epoch.mjd_mid)}
              {cand.observation_ids.includes(epoch.observation_id)
                ? ', a flagged date for this spot.'
                : '; this spot was flagged on another date.'}
            </p>
          )}
          <div className="viewer-caption">
            <div className="caption-row">
              <ul className="validity" aria-label="What this view can be trusted for">
                {mode === 'difference' ? (
                  <li data-ok={diff ? diff.status === 'validated' : undefined}>
                    {!diff
                      ? 'Not evaluated'
                      : diff.status === 'validated'
                        ? 'Noise check passed'
                        : 'Picture only'}
                  </li>
                ) : (
                  <li
                    data-ok={
                      pair.status === 'same' || pair.status === 'unknown' ? undefined : comparable
                    }
                  >
                    {pair.status === 'same'
                      ? 'One date'
                      : comparable
                        ? 'Fair comparison'
                        : pair.status === 'unknown'
                          ? 'Comparison unverified'
                          : 'Comparison refused'}
                  </li>
                )}
                <li data-ok={manifest.data_kind === 'real'}>
                  {manifest.data_kind === 'real' ? 'Real SPHEREx data' : 'Simulated'}
                </li>
              </ul>
              <BookmarkButton
                id={`obs:${epoch.observation_id}`}
                make={() => observationEntry(manifest, epoch)}
                label={`the ${longDate(epoch.epoch.mjd_mid)} observation`}
              />
            </div>
            {lapse && (
              <p className="small dim">
                Time-lapse: {lapse.length} dates in order, {lapse.indexOf(epoch.observation_id) + 1}{' '}
                of {lapse.length}
                {skipped
                  ? `. ${skipped} date${skipped > 1 ? 's' : ''} left out: not comparable with these.`
                  : '.'}
              </p>
            )}
            {comparing && !comparable && 'reasons' in pair && (
              <p className="warn" role="alert">
                These two dates cannot be compared fairly: {pair.reasons.join('; ')}. Showing date A
                alone; pick another B.
              </p>
            )}
            {mode === 'difference' && !diff && (
              <p className="warn" role="note">
                No change map exists for this date, so nothing has been evaluated here.
              </p>
            )}
            {mode === 'difference' && diff && (
              <div
                className="legend"
                aria-label={`Change strength from −${diff.display_range_sigma} to +${diff.display_range_sigma} sigma`}
              >
                <span>fainter</span>
                <span className="mono">−{diff.display_range_sigma}σ</span>
                <span className="legend-ramp" aria-hidden="true" />
                <span className="mono">+{diff.display_range_sigma}σ</span>
                <span>brighter</span>
                <span className="legend-masked" aria-hidden="true" />
                <span>not judged</span>
              </div>
            )}
            {mode === 'difference' && diff?.status === 'visualization_only' && (
              <p className="warn" role="note">
                Picture only: this date failed its noise check ({diff.reasons.join('; ')}), so no
                strengths or brightness numbers are quoted for it.
              </p>
            )}
            <details className="observation-caption">
              <summary>
                Visualization · {epoch.provenance.data_release ?? 'SIMULATED'} · observation details
              </summary>
              {tab === 'analyze' ? (
                <p className="mono dim small">
                  {epoch.spectral.wavelength_center_um.toFixed(3)} µm · D
                  {epoch.spectral.detector ?? '?'} · {epoch.provenance.data_release ?? 'SIM'} · MJD{' '}
                  {epoch.epoch.mjd_mid.toFixed(3)} {epoch.epoch.time_scale.toUpperCase()}
                  {epoch.quality.psf_fwhm_arcsec
                    ? ` · PSF ${epoch.quality.psf_fwhm_arcsec.toFixed(1)}″`
                    : ''}
                  {diff ? ` · k ${diff.noise_scale.toFixed(2)}` : ''}
                </p>
              ) : (
                <p className="small dim">
                  <Term k="infrared">Infrared</Term> at{' '}
                  {epoch.spectral.wavelength_center_um.toFixed(2)} µm ·{' '}
                  {manifest.data_kind === 'simulated' ? 'simulated' : 'SPHEREx'} image from{' '}
                  {longDate(epoch.epoch.mjd_mid)}
                  {epoch.provenance.data_release ? ` (${epoch.provenance.data_release})` : ''}
                </p>
              )}
            </details>
          </div>
          <SkyCanvas
            layer={layer}
            label={`${showing}. ${manifest.title}. ${manifest.candidates.length} marked changes.`}
            width={first.image.width_px}
            height={first.image.height_px}
            wcs={wcs}
            candidates={manifest.candidates}
            activeEpochId={epoch.observation_id}
            selectedId={candId}
            onPick={(id) => {
              selectCandidate(id);
              if (tab === 'discover') onTab('explore');
            }}
            pin={pin}
            focus={focus}
            pixelScale={first.image.pixel_scale_arcsec}
            stretch={stretch}
            loupe={loupe}
          />

          {manifest.candidates.length > 0 && (
            <details className="marker-key small dim">
              <summary>Image marker key · unconfirmed leads</summary>
              <ul className="marker-shapes">
                <li>
                  <Glyph kind="variable_like" /> Brightness change
                </li>
                <li>
                  <Glyph kind="new_source_like" /> Possible appearance
                </li>
                <li>
                  <Glyph kind="dipole_like" /> Shift or misalignment
                </li>
                <li>
                  <Glyph kind="artifact_like" /> Likely artifact
                </li>
              </ul>
              <p>
                Unconfirmed leads · solid: flagged on this date · dashed: another date · orange
                reticle: selected. The image shows all markers; the list can filter them.
              </p>
            </details>
          )}

          <Timeline
            observations={observations}
            differences={differences}
            selectedId={epoch.observation_id}
            onSelect={setEpochId}
            highlight={new Set(cand?.observation_ids ?? [])}
            quiet={lapse != null || playing}
            referenceId={comparing && refId !== 'template' ? refId : null}
            comparingDates={comparing}
            onReferenceSelect={(id) => {
              setPlaying(false);
              setLapse(null);
              setRefId(id);
            }}
            getCompatibility={(id, role) =>
              role === 'B'
                ? checkPair(manifest, epochId, id)
                : refId === 'template'
                  ? { status: 'compatible' }
                  : checkPair(manifest, id, refId)
            }
          />
        </section>

        <aside
          id="observatory-inspector"
          className="rail"
          hidden={!sheet}
          aria-label="Context and evidence"
        >
          <div className="inspector-heading">
            <div>
              <p className="small dim">
                {tab === 'discover'
                  ? 'Guided investigation'
                  : tab === 'explore'
                    ? 'Context & evidence'
                    : 'Scientific inspector'}
              </p>
              <h2>{tab === 'discover' ? 'Read the sky' : 'Investigate this field'}</h2>
            </div>
            <button
              type="button"
              aria-label="Close inspector"
              onClick={() => {
                setSheet(false);
                document
                  .querySelector<HTMLButtonElement>('[aria-controls="observatory-inspector"]')
                  ?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="rail-body">
            {tab === 'discover' ? (
              <DiscoverPanel
                chapters={chapters}
                index={chapter}
                onIndex={goChapter}
                onExplore={() => onTab('explore')}
                onAnalyze={() => onTab('analyze')}
                hasCandidate={storyCand != null}
              />
            ) : (
              <>
                <details className="inspector-section candidate-browser" open={!cand}>
                  <summary>
                    What changed?{' '}
                    <span className="dim">{manifest.candidates.length} unconfirmed leads</span>
                  </summary>
                  <CandidateList
                    manifest={manifest}
                    selectedId={candId}
                    onSelect={selectCandidate}
                    plain={plain}
                  />
                </details>
                {cand && (
                  <div className="rail-actions">
                    <BookmarkButton
                      id={`cand:${cand.candidate_id}`}
                      make={() => changeEntry(manifest, cand)}
                      label="this change"
                    />
                    <a className="button-link" href="#/journal">
                      Open journal
                    </a>
                  </div>
                )}
                {cand ? (
                  <>
                    <ChangeSummary
                      candidate={cand}
                      manifest={manifest}
                      activeEpochId={epoch.observation_id}
                      onSelectEpoch={setEpochId}
                      onAnalyze={() => onTab('analyze')}
                    />
                    {tab === 'analyze' && (
                      <details className="inspector-section">
                        <summary>Full evidence, measurements & caveats</summary>
                        <EvidenceReport
                          candidate={cand}
                          manifest={manifest}
                          activeEpochId={epoch.observation_id}
                          onSelectEpoch={setEpochId}
                        />
                      </details>
                    )}
                  </>
                ) : (
                  <p className="empty">
                    Select a marked spot on the image or a lead in the list. Compare its dates, then
                    weigh the evidence. All leads remain unconfirmed.
                  </p>
                )}
                {tab === 'analyze' && (
                  <AnalyzePanel
                    manifest={manifest}
                    observations={observations}
                    differences={differences}
                    epoch={epoch}
                    refName={
                      refId === 'template'
                        ? 'median of all dates'
                        : isoDate((refObs ?? first).epoch.mjd_mid)
                    }
                    pair={comparing ? pair : { status: 'compatible' }}
                    onSelectEpoch={setEpochId}
                  />
                )}
              </>
            )}
            {tab !== 'analyze' && (
              <ViewGuide
                mode={mode}
                comparable={comparable}
                simulated={manifest.data_kind === 'simulated'}
                pixelScale={first.image.pixel_scale_arcsec}
                dates={observations.length}
                markers={manifest.candidates.length > 0}
              />
            )}
            <details className="credits small dim">
              <summary>Archive sources & acknowledgements</summary>
              <p>{manifest.dataset.citation}</p>
              <p>{manifest.dataset.acknowledgement}</p>
              <p>
                A NASA Space Apps Challenge 2026 project. Not affiliated with or endorsed by NASA.
              </p>
            </details>
          </div>
        </aside>
      </main>
    </div>
  );
}

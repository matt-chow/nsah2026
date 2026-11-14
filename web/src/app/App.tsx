import { useCallback, useEffect, useMemo, useState } from 'react';
import { ObservationDetails } from '../components/ObservationDetails.tsx';
import { SkyCanvas, type Layer } from '../components/SkyCanvas.tsx';
import { CandidateList, EvidenceReport } from '../features/candidates/CandidatesPanel.tsx';
import { CoordinateSearch } from '../features/sky-explorer/CoordinateSearch.tsx';
import { Timeline } from '../features/timeline/Timeline.tsx';
import { loadIndex, loadManifest } from '../lib/manifest.ts';
import { skyToPixel, tanWcs } from '../lib/sky.ts';
import { isoDate } from '../lib/time.ts';
import type { FieldSummary, Manifest, Observation } from '../types/manifest.ts';
import { Intro } from './Intro.tsx';
import { Tour, type TourStep } from './Tour.tsx';

const BASE = import.meta.env.BASE_URL;
const DEMO_FIELD = 'nep-d2';
const DEMO_CANDIDATE = 'nep-d2-c012';

type Load<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readHash() {
  const [field, cand] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { field: field || null, cand: cand || null };
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
  const [intro, setIntro] = useState<'shown' | 'leaving' | 'gone'>(() =>
    seenIntro() || readHash().field ? 'gone' : 'shown',
  );
  const [tour, setTour] = useState(false);
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
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const enter = (withTour: boolean) => {
    try {
      sessionStorage.setItem('parallax.intro', '1');
    } catch {
      /* private mode: the intro simply shows again next visit */
    }
    if (withTour) {
      setFieldId(DEMO_FIELD);
      setTour(true);
    }
    const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setIntro(instant ? 'gone' : 'leaving');
    if (!instant) window.setTimeout(() => setIntro('gone'), 900);
  };

  const failure =
    index.status === 'error'
      ? index.message
      : manifest.status === 'error'
        ? manifest.message
        : null;

  return (
    <div className="app">
      {intro !== 'gone' && (
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
      {failure ? (
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
          tour={tour}
          onTour={setTour}
          inert={intro !== 'gone'}
        />
      ) : (
        <div className="state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading field…
        </div>
      )}
    </div>
  );
}

type Mode = 'blink' | 'overlay' | 'difference';

interface WorkspaceProps {
  manifest: Manifest;
  fields: FieldSummary[];
  onField: (id: string) => void;
  tour: boolean;
  onTour: (on: boolean) => void;
  inert: boolean;
}

function Workspace({ manifest, fields, onField, tour, onTour, inert }: WorkspaceProps) {
  const observations = useMemo(
    () => [...manifest.observations].sort((a, b) => a.epoch.mjd_mid - b.epoch.mjd_mid),
    [manifest],
  );
  const differences = useMemo(
    () => new Map(manifest.differences.map((d) => [d.observation_id, d])),
    [manifest],
  );
  const hasDiff = differences.size > 0;
  const first = observations[0] as Observation; // parseManifest guarantees one
  const wcs = useMemo(() => tanWcs(first.image.wcs), [first]);

  const initialCand = readHash().cand;
  const initial = manifest.candidates.find((c) => c.candidate_id.endsWith(initialCand ?? '\0'));
  const [candId, setCandId] = useState<string | null>(initial?.candidate_id ?? null);
  const [epochId, setEpochId] = useState(initial?.observation_ids[0] ?? first.observation_id);
  const [refId, setRefId] = useState<string>(
    manifest.template ? 'template' : (observations[1] ?? first).observation_id,
  );
  const [mode, setMode] = useState<Mode>(hasDiff ? 'difference' : 'blink');
  const [showRef, setShowRef] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number; nonce: number } | null>(
    initial ? { x: initial.pixel_x, y: initial.pixel_y, nonce: 0 } : null,
  );

  const epochIdx = observations.findIndex((o) => o.observation_id === epochId);
  const epoch = observations[epochIdx] ?? first;
  const cand = manifest.candidates.find((c) => c.candidate_id === candId) ?? null;
  const diff = differences.get(epoch.observation_id);
  const ref =
    refId === 'template' && manifest.template
      ? { src: manifest.template.display_png, name: `median of all ${observations.length} epochs` }
      : (() => {
          const o = observations.find((x) => x.observation_id === refId) ?? first;
          return { src: o.assets.display_png, name: `epoch ${isoDate(o.epoch.mjd_mid)}` };
        })();

  useEffect(() => {
    location.replace(`#${manifest.manifest_id}${candId ? `/${candId.split('-').at(-1)}` : ''}`);
  }, [manifest.manifest_id, candId]);

  useEffect(() => {
    if (!playing || mode !== 'blink') return;
    const id = window.setInterval(() => setShowRef((s) => !s), 600);
    return () => window.clearInterval(id);
  }, [playing, mode]);

  const selectCandidate = useCallback(
    (id: string | null) => {
      setCandId(id);
      const c = manifest.candidates.find((x) => x.candidate_id === id);
      if (!c) return;
      setEpochId((e) => (c.observation_ids.includes(e) ? e : (c.observation_ids[0] ?? e)));
      setFocus({ x: c.pixel_x, y: c.pixel_y, nonce: Date.now() });
    },
    [manifest],
  );

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
        t.closest('input, select, textarea, [role=dialog]')
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
        o: () => setMode('overlay'),
        d: () => hasDiff && setMode('difference'),
        ' ': () => {
          if (mode !== 'blink') setMode('blink');
          setPlaying((p) => !p);
        },
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
  }, [inert, manifest, candId, step, hasDiff, mode, selectCandidate]);

  const layer: Layer =
    mode === 'difference' && diff
      ? { kind: 'difference', src: `${BASE}${diff.display_png}`, range: diff.display_range_sigma }
      : mode === 'overlay'
        ? {
            kind: 'overlay',
            src: `${BASE}${epoch.assets.display_png}`,
            over: `${BASE}${ref.src}`,
            opacity,
          }
        : {
            kind: 'image',
            src: `${BASE}${mode === 'blink' && showRef ? ref.src : epoch.assets.display_png}`,
          };

  const showing =
    mode === 'difference'
      ? `Difference ${isoDate(epoch.epoch.mjd_mid)} vs. the other epochs`
      : mode === 'overlay'
        ? `${isoDate(epoch.epoch.mjd_mid)} under ${ref.name} at ${Math.round(opacity * 100)}%`
        : showRef
          ? `Reference: ${ref.name}`
          : `Epoch ${isoDate(epoch.epoch.mjd_mid)}`;

  const tourSteps: TourStep[] = useMemo(() => {
    const c =
      manifest.candidates.find((x) => x.candidate_id === DEMO_CANDIDATE) ?? manifest.candidates[0];
    return [
      {
        target: 'canvas',
        title: 'A real patch of infrared sky',
        body: 'This is a SPHEREx image of the North Ecliptic Pole at 1.45 µm, about 15 arcminutes across. Each square is one 6-arcsecond pixel. Drag to pan and scroll to zoom.',
        run: () => {
          setMode('blink');
          setPlaying(false);
          setShowRef(false);
          setCandId(null);
          if (c?.observation_ids[0]) setEpochId(c.observation_ids[0]);
        },
      },
      {
        target: 'modes',
        title: 'Blink to spot changes',
        body: 'Blink flips between this epoch and the median of all epochs, the way astronomers have compared photographic plates for a century. Anything that changed appears to jump.',
        run: () => {
          setMode('blink');
          setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);
        },
      },
      {
        target: 'canvas',
        title: 'Subtract the steady sky',
        body: 'Difference mode subtracts the median of the other epochs and divides by the measured noise. Amber is brighter than usual, blue is fainter, and grey is masked. Most of the field is noise.',
        run: () => {
          setPlaying(false);
          setMode('difference');
          if (c) selectCandidate(c.candidate_id);
        },
      },
      {
        target: 'candidates',
        title: 'Residuals, not discoveries',
        body: 'Every spot above 5σ is listed and classified. Most are artifacts. A few, like this one, need follow-up: they are worth a second look, not a headline.',
      },
      {
        target: 'evidence',
        title: 'Judge the evidence',
        body: 'The light curve shows the flux at this position in every epoch. One significant epoch is consistent with a transient, but cosmic rays and moving objects look the same. Only an independent detection could confirm it.',
      },
      {
        target: 'timeline',
        title: 'Step through time',
        body: 'Each mark is one SPHEREx visit, spaced by real time. Use the ← and → keys to step through epochs, B, O and D to switch views, and J and K to move between residuals.',
      },
    ];
  }, [manifest, selectCandidate]);

  return (
    <div className="workspace" inert={inert}>
      <header className="topbar">
        <p className="wordmark">PARALLAX</p>
        <label className="field-select">
          <span className="visually-hidden">Field</span>
          <select value={manifest.manifest_id} onChange={(e) => onField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.manifest_id} value={f.manifest_id}>
                {f.data_kind === 'simulated' ? 'SIMULATED · ' : ''}
                {f.title}
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
        <div className="topbar-end">
          <button type="button" onClick={() => onTour(true)}>
            Tour
          </button>
          <button type="button" popoverTarget="keys">
            Keys
          </button>
        </div>
      </header>
      <div id="keys" popover="auto" className="keys">
        <h2>Keyboard</h2>
        <dl className="mono">
          {[
            ['← →', 'previous / next epoch'],
            ['B O D', 'blink, overlay, difference'],
            ['Space', 'start or stop blinking'],
            ['R', 'flip to the reference once'],
            ['J K', 'next / previous residual'],
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

      <main className="stage">
        <section className="viewer" aria-label="Image viewer">
          <div className="viewer-bar">
            <div className="segmented" role="group" aria-label="View" data-tour="modes">
              <button
                type="button"
                aria-pressed={mode === 'blink'}
                onClick={() => setMode('blink')}
              >
                Blink
              </button>
              <button
                type="button"
                aria-pressed={mode === 'overlay'}
                onClick={() => setMode('overlay')}
              >
                Overlay
              </button>
              <button
                type="button"
                aria-pressed={mode === 'difference'}
                onClick={() => setMode('difference')}
                disabled={!hasDiff}
                title={hasDiff ? undefined : 'No difference images for this field'}
              >
                Difference
              </button>
            </div>
            {mode === 'blink' && (
              <>
                <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
                  {playing ? 'Stop' : 'Play'}
                </button>
                <button type="button" onClick={() => setShowRef((s) => !s)} disabled={playing}>
                  Flip
                </button>
              </>
            )}
            {mode === 'overlay' && (
              <label className="slider">
                <span>Reference</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
            )}
            {mode !== 'difference' && (
              <label className="ref-select">
                <span>vs.</span>
                <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                  {manifest.template && <option value="template">Median of all epochs</option>}
                  {observations.map((o) => (
                    <option key={o.observation_id} value={o.observation_id}>
                      {isoDate(o.epoch.mjd_mid)} ({o.provenance.data_release ?? 'sim'})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'difference' && diff && (
              <div
                className="legend"
                aria-label={`Significance from −${diff.display_range_sigma} to +${diff.display_range_sigma} sigma`}
              >
                <span className="mono">−{diff.display_range_sigma}σ</span>
                <span className="legend-ramp" aria-hidden="true" />
                <span className="mono">+{diff.display_range_sigma}σ</span>
                <span className="legend-masked" aria-hidden="true" />
                <span>masked</span>
              </div>
            )}
          </div>

          <SkyCanvas
            layer={layer}
            label={`${showing}. ${manifest.title}. ${manifest.candidates.length} residual markers.`}
            width={first.image.width_px}
            height={first.image.height_px}
            wcs={wcs}
            candidates={manifest.candidates}
            activeEpochId={epoch.observation_id}
            selectedId={candId}
            onPick={selectCandidate}
            pin={pin}
            focus={focus}
          />

          <div className="viewer-caption">
            <p className="showing" aria-live="polite">
              <span className={`frame-tag ${mode === 'blink' && showRef ? 'ref' : ''}`}>
                {showing}
              </span>
            </p>
            <p className="mono dim">
              {epoch.spectral.wavelength_center_um.toFixed(3)} µm · D
              {epoch.spectral.detector ?? '?'} · {epoch.provenance.data_release ?? 'SIM'} · MJD{' '}
              {epoch.epoch.mjd_mid.toFixed(3)} {epoch.epoch.time_scale.toUpperCase()}
              {epoch.quality.psf_fwhm_arcsec
                ? ` · PSF ${epoch.quality.psf_fwhm_arcsec.toFixed(1)}″`
                : ''}
              {diff ? ` · k ${diff.noise_scale.toFixed(2)}` : ''}
            </p>
            {mode === 'difference' && diff?.status === 'visualization_only' && (
              <p className="warn" role="note">
                Visualization only: this comparison failed validation ({diff.reasons.join('; ')}),
                so no significance values are quoted for it.
              </p>
            )}
          </div>

          <Timeline
            observations={observations}
            differences={differences}
            selectedId={epoch.observation_id}
            onSelect={setEpochId}
            highlight={new Set(cand?.observation_ids ?? [])}
          />
        </section>

        <aside className="rail" aria-label="Residuals and evidence">
          <CandidateList manifest={manifest} selectedId={candId} onSelect={selectCandidate} />
          {cand ? (
            <EvidenceReport
              candidate={cand}
              manifest={manifest}
              activeEpochId={epoch.observation_id}
              onSelectEpoch={setEpochId}
            />
          ) : (
            manifest.candidates.length > 0 && (
              <p className="empty">
                Select a residual from the list or on the image to see its evidence.
              </p>
            )
          )}
          <details className="meta">
            <summary>Epoch metadata and provenance</summary>
            <ObservationDetails obs={epoch} />
            {manifest.alignment && <p className="small dim">{manifest.alignment}</p>}
          </details>
          <footer className="credits small dim">
            <p>{manifest.dataset.citation}</p>
            <p>{manifest.dataset.acknowledgement}</p>
            <p>
              A NASA Space Apps Challenge 2026 project. Not affiliated with or endorsed by NASA.
            </p>
          </footer>
        </aside>
      </main>
      {tour && <Tour steps={tourSteps} onClose={() => onTour(false)} />}
    </div>
  );
}

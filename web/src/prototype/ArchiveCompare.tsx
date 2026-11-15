import { useEffect, useMemo, useState } from 'react';
import { parseCutout } from '../features/atlas/cutout.ts';
import { formatDec, formatRa } from '../lib/sky.ts';
import { BASE_MODES, CompareControls, CompareLayers, type ModeOption } from './Compare.tsx';
import { LiveError, loadFrame, makeStretch, paintFrame, type LiveFrame } from './live.ts';
import { paletteTable, type Palette } from './SkyDome.tsx';
import type { ArchiveCompare as State } from './store.ts';

type Tab = 'compare' | 'source';
type Wave =
  | { kind: 'idle' | 'busy' }
  | { kind: 'done'; a: string; b: string }
  | { kind: 'error'; text: string };

const date = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const MODES: ModeOption[] = [
  ...BASE_MODES,
  {
    id: 'change',
    label: 'Change',
    about: '',
    unavailable:
      'a change map needs both images on a checked common grid with matched wavelength, background and sharpness. These are display reprojections; open a prepared field for validated change maps.',
  },
];

/** Wavelength SPHEREx measured at the centre of a small cutout of one exposure. */
async function centreWavelength(url: string, ra: number, dec: number, signal: AbortSignal) {
  const q = new URLSearchParams({ url, ra: String(ra), dec: String(dec), size: '0.01' });
  const r = await fetch(`api/cutout?${q}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!(r.headers.get('content-type') ?? '').includes('fits'))
    throw new Error(
      r.ok ? 'This copy of the app has no cutout function.' : `The archive answered ${r.status}.`,
    );
  const c = parseCutout(new Uint8Array(await r.arrayBuffer()));
  const w = c.lvf((c.w - 1) / 2, (c.h - 1) / 2);
  return w
    ? `${w.um.toFixed(3)} µm (band about ${w.bandwidth.toFixed(3)} µm wide)`
    : 'not recorded in this file';
}

/** Two live archive exposures, A and B: display imagery only, never measured. */
export function ArchiveCompare(props: {
  state: State;
  onState: (patch: Partial<State>) => void;
  palette: Palette;
  reduced: boolean;
  returnLabel: string;
  onReturn: () => void;
  onSave: (title: string, detail: string) => void;
}) {
  const { state, onState } = props;
  const [attempt, setAttempt] = useState(0);
  // keyed by the request, so a new pair or retry reads as loading without a reset
  const key = `${state.ra},${state.dec},${state.a.url},${state.b.url},${attempt}`;
  const [res, setRes] = useState<{
    key: string;
    frames?: { a: LiveFrame; b: LiveFrame };
    error?: LiveError;
  } | null>(null);
  const frames = res?.key === key ? res.frames : undefined;
  const error = res?.key === key ? res.error : undefined;
  const [tab, setTab] = useState<Tab>('compare');
  const [showB, setShowB] = useState(false);
  const [mix, setMix] = useState(0.5);
  const [wave, setWave] = useState<Wave>({ kind: 'idle' });

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      loadFrame(state.ra, state.dec, state.a.url, ac.signal),
      loadFrame(state.ra, state.dec, state.b.url, ac.signal),
    ]).then(
      ([a, b]) => setRes({ key, frames: { a, b } }),
      (e: unknown) =>
        !ac.signal.aborted &&
        setRes({
          key,
          error:
            e instanceof LiveError ? e : new LiveError('outage', 'The archive request failed.'),
        }),
    );
    return () => ac.abort();
  }, [state.ra, state.dec, state.a.url, state.b.url, key]);

  // one stretch for both, so equal brightness looks equal
  const canvases = useMemo(() => {
    if (!frames) return null;
    const both = new Float32Array(frames.a.pix.length * 2);
    both.set(frames.a.pix);
    both.set(frames.b.pix, frames.a.pix.length);
    const s = makeStretch(both);
    const map = paletteTable(props.palette);
    const a = document.createElement('canvas');
    const b = document.createElement('canvas');
    paintFrame(a, frames.a, s, map);
    paintFrame(b, frames.b, s, map);
    return { a, b };
  }, [frames, props.palette]);

  function checkWavelength() {
    const ac = new AbortController();
    setWave({ kind: 'busy' });
    Promise.all([
      centreWavelength(state.a.url, state.ra, state.dec, ac.signal),
      centreWavelength(state.b.url, state.ra, state.dec, ac.signal),
    ]).then(
      ([a, b]) => setWave({ kind: 'done', a, b }),
      (e: unknown) => setWave({ kind: 'error', text: e instanceof Error ? e.message : String(e) }),
    );
  }

  const aLabel = date(state.a.mjd);
  const bLabel = date(state.b.mjd);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'compare', label: 'Compare' },
    { id: 'source', label: 'Source' },
  ];

  return (
    <div className="inspect" role="region" aria-label="Analysis: two archive exposures">
      <div className="stage">
        <div className="stage-chrome stage-top">
          <p className="stage-scale">
            <span>Whole image 6′ across</span>
            <span className="muted">
              RA {formatRa(state.ra)}, Dec {formatDec(state.dec)}
            </span>
          </p>
        </div>
        <div className="stage-frame">
          {error ? (
            <div className="flip-state" role="alert">
              <h2>
                {error.kind === 'no-api'
                  ? 'No archive connection here'
                  : 'The archive is not answering'}
              </h2>
              <p>{error.message} Prepared fields and your notebook still work.</p>
              {error.kind === 'outage' && (
                <button onClick={() => setAttempt((x) => x + 1)}>Try again</button>
              )}
            </div>
          ) : (
            <div className="stage-image" style={{ transform: `scale(${state.zoom})` }}>
              <CompareLayers
                a={canvases?.a ?? null}
                b={canvases?.b ?? null}
                mode={state.mode}
                showB={showB}
                mix={mix}
                label={`Archive exposure A, ${aLabel}${state.mode !== 'one' ? `, compared with B, ${bLabel}` : ''}`}
              />
            </div>
          )}
          {!error && !canvases && (
            <p className="flip-wait" role="status">
              Loading both exposures…
            </p>
          )}
          {state.mode !== 'one' && (
            <p className="ab-chips" aria-hidden="true">
              <span data-on={state.mode !== 'blink' || !showB ? '' : undefined}>A · {aLabel}</span>
              <span data-on={state.mode !== 'blink' || showB ? '' : undefined}>B · {bLabel}</span>
            </p>
          )}
          <span className="flip-tag">
            Archive imagery · display only · not checked by the pipeline
          </span>
        </div>
        <div className="stage-chrome stage-bottom">
          <div className="zoom zoom-text" role="group" aria-label="Framing, shared by A and B">
            <button onClick={() => onState({ zoom: 1 })} disabled={state.zoom === 1}>
              Fit
            </button>
            <button onClick={() => onState({ zoom: 2 })} disabled={state.zoom === 2}>
              Zoom 2×
            </button>
            <button onClick={() => (onState({ zoom: 1, mode: 'blink' }), setMix(0.5))}>
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="inspect-panel">
        <header className="panel-head">
          <h2>
            {aLabel} vs {bLabel}
          </h2>
          <p className="muted">Live SPHEREx archive · detector {state.band} · two exposures</p>
        </header>

        <div className="tabs" role="tablist" aria-label="Analysis">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`atab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`atp-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const next = tab === 'compare' ? 'source' : 'compare';
                setTab(next);
                document.getElementById(`atab-${next}`)?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
          <span className="tab-off" title="Evidence needs pipeline-checked data">
            Evidence <span className="sr-only">unavailable</span>
          </span>
        </div>

        {tab === 'compare' ? (
          <div className="tabpanel" id="atp-compare" role="tabpanel" aria-labelledby="atab-compare">
            <section className="block">
              <p className="verdict">
                <span className="verdict-mark" aria-hidden="true">
                  !
                </span>
                Not checked: same detector band ({state.band}), but the wavelength at this point,
                the background and the sharpness may differ. Look, don’t measure.
              </p>
              <CompareControls
                modes={MODES}
                mode={state.mode}
                onMode={(m) => onState({ mode: m })}
                showB={showB}
                onShowB={setShowB}
                mix={mix}
                onMix={setMix}
                reduced={props.reduced}
                aLabel={aLabel}
                bLabel={bLabel}
              />
            </section>
            <section className="block" aria-labelledby="wv-h">
              <h3 id="wv-h">Wavelength at this point</h3>
              <p className="note">
                Reads each exposure’s own wavelength map at the centre, from a small 36″ cutout of
                each. Fetched only when you ask.
              </p>
              {wave.kind === 'done' ? (
                <dl className="facts" aria-live="polite">
                  <dt>A</dt>
                  <dd>{wave.a}</dd>
                  <dt>B</dt>
                  <dd>{wave.b}</dd>
                </dl>
              ) : (
                <button disabled={wave.kind === 'busy'} onClick={checkWavelength}>
                  {wave.kind === 'busy' ? 'Reading…' : 'Check wavelengths'}
                </button>
              )}
              {wave.kind === 'error' && (
                <p className="note" role="alert">
                  Could not read them: {wave.text}
                </p>
              )}
            </section>
            <section className="block">
              <h3>Evidence and measurements</h3>
              <p className="note">
                Unavailable for archive exposures: brightness numbers need the pipeline’s checked
                science files, not display images. Prepared fields carry validated light curves.
              </p>
            </section>
          </div>
        ) : (
          <div className="tabpanel" id="atp-source" role="tabpanel" aria-labelledby="atab-source">
            {(['a', 'b'] as const).map((k) => (
              <section className="block" key={k}>
                <h3>
                  {k.toUpperCase()} · {date(state[k].mjd)}
                </h3>
                <dl className="facts">
                  <dt>Observed</dt>
                  <dd>MJD {state[k].mjd.toFixed(5)}</dd>
                  <dt>Detector</dt>
                  <dd>
                    {state.band}, covering {state[k].um[0]}–{state[k].um[1]} µm across the detector
                  </dd>
                </dl>
                <a href={state[k].url} target="_blank" rel="noreferrer">
                  Original Level 2 file at NASA/IPAC IRSA
                </a>
              </section>
            ))}
            <section className="block">
              <h3>Processing for display</h3>
              <p>
                Each exposure is reprojected by the PARALLAX API to a 59 × 59 north-up grid of 6.15″
                pixels centred here (bilinear), with the cutout’s median subtracted. Both share one
                square-root stretch. None of this is calibrated photometry.
              </p>
            </section>
          </div>
        )}

        <div className="panel-actions">
          <button
            onClick={() =>
              props.onSave(
                `${aLabel} vs ${bLabel}`,
                `Archive exposures · ${state.band} · display only`,
              )
            }
          >
            Save comparison
          </button>
          <button className="primary" onClick={props.onReturn}>
            {props.returnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

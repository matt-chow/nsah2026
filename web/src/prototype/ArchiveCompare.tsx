import { useEffect, useMemo, useState } from 'react';
import { parseCutout } from '../features/atlas/cutout.ts';
import { formatDec, formatRa } from '../lib/sky.ts';
import type { Manifest } from '../types/manifest.ts';
import { BASE_MODES, CompareControls, CompareLayers, type ModeOption } from './Compare.tsx';
import { LiveError, loadFrame, makeStretch, paintFrame, type LiveFrame } from './live.ts';
import { paletteTable, type Palette } from './SkyDome.tsx';
import type { ArchiveCompare as State, Pin } from './store.ts';
import { PinCompare, WorkspaceBar, type PinProps } from './Workspace.tsx';

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
export function ArchiveCompare(
  props: {
    state: State;
    onState: (patch: Partial<State>) => void;
    palette: Palette;
    reduced: boolean;
    manifests: Record<string, Manifest | 'error'>;
    originLabel: string | null;
    onSky: () => void;
    onReturn: () => void;
    onSave: (title: string, detail: string) => void;
  } & Omit<PinProps, 'onComparePins'>,
) {
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
  const [pinPair, setPinPair] = useState<[Pin, Pin] | null>(null);
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
  const where = `RA ${formatRa(state.ra)}, Dec ${formatDec(state.dec)}`;
  const pinId = `archive/${state.ra.toFixed(4)},${state.dec.toFixed(4)}/${state.band}`;
  const pinned = props.pins.some((p) => p.id === pinId);

  const bar = (
    <WorkspaceBar
      title={`${aLabel} vs ${bLabel}`}
      detail={`Live archive region · browsing only · ${where} · ${state.band}`}
      originLabel={props.originLabel}
      onSky={props.onSky}
      onOrigin={props.onReturn}
      onSave={() =>
        props.onSave(`${aLabel} vs ${bLabel}`, `Archive exposures · ${state.band} · display only`)
      }
      saveLabel="Save investigation"
      pins={props.pins}
      onPin={props.onPin}
      onUnpin={props.onUnpin}
      onComparePins={(ids) => {
        const two = ids.map((id) => props.pins.find((p) => p.id === id));
        if (two[0] && two[1]) setPinPair([two[0], two[1]]);
      }}
    />
  );
  const closePair = () => {
    setPinPair(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.pin-tray > button')?.focus());
  };
  if (pinPair)
    return (
      <div className="inspect ws" role="region" aria-label="Deep Dive: pinned comparison">
        {bar}
        <PinCompare
          pins={pinPair}
          manifests={props.manifests}
          palette={props.palette}
          onClose={closePair}
        />
      </div>
    );

  return (
    <div className="inspect ws" role="region" aria-label="Deep Dive: two archive exposures">
      {bar}
      <div className="stage">
        <div className="ws-viewbar">
          <div className="ab-pick ab-fixed">
            <p>
              <span>A</span> {aLabel}
            </p>
            <p>
              <span>B</span> {bLabel}
            </p>
            <button
              className="quiet"
              onClick={() => onState({ a: state.b, b: state.a })}
              aria-label="Swap A and B"
            >
              Swap
            </button>
          </div>
          <div className="ws-modes">
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
          </div>
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
          <p className="ab-chips" aria-hidden="true">
            <span data-on={state.mode !== 'blink' || !showB ? '' : undefined}>A · {aLabel}</span>
            {state.mode !== 'one' && (
              <span data-on={state.mode !== 'blink' || showB ? '' : undefined}>B · {bLabel}</span>
            )}
          </p>
        </div>
        <div className="ws-controls">
          <p className="muted">Whole image 6′ across</p>
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
        <p className="verdict">
          <span className="verdict-mark" aria-hidden="true">
            !
          </span>
          Not checked: same detector ({state.band}), but the wavelength at this point, the
          background and the sharpness may differ. Look, don’t measure.
        </p>
      </div>

      <aside className="inspect-panel ws-context" aria-label="What this region supports">
        <section className="block capability" aria-labelledby="cap-h">
          <h3 id="cap-h">Browsing only</h3>
          <p>
            These are live SPHEREx archive exposures, reprojected for display. Analysis is
            unavailable here because nothing has checked that the two share a grid, wavelength,
            background and sharpness, so a difference could come from any of them.
          </p>
          <dl className="ws-figures">
            <dt>Change</dt>
            <dd>
              <span className="muted">— not measured</span>
            </dd>
            <dt>Uncertainty</dt>
            <dd>
              <span className="muted">— no variance used</span>
            </dd>
            <dt>Quality checks</dt>
            <dd>Not assessed</dd>
          </dl>
          <p className="note">
            Validated analysis needs a prepared field: aligned visits, a typical image, checked
            pairs and measured light curves. Two exist so far.
          </p>
          <div className="row">
            <button
              aria-pressed={pinned}
              onClick={() =>
                pinned
                  ? props.onUnpin(pinId)
                  : props.onPin({
                      kind: 'archive',
                      id: pinId,
                      label: `Region ${formatRa(state.ra)} ${formatDec(state.dec)}`,
                      compare: state,
                    })
              }
            >
              {pinned ? 'Pinned' : 'Pin this region'}
            </button>
          </div>
        </section>
        <section className="block" aria-labelledby="wv-h">
          <h3 id="wv-h">Wavelength at this point</h3>
          <p className="note">
            Reads each exposure’s own wavelength map at the centre, from a small 36″ cutout of each.
            Fetched only when you ask.
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
        <details className="block">
          <summary>Data and provenance</summary>
          {(['a', 'b'] as const).map((k) => (
            <section key={k}>
              <h4>
                {k.toUpperCase()} · {date(state[k].mjd)}
              </h4>
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
          <p>
            Each exposure is reprojected by the PARALLAX API to a 59 × 59 north-up grid of 6.15″
            pixels centred here (bilinear), with the cutout’s median subtracted. Both share one
            square-root stretch. None of this is calibrated photometry.
          </p>
        </details>
      </aside>

      <section className="ws-lower" aria-labelledby="alower-h">
        <div className="ws-lower-head">
          <h3 id="alower-h">The two exposures</h3>
          <p className="muted ws-key">No brightness chart: nothing here is measured</p>
        </div>
        <div className="ws-lower-body ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">Date (UTC)</th>
                <th scope="col">Role</th>
                <th scope="col">Detector band, µm</th>
                <th scope="col" className="num">
                  Change, µJy
                </th>
              </tr>
            </thead>
            <tbody>
              {(['a', 'b'] as const).map((k) => (
                <tr key={k} data-active={k === 'a' ? '' : undefined}>
                  <th scope="row">{date(state[k].mjd)}</th>
                  <td>{k.toUpperCase()}</td>
                  <td>
                    {state[k].um[0]}–{state[k].um[1]}
                  </td>
                  <td className="num">
                    <span className="muted">— not measured</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

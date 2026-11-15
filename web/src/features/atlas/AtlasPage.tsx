import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PageProps } from '../../app/App.tsx';
import { parseDegrees } from '../../lib/coords.ts';
import { formatDec, formatRa } from '../../lib/sky.ts';
import { longDate } from '../../lib/time.ts';
import { HIPS_URL, loadProperties, type CubeInfo } from './hips.ts';
import { Observations } from './Observations.tsx';
import type { ColourMap, Stretch, View } from './render.ts';
import { layerLabel, MAX_VALUE_FOV, SkyView } from './SkyView.tsx';
import { readState, RGB_PRESET, writeState, type AtlasState, type Mode } from './state.ts';
import '../../styles/pages.css';

const PLACES: { name: string; ra: number; dec: number }[] = [
  { name: 'Orion Nebula', ra: 83.822, dec: -5.391 },
  { name: 'Galactic Centre', ra: 266.417, dec: -29.008 },
  { name: 'Andromeda (M31)', ra: 10.685, dec: 41.269 },
  { name: 'Large Magellanic Cloud', ra: 80.894, dec: -69.756 },
  { name: 'Pleiades', ra: 56.75, dec: 24.12 },
  { name: 'Carina Nebula', ra: 161.265, dec: -59.867 },
];
const MODES: { id: Mode; label: string }[] = [
  { id: 'mosaic', label: 'Picture' },
  { id: 'values', label: 'Measured values' },
  { id: 'rgb', label: 'Infrared colour' },
];
const CHANNELS = ['Red', 'Green', 'Blue'] as const;

type Load = { kind: 'busy' } | { kind: 'error'; text: string } | { kind: 'ready'; info: CubeInfo };

export function AtlasPage({ fields }: PageProps) {
  const [load, setLoad] = useState<Load>({ kind: 'busy' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    loadProperties(ctrl.signal)
      .then((info) => setLoad({ kind: 'ready', info }))
      .catch(
        (e: unknown) =>
          !ctrl.signal.aborted &&
          setLoad({ kind: 'error', text: e instanceof Error ? e.message : String(e) }),
      );
    return () => ctrl.abort();
  }, [attempt]);

  return (
    <main className="page atlas-page" id="main">
      <header className="page-head">
        <h1>Sky atlas</h1>
        <p className="lede">
          Pan across the whole SPHEREx sky at any of its 102 infrared wavelengths, read real surface
          brightness, build an infrared colour image, and look up the dated exposures behind any
          position.
        </p>
      </header>
      {load.kind === 'busy' && (
        <p className="state" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Reading the SPHEREx all-sky cube
          description from IRSA…
        </p>
      )}
      {load.kind === 'error' && (
        <div className="state" role="alert">
          <p>
            The IRSA sky atlas could not be reached ({load.text}). Nothing is shown rather than a
            stale or invented sky.
          </p>
          <button
            type="button"
            onClick={() => (setLoad({ kind: 'busy' }), setAttempt(attempt + 1))}
          >
            Try again
          </button>
        </div>
      )}
      {load.kind === 'ready' && <Atlas info={load.info} fields={fields} />}
    </main>
  );
}

function Atlas({ info, fields }: { info: CubeInfo; fields: PageProps['fields'] }) {
  const depth = info.wavelengths.length;
  const [state, setState] = useState<AtlasState>(() => readState(location.hash, depth));
  useEffect(() => {
    const sync = () =>
      location.hash.startsWith('#/atlas') && setState(readState(location.hash, depth));
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, [depth]);
  useEffect(() => history.replaceState(null, '', writeState(state)), [state]);

  const patch = useCallback((p: Partial<AtlasState>) => setState((s) => ({ ...s, ...p })), []);
  const onView = useCallback((v: View) => patch(v), [patch]);
  const [raText, setRaText] = useState('');
  const [decText, setDecText] = useState('');
  const [formError, setFormError] = useState('');

  function go(e: FormEvent) {
    e.preventDefault();
    const ra = parseDegrees(raText, 0, 360, false);
    const dec = parseDegrees(decText, -90, 90, true);
    if (!ra.ok) return setFormError(`RA: ${ra.error}`);
    if (!dec.ok) return setFormError(`Dec: ${dec.error}`);
    setFormError('');
    patch({ ra: ra.value, dec: dec.value });
  }

  const wavelength = info.wavelengths[state.frame] ?? 0;
  const layerSelect = (value: number, onChange: (f: number) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {info.wavelengths.map((_, f) => (
        <option key={f} value={f} disabled={info.blank.has(f)}>
          {layerLabel(info, f)}
          {info.blank.has(f) ? ' (blank)' : ''}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <section className="atlas-controls" aria-label="Atlas controls">
        <div className="segmented" role="group" aria-label="What to show">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={state.mode === m.id}
              onClick={() => patch({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <form className="atlas-goto" onSubmit={go} noValidate>
          <label>
            RA°{' '}
            <input
              inputMode="decimal"
              size={9}
              value={raText}
              onChange={(e) => setRaText(e.target.value)}
              placeholder={state.ra.toFixed(3)}
            />
          </label>
          <label>
            Dec°{' '}
            <input
              inputMode="decimal"
              size={9}
              value={decText}
              onChange={(e) => setDecText(e.target.value)}
              placeholder={state.dec.toFixed(3)}
            />
          </label>
          <button type="submit">Go</button>
          <span role="alert" className="form-error">
            {formError}
          </span>
        </form>
        <label className="atlas-places">
          Places to try{' '}
          <select
            value=""
            onChange={(e) => {
              const p = PLACES[Number(e.target.value)];
              if (p) patch({ ra: p.ra, dec: p.dec, fov: Math.min(state.fov, MAX_VALUE_FOV) });
            }}
          >
            <option value="" disabled>
              choose…
            </option>
            {PLACES.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {state.mode !== 'rgb' ? (
          <div className="atlas-wave">
            <label htmlFor="atlas-frame">
              Wavelength <span className="mono">{layerLabel(info, state.frame)}</span>
            </label>
            <input
              id="atlas-frame"
              type="range"
              min={0}
              max={depth - 1}
              value={state.frame}
              onChange={(e) => patch({ frame: Number(e.target.value) })}
              aria-valuetext={`${layerLabel(info, state.frame)}${info.blank.has(state.frame) ? ', blank layer' : ''}`}
            />
            <span className="legend-note">
              {info.wavelengths[0]?.toFixed(2)}–{info.wavelengths.at(-1)?.toFixed(2)} µm, {depth}{' '}
              layers from IRSA's cube description
              {info.blank.has(state.frame) &&
                ' · this layer is blank in the archive (no data, not zero)'}
            </span>
          </div>
        ) : (
          <fieldset className="atlas-rgb">
            <legend>Infrared wavelengths mapped to visible colours</legend>
            {CHANNELS.map((c, i) => (
              <label key={c}>
                {c}{' '}
                {layerSelect(
                  state.rgb[i] as number,
                  (f) => {
                    const rgb: AtlasState['rgb'] = [...state.rgb];
                    rgb[i] = f;
                    patch({ rgb });
                  },
                  `${c} channel wavelength`,
                )}
              </label>
            ))}
            <button type="button" onClick={() => patch({ rgb: RGB_PRESET })}>
              Preset: 3.3 / 2.2 / 1.25 µm
            </button>
          </fieldset>
        )}
        {state.mode !== 'rgb' && (
          <div className="atlas-look">
            <label>
              Colour map{' '}
              <select
                value={state.cmap}
                onChange={(e) => patch({ cmap: e.target.value as ColourMap })}
              >
                <option value="grey">grey</option>
                <option value="viridis">viridis</option>
                <option value="inferno">inferno</option>
              </select>
            </label>
            {state.mode === 'values' && (
              <div className="segmented" role="group" aria-label="Stretch">
                {(['linear', 'asinh'] as Stretch[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={state.stretch === s}
                    onClick={() => patch({ stretch: s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <SkyView info={info} state={state} fields={fields} onView={onView} />

      <div className="atlas-sections">
        <section className="panel" aria-labelledby="atlas-a">
          <h2 id="atlas-a">A · The all-sky map</h2>
          <p>
            IRSA combined every {info.collection} exposure into one sky image per wavelength
            (released {info.release}). <strong>Picture</strong> uses IRSA's ready-made display tiles
            (a {info.pixelFunction} stretch of {info.cut[0]}–{info.cut[1]} MJy/sr): good for
            looking, not for measuring. <strong>Measured values</strong> and{' '}
            <strong>Infrared colour</strong> read the numeric cube itself, so the hover readout is
            real surface brightness. They need a view of {MAX_VALUE_FOV}° or less, because each
            512-pixel cube tile is 1 MiB per wavelength.
          </p>
          <p>
            The map's 102 layers are wavelengths, not dates: each pixel averages exposures taken
            between {longDate(info.mjdRange[0])} and {longDate(info.mjdRange[1])}. To see changes
            over time, use B or C.
          </p>
          <p className="legend-note">
            Source: <a href={`${HIPS_URL}/properties`}>{info.title}</a>, NASA/IPAC Infrared Science
            Archive. This research uses data from SPHEREx, a joint project of the Jet Propulsion
            Laboratory and the California Institute of Technology, funded by NASA.
          </p>
        </section>
        <section className="panel" aria-labelledby="atlas-b">
          <h2 id="atlas-b">B · Archived exposures at this position</h2>
          <p>
            The individual, dated detector images that went into the map. Each can be cut out around
            the position with its own calibration, units, uncertainty and quality flags.
          </p>
          <Observations ra={state.ra} dec={state.dec} wavelength={wavelength} />
        </section>
        <section className="panel" aria-labelledby="atlas-c">
          <h2 id="atlas-c">C · Prepared time series</h2>
          <p>
            For two deep fields the pipeline has already registered many epochs to a common grid,
            checked which pairs can be compared, and searched the differences. That is where change
            detection lives.
          </p>
          {fields === null ? (
            <p className="legend-note">Loading prepared fields…</p>
          ) : (
            <ul className="atlas-fields">
              {fields
                .filter((f) => f.data_kind === 'real')
                .map((f) => (
                  <li key={f.manifest_id}>
                    <a href={`#${f.manifest_id}`}>{f.title}</a>{' '}
                    <span className="mono">
                      {formatRa(f.ra_deg)} {formatDec(f.dec_deg)} · {f.observations} epochs
                    </span>{' '}
                    <button
                      type="button"
                      onClick={() => patch({ ra: f.ra_deg, dec: f.dec_deg, fov: 1 })}
                    >
                      Show in atlas
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

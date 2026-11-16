// The Deep Dive's shared pieces: the workspace bar, pin tray, quality list, guide, observation
// table, timeline, and the two-pin comparison. Display only; numbers come from the manifest.

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadImage } from '../lib/imageCache.ts';
import { divergingRgb } from '../lib/sky.ts';
import { isoDate } from '../lib/time.ts';
import type { Candidate, Manifest, Observation } from '../types/manifest.ts';
import { EvidenceChart } from './EvidenceChart.tsx';
import { useEscape } from './escape.ts';
import { LiveError, loadFrame, makeStretch, paintFrame } from './live.ts';
import { paletteTable, type Palette } from './SkyDome.tsx';
import type { Pin } from './store.ts';
import { comparePins, pinFacts, STATUS_TEXT, type Check, type CheckStatus } from './workspace.ts';

export const shortDate = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
export const signed = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('en')}`;

/** Recolour a display PNG once per (url, palette); masked pixels get the hatch. */
const painted = new Map<string, Promise<HTMLCanvasElement>>();
export function paintImage(url: string, palette: Palette | 'diverging') {
  const key = `${url}|${palette}`;
  let p = painted.get(key);
  if (!p) {
    p = loadImage(url).then((img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      const map = palette === 'diverging' ? null : paletteTable(palette);
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] ?? 0;
        let rgb: number[];
        if (map) {
          if ((px[i + 3] ?? 0) < 128) {
            const j = i / 4;
            rgb = ((j % c.width) + Math.floor(j / c.width)) & 2 ? [44, 42, 40] : [24, 23, 22];
          } else rgb = [map[v * 3] ?? 0, map[v * 3 + 1] ?? 0, map[v * 3 + 2] ?? 0];
        } else rgb = divergingRgb(v);
        px[i] = rgb[0] ?? 0;
        px[i + 1] = rgb[1] ?? 0;
        px[i + 2] = rgb[2] ?? 0;
        px[i + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      return c;
    });
    painted.set(key, p);
    p.catch(() => painted.delete(key));
  }
  return p;
}

/** Load a painted image into state; the previous one stays until the next is ready. */
export function usePainted(url: string | undefined, palette: Palette | 'diverging') {
  const [src, setSrc] = useState<{ url: string; c: HTMLCanvasElement } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    paintImage(url, palette).then(
      (c) => live && (setSrc({ url, c }), setFailed(null)),
      () => live && setFailed(url),
    );
    return () => {
      live = false;
    };
  }, [url, palette]);
  return { canvas: src?.c ?? null, failed: !!url && failed === url };
}

/** Copies a source canvas into a visible one; nothing here touches the data. */
function Copy({ src, label }: { src: HTMLCanvasElement | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const dst = ref.current;
    if (!src || !dst) return;
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext('2d')?.drawImage(src, 0, 0);
  }, [src]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}

export interface PinProps {
  pins: Pin[];
  onPin: (p: Pin) => void;
  onUnpin: (id: string) => void;
  onComparePins: (ids: [string, string]) => void;
}

/** One bar for every Deep Dive: the way back, what is open, and the investigation's actions. */
export function WorkspaceBar(
  props: {
    title: string;
    detail: string;
    /** The view this was opened from, when it is not the sky; null otherwise. */
    originLabel: string | null;
    onSky: () => void;
    onOrigin: () => void;
    guideOpen?: boolean;
    onGuide?: () => void;
    onSave: () => void;
    saveLabel: string;
  } & PinProps,
) {
  const h = useRef<HTMLHeadingElement>(null);
  // a keyboard or screen-reader visitor lands on what opened, not on the dock
  useEffect(() => h.current?.focus({ preventScroll: true }), []);
  return (
    <header className="ws-bar">
      <div className="ws-way">
        <button className="ws-return" onClick={props.onSky}>
          <span aria-hidden="true">←</span> Return to Sky
        </button>
        {props.originLabel && (
          <button className="quiet" onClick={props.onOrigin}>
            {props.originLabel}
          </button>
        )}
      </div>
      <div className="ws-what">
        <h1 ref={h} tabIndex={-1} id="ws-title">
          {props.title}
        </h1>
        <p className="muted">{props.detail}</p>
      </div>
      <div className="ws-acts">
        {props.onGuide && (
          <button aria-pressed={props.guideOpen} onClick={props.onGuide}>
            Guide this investigation
          </button>
        )}
        <PinTray {...props} />
        <button className="primary ws-save" onClick={props.onSave}>
          {props.saveLabel}
        </button>
      </div>
    </header>
  );
}

function PinTray(props: PinProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  useEscape(open, () => setOpen(false));
  // the latest two pins stay chosen until the visitor picks otherwise
  const ids = props.pins.map((p) => p.id);
  const pick = chosen.filter((id) => ids.includes(id));
  const two = (pick.length === 2 ? pick : ids.slice(-2)) as [string, string];
  return (
    <div className="pin-tray">
      <button aria-expanded={open} aria-controls="pin-list" onClick={() => setOpen(!open)}>
        Pinned <span className="dock-count">{props.pins.length}</span>
      </button>
      {open && (
        <div className="pin-pop" id="pin-list" role="group" aria-label="Pinned spots and regions">
          {props.pins.length === 0 ? (
            <p className="note">
              Nothing pinned yet. Use <strong>Pin this spot</strong> or{' '}
              <strong>Pin this region</strong>, then compare two side by side.
            </p>
          ) : (
            <ul>
              {props.pins.map((p) => (
                <li key={p.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={two.includes(p.id)}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...two.filter((x) => x !== p.id), p.id].slice(-2)
                            : two.filter((x) => x !== p.id),
                        )
                      }
                    />
                    <span>
                      {p.label}
                      <span className="muted">
                        {' '}
                        · {p.kind === 'archive' ? 'archive region' : 'prepared field'}
                      </span>
                    </span>
                  </label>
                  <button
                    className="quiet"
                    aria-label={`Unpin ${p.label}`}
                    onClick={() => props.onUnpin(p.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="primary"
            disabled={two.length !== 2 || props.pins.length < 2}
            onClick={() => (setOpen(false), props.onComparePins(two))}
          >
            Compare two side by side
          </button>
          {props.pins.length === 1 && <p className="note">Pin one more to compare.</p>}
        </div>
      )}
    </div>
  );
}

const GLYPH: Record<CheckStatus, string> = {
  passed: '✓',
  caution: '!',
  failed: '×',
  'not-assessed': '–',
};

export function QualityList({ checks, headingId }: { checks: Check[]; headingId: string }) {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const summary = (['passed', 'caution', 'failed', 'not-assessed'] as const)
    .filter((s) => count(s) > 0)
    .map((s) => `${count(s)} ${STATUS_TEXT[s].toLowerCase()}`)
    .join(' · ');
  return (
    <section className="block" aria-labelledby={headingId}>
      <div className="ws-head">
        <h3 id={headingId} tabIndex={-1}>
          Quality checks
        </h3>
        <span className="muted">{summary}</span>
      </div>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.id} data-status={c.status}>
            <span className="check-mark" aria-hidden="true">
              {GLYPH[c.status]}
            </span>
            <span className="check-label">{c.label}</span>
            <span className="check-status">{STATUS_TEXT[c.status]}</span>
            <span className="check-detail">{c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type GuideStep = 'compare' | 'quality' | 'evidence' | 'save';
const STEPS: { id: GuideStep; title: string; text: string }[] = [
  {
    id: 'compare',
    title: 'Compare two dates',
    text: 'Blink swaps A and B in the same place, so anything that changed catches the eye.',
  },
  {
    id: 'quality',
    title: 'Inspect quality',
    text: 'Each check reads passed, caution, failed or not assessed. Not assessed is not a pass.',
  },
  {
    id: 'evidence',
    title: 'Weigh the evidence',
    text: 'The chart shows the change on every date. Then read what else could cause it.',
  },
  {
    id: 'save',
    title: 'Save it',
    text: 'The notebook keeps the dates, spot, framing and colours, and reopens them as they are.',
  },
];

/** Four prompts, each tied to a control that exists. Never blocks the workspace. */
export function Guide(props: { onShow: (s: GuideStep) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i] ?? STEPS[0];
  useEscape(true, props.onClose);
  if (!s) return null;
  return (
    <section className="ws-guide" aria-labelledby="guide-h">
      <div className="ws-head">
        <h3 id="guide-h">
          Step {i + 1} of {STEPS.length} · {s.title}
        </h3>
        <button className="quiet" onClick={props.onClose} aria-label="Close the guide">
          ×
        </button>
      </div>
      <p>{s.text}</p>
      <div className="row">
        <button onClick={() => props.onShow(s.id)}>Show me</button>
        {i > 0 && (
          <button className="quiet" onClick={() => setI(i - 1)}>
            Back
          </button>
        )}
        {i < STEPS.length - 1 ? (
          <button className="quiet" onClick={() => setI(i + 1)}>
            Next step
          </button>
        ) : (
          <button className="quiet" onClick={props.onClose}>
            Finish
          </button>
        )}
      </div>
      <p className="note">Flagged spots stay unconfirmed. The guide never decides what they are.</p>
    </section>
  );
}

/** Every date as a row; the same active date as the image, chart and timeline. */
export function ObservationTable(props: {
  observations: Observation[];
  candidate: Candidate | undefined;
  active: number;
  b: string;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <caption className="sr-only">
          Every date in this field. Choose a date to show it as image A.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date (UTC)</th>
            <th scope="col">Visit</th>
            <th scope="col" className="num">
              Change vs typical, µJy
            </th>
            <th scope="col" className="num">
              Masked pixels
            </th>
            <th scope="col">Archive flag</th>
          </tr>
        </thead>
        <tbody>
          {props.observations.map((o, i) => {
            const p = props.candidate?.light_curve.find(
              (l) => l.observation_id === o.observation_id,
            );
            const isB = o.observation_id === props.b;
            return (
              <tr key={o.observation_id} data-active={i === props.active ? '' : undefined}>
                <th scope="row">
                  <button
                    className="link"
                    aria-pressed={i === props.active}
                    onClick={() => props.onSelect(i)}
                  >
                    {isoDate(o.epoch.mjd_mid)}
                  </button>
                  {i === props.active && <span className="ab-tag">A</span>}
                  {isB && <span className="ab-tag">B</span>}
                </th>
                <td>{i + 1}</td>
                <td className="num">
                  {!props.candidate ? (
                    <span className="muted">—</span>
                  ) : p?.delta_flux_ujy == null ? (
                    <span className="muted" title="Flagged pixels cover the spot">
                      — masked
                    </span>
                  ) : (
                    `${signed(p.delta_flux_ujy)} ± ${Math.round(p.uncertainty_ujy ?? 0)}`
                  )}
                </td>
                <td className="num">
                  {o.quality.masked_fraction == null
                    ? '—'
                    : `${(o.quality.masked_fraction * 100).toFixed(1)}%`}
                </td>
                <td>
                  {o.quality.notes.find((n) => /DQA/i.test(n))?.replace(/^L2 DQA: /, '') ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Real elapsed time: where the dates fall, and long pauses at their true length. */
export function Timeline(props: { observations: Observation[]; active: number; b: string }) {
  const mjds = props.observations.map((o) => o.epoch.mjd_mid);
  const lo = Math.min(...mjds);
  const hi = Math.max(...mjds);
  const x = (m: number) => (hi > lo ? ((m - lo) / (hi - lo)) * 100 : 50);
  return (
    <div className="ws-timeline" aria-hidden="true">
      <div className="tl-track">
        {props.observations.map((o, i) => (
          <span
            key={o.observation_id}
            className="tl-tick"
            data-active={i === props.active ? '' : undefined}
            data-b={o.observation_id === props.b ? '' : undefined}
            style={{ left: `${x(o.epoch.mjd_mid)}%` }}
          />
        ))}
      </div>
      <p className="tl-ends">
        <span>{shortDate(lo)}</span>
        <span>Real time between dates</span>
        <span>{shortDate(hi)}</span>
      </p>
    </div>
  );
}

const PIN_ZOOM = 2.5;

/** Two pins side by side: each keeps its own framing and chart scale; dates link only when meaningful. */
export function PinCompare(props: {
  pins: [Pin, Pin];
  manifests: Record<string, Manifest | 'error'>;
  palette: Palette;
  onClose: () => void;
}) {
  const [x, y] = props.pins;
  const fx = pinFacts(x, props.manifests);
  const fy = pinFacts(y, props.manifests);
  const verdict = fx && fy ? comparePins(fx, fy) : null;
  const [linked, setLinked] = useState(true);
  const [dates, setDates] = useState<[number | null, number | null]>([null, null]);
  const h = useRef<HTMLHeadingElement>(null);
  useEscape(true, props.onClose);
  useEffect(() => h.current?.focus({ preventScroll: true }), []);
  const sync = !!verdict?.syncDates && linked;
  const setDate = (k: 0 | 1, i: number) =>
    setDates((d) => (sync ? [i, i] : k === 0 ? [i, d[1]] : [d[0], i]));
  return (
    <div className="pin-compare" role="region" aria-labelledby="pc-h">
      <div className="pc-head">
        <div>
          <h2 id="pc-h" ref={h} tabIndex={-1}>
            {x.label} and {y.label}
          </h2>
          <p className="muted">
            Side by side. Each keeps its own framing and its own chart scale; heights are not
            comparable between the two charts.
          </p>
        </div>
        <button onClick={props.onClose}>Close comparison</button>
      </div>
      {verdict && (
        <div className="pc-issues" aria-live="polite">
          {verdict.issues.length === 0 ? (
            <p>Same detector, wavelength, units and dates.</p>
          ) : (
            <ul>
              {verdict.issues.map((t) => (
                <li key={t}>
                  <span className="check-mark" aria-hidden="true">
                    !
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          )}
          {verdict.syncDates && (
            <label className="check">
              <input
                type="checkbox"
                checked={linked}
                onChange={(e) => setLinked(e.target.checked)}
              />
              Link dates (both are in the same prepared field)
            </label>
          )}
        </div>
      )}
      <div className="pc-cols">
        {([x, y] as const).map((p, k) => (
          <PinColumn
            key={p.id}
            pin={p}
            manifests={props.manifests}
            palette={props.palette}
            active={dates[k as 0 | 1]}
            onDate={(i) => setDate(k as 0 | 1, i)}
          />
        ))}
      </div>
    </div>
  );
}

function PinColumn(props: {
  pin: Pin;
  manifests: Record<string, Manifest | 'error'>;
  palette: Palette;
  active: number | null;
  onDate: (i: number) => void;
}) {
  const { pin } = props;
  if (pin.kind === 'archive') return <ArchivePin pin={pin} palette={props.palette} />;
  const m = props.manifests[pin.manifestId];
  if (!m)
    return (
      <section className="pc-col" role="status">
        Loading {pin.label}…
      </section>
    );
  if (m === 'error')
    return (
      <section className="pc-col" role="alert">
        <h3>{pin.label}</h3>
        <p>This field’s data could not be loaded.</p>
      </section>
    );
  const c = m.candidates.find((z) => z.candidate_id === pin.candidate);
  if (!c)
    return (
      <section className="pc-col" role="alert">
        <h3>{pin.label}</h3>
        <p>This spot is no longer listed in the field’s current data.</p>
      </section>
    );
  return <CandidatePin m={m} c={c} {...props} />;
}

function CandidatePin(props: {
  pin: Pin;
  m: Manifest;
  c: Candidate;
  palette: Palette;
  active: number | null;
  onDate: (i: number) => void;
}) {
  const { m, c } = props;
  const obs = m.observations;
  const peak = useMemo(() => {
    let best = -1;
    let at = 0;
    obs.forEach((o, i) => {
      const v = c.light_curve.find((l) => l.observation_id === o.observation_id)?.delta_flux_ujy;
      if (v != null && Math.abs(v) > best) [best, at] = [Math.abs(v), i];
    });
    return at;
  }, [obs, c]);
  const i = props.active ?? peak;
  const o = obs[i] ?? obs[0];
  const img = usePainted(o?.assets.display_png, props.palette);
  const W = o?.image.width_px ?? 147;
  const H = o?.image.height_px ?? 147;
  const col = c.pixel_x + 0.5;
  const row = H - 1 - c.pixel_y + 0.5;
  const [zoom, setZoom] = useState(PIN_ZOOM);
  const p = c.light_curve.find((l) => l.observation_id === o?.observation_id);
  const ref = c.measurements.find((z) => z.name === 'reference flux');
  return (
    <section className="pc-col" aria-label={props.pin.label}>
      <h3>{props.pin.label}</h3>
      <p className="muted">
        Prepared field · D{o?.spectral.detector} ·{' '}
        {c.measurements.find((z) => z.name === 'wavelength')?.value.toFixed(2)} µm
      </p>
      <div className="pc-image">
        <div
          className="pc-zoom"
          style={{
            transform: `scale(${zoom}) translate(${((W / 2 - col) / W) * 100}%, ${((H / 2 - row) / H) * 100}%)`,
          }}
        >
          <Copy
            src={img.canvas}
            label={`${props.pin.label} on ${o ? isoDate(o.epoch.mjd_mid) : ''}`}
          />
          <svg viewBox={`0 0 ${W} ${H}`} className="stage-marks" aria-hidden="true">
            <circle cx={col} cy={row} r={5} className="pc-mark" />
          </svg>
        </div>
        {img.failed && <p className="stage-error">This image could not be loaded.</p>}
      </div>
      <div className="row">
        <button onClick={() => setZoom(zoom === 1 ? PIN_ZOOM : 1)}>
          {zoom === 1 ? 'Zoom to the spot' : 'Whole field'}
        </button>
        <span className="muted">Own framing</span>
      </div>
      <p className="pc-fig">
        {p?.delta_flux_ujy == null ? (
          <>
            <strong>—</strong> masked on {o ? isoDate(o.epoch.mjd_mid) : 'this date'}, no
            measurement
          </>
        ) : (
          <>
            <strong>
              {signed(p.delta_flux_ujy)} ± {Math.round(p.uncertainty_ujy ?? 0)}
            </strong>{' '}
            µJy change on {o ? isoDate(o.epoch.mjd_mid) : ''}, relative to typical
          </>
        )}
      </p>
      {ref && (
        <p className="note">
          Typical brightness {Math.round(ref.value)} ± {Math.round(ref.uncertainty ?? 0)} µJy
        </p>
      )}
      <EvidenceChart candidate={c} observations={obs} active={i} onSelect={props.onDate} />
    </section>
  );
}

function ArchivePin({
  pin,
  palette,
}: {
  pin: Extract<Pin, { kind: 'archive' }>;
  palette: Palette;
}) {
  const s = pin.compare;
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<{ c?: HTMLCanvasElement; e?: LiveError; key: string } | null>(
    null,
  );
  const key = `${s.a.url}|${palette}|${attempt}`;
  useEffect(() => {
    const ac = new AbortController();
    loadFrame(s.ra, s.dec, s.a.url, ac.signal).then(
      (f) => {
        const c = document.createElement('canvas');
        paintFrame(c, f, makeStretch(f.pix), paletteTable(palette));
        setRes({ c, key });
      },
      (e: unknown) =>
        !ac.signal.aborted &&
        setRes({
          key,
          e: e instanceof LiveError ? e : new LiveError('outage', 'The archive request failed.'),
        }),
    );
    return () => ac.abort();
  }, [s.ra, s.dec, s.a.url, palette, key]);
  const cur = res?.key === key ? res : null;
  return (
    <section className="pc-col" aria-label={pin.label}>
      <h3>{pin.label}</h3>
      <p className="muted">
        Live archive · {s.band} · {shortDate(s.a.mjd)} · display only
      </p>
      <div className="pc-image">
        {cur?.e ? (
          <div className="flip-state" role="alert">
            <p>
              {cur.e.kind === 'no-api'
                ? 'No archive connection here.'
                : 'The archive is not answering.'}
            </p>
            {cur.e.kind === 'outage' && (
              <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            )}
          </div>
        ) : cur?.c ? (
          <div className="pc-zoom">
            <Copy src={cur.c} label={`${pin.label}, archive exposure of ${shortDate(s.a.mjd)}`} />
          </div>
        ) : (
          <p className="flip-wait" role="status">
            Loading the exposure…
          </p>
        )}
      </div>
      <p className="pc-fig">
        <strong>—</strong> no measurement
      </p>
      <p className="note">
        Live archive exposures are display imagery: no checked grid, background or calibration, so
        no brightness, change or uncertainty can be shown. Prepared fields carry those.
      </p>
    </section>
  );
}

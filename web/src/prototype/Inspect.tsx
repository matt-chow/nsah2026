import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { archiveLookup, type ArchiveCount } from '../lib/archive.ts';
import { checkPair } from '../lib/compare.ts';
import { pixelToSky, tanWcs } from '../lib/sky.ts';
import { isoDate, longDate } from '../lib/time.ts';
import type { Candidate, Manifest, Observation } from '../types/manifest.ts';
import { BASE_MODES, CompareControls, CompareLayers, type ModeOption } from './Compare.tsx';
import { EvidenceChart } from './EvidenceChart.tsx';
import type { Place } from './places.ts';
import { toScreen, type View } from './projection.ts';
import { PALETTES, SkyDome, type Palette } from './SkyDome.tsx';
import { versionsOf, writeFlag, type CuratedCompare, type Pin } from './store.ts';
import {
  Guide,
  ObservationTable,
  paintImage,
  PinCompare,
  QualityList,
  shortDate,
  signed,
  Timeline,
  usePainted,
  WorkspaceBar,
  type GuideStep,
  type PinProps,
} from './Workspace.tsx';
import { artifactSigns, qualityChecks } from './workspace.ts';

export type Challenge = { kind: 'find' | 'judge'; candidate: string } | null;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Tab = 'evidence' | 'compare' | 'data';
type Lower = 'chart' | 'table';

interface Props extends Omit<PinProps, 'onComparePins'> {
  place: Place;
  manifest: Manifest;
  manifests: Record<string, Manifest | 'error'>;
  frame: number;
  palette: Palette;
  onPalette: (p: Palette) => void;
  state: CuratedCompare;
  onState: (patch: Partial<CuratedCompare>) => void;
  /** Problems found when a saved comparison was reopened. */
  notice: string[];
  from: Rect | null;
  reduced: boolean;
  challenge: Challenge;
  onChallenge: (c: Challenge) => void;
  /** The view this was opened from, when it is not the sky. */
  originLabel: string | null;
  onReturn: (to: 'sky' | 'origin' | 'wavelengths') => void;
  onSave: (kind: 'visit' | 'comparison', title: string, detail: string, c?: CuratedCompare) => void;
  announce: (s: string) => void;
}

const KIND: Record<Candidate['kind'], string> = {
  variable_like: 'A spot that changed brightness',
  new_source_like: 'Something that appeared once',
  dipole_like: 'A spot that shifted',
  artifact_like: 'Probably a detector artifact',
};
const STATUS: Record<Candidate['status'], string> = {
  unreviewed: 'Unconfirmed · not yet reviewed',
  needs_followup: 'Unconfirmed · needs follow-up',
  known_object: 'Matches a known object',
  likely_artifact: 'Unconfirmed · likely artifact',
  rejected: 'Rejected by the pipeline',
};
const MAX_ZOOM = 2; // on top of the fit; keeps a SPHEREx pixel under ~9 screen pixels
const SHORT_LIST = 5;
const ALTERNATIVES = [
  'an asteroid or other moving object crossing the field',
  'a cosmic ray or detector glitch not caught by the quality flags',
  'a misjudged background or a difference in image sharpness between visits',
];

const measure = (c: Candidate, name: string) => c.measurements.find((m) => m.name === name);

export function Inspect(props: Props) {
  const { manifest: m, place, palette, reduced, challenge, state, onState } = props;
  const obs = m.observations;
  const epoch = Math.max(
    0,
    obs.findIndex((x) => x.observation_id === state.a),
  );
  const o = obs[epoch] ?? obs[0];
  const bObs = state.b === 'typical' ? null : obs.find((x) => x.observation_id === state.b);
  const W = o?.image.width_px ?? 147;
  const H = o?.image.height_px ?? 147;
  const scale = o?.image.pixel_scale_arcsec ?? 6.15;
  const wcs = o ? tanWcs(o.image.wcs) : null;
  const mode = state.mode;
  const zoom = state.zoom;
  const [tab, setTab] = useState<Tab>('evidence');
  const [lower, setLower] = useState<Lower>('chart');
  // short laptop screens start with the image large; the chart is one click (or the guide) away
  const [lowerOpen, setLowerOpen] = useState(
    () => typeof matchMedia !== 'function' || matchMedia('(min-height: 820px)').matches,
  );
  const [guide, setGuide] = useState(false);
  const [pinPair, setPinPair] = useState<[Pin, Pin] | null>(null);
  const [showB, setShowB] = useState(false);
  const [mix, setMix] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [archive, setArchive] = useState<ArchiveCount[] | null | 'loading'>('loading');
  const [found, setFound] = useState<'no' | 'miss' | 'yes'>('no');
  const [misses, setMisses] = useState(0);
  const [verdict, setVerdict] = useState<null | 'real' | 'artifact'>(null);
  const [showAll, setShowAll] = useState(false);
  const [longList, setLongList] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const frameEl = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState(0);
  const [closing, setClosing] = useState(false);

  const setEpoch = (i: number) => {
    const ob = obs[i];
    if (ob) onState({ a: ob.observation_id });
  };
  const candidate = m.candidates.find(
    (c) => c.candidate_id === (challenge?.candidate ?? state.candidate),
  );
  const candidateId = candidate?.candidate_id;
  const hidden = challenge?.kind === 'find' && found !== 'yes';
  const judging = challenge?.kind === 'judge' && verdict === null;

  // the signature move: the stage grows out of the footprint it occupied on the sky
  useLayoutEffect(() => {
    const el = frameEl.current;
    const from = props.from;
    if (!el || reduced || !from) return;
    const r = el.getBoundingClientRect();
    const s = from.w / r.width;
    el.animate(
      [
        { transform: `translate(${from.x - r.left}px, ${from.y - r.top}px) scale(${s})` },
        { transform: 'none' },
      ],
      { duration: 480, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
    );
    // mount only; `from` is the footprint at the moment of opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Back to the sky shrinks the stage into its footprint; any other exit is immediate. */
  function close(to: 'sky' | 'origin' | 'wavelengths') {
    const el = frameEl.current;
    const from = props.from;
    if (closing) return;
    setClosing(true);
    if (!el || reduced || !from || to === 'origin') return props.onReturn(to);
    const r = el.getBoundingClientRect();
    const zoomed = el.querySelector('.stage-image') as HTMLElement | null;
    if (zoomed) zoomed.style.transform = 'none';
    el.animate(
      [
        { transform: 'none' },
        {
          transform: `translate(${from.x - r.left}px, ${from.y - r.top}px) scale(${from.w / r.width})`,
        },
      ],
      { duration: 380, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' },
    ).onfinish = () => props.onReturn(to);
    shell.current?.setAttribute('data-closing', '');
  }

  useEffect(() => {
    const el = frameEl.current;
    if (!el) return;
    // the square image fits the frame's shorter side
    const ro = new ResizeObserver(([e]) =>
      setFrameSize(Math.round(Math.min(e?.contentRect.width ?? 0, e?.contentRect.height ?? 0))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [pinPair]);

  // the two layers; every visit is decoded ahead so stepping never waits on the network
  const diff = m.differences.find((d) => d.observation_id === o?.observation_id);
  const urlA = mode === 'change' ? diff?.display_png : o?.assets.display_png;
  const urlB = state.b === 'typical' ? m.template?.display_png : bObs?.assets.display_png;
  const layerA = usePainted(urlA, mode === 'change' ? 'diverging' : palette);
  const layerB = usePainted(urlB, palette);
  useEffect(() => {
    for (const ob of obs) {
      void paintImage(ob.assets.display_png, palette).catch(() => undefined);
      const d = m.differences.find((x) => x.observation_id === ob.observation_id);
      if (d) void paintImage(d.display_png, 'diverging').catch(() => undefined);
    }
  }, [obs, m.differences, palette]);

  const epochRef = useRef(epoch);
  useEffect(() => {
    epochRef.current = epoch;
  });
  // playback: image A steps one visit per 0.8 s, only while playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const ob = obs[(epochRef.current + 1) % obs.length];
      if (ob) onState({ a: ob.observation_id });
    }, 800);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, obs]);

  useEffect(() => {
    const ac = new AbortController();
    const t = m.target;
    archiveLookup(t.ra_deg, t.dec_deg, ac.signal).then(
      (r) => !ac.signal.aborted && setArchive(r),
      () => !ac.signal.aborted && setArchive(null),
    );
    return () => ac.abort();
  }, [m.target]);

  // stage pan by drag, only when zoomed in; pan is kept as a fraction of the fitted width
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(
    null,
  );
  const fit = frameSize || 1;
  const pan = { x: state.pan.x * fit, y: state.pan.y * fit };
  const perPx = (fit * zoom) / W; // screen px per data px
  const clampFrac = (p: { x: number; y: number }, z = zoom) => {
    const lim = (z - 1) / 2;
    return { x: Math.max(-lim, Math.min(lim, p.x)), y: Math.max(-lim, Math.min(lim, p.y)) };
  };
  const setZ = (z: number) => {
    const nz = Math.max(1, Math.min(MAX_ZOOM, z));
    onState({ zoom: nz, pan: clampFrac(state.pan, nz) });
  };
  const dataAt = (clientX: number, clientY: number) => {
    const r = frameEl.current?.getBoundingClientRect();
    if (!r) return null;
    const sx = clientX - r.left - r.width / 2 - pan.x;
    const sy = clientY - r.top - r.height / 2 - pan.y;
    return { col: sx / perPx + W / 2, row: sy / perPx + H / 2 };
  };

  function tap(clientX: number, clientY: number) {
    if (challenge?.kind !== 'find' || !candidate || found === 'yes') return;
    const p = dataAt(clientX, clientY);
    if (!p) return;
    const dx = p.col - (candidate.pixel_x + 0.5);
    const dy = p.row - (H - 1 - candidate.pixel_y + 0.5);
    if (Math.hypot(dx, dy) <= 6) {
      setFound('yes');
      onState({ candidate: candidate.candidate_id });
      props.announce('Found it. The change is marked on the image and described in the panel.');
    } else {
      setFound('miss');
      setMisses((n) => n + 1);
      props.announce('Nothing flagged there. Keep stepping through the visits.');
    }
  }

  const peakOf = (c: Candidate | undefined) => {
    if (!c) return epoch;
    let best = -1;
    let at = epoch;
    obs.forEach((ob, i) => {
      const p = c.light_curve.find((l) => l.observation_id === ob.observation_id);
      if (p?.delta_flux_ujy != null && Math.abs(p.delta_flux_ujy) > best) {
        best = Math.abs(p.delta_flux_ujy);
        at = i;
      }
    });
    return at;
  };
  const peak = peakOf(candidate);

  /** A spot's evidence: its peak visit against the typical image, zoomed in on it. */
  function selectCandidate(c: Candidate) {
    props.onChallenge(null);
    const z = MAX_ZOOM;
    const col = c.pixel_x + 0.5;
    const row = H - 1 - c.pixel_y + 0.5;
    onState({
      candidate: c.candidate_id,
      a: obs[peakOf(c)]?.observation_id ?? state.a,
      b: m.template ? 'typical' : state.b,
      zoom: z,
      pan: clampFrac({ x: (-(col - W / 2) * z) / W, y: (-(row - H / 2) * z) / H }, z),
    });
    setTab('evidence');
    props.announce(`Showing ${KIND[c.kind].toLowerCase()} at its strongest visit.`);
  }

  /** One active date everywhere: image A, the chart, the timeline and the table. */
  function chooseDate(i: number) {
    setEpoch(i);
    const ob = obs[i];
    if (ob) props.announce(`Image A is now visit ${i + 1}, ${longDate(ob.epoch.mjd_mid)}.`);
  }

  const pair = state.b === 'typical' ? null : checkPair(m, state.a, state.b);
  const pairBlocked =
    pair && (pair.status === 'incompatible' || pair.status === 'unknown')
      ? `the pipeline’s check for this pair says ${pair.status}: ${pair.reasons.join('; ')}.`
      : pair?.status === 'same'
        ? 'A and B are the same visit; choose a different B.'
        : undefined;
  const modes: ModeOption[] = [
    ...BASE_MODES.map((x) => (x.id === 'one' ? x : { ...x, unavailable: pairBlocked })),
    {
      id: 'change',
      label: 'Change',
      about:
        'Image A minus the typical image, in units of its noise: orange (+) brighter than usual, ' +
        'blue (−) fainter, grey masked. A validated pipeline product, not a display effect.',
      unavailable: !diff
        ? 'no difference image was produced for this visit.'
        : diff.status !== 'validated'
          ? `the pipeline marked it ${diff.status.replace('_', ' ')}: ${diff.reasons.join('; ')}.`
          : undefined,
    },
  ];

  const exposures = Array.isArray(archive) ? archive.reduce((s, a) => s + a.exposures, 0) : null;
  const truncated = Array.isArray(archive) && archive.some((a) => a.truncated);
  const band = o?.spectral;
  const aLabel = o ? shortDate(o.epoch.mjd_mid) : '';
  const bLabel = bObs ? shortDate(bObs.epoch.mjd_mid) : 'typical';
  const nTypical = m.template?.observation_ids.length ?? 0;

  // overview inset: field footprint and the zoomed window, on the real sky map
  const OV = 120;
  const ovView: View = { ra: m.target.ra_deg, dec: m.target.dec_deg, fov: 0.9 };
  const corner = (x: number, y: number) => {
    if (!wcs) return null;
    const s = pixelToSky(wcs, x, y);
    return toScreen(ovView, OV, OV, s.ra, s.dec);
  };
  const poly = (x0: number, y0: number, x1: number, y1: number) =>
    [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)]
      .map((p) => (p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : ''))
      .join(' ');
  const half = W / (2 * zoom);
  const cx = W / 2 - pan.x / perPx;
  const cy = H / 2 - pan.y / perPx; // PNG rows
  const win = poly(
    cx - half - 0.5,
    H - 1 - (cy - half) + 0.5,
    cx + half - 0.5,
    H - 1 - (cy + half) + 0.5,
  );

  const markers = showAll ? m.candidates : candidate && !hidden ? [candidate] : [];
  const flux = candidate && measure(candidate, 'aperture flux change');
  const refFlux = candidate && measure(candidate, 'reference flux');
  const point = candidate?.light_curve.find((l) => l.observation_id === o?.observation_id);
  const checks = qualityChecks(m, state.a, state.b, hidden || judging ? undefined : candidate);
  const signs = candidate ? artifactSigns(candidate) : [];
  // a few dozen spots at most: sorting each render is cheaper than memo bookkeeping
  const ranked = m.candidates
    .filter((c) => c.candidate_id !== candidateId)
    .sort(
      (a, b) =>
        Number(a.status === 'likely_artifact') - Number(b.status === 'likely_artifact') ||
        (measure(b, 'peak significance')?.value ?? 0) -
          (measure(a, 'peak significance')?.value ?? 0),
    );
  const comparing = mode === 'blink' || mode === 'split' || mode === 'fade';
  const pinId = candidate ? `${m.manifest_id}/${candidate.candidate_id}` : null;
  const pinned = !!pinId && props.pins.some((p) => p.id === pinId);

  function saveInvestigation() {
    const title = `${place.name}: ${aLabel} vs ${bLabel}`;
    const what = candidate ? `${KIND[candidate.kind]} (${candidate.candidate_id}). ` : '';
    props.onSave(
      'comparison',
      title,
      `${what}${modes.find((x) => x.id === mode)?.label} · ${band?.wavelength_center_um.toFixed(2)} µm${props.pins.length ? ` · ${props.pins.length} pinned` : ''}`,
      {
        ...state,
        candidate: candidateId ?? state.candidate,
        palette,
        pins: props.pins,
        versions: versionsOf(m, [state.a, state.b]),
      },
    );
  }

  /** "Show me": take the visitor to the real control for each guide step. */
  function show(s: GuideStep) {
    const focus = (sel: string) =>
      requestAnimationFrame(() => shell.current?.querySelector<HTMLElement>(sel)?.focus());
    if (s === 'compare') {
      if (!pairBlocked && mode === 'one') onState({ mode: 'blink' });
      focus('.ws-modes [aria-checked="true"]');
    } else if (s === 'quality') {
      setTab('evidence');
      focus('#q-h');
    } else if (s === 'evidence') {
      setLowerOpen(true);
      setLower('chart');
      focus('.ws-lower .hit[aria-pressed="true"], .ws-lower .hit');
    } else focus('.ws-save');
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'evidence', label: 'Evidence' },
    { id: 'compare', label: 'Compare' },
    { id: 'data', label: 'Data' },
  ];

  const bar = (
    <WorkspaceBar
      title={place.name}
      detail={`Prepared field · real SPHEREx data · D${band?.detector} · ${band?.wavelength_center_um.toFixed(2)} µm · ${obs.length} visits`}
      originLabel={props.originLabel}
      onSky={() => close('sky')}
      onOrigin={() => close('origin')}
      guideOpen={guide}
      onGuide={() => {
        setGuide(!guide);
        if (guide) writeFlag('guide-dismissed', true);
      }}
      onSave={saveInvestigation}
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

  // back to the tray that opened the comparison
  const closePair = () => {
    setPinPair(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.pin-tray > button')?.focus());
  };
  if (pinPair)
    return (
      <div className="inspect ws" ref={shell} role="region" aria-label={`Deep Dive: ${place.name}`}>
        {bar}
        <PinCompare
          pins={pinPair}
          manifests={props.manifests}
          palette={palette}
          onClose={closePair}
        />
      </div>
    );

  return (
    <div
      className="inspect ws"
      ref={shell}
      role="region"
      aria-label={`Deep Dive: ${place.name}`}
      data-lower={lowerOpen ? '' : undefined}
    >
      {bar}

      <div className="stage">
        <div className="ws-viewbar">
          <div className="ab-pick">
            <label>
              <span>A</span>
              <select value={state.a} onChange={(e) => onState({ a: e.target.value })}>
                {obs.map((ob, i) => (
                  <option key={ob.observation_id} value={ob.observation_id}>
                    Visit {i + 1} · {shortDate(ob.epoch.mjd_mid)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>B</span>
              <select value={state.b} onChange={(e) => onState({ b: e.target.value })}>
                {m.template && (
                  <option value="typical">Typical (median of {nTypical} visits)</option>
                )}
                {obs.map((ob, i) => (
                  <option key={ob.observation_id} value={ob.observation_id}>
                    Visit {i + 1} · {shortDate(ob.epoch.mjd_mid)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ws-modes">
            <CompareControls
              modes={modes}
              mode={mode}
              onMode={(x) => onState({ mode: x })}
              showB={showB}
              onShowB={setShowB}
              mix={mix}
              onMix={setMix}
              reduced={reduced}
              aLabel={aLabel}
              bLabel={bLabel}
            />
          </div>
        </div>

        <div
          className="stage-frame"
          ref={frameEl}
          data-challenge={challenge?.kind === 'find' && found !== 'yes' ? '' : undefined}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || zoom === 1) return;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
            onState({
              pan: clampFrac({
                x: (d.px + e.clientX - d.x) / fit,
                y: (d.py + e.clientY - d.y) / fit,
              }),
            });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) tap(e.clientX, e.clientY);
          }}
          onPointerCancel={() => (drag.current = null)}
        >
          <div
            className="stage-image"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <CompareLayers
              a={layerA.canvas}
              b={comparing ? layerB.canvas : null}
              mode={mode}
              showB={showB}
              mix={mix}
              label={`${modes.find((x) => x.id === mode)?.label}: A is visit ${epoch + 1} of ${obs.length}, ${o ? longDate(o.epoch.mjd_mid) : ''}${comparing ? `; B is ${bLabel}` : ''}`}
            />
            <svg viewBox={`0 0 ${W} ${H}`} className="stage-marks" aria-hidden="true">
              {markers.map((c) => (
                <g
                  key={c.candidate_id}
                  className={
                    c.candidate_id === candidate?.candidate_id && !hidden
                      ? 'mark is-selected'
                      : 'mark'
                  }
                  transform={`translate(${c.pixel_x + 0.5} ${H - 1 - c.pixel_y + 0.5})`}
                >
                  <circle r={c.candidate_id === candidate?.candidate_id ? 5 : 2.6} />
                </g>
              ))}
            </svg>
          </div>
          <p className="ab-chips" aria-hidden="true">
            <span data-on={!comparing || mode !== 'blink' || !showB ? '' : undefined}>
              A · {mode === 'change' ? `change on ${aLabel}` : aLabel}
            </span>
            {comparing && (
              <span data-on={mode !== 'blink' || showB ? '' : undefined}>B · {bLabel}</span>
            )}
          </p>
          <button
            className="overview"
            onClick={() => close('sky')}
            aria-label="Overview: where this field sits on the sky. Return to Sky"
          >
            <SkyDome
              view={ovView}
              frame={props.frame}
              palette={palette}
              label={`Overview: the sky around ${place.name}`}
              className="overview-dome"
            >
              <svg className="overview-marks" viewBox={`0 0 ${OV} ${OV}`} aria-hidden="true">
                <polygon points={poly(-0.5, -0.5, W - 0.5, H - 0.5)} className="fp" />
                {zoom > 1 && <polygon points={win} className="fp-window" />}
              </svg>
            </SkyDome>
          </button>
          {(layerA.failed || (comparing && layerB.failed)) && (
            <p className="stage-error">This image could not be loaded.</p>
          )}
        </div>

        <div className="ws-controls">
          <div className="play-row" role="group" aria-label="Image A's date">
            <button
              className="icon-btn"
              onClick={() => chooseDate((epoch - 1 + obs.length) % obs.length)}
              aria-label="Previous visit"
            >
              ‹
            </button>
            <button className="play" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
              {playing ? 'Pause' : 'Play visits'}
            </button>
            <button
              className="icon-btn"
              onClick={() => chooseDate((epoch + 1) % obs.length)}
              aria-label="Next visit"
            >
              ›
            </button>
            <span className="visit-title">
              Visit {epoch + 1} of {obs.length}
              <span className="muted"> · {o ? longDate(o.epoch.mjd_mid) : ''}</span>
            </span>
          </div>
          <div className="scalebar" aria-hidden="true">
            <span style={{ width: `${(60 / scale) * perPx}px` }} />
            1′
          </div>
          <div className="zoom" role="group" aria-label="Framing, shared by A and B">
            <button onClick={() => setZ(zoom / 1.5)} disabled={zoom <= 1} aria-label="Zoom out">
              −
            </button>
            <button
              onClick={() => setZ(zoom * 1.5)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in"
            >
              +
            </button>
            <button onClick={() => onState({ zoom: 1, pan: { x: 0, y: 0 } })} disabled={zoom === 1}>
              Fit
            </button>
            <button
              onClick={() => {
                onState({ zoom: 1, pan: { x: 0, y: 0 }, mode: 'one' });
                setMix(0.5);
                setPlaying(false);
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <p className="verdict" data-ok={!pairBlocked ? '' : undefined}>
          <span className="verdict-mark" aria-hidden="true">
            {pairBlocked ? '!' : '✓'}
          </span>
          {state.b === 'typical'
            ? `Checked pair: B is the typical image, built from these same aligned visits.`
            : pair?.status === 'compatible'
              ? 'Checked pair: same detector, wavelength, grid and calibration.'
              : pair?.status === 'same'
                ? 'A and B are the same visit.'
                : `Not comparable: ${pair?.reasons.join('; ')}.`}{' '}
          <span className="muted">
            Colours, blink, split and fade change the display only, never the data.
          </span>
        </p>
      </div>

      <aside className="inspect-panel ws-context" aria-label="Investigation">
        {guide && (
          <Guide
            onShow={show}
            onClose={() => {
              setGuide(false);
              writeFlag('guide-dismissed', true);
            }}
          />
        )}

        {props.notice.length > 0 && (
          <section className="block reopened" role="status">
            <h3>Reopened with changes</h3>
            <ul>
              {props.notice.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        )}

        {challenge?.kind === 'find' && found !== 'yes' && candidate ? (
          <section className="block challenge" aria-labelledby="ch-h">
            <h3 id="ch-h">Find the change</h3>
            <p>
              {candidate.kind === 'variable_like'
                ? 'One spot in this patch brightened sharply on two visits.'
                : 'Something shows up here on one visit only.'}{' '}
              Step through the visits, or choose <em>Change</em>, then tap the spot.
            </p>
            <p className="note">Real SPHEREx data; the answer is a change the pipeline flagged.</p>
            {found === 'miss' && <p role="status">Nothing flagged there. Keep looking.</p>}
            <div className="row">
              {misses >= 2 && (
                <button
                  onClick={() => {
                    setFound('yes');
                    setEpoch(peak);
                  }}
                >
                  Show me
                </button>
              )}
              <button className="quiet" onClick={() => props.onChallenge(null)}>
                Stop challenge
              </button>
            </div>
          </section>
        ) : (
          judging &&
          candidate && (
            <section className="block challenge" aria-labelledby="judge-h">
              <h3 id="judge-h">Real change or artifact?</h3>
              <p>
                The marked spot jumps by {flux ? signed(flux.value) : '?'} µJy on one visit. Step to
                visit {peak + 1}, compare with the others, then decide.
              </p>
              <div className="row">
                <button onClick={() => setVerdict('real')}>Real change</button>
                <button onClick={() => setVerdict('artifact')}>Detector artifact</button>
              </div>
              <button className="quiet" onClick={() => props.onChallenge(null)}>
                Stop challenge
              </button>
            </section>
          )
        )}

        {candidate && !hidden && !judging ? (
          <section className="block evidence" aria-labelledby="ev-h">
            {challenge?.kind === 'judge' && verdict && (
              <p className="reveal" role="status">
                {verdict === 'artifact'
                  ? 'That matches the pipeline’s view. '
                  : 'Reasonable, but the pipeline leans the other way. '}
                It touches pixels flagged for persistence (an afterimage from an earlier bright
                exposure) and appears on one visit only. Neither answer is confirmed.
              </p>
            )}
            {challenge?.kind === 'find' && found === 'yes' && (
              <p className="reveal" role="status">
                Found it. This is a real flagged change, and still unconfirmed.
              </p>
            )}
            <div className="ev-head">
              <h3 id="ev-h">{KIND[candidate.kind]}</h3>
              <span className="status">{STATUS[candidate.status]}</span>
            </div>
            <dl className="ws-figures">
              <dt>Change on {aLabel}</dt>
              <dd aria-live="polite">
                {point?.delta_flux_ujy == null ? (
                  <>
                    <strong>—</strong>{' '}
                    <span className="muted">
                      {point
                        ? 'masked: flagged pixels cover the spot'
                        : 'not measured on this date'}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>
                      {signed(point.delta_flux_ujy)} ± {Math.round(point.uncertainty_ujy ?? 0)}
                    </strong>{' '}
                    µJy
                  </>
                )}
              </dd>
              <dt>Relative to</dt>
              <dd>The typical image, the median of {nTypical} visits</dd>
              {refFlux && (
                <>
                  <dt>Typical brightness</dt>
                  <dd>
                    {Math.round(refFlux.value)} ± {Math.round(refFlux.uncertainty ?? 0)} µJy
                  </dd>
                </>
              )}
              {flux && (
                <>
                  <dt>Largest change</dt>
                  <dd>
                    {signed(flux.value)} ± {Math.round(flux.uncertainty ?? 0)} µJy, visit {peak + 1}
                  </dd>
                </>
              )}
            </dl>
            <p className="note">
              ± is one standard deviation from the science file’s variance; µJy is microjansky, a
              unit of brightness. Measured in a fixed aperture on the science images, never these
              display pictures.
            </p>
            <div className="row">
              {epoch !== peak || state.b !== 'typical' ? (
                <button onClick={() => selectCandidate(candidate)}>Show the largest change</button>
              ) : null}
              <button
                aria-pressed={pinned}
                onClick={() =>
                  pinned && pinId
                    ? props.onUnpin(pinId)
                    : pinId &&
                      props.onPin({
                        kind: 'candidate',
                        id: pinId,
                        label: `${place.name} · ${candidate.candidate_id.split('-').at(-1)}`,
                        placeId: place.id,
                        manifestId: m.manifest_id,
                        candidate: candidate.candidate_id,
                      })
                }
              >
                {pinned ? 'Pinned' : 'Pin this spot'}
              </button>
            </div>
          </section>
        ) : (
          !hidden &&
          !judging && <p className="note">No flagged spot selected. Choose one under Compare.</p>
        )}

        <div className="tabs" role="tablist" aria-label="Investigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`tp-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.id === tab);
                const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                const next = tabs[(i + d + tabs.length) % tabs.length] as (typeof tabs)[number];
                setTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'evidence' && (
          <div className="tabpanel" id="tp-evidence" role="tabpanel" aria-labelledby="tab-evidence">
            <QualityList checks={checks} headingId="q-h" />
            {candidate && !hidden && !judging && (
              <section className="block ws-alt" aria-labelledby="alt-h">
                <h3 id="alt-h">What else could cause this?</h3>
                {signs.length > 0 && (
                  <>
                    <p className="note">Signs the pipeline found of a detector cause:</p>
                    <ul>
                      {signs.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="note">Other causes not ruled out:</p>
                <ul>
                  {ALTERNATIVES.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                  {candidate.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="note">
                  These are possibilities, not findings. Confirming any change needs later SPHEREx
                  visits or another instrument.
                </p>
                <details>
                  <summary>All pipeline evidence and method</summary>
                  <ul>
                    {candidate.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <p className="note">{candidate.method}</p>
                </details>
              </section>
            )}
          </div>
        )}

        {tab === 'compare' && (
          <div className="tabpanel" id="tp-compare" role="tabpanel" aria-labelledby="tab-compare">
            {!challenge && place.id === 'sep' && (
              <aside className="invite">
                <p>Try a challenge: is a flagged spot real or a detector artifact?</p>
                <button
                  className="quiet"
                  onClick={() => {
                    setVerdict(null);
                    props.onChallenge({ kind: 'judge', candidate: 'sep-d4-c001' });
                  }}
                >
                  Real or artifact? · real data
                </button>
              </aside>
            )}
            <section className="block" aria-labelledby="spots-h">
              <h3 id="spots-h">Other flagged spots</h3>
              <p className="note">
                {m.candidates.length} spots flagged by the pipeline here, follow-ups first. All
                unconfirmed.
              </p>
              <ul className="spots">
                {(longList ? ranked : ranked.slice(0, SHORT_LIST)).map((c) => (
                  <li key={c.candidate_id}>
                    <button className="quiet" onClick={() => selectCandidate(c)}>
                      {KIND[c.kind]}
                    </button>
                    <span className="muted">
                      {measure(c, 'peak significance')?.value.toFixed(0)}σ ·{' '}
                      {c.status === 'likely_artifact' ? 'likely artifact' : 'needs follow-up'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="row">
                {ranked.length > SHORT_LIST && (
                  <button className="quiet" onClick={() => setLongList(!longList)}>
                    {longList ? 'Show fewer' : `Show all ${ranked.length}`}
                  </button>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                  />
                  Mark them all on the image
                </label>
              </div>
            </section>
            <section className="block" aria-labelledby="col-h">
              <h3 id="col-h">Colours</h3>
              <div className="seg" role="radiogroup" aria-label="Display colours">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={palette === p.id}
                    disabled={mode === 'change'}
                    onClick={() => props.onPalette(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="note">
                {mode === 'change'
                  ? 'The change map keeps a fixed orange/blue scale so its signs stay readable.'
                  : 'Display only: brightness is mapped to these colours on screen. They are not the colours of infrared light.'}
              </p>
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="tabpanel" id="tp-data" role="tabpanel" aria-labelledby="tab-data">
            <section className="block" aria-labelledby="light-h">
              <h3 id="light-h">Wavelength</h3>
              <p>
                This field was prepared at one wavelength only,{' '}
                {band?.wavelength_center_um.toFixed(2)} µm ({band?.wavelength_min_um.toFixed(2)}–
                {band?.wavelength_max_um.toFixed(2)} µm on detector {band?.detector}). SPHEREx
                measured many more here, but they are not in this prepared set.
              </p>
              <button onClick={() => close('wavelengths')}>
                See this spot at other wavelengths
              </button>
            </section>

            <section className="block" aria-labelledby="lim-h">
              <h3 id="lim-h">Comparison limits</h3>
              <ul className="limits">
                <li>
                  Alignment:{' '}
                  {m.alignment ?? 'not recorded; comparisons rely on each visit’s own grid.'}
                </li>
                {m.template && <li>Typical image: {m.template.method}</li>}
                {diff && (
                  <li>
                    Change map for A ({diff.status.replace('_', ' ')}): {diff.method}. Spots beyond{' '}
                    {diff.threshold_sigma}σ are flagged.
                  </li>
                )}
                <li>Brightness numbers come from the science files, never from these PNGs.</li>
              </ul>
            </section>

            <section className="block" aria-labelledby="count-h">
              <h3 id="count-h">How many observations?</h3>
              <p aria-live="polite">
                {obs.length} prepared visits, chosen for matching detector and wavelength.{' '}
                {archive === 'loading'
                  ? 'Checking the SPHEREx archive…'
                  : exposures !== null
                    ? `The archive lists ${truncated ? 'at least ' : ''}${exposures.toLocaleString('en')} exposures covering this spot, across all detectors and wavelengths; only the prepared ones support measurement here.`
                    : 'The archive count is unavailable right now (it needs the PARALLAX API).'}
              </p>
            </section>

            {o && <Provenance title={`A · visit ${epoch + 1}`} o={o} />}
            {bObs && bObs !== o && (
              <Provenance title={`B · visit ${obs.indexOf(bObs) + 1}`} o={bObs} />
            )}
            <p className="note">
              {m.dataset.citation} Processed by {m.generated_by.tool} {m.generated_by.version},
              manifest schema {m.schema_version}.
            </p>
          </div>
        )}
      </aside>

      <section className="ws-lower" aria-labelledby="lower-h">
        <div className="ws-lower-head">
          <button
            className="quiet ws-lower-toggle"
            aria-expanded={lowerOpen}
            aria-controls="lower-body"
            onClick={() => setLowerOpen(!lowerOpen)}
            id="lower-h"
          >
            <span aria-hidden="true">{lowerOpen ? '▾' : '▸'}</span> Brightness over time
          </button>
          {lowerOpen && (
            <div className="seg" role="radiogroup" aria-label="Show as">
              {(['chart', 'table'] as const).map((v) => (
                <button key={v} role="radio" aria-checked={lower === v} onClick={() => setLower(v)}>
                  {v === 'chart' ? 'Chart' : 'Table'}
                </button>
              ))}
            </div>
          )}
          {lowerOpen && (
            <p className="muted ws-key">
              Change vs typical · µJy · bars ±1σ · × masked · square beyond 5σ
            </p>
          )}
        </div>
        {lowerOpen && (
          <div id="lower-body" className="ws-lower-body">
            {lower === 'chart' ? (
              candidate && !hidden && !judging ? (
                <div className="ws-chart">
                  <EvidenceChart
                    candidate={candidate}
                    observations={obs}
                    active={epoch}
                    onSelect={chooseDate}
                  />
                  <Timeline observations={obs} active={epoch} b={state.b} />
                </div>
              ) : (
                <p className="note">
                  {hidden || judging
                    ? 'The chart appears once you finish the challenge.'
                    : 'Choose a flagged spot to see its brightness on every date.'}
                </p>
              )
            ) : (
              <ObservationTable
                observations={obs}
                candidate={hidden || judging ? undefined : candidate}
                active={epoch}
                b={state.b}
                onSelect={chooseDate}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Provenance({ title, o }: { title: string; o: Observation }) {
  return (
    <details className="block">
      <summary>Data and provenance: {title}</summary>
      <dl className="facts">
        <dt>Observed</dt>
        <dd>
          {longDate(o.epoch.mjd_mid)} · MJD {o.epoch.mjd_mid.toFixed(4)} (
          {o.epoch.time_scale.toUpperCase()}) · {isoDate(o.epoch.mjd_mid)}
        </dd>
        <dt>Exposure</dt>
        <dd>{o.epoch.exposure_s?.toFixed(0) ?? 'unknown'} s</dd>
        <dt>Wavelength</dt>
        <dd>
          {o.spectral.wavelength_center_um.toFixed(4)} µm ({o.spectral.basis})
        </dd>
        <dt>Source</dt>
        <dd>
          {o.provenance.collection} · {o.provenance.data_release} ·{' '}
          {o.provenance.calibration_version}
        </dd>
        <dt>Quality</dt>
        <dd>
          {o.quality.masked_fraction == null
            ? 'masked fraction unknown'
            : `${(o.quality.masked_fraction * 100).toFixed(1)}% masked`}{' '}
          · PSF FWHM {o.quality.psf_fwhm_arcsec?.toFixed(1) ?? 'unknown'}″ ·{' '}
          {o.quality.notes.join(' · ') || 'no notes'}
        </dd>
        <dt>Display</dt>
        <dd>{o.assets.display_stretch}</dd>
        <dt>Processing</dt>
        <dd>{o.provenance.processing}</dd>
      </dl>
      {o.provenance.source_url && (
        <a href={o.provenance.source_url} target="_blank" rel="noreferrer">
          Original file at NASA/IPAC IRSA
        </a>
      )}
    </details>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { BANDS } from '../features/spectrum/channels.ts';
import { formatDec, formatRa } from '../lib/sky.ts';
import {
  coverage,
  DEFAULT_SIZE,
  FLAG_ABOUT,
  holdMs,
  listExposures,
  LiveError,
  loadFrame,
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
import { parseCoords, TARGETS } from './places.ts';
import { paletteTable, type Palette } from './SkyDome.tsx';
import type { ArchiveCompare, FlipTarget } from './store.ts';

const WINDOW = 12; // frames fetched ahead of the one shown; nothing further is downloaded
const CONCURRENCY = 4;
const STRETCH_FROM = 6; // frames that set the shared stretch
const SPEEDS = [2, 4, 8];

type ListState =
  { kind: 'loading' } | { kind: 'ready'; listing: Listing } | { kind: 'error'; e: LiveError };

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

/**
 * Every exposure the archive lists at one point, in one detector band, played in time order.
 * Display imagery only: frames are reprojected and background-subtracted by the API.
 */
export function Flipbook(props: {
  target: FlipTarget;
  active: boolean;
  palette: Palette;
  reduced: boolean;
  onTarget: (t: FlipTarget) => void;
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
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!props.reduced);
  const [speed, setSpeed] = useState(4);
  const [timing, setTiming] = useState<Timing>('equal');
  const [zoom, setZoom] = useState(1);
  const [markA, setMarkA] = useState<Listed | null>(null);
  const [, setTick] = useState(0); // a frame arrived
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
  const list = useMemo(
    () => (month === 'all' ? inBand : inBand.filter((f) => monthOf(f.mjd) === month)),
    [inBand, month],
  );
  const i = Math.min(index, Math.max(0, list.length - 1));
  const cur = list[i];
  const peek = (url: string) => peekFrame(ra, dec, url, size);
  const failKey = (url: string) => `${size}|${url}`;
  const isFailed = (url: string) => failed.has(failKey(url));

  // fetch only a window ahead of the frame shown; leaving the window cancels the request
  const want = useMemo(() => {
    const out: string[] = [];
    for (let k = 0; k < Math.min(WINDOW, list.length); k++) {
      const f = list[(i + k) % list.length];
      if (f) out.push(f.url);
    }
    return out;
  }, [list, i]);
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

  useEffect(() => {
    const c = canvas.current;
    if (!c || !frame || !props.active) return;
    paintFrame(c, frame, shared ?? makeStretch(frame.pix), paletteTable(props.palette));
  }, [frame, shared, props.palette, props.active]);

  // playback holds each frame, then moves on only once the next one has arrived or failed
  const mjds = useMemo(() => list.map((f) => f.mjd), [list]);
  const next = list[(i + 1) % list.length];
  const nextReady = !!next && (!!peek(next.url) || isFailed(next.url));
  useEffect(() => {
    if (!playing || !props.active || !nextReady || list.length < 2) return;
    const t = setTimeout(
      () => {
        let k = (i + 1) % list.length;
        while (failed.has(`${size}|${list[k]?.url ?? ''}`) && k !== i) k = (k + 1) % list.length;
        setIndex(k);
      },
      holdMs(mjds, i, timing, speed),
    );
    return () => clearTimeout(t);
  }, [playing, props.active, nextReady, i, list, mjds, timing, speed, failed, size]);
  if (!props.active && playing) setPlaying(false);

  const step = (d: number) => {
    setPlaying(false);
    setIndex((i + d + list.length) % list.length);
  };
  const cov = frame ? coverage(frame) : null;
  const unsupported = typeof AbortSignal.any !== 'function';
  const named = TARGETS.find((t) => sameSpot(t, props.target));

  let state: { title: string; body: string; retry?: boolean } | null = null;
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
            </div>
          ) : (
            <>
              <div className="flip-frame">
                <canvas
                  ref={canvas}
                  role="img"
                  style={{ transform: `scale(${zoom})` }}
                  aria-label={
                    cur
                      ? `Exposure ${i + 1} of ${list.length}, ${date(cur.mjd)}, detector ${band}. The ring marks the position searched for.`
                      : ''
                  }
                />
                <span className="flip-aim" style={{ transform: `scale(${zoom})` }} aria-hidden />
                {!frame && cur && (
                  <p className="flip-wait" role="status">
                    {isFailed(cur.url)
                      ? 'This exposure failed to load; it is skipped in playback.'
                      : 'Loading this exposure…'}
                  </p>
                )}
                <span className="flip-tag">Archive imagery · display only</span>
              </div>
              <div className="flip-caption">
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
                {frame && <FlagLine flags={frame.flags} />}
              </div>
            </>
          )}
        </div>

        <div className="flip-panel">
          <section className="block" aria-labelledby="what-h">
            <h2 id="what-h">What you are seeing</h2>
            {named && <p>{named.about}</p>}
            <p className="note">
              Each square is one SPHEREx exposure of the same {size}′ patch of sky, lined up
              north-up around the ring. Brighter means more infrared light; the colours are a
              display palette, not the colours the eye would see. Anything that shifts between
              exposures either moved on the sky or is a detector effect: the flag line under the
              image says when an exposure is affected at the ring.
            </p>
          </section>

          <section className="block" aria-labelledby="band-h">
            <h2 id="band-h">Detector band</h2>
            <label className="field">
              <span className="sr-only">Detector band</span>
              <select
                value={band}
                onChange={(e) => (
                  setTarget({ band: e.target.value }),
                  setIndex(0),
                  setMonth('all')
                )}
              >
                {BANDS.map((b) => {
                  const id = `D${b.detector}`;
                  return (
                    <option key={id} value={id}>
                      {id} · {range(id)}
                      {listing.kind === 'ready' ? ` · ${counts[id] ?? 0} exposures` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <p className="note">
              One detector band is not one wavelength: SPHEREx’s filters change colour across each
              detector, so two {band} exposures can see this point at different wavelengths. The
              caption gives the wavelength at the ring for each exposure, from its own calibration.
            </p>
          </section>

          {!state && (
            <>
              <section className="block" aria-labelledby="pb-h">
                <h2 id="pb-h">
                  Exposure {i + 1} of {list.length}
                </h2>
                <div className="play-row">
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
                  <button className="icon-btn" onClick={() => step(1)} aria-label="Next exposure">
                    ›
                  </button>
                </div>
                <label className="slider">
                  <span className="sr-only">Timeline</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, list.length - 1)}
                    value={i}
                    aria-valuetext={cur ? `Exposure ${i + 1}, ${date(cur.mjd)}` : ''}
                    onChange={(e) => (setPlaying(false), setIndex(Number(e.target.value)))}
                  />
                  <span className="ends muted">
                    <span>{list[0] ? date(list[0].mjd) : ''}</span>
                    <span>{list.at(-1) ? date((list.at(-1) as Listed).mjd) : ''}</span>
                  </span>
                </label>
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
                      onChange={(e) => (setTarget({ size: Number(e.target.value) }), setZoom(1))}
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
                <p className="note">
                  Framing is locked: every exposure is reprojected to the same {size}′ north-up
                  square around this point (one SPHEREx pixel is 6.15″), so anything that moves
                  really moved on the sky or is a detector effect.
                  {baked && size !== DEFAULT_SIZE
                    ? ' The saved copy holds 6′ squares; other sizes load from the live archive.'
                    : ''}
                </p>
              </section>

              <section className="block" aria-labelledby="flt-h">
                <h2 id="flt-h">Filter</h2>
                <label className="field">
                  <span>Month</span>
                  <select value={month} onChange={(e) => (setMonth(e.target.value), setIndex(0))}>
                    <option value="all">All {inBand.length} exposures</option>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {m} · {inBand.filter((f) => monthOf(f.mjd) === m).length}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="note" aria-live="polite">
                  The {baked ? `listing saved on ${baked}` : 'archive'} has {all.length} exposures
                  here in all bands, {inBand.length} in {band}. Loaded {loaded}
                  {failures ? `, ${failures} failed` : ''}; only the next {WINDOW} are fetched.
                </p>
              </section>

              <section className="block" aria-labelledby="cmp-h">
                <h2 id="cmp-h">Compare two exposures</h2>
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
                      Mark this exposure as A, step to another, then compare them side by side.
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

              <section className="block" aria-labelledby="d3-h">
                <h2 id="d3-h">3D landscape</h2>
                <p className="note">
                  The same exposures drawn as a landscape, brightness as height. It opens as a
                  separate page.
                </p>
                <a
                  className="button"
                  href={`flipbook/index.html?${new URLSearchParams({ ra: String(ra), dec: String(dec), band })}`}
                >
                  Open in 3D
                </a>
              </section>
            </>
          )}

          <p className="note">
            NASA/IPAC IRSA SPHEREx Level 2 images, reprojected for display (bilinear, median
            background removed). Not measurements; brightness here is not comparable to the
            validated numbers in prepared fields.
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

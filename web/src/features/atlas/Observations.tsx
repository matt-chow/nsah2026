import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatDec, formatRa } from '../../lib/sky.ts';
import { isoDate } from '../../lib/time.ts';
import { flagNames, parseCutout, type Cutout } from './cutout.ts';
import { lut, paintScalar, percentiles } from './render.ts';

// Archived exposures (B): individual dated SPHEREx Level 2 images listed by IRSA's SIA2
// service. IRSA sends no CORS headers, so the list and the cutouts come through the two small
// functions in /api; on a purely static deployment we say so and link to IRSA directly.

export const COLLECTIONS = [
  'spherex_dr1',
  'spherex_qr3',
  'spherex_dr1_deep',
  'spherex_qr3_deep',
] as const;
const PAGE = 20;
const CUTOUT_DEG = 0.05;
const SPHEREX_PIXEL_ARCSEC = 6.15;
// bits from science/src/parallax_science/spherex.py: HARD_FLAGS exclude a pixel, CAUTION ones warn
const HARD = [1, 2, 6, 7, 9, 10, 11, 15];
const CAUTION = [0, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28];
const mask = (bits: number[]) => bits.reduce((m, b) => m | (1 << b), 0);

export interface Exposure {
  obsId: string;
  detector: number;
  emMin: number; // µm, detector-wide
  emMax: number;
  mjdStart: number;
  mjdEnd: number;
  exposure: number;
  url: string;
  collection: string;
}

type Result =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; text: string }
  | {
      kind: 'ready';
      rows: Exposure[];
      truncated: boolean;
      query: string;
      ra: number;
      dec: number;
      collection: string;
    };

const siaLink = (ra: number, dec: number, collection: string) =>
  `https://irsa.ipac.caltech.edu/SIA?${new URLSearchParams({ COLLECTION: collection, POS: `CIRCLE ${ra} ${dec} 0.001`, RESPONSEFORMAT: 'CSV', MAXREC: '1000' })}`;

async function api(path: string, signal: AbortSignal): Promise<Response | null> {
  const res = await fetch(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  // a static host answers /api with its 404 page or index.html: no functions on this deployment
  const type = res.headers.get('content-type') ?? '';
  return type.includes('json') || type.includes('fits') ? res : null;
}

interface Props {
  ra: number;
  dec: number;
  wavelength: number; // µm of the atlas layer, to highlight detectors that cover it
}

export const Observations = memo(function Observations({ ra, dec, wavelength }: Props) {
  const [collection, setCollection] = useState<string>('spherex_dr1');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [detector, setDetector] = useState(0);
  const [covering, setCovering] = useState(false);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Exposure | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  async function search() {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const at = { ra: Number(ra.toFixed(5)), dec: Number(dec.toFixed(5)) };
    setResult({ kind: 'busy' });
    setPicked(null);
    setPage(0);
    try {
      const res = await api(
        `api/observations?ra=${at.ra}&dec=${at.dec}&collection=${collection}`,
        ctrl.signal,
      );
      if (!res)
        return setResult({
          kind: 'error',
          text: 'The archive search needs the small metadata function, which this deployment does not run. The IRSA query below gives the same list as CSV.',
        });
      const body = (await res.json()) as {
        rows?: Exposure[];
        truncated?: boolean;
        query?: string;
        error?: string;
      };
      if (!res.ok || !Array.isArray(body.rows))
        return setResult({ kind: 'error', text: body.error ?? `HTTP ${res.status}` });
      setResult({
        kind: 'ready',
        rows: body.rows,
        truncated: !!body.truncated,
        query: body.query ?? siaLink(at.ra, at.dec, collection),
        ...at,
        collection,
      });
    } catch (e) {
      if (!ctrl.signal.aborted || (e instanceof DOMException && e.name === 'TimeoutError'))
        setResult({ kind: 'error', text: 'IRSA did not answer in time. Try again shortly.' });
    }
  }

  const rows = useMemo(() => (result.kind === 'ready' ? result.rows : []), [result]);
  const shown = useMemo(
    () =>
      rows.filter(
        (o) =>
          (!detector || o.detector === detector) &&
          (!covering || (o.emMin <= wavelength && wavelength <= o.emMax)),
      ),
    [rows, detector, covering, wavelength],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const exposures = new Set(rows.map((o) => o.obsId)).size;
  const moved =
    result.kind === 'ready' &&
    (Math.abs(result.ra - ra) > 1e-4 || Math.abs(result.dec - dec) > 1e-4);

  return (
    <div className="atlas-obs">
      <div className="obs-search">
        <p className="mono">
          Position: {formatRa(ra)} {formatDec(dec)} (the atlas centre)
        </p>
        <label>
          Collection{' '}
          <select value={collection} onChange={(e) => setCollection(e.target.value)}>
            {COLLECTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => void search()}
          disabled={result.kind === 'busy'}
        >
          {result.kind === 'busy' ? 'Asking IRSA…' : 'Find archived exposures here'}
        </button>
      </div>
      <div aria-live="polite">
        {result.kind === 'busy' && (
          <p className="atlas-status busy">
            <span className="spinner" aria-hidden="true" /> Querying IRSA's SIA2 service (metadata
            only)…
          </p>
        )}
        {result.kind === 'error' && (
          <div className="atlas-status error">
            <p>{result.text}</p>
            <a
              href={siaLink(Number(ra.toFixed(5)), Number(dec.toFixed(5)), collection)}
              rel="noreferrer"
            >
              Open the IRSA query for this position
            </a>
          </div>
        )}
        {result.kind === 'ready' && (
          <p className="atlas-status ok">
            {rows.length === 0
              ? `IRSA lists no ${result.collection} images at this position.`
              : `${rows.length}${result.truncated ? '+' : ''} detector images from ${exposures} exposures, ${isoDate(rows[0]?.mjdStart ?? 0)} to ${isoDate(rows.at(-1)?.mjdStart ?? 0)}.`}{' '}
            {result.truncated &&
              'IRSA capped the list; the earliest rows are not guaranteed to be included. '}
            {moved && 'The atlas has moved since this search; search again for the new centre. '}
            <a href={result.query} rel="noreferrer">
              Raw IRSA response
            </a>
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <>
          <p className="legend-note">
            Each exposure images the sky through two detectors at once (1–3 and 4–6 share a
            dichroic), so most appear twice. A detector's range is wide; the wavelength at{' '}
            <em>this</em> position is narrower and is read from the cutout.
          </p>
          <div className="obs-filters">
            <label>
              Detector{' '}
              <select
                value={detector}
                onChange={(e) => (setDetector(Number(e.target.value)), setPage(0))}
              >
                <option value={0}>all</option>
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    D{d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={covering}
                onChange={(e) => (setCovering(e.target.checked), setPage(0))}
              />{' '}
              Only detectors whose range includes the atlas layer ({wavelength.toFixed(3)} µm)
            </label>
            <span className="mono">{shown.length} shown</span>
          </div>
          <div className="table-scroll">
            <table className="calib obs-table">
              <caption className="visually-hidden">
                Archived SPHEREx detector images at this position, oldest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">MJD</th>
                  <th scope="col">Detector</th>
                  <th scope="col">Range (µm)</th>
                  <th scope="col">Exp. (s)</th>
                  <th scope="col">Observation</th>
                  <th scope="col">Data</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((o) => (
                  <tr key={o.url} aria-current={picked?.url === o.url || undefined}>
                    <td>{isoDate(o.mjdStart)}</td>
                    <td className="mono">{o.mjdStart.toFixed(4)}</td>
                    <td>D{o.detector}</td>
                    <td className="mono">
                      {o.emMin.toFixed(3)}–{o.emMax.toFixed(3)}
                    </td>
                    <td className="mono">{o.exposure.toFixed(1)}</td>
                    <td className="mono">{o.obsId}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setPicked(o)}
                        aria-label={`Load cutout of ${o.obsId} detector ${o.detector}`}
                      >
                        Cutout
                      </button>{' '}
                      <a
                        href={o.url}
                        rel="noreferrer"
                        aria-label={`Full IRSA file for ${o.obsId} detector ${o.detector}`}
                      >
                        File
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="obs-pages">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Earlier
              </button>
              <span className="mono">
                page {page + 1} of {pages}
              </span>
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                Later
              </button>
            </div>
          )}
        </>
      )}
      {picked && result.kind === 'ready' && (
        <CutoutPanel key={picked.url} exposure={picked} ra={result.ra} dec={result.dec} />
      )}
    </div>
  );
});

type CutLoad = { kind: 'busy' } | { kind: 'error'; text: string } | { kind: 'ready'; cut: Cutout };

const CutoutPanel = memo(function CutoutPanel({
  exposure,
  ra,
  dec,
}: {
  exposure: Exposure;
  ra: number;
  dec: number;
}) {
  const [load, setLoad] = useState<CutLoad>({ kind: 'busy' });
  const [attempt, setAttempt] = useState(0);
  const [showFlags, setShowFlags] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readRef = useRef<HTMLOutputElement>(null);
  const irsa = `${exposure.url}?center=${ra},${dec}&size=${CUTOUT_DEG}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const q = new URLSearchParams({
      url: exposure.url,
      ra: String(ra),
      dec: String(dec),
      size: String(CUTOUT_DEG),
    });
    api(`api/cutout?${q}`, ctrl.signal)
      .then(async (res) => {
        if (!res)
          return setLoad({
            kind: 'error',
            text: 'Cutouts need the small cutout function, which this deployment does not run. The IRSA link below downloads the same cutout.',
          });
        if (!res.ok || !res.headers.get('content-type')?.includes('fits')) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return setLoad({ kind: 'error', text: body.error ?? `HTTP ${res.status}` });
        }
        setLoad({ kind: 'ready', cut: parseCutout(new Uint8Array(await res.arrayBuffer())) });
      })
      .catch(
        (e: unknown) =>
          !ctrl.signal.aborted &&
          setLoad({ kind: 'error', text: e instanceof Error ? e.message : String(e) }),
      );
    return () => ctrl.abort();
  }, [exposure.url, ra, dec, attempt]);

  const cut = load.kind === 'ready' ? load.cut : null;
  const k = cut ? Math.max(4, Math.floor(288 / Math.max(cut.w, cut.h))) : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!cut || !canvas || !ctx) return;
    // FITS rows run bottom-up; the screen runs top-down
    const flipped = new Float32Array(cut.w * cut.h);
    for (let y = 0; y < cut.h; y++)
      flipped.set(cut.image.subarray(y * cut.w, (y + 1) * cut.w), (cut.h - 1 - y) * cut.w);
    const p = percentiles(flipped, [1, 99.5]) ?? [0, 1];
    const small = new ImageData(cut.w, cut.h);
    paintScalar(
      flipped,
      cut.w,
      { lo: p[0] as number, hi: p[1] as number },
      'asinh',
      lut('grey'),
      small.data,
    );
    const tmp = new OffscreenCanvas(cut.w, cut.h);
    tmp.getContext('2d')?.putImageData(small, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, cut.w * k, cut.h * k);
    if (showFlags) {
      const hard = mask(HARD);
      const caution = mask(CAUTION);
      for (let y = 0; y < cut.h; y++)
        for (let x = 0; x < cut.w; x++) {
          const f = cut.flags[y * cut.w + x] as number;
          const sy = (cut.h - 1 - y) * k;
          if (f & hard) {
            ctx.strokeStyle = '#ff5a4f';
            ctx.lineWidth = 2;
            ctx.strokeRect(x * k + 1, sy + 1, k - 2, k - 2);
          } else if (f & caution) {
            ctx.fillStyle = '#f2a33a';
            ctx.fillRect(x * k + k / 2 - 1.5, sy + k / 2 - 1.5, 3, 3);
          }
        }
    }
    // compass from the PC matrix (display helper); screen y is FITS −y
    const o = { x: 26, y: cut.h * k - 26 };
    ctx.font = '12px "IBM Plex Mono", monospace';
    for (const [label, a] of [
      ['N', cut.northUp],
      ['E', cut.eastUp],
    ] as const) {
      const tip = { x: o.x + 18 * Math.sin(a), y: o.y - 18 * Math.cos(a) };
      ctx.strokeStyle = ctx.fillStyle = '#7fdcff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.fillText(label, tip.x + 5 * Math.sin(a) - 4, tip.y - 5 * Math.cos(a) + 4);
    }
  }, [cut, k, showFlags]);

  function hover(e: React.PointerEvent<HTMLCanvasElement>) {
    const out = readRef.current;
    if (!cut || !out) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * cut.w);
    const y = cut.h - 1 - Math.floor(((e.clientY - r.top) / r.height) * cut.h);
    if (x < 0 || y < 0 || x >= cut.w || y >= cut.h) return void (out.textContent = '');
    const i = y * cut.w + x;
    const v = cut.image[i] as number;
    const s = cut.variance ? Math.sqrt(cut.variance[i] as number) : NaN;
    const lam = cut.lvf(x, y);
    const flags = flagNames(cut.flags[i] as number, cut.flagBits);
    out.textContent =
      `pixel (${x}, ${y})  ${Number.isNaN(v) ? 'no data' : `${v.toPrecision(4)}${Number.isNaN(s) ? '' : ` ± ${s.toPrecision(2)}`} ${cut.bunit}`}` +
      `${cut.zodi ? `  zodiacal model ${(cut.zodi[i] as number).toPrecision(3)}` : ''}` +
      `${lam ? `  λ ${lam.um.toFixed(4)} µm` : ''}  flags: ${flags.length ? flags.join(', ') : 'none'}`;
  }

  if (load.kind !== 'ready')
    return (
      <section className="panel cutout-panel" aria-live="polite">
        <h3>
          Cutout · {exposure.obsId} D{exposure.detector}
        </h3>
        {load.kind === 'busy' ? (
          <p className="atlas-status busy">
            <span className="spinner" aria-hidden="true" /> IRSA is cutting {CUTOUT_DEG * 60}′
            around the position…
          </p>
        ) : (
          <div className="atlas-status error">
            <p>{load.text}</p>
            <button
              type="button"
              onClick={() => (setLoad({ kind: 'busy' }), setAttempt(attempt + 1))}
            >
              Try again
            </button>
          </div>
        )}
        <a href={irsa} rel="noreferrer">
          Download this cutout from IRSA (FITS)
        </a>
      </section>
    );

  const c = load.cut;
  const centre = c.lvf((c.w - 1) / 2, (c.h - 1) / 2);
  const expected = Math.round((CUTOUT_DEG * 3600) / SPHEREX_PIXEL_ARCSEC);
  const clipped = c.w < expected - 1 || c.h < expected - 1;
  const hardN = c.flags.reduce((n, f) => n + (f & mask(HARD) ? 1 : 0), 0);
  const nan = c.image.reduce((n, v) => n + (Number.isNaN(v) ? 1 : 0), 0);
  const pipe = /(l2b-v\d+)-(\d{4}-\d{3})/.exec(exposure.url);
  return (
    <section className="panel cutout-panel" aria-live="polite">
      <h3>
        Cutout · {c.obsId} D{c.detector} · {c.dateAvg.replace('T', ' ').slice(0, 19)} UTC
      </h3>
      <div className="cutout-body">
        <figure>
          <canvas
            ref={canvasRef}
            width={c.w * k}
            height={c.h * k}
            onPointerMove={hover}
            onPointerLeave={() => readRef.current && (readRef.current.textContent = '')}
            aria-label={`Cutout image, ${c.w} by ${c.h} detector pixels, in detector orientation; arrows mark north and east.`}
          />
          <figcaption>
            Detector orientation (not rotated to north up), asinh stretch, grey. Visualization;
            hover for measured values.
            {clipped
              ? ' The cutout is clipped at the detector edge, so the position is not at its centre.'
              : ' The searched position is at the centre.'}
          </figcaption>
          <label className="flag-toggle">
            <input
              type="checkbox"
              checked={showFlags}
              onChange={(e) => setShowFlags(e.target.checked)}
            />{' '}
            Show flagged pixels <span className="flag-key hard">exclude</span>{' '}
            <span className="flag-key caution">caution</span>
          </label>
          <output ref={readRef} className="atlas-readout mono" aria-live="off" />
        </figure>
        <dl className="facts cutout-facts">
          <dt>Observation</dt>
          <dd className="mono">
            {c.obsId} (exposure {c.expId})
          </dd>
          <dt>Detector</dt>
          <dd>D{c.detector}</dd>
          <dt>Mid-exposure</dt>
          <dd className="mono">
            {c.dateAvg} UTC · MJD {c.mjdAvg.toFixed(5)}
          </dd>
          <dt>Exposure</dt>
          <dd>{c.exposure.toFixed(1)} s</dd>
          <dt>Wavelength here</dt>
          <dd>
            {centre
              ? `${centre.um.toFixed(3)} µm, bandwidth ${centre.bandwidth.toFixed(3)} µm (IRSA per-pixel table, cutout centre)`
              : 'unavailable (no WCS-WAVE table)'}
          </dd>
          <dt>Units</dt>
          <dd>
            {c.bunit} (surface brightness); variance {c.variance ? 'included' : 'absent'}
          </dd>
          <dt>Quality</dt>
          <dd>
            L2 QA {c.qa || 'not stated'} · {hardN} of {c.w * c.h} pixels hard-flagged · {nan}{' '}
            without data
          </dd>
          <dt>PSF FWHM</dt>
          <dd>{c.psfFwhm ? `${c.psfFwhm.toFixed(2)}″` : 'not stated'}</dd>
          <dt>Calibration</dt>
          <dd className="mono">
            {pipe ? `${pipe[1]} (${pipe[2]})` : 'unknown'} · software {c.softwareVersion || '?'}
          </dd>
          <dt>Source</dt>
          <dd>
            <a href={exposure.url} rel="noreferrer">
              IRSA Level 2 file
            </a>{' '}
            ·{' '}
            <a href={irsa} rel="noreferrer">
              this cutout (FITS, incl. PSF)
            </a>
          </dd>
        </dl>
      </div>
    </section>
  );
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { FLAG_ABOUT, loadFrame, type Listed, type LiveFrame } from './live.ts';
import { aperture, centroid, fitMotion, wingCentroid, type Motion } from './measure.ts';

// The flipbook's Measure and Spectrum tools. Both read the archive pixel values of the cutouts
// (never the display stretch) and report background-limited 1σ errors; see measure.ts.

const date = (mjd: number) =>
  new Date((mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const fmt = (v: number, d = 1) => (Math.abs(v) < 0.05 && d === 1 ? '0.0' : v.toFixed(d));
// flags that mean the pixels at the target are not trustworthy for a measurement
const BAD = new Set(['OVERFLOW', 'NONLINEAR', 'NONFUNC', 'MISSING_DATA', 'SUR_ERROR', 'BLOOM']);
const isBad = (f: LiveFrame) => !!f.flags?.some((x) => BAD.has(x));
// of those, the ones a saturated star sets: its core is blanked but its wings are still usable
const SATURATION = new Set(['OVERFLOW', 'NONLINEAR', 'SUR_ERROR', 'BLOOM']);
const isSaturated = (f: LiveFrame) =>
  isBad(f) && !!f.flags?.every((x) => !BAD.has(x) || SATURATION.has(x));

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const provenance = (ra: number, dec: number) => ({
  tool: 'PARALLAX flipbook (web/src/prototype/measure.ts)',
  exported: new Date().toISOString(),
  data_kind: 'real',
  target_icrs_deg: { ra, dec },
  source: 'NASA/IPAC IRSA SPHEREx Level 2 images via /api/spherex (api/_spherex.py)',
  processing:
    'Cutout reprojected north-up to 6.15″ pixels (bilinear), cutout median subtracted; local annulus background (6–9 px) subtracted again here.',
  uncertainty:
    'Background-limited 1σ from 1.4826 × MAD of the annulus; source photon noise and resampling correlations not included.',
});

// ---------- a small accessible scatter plot ----------

interface Pt {
  x: number;
  y: number;
  ey?: number;
  ex?: number;
  hollow?: boolean;
}

const ticks = (lo: number, hi: number) => {
  const step = 10 ** Math.floor(Math.log10((hi - lo) / 3 || 1));
  const k = [1, 2, 5, 10].find((m) => (hi - lo) / (m * step) <= 5) ?? 10;
  const s = k * step;
  const out: number[] = [];
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(Number(v.toPrecision(6)));
  return out;
};

function Plot(props: {
  points: Pt[];
  xLabel: string;
  yLabel: string;
  label: string;
  flipX?: boolean;
  line?: [number, number, number, number];
  xFormat?: (v: number) => string;
}) {
  const W = 340;
  const H = 200;
  const L = 48;
  const B = 34;
  const pts = props.points;
  const ext = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    return [lo - pad, hi + pad] as const;
  };
  const [x0, x1] = ext(pts.flatMap((p) => [p.x - (p.ex ?? 0), p.x + (p.ex ?? 0)]));
  const [y0, y1] = ext(pts.flatMap((p) => [p.y - (p.ey ?? 0), p.y + (p.ey ?? 0)]));
  const sx = (x: number) => {
    const t = (x - x0) / (x1 - x0);
    return L + (props.flipX ? 1 - t : t) * (W - L - 8);
  };
  const sy = (y: number) => 8 + (1 - (y - y0) / (y1 - y0)) * (H - B - 8);
  const xf = props.xFormat ?? ((v: number) => String(v));
  return (
    <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label}>
      {ticks(y0, y1).map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - 8} y1={sy(v)} y2={sy(v)} className="grid" />
          <text x={L - 6} y={sy(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {ticks(x0, x1).map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - B + 16} textAnchor="middle">
          {xf(v)}
        </text>
      ))}
      <text x={(L + W) / 2} y={H - 3} textAnchor="middle" className="axis">
        {props.xLabel}
      </text>
      <text
        x={12}
        y={(H - B) / 2}
        textAnchor="middle"
        className="axis"
        transform={`rotate(-90 12 ${(H - B) / 2})`}
      >
        {props.yLabel}
      </text>
      {props.line && (
        <line
          className="fit"
          x1={sx(props.line[0])}
          y1={sy(props.line[1])}
          x2={sx(props.line[2])}
          y2={sy(props.line[3])}
        />
      )}
      {pts.map((p, k) => (
        <g key={k} className={p.hollow ? 'pt hollow' : 'pt'}>
          {p.ey ? <line x1={sx(p.x)} x2={sx(p.x)} y1={sy(p.y - p.ey)} y2={sy(p.y + p.ey)} /> : null}
          {p.ex ? <line y1={sy(p.y)} y2={sy(p.y)} x1={sx(p.x - p.ex)} x2={sx(p.x + p.ex)} /> : null}
          <circle cx={sx(p.x)} cy={sy(p.y)} r={3} />
        </g>
      ))}
    </svg>
  );
}

// ---------- Measure: motion and brightness in this band ----------

export function MeasurePanel(props: {
  ra: number;
  dec: number;
  band: string;
  list: Listed[];
  frames: (LiveFrame | undefined)[]; // parallel to list; undefined = not loaded
  allLoaded: boolean;
  onLoadAll: () => void;
}) {
  const { ra, dec, band, list, frames } = props;
  const rows = useMemo(
    () =>
      list.flatMap((l, k) => {
        const f = frames[k];
        if (!f) return [];
        return [{ l, f, c: centroid(f.pix, f.n), ap: aperture(f.pix, f.n), bad: isBad(f) }];
      }),
    [list, frames],
  );
  // A star that saturates most exposures is measured from its wings in every exposure, so one
  // method (and one set of systematics) runs through the whole series.
  const saturated = rows.filter((r) => isSaturated(r.f)).length;
  const wings = saturated > rows.filter((r) => r.c && !r.bad).length;
  const wingRows = useMemo(
    () =>
      wings
        ? rows.map((r) => {
            const w = !r.bad || isSaturated(r.f) ? wingCentroid(r.f.pix, r.f.n) : null;
            // unit weights: fitMotion's empirical mode sets the errors from the scatter
            return { ...r, c: w && { ...w, se: 1, sn: 1, snr: NaN }, bad: !w };
          })
        : null,
    [rows, wings],
  );
  const used = wingRows ?? rows;
  const good = used.filter((r) => r.c && !r.bad);
  const motion: Motion | null = fitMotion(
    good.map((r) => ({ mjd: r.f.mjd ?? r.l.mjd, c: r.c as NonNullable<typeof r.c> })),
    { ra, dec, empirical: wings },
  );
  const plx = motion?.withParallax ?? null;
  const flagged = used.filter((r) => r.bad).length;
  const faint = used.filter((r) => !r.bad && !r.c).length;
  const sig = motion ? motion.total / motion.sTotal : 0;
  const lc = rows.filter((r) => r.ap);
  const t0 = list[0]?.mjd ?? 0;

  return (
    <div className="tool">
      <section className="block" aria-labelledby="mv-h">
        <h2 id="mv-h">Does it move?</h2>
        <p className="note">
          For each exposure, the centre of the light nearest the ring is measured from the archive
          pixel values, then a straight line through those positions gives a speed across the sky.
        </p>
        <p className="note" aria-live="polite">
          {rows.length} of {list.length} {band} exposures loaded: {good.length} measurable
          {flagged
            ? `, ${flagged} skipped as ${wings ? '' : 'saturated or '}flagged at the ring`
            : ''}
          {faint ? `, ${faint} too faint or with gaps` : ''}.
        </p>
        {wings && (
          <p className="note">
            This star saturates the detector: the archive blanks its brightest pixels. Its centre is
            found instead from the unsaturated light around them, as the point the star looks the
            same from on every side. The uncertainties come from how much those positions scatter.
          </p>
        )}
        {!props.allLoaded && (
          <button onClick={props.onLoadAll}>Load all {list.length} exposures</button>
        )}
        {motion ? (
          <>
            <p className="result" aria-live="polite">
              <span className="data">
                {fmt(motion.total, 2)} ± {fmt(motion.sTotal, 2)}″ per year
              </span>{' '}
              ({fmt(motion.pmN, 2)} ± {fmt(motion.sN, 2)} north, {fmt(motion.pmE, 2)} ±{' '}
              {fmt(motion.sE, 2)} east), from {motion.used} exposures over{' '}
              {fmt(motion.years * 12, 1)} months.
            </p>
            <p className="stamp">
              {sig >= 3
                ? `Possible motion, ${fmt(sig, 1)}σ from zero: unconfirmed`
                : `No motion detected at this precision (${fmt(sig, 1)}σ)`}
            </p>
            <p className="note">
              {sig >= 3
                ? 'A measured shift, not a confirmed one. A neighbouring star blending in, the filter changing colour across the detector, or a flag the archive missed can all move the centre of light. Compare with the Gaia markers.'
                : `Any motion is smaller than about ${fmt(3 * motion.sTotal, 1)}″ per year, or hidden by the scatter. One SPHEREx pixel is 6.15″, so slow movers need longer than this time span.`}
              {motion.chi2r > 1 && !wings
                ? ` The positions scatter ${fmt(Math.sqrt(motion.chi2r), 1)}× more than the pixel noise predicts, so the errors were scaled up by that much.`
                : ''}
            </p>
            {plx ? (
              <p className="note">
                <strong>With parallax.</strong> Fitting the yearly wobble from Earth’s orbit as
                well: parallax{' '}
                <span className="data">
                  {fmt(plx.plx, 2)} ± {fmt(plx.sPlx, 2)}″
                </span>
                {plx.plx > 3 * plx.sPlx
                  ? ` (${fmt(plx.plx / plx.sPlx, 1)}σ, which would put it about ${fmt(3.26 / plx.plx, 0)} light years away; unconfirmed)`
                  : ' (not detected: smaller than three times its uncertainty, which this scatter and time span allow)'}
                , motion {fmt(plx.pmN, 2)} ± {fmt(plx.sN, 2)} north, {fmt(plx.pmE, 2)} ±{' '}
                {fmt(plx.sE, 2)} east.
              </p>
            ) : (
              <p className="note">
                Parallax, the yearly wobble from Earth’s orbit, is not fitted: it needs exposures
                spanning about a year (three visits) to tell apart from steady motion.
              </p>
            )}
            <Plot
              label={`Measured position of the centre of light in each of ${motion.used} exposures, east and north of the ring, in arcseconds, with the fitted straight-line motion.`}
              xLabel="east of ring (″) ← east"
              yLabel="north of ring (″)"
              flipX
              points={good.map((r) => ({
                x: r.c?.e ?? 0,
                y: r.c?.n ?? 0,
                ex: wings ? 0 : (r.c?.se ?? 0),
                ey: wings ? 0 : (r.c?.sn ?? 0),
              }))}
              line={(() => {
                const [a, b] = [motion.track[0], motion.track.at(-1)];
                const mid = {
                  e: motion.track.reduce((s, p) => s + p.e, 0) / motion.track.length,
                  n: motion.track.reduce((s, p) => s + p.n, 0) / motion.track.length,
                };
                const tm = motion.track.reduce((s, p) => s + p.mjd, 0) / motion.track.length;
                const at = (mjd: number) => [
                  mid.e + (motion.pmE * (mjd - tm)) / 365.25,
                  mid.n + (motion.pmN * (mjd - tm)) / 365.25,
                ];
                return [...at(a?.mjd ?? tm), ...at(b?.mjd ?? tm)] as [
                  number,
                  number,
                  number,
                  number,
                ];
              })()}
            />
          </>
        ) : (
          <p className="note">
            {good.length < 4
              ? 'Not enough measurable exposures yet: a speed needs at least four positions.'
              : 'These exposures span too short a time (under about five weeks) to measure a speed.'}
            {flagged && !good.length && !wings
              ? ' Every exposure is flagged at the ring here; try another band.'
              : ''}
          </p>
        )}
      </section>

      {lc.length >= 2 && (
        <section className="block" aria-labelledby="lc-h">
          <h2 id="lc-h">Does it change brightness?</h2>
          <Plot
            label={`Brightness at the ring in ${lc.length} exposures, in millijanskys, against date.`}
            xLabel="days since the first exposure"
            yLabel="brightness (mJy)"
            points={lc.map((r) => ({
              x: (r.f.mjd ?? r.l.mjd) - t0,
              y: r.ap?.mjy ?? 0,
              ey: r.ap?.err ?? 0,
              hollow: r.bad,
            }))}
          />
          <p className="note">
            Light within 2 pixels (12″) of the ring, minus the local background. Hollow points are
            flagged at the ring (often saturated) and unreliable. Not corrected for the light
            outside that circle, so compare points with each other rather than with catalogues. Each{' '}
            {band} exposure sees this point at a slightly different wavelength, which can change the
            brightness on its own.
          </p>
        </section>
      )}

      {rows.length > 0 && (
        <button
          onClick={() =>
            download(`parallax-${band}-measurements.json`, {
              ...provenance(ra, dec),
              band,
              method: {
                centroid: wings
                  ? 'saturated star: point of maximum point symmetry of the unsaturated pixels within 4 px (bilinear reflection, NaN core ignored), searched within 2 px of the ring; no per-exposure error'
                  : 'brightest pixel within 2 px of the ring, then background-subtracted first moments within 2.5 px; SNR ≥ 5; 0.3″ floor added in quadrature',
                motion: wings
                  ? 'unweighted least-squares line per axis; errors from the scatter (× √χ²ᵣ)'
                  : 'weighted least-squares line per axis; errors × √χ²ᵣ when χ²ᵣ > 1',
                parallax:
                  'joint 5-parameter fit (offsets, proper motion, parallax), low-precision Earth ephemeris; only when exposures span ≥ 0.9 yr',
                brightness: 'aperture r = 2 px minus annulus median, no aperture correction',
                excluded_flags: [...BAD],
              },
              motion_arcsec_per_year: motion && {
                east: motion.pmE,
                north: motion.pmN,
                east_err: motion.sE,
                north_err: motion.sN,
                total: motion.total,
                total_err: motion.sTotal,
                chi2_reduced: motion.chi2r,
                significance_sigma: sig,
                status: sig >= 3 ? 'possible motion (unconfirmed)' : 'not detected',
              },
              with_parallax_arcsec: plx && {
                parallax: plx.plx,
                parallax_err: plx.sPlx,
                east_per_year: plx.pmE,
                north_per_year: plx.pmN,
                east_err: plx.sE,
                north_err: plx.sN,
                chi2_reduced: plx.chi2r,
              },
              exposures: used.map((r) => ({
                url: r.l.url,
                mjd: r.f.mjd ?? r.l.mjd,
                release: r.l.rel ?? null,
                detector: r.f.det,
                wavelength_um: r.f.um,
                flags_at_ring: r.f.flags,
                excluded: r.bad,
                offset_east_arcsec: r.c?.e ?? null,
                offset_north_arcsec: r.c?.n ?? null,
                offset_err_arcsec: r.c && !wings ? [r.c.se, r.c.sn] : null,
                brightness_mjy: r.ap?.mjy ?? null,
                brightness_err_mjy: r.ap?.err ?? null,
              })),
            })
          }
        >
          Download the numbers (JSON)
        </button>
      )}
    </div>
  );
}

// ---------- Spectrum: brightness against wavelength, across all six detectors ----------

const SPEC_SIZE = 2; // arcmin: small cutouts, quick to make
const PER_BAND = 6;
const SPEC_CONCURRENCY = 4;

interface SpecPt {
  band: string;
  mjd: number;
  url: string;
  um: number;
  dum: number | null;
  mjy: number;
  err: number;
  bad: boolean;
}

/** Up to `per` exposures per band, spread evenly in time. */
export function pickSpread(all: Listed[], per: number): Listed[] {
  const byBand = new Map<string, Listed[]>();
  for (const f of all) byBand.set(f.band, [...(byBand.get(f.band) ?? []), f]);
  return [...byBand.values()].flatMap((fs) => {
    const s = [...fs].sort((a, b) => a.mjd - b.mjd);
    if (s.length <= per) return s;
    return Array.from(
      { length: per },
      (_, k) => s[Math.round((k * (s.length - 1)) / (per - 1))] as Listed,
    );
  });
}

export function SpectrumPanel(props: { ra: number; dec: number; all: Listed[] }) {
  const { ra, dec, all } = props;
  const picks = useMemo(() => pickSpread(all, PER_BAND), [all]);
  const [run, setRun] = useState(0);
  const [pts, setPts] = useState<SpecPt[]>([]);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [noApi, setNoApi] = useState(false);
  const ac = useRef<AbortController | null>(null);

  // a new point starts over; leaving one cancels its downloads
  const point = `${ra},${dec}`;
  const [seen, setSeen] = useState(point);
  if (seen !== point) {
    setSeen(point);
    setPts([]);
    setDone(0);
    setFailed(0);
    setNoApi(false);
    setRun(0);
  }
  useEffect(() => () => ac.current?.abort(), [ra, dec]);

  const start = () => {
    ac.current?.abort();
    const ctl = new AbortController();
    ac.current = ctl;
    setPts([]);
    setDone(0);
    setFailed(0);
    setNoApi(false);
    setRun((r) => r + 1);
    const queue = [...picks];
    const worker = async () => {
      for (let l = queue.shift(); l && !ctl.signal.aborted; l = queue.shift()) {
        try {
          const f = await loadFrame(ra, dec, l.url, ctl.signal, SPEC_SIZE);
          const ap = aperture(f.pix, f.n);
          if (ctl.signal.aborted) return;
          if (ap && f.um !== null)
            setPts((p) => [
              ...p,
              {
                band: l.band,
                mjd: f.mjd ?? l.mjd,
                url: l.url,
                um: f.um as number,
                dum: f.dum,
                mjy: ap.mjy,
                err: ap.err,
                bad: isBad(f),
              },
            ]);
          else setFailed((n) => n + 1);
        } catch (e) {
          if (ctl.signal.aborted) return;
          if ((e as { kind?: string }).kind === 'no-api') {
            setNoApi(true);
            ctl.abort();
            return;
          }
          setFailed((n) => n + 1);
        }
        setDone((n) => n + 1);
      }
    };
    void Promise.all(Array.from({ length: SPEC_CONCURRENCY }, worker));
  };

  const busy = run > 0 && done < picks.length && !noApi;
  const sorted = [...pts].sort((a, b) => a.um - b.um);
  return (
    <div className="tool">
      <section className="block" aria-labelledby="sp-h">
        <h2 id="sp-h">Its spectrum, from the archive</h2>
        <p className="note">
          SPHEREx sees 0.75–5 µm through filters whose colour changes across each detector, so every
          exposure catches this point at its own wavelength. Measuring the brightness at the ring in
          a few exposures from each of the six detectors traces a spectrum: dips are where molecules
          such as water, methane or carbon monoxide absorb.
        </p>
        <button className="primary" onClick={start} disabled={busy || picks.length === 0}>
          {busy
            ? `Measuring ${done} of ${picks.length}…`
            : run
              ? 'Measure again'
              : `Measure ${picks.length} exposures across all detectors`}
        </button>
        {noApi && (
          <p className="note" role="alert">
            This copy of the app has no archive connection, and the saved targets hold one detector
            each, so a spectrum needs the online version.
          </p>
        )}
        {failed > 0 && (
          <p className="note">
            {failed} exposure{failed > 1 ? 's' : ''} could not be measured (no data at the ring,
            unknown wavelength or an archive error).
          </p>
        )}
        {sorted.length >= 2 && (
          <>
            <Plot
              label={`Brightness at the ring against wavelength, ${sorted.length} exposures, in millijanskys.`}
              xLabel="wavelength (µm)"
              yLabel="brightness (mJy)"
              points={sorted.map((p) => ({
                x: p.um,
                y: p.mjy,
                ey: p.err,
                ex: (p.dum ?? 0) / 2,
                hollow: p.bad,
              }))}
            />
            <p className="note">
              Each point is one exposure: horizontal bars span its filter width, vertical bars the
              1σ background noise. Hollow points are flagged at the ring and unreliable. Light
              within 2 pixels of the ring, not corrected for what spills outside, so the shape
              matters more than the level. Exposures from different dates are mixed: a star that
              varies changes the shape too.
            </p>
            <details>
              <summary>The numbers</summary>
              <table className="nums">
                <thead>
                  <tr>
                    <th>λ (µm)</th>
                    <th>mJy</th>
                    <th>±</th>
                    <th>date</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.url}>
                      <td>{p.um.toFixed(3)}</td>
                      <td>{p.mjy.toFixed(2)}</td>
                      <td>{p.err.toFixed(2)}</td>
                      <td>
                        {date(p.mjd)}
                        {p.bad ? ' ⚑' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {!busy && (
              <button
                onClick={() =>
                  download('parallax-spectrum.json', {
                    ...provenance(ra, dec),
                    cutout_arcmin: SPEC_SIZE,
                    method:
                      'aperture r = 2 px minus annulus median, no aperture correction; wavelength at the target from each exposure’s WCS-WAVE table',
                    flag_meanings: FLAG_ABOUT,
                    points: sorted,
                  })
                }
              >
                Download the spectrum (JSON)
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

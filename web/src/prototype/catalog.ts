// Gaia DR3 stars around a flipbook point, as an overlay only (AGENTS.md §2): markers moved to each
// exposure's date with the catalogue's proper motion, so a fast mover's marker travels with it.
// Queried from VizieR (I/355/gaiadr3); nothing from it enters a SPHEREx measurement.

export interface Star {
  ra: number; // ICRS degrees at the Gaia DR3 epoch, J2016.0
  dec: number;
  pmra: number | null; // mas/yr, includes cos(dec); null = Gaia gives none (two-parameter solution)
  pmdec: number | null;
  g: number | null;
}

export const GAIA_EPOCH_MJD = 57388.5; // J2016.0 (TCB), Gaia DR3 reference epoch
const MAX_STARS = 300;
// CDS and its mirror; the first that answers wins
const HOSTS = [
  'https://vizier.cds.unistra.fr',
  'https://vizier.unistra.fr',
  'https://vizier.cfa.harvard.edu',
];

/**
 * VizieR asu-tsv: '#' comments, a header row, a units row, a dashes row, then data rows. Gaia
 * columns by default; AllWISE passes its own position and magnitude columns (no proper motion).
 */
export function parseTsv(
  text: string,
  cols: [string, string, string] = ['RA_ICRS', 'DE_ICRS', 'Gmag'],
): Star[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = rows[0]?.split('\t').map((h) => h.trim()) ?? [];
  const col = (name: string) => head.indexOf(name);
  const [ira, idec, ipa, ipd, ig] = [cols[0], cols[1], 'pmRA', 'pmDE', cols[2]].map(col);
  if (ira === undefined || idec === undefined || ira < 0 || idec < 0) return [];
  const num = (cells: string[], k: number | undefined) => {
    const s = k === undefined || k < 0 ? '' : (cells[k] ?? '').trim();
    return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
  };
  const out: Star[] = [];
  for (const line of rows.slice(3)) {
    const cells = line.split('\t');
    const ra = num(cells, ira);
    const dec = num(cells, idec);
    if (ra === null || dec === null) continue;
    out.push({ ra, dec, pmra: num(cells, ipa), pmdec: num(cells, ipd), g: num(cells, ig) });
  }
  return out;
}

/** Linear proper-motion propagation from J2016.0 (no parallax or radial velocity: display only). */
export function propagate(s: Star, mjd: number): { ra: number; dec: number } {
  const yr = (mjd - GAIA_EPOCH_MJD) / 365.25;
  const dec = s.dec + ((s.pmdec ?? 0) * yr) / 3.6e6;
  return { ra: s.ra + ((s.pmra ?? 0) * yr) / 3.6e6 / Math.cos((s.dec * Math.PI) / 180), dec };
}

/**
 * Sky position → fractional (column, row) on a flipbook grid: gnomonic about (ra0, dec0), 6.15″
 * pixels, row 0 north, column 0 east, as api/_spherex.py builds it. An approximate display helper.
 */
export function toGrid(ra: number, dec: number, ra0: number, dec0: number, n: number) {
  const d = Math.PI / 180;
  const da = (ra - ra0) * d;
  const cosc =
    Math.sin(dec0 * d) * Math.sin(dec * d) + Math.cos(dec0 * d) * Math.cos(dec * d) * Math.cos(da);
  const xi = (Math.cos(dec * d) * Math.sin(da)) / cosc;
  const eta =
    (Math.cos(dec0 * d) * Math.sin(dec * d) -
      Math.sin(dec0 * d) * Math.cos(dec * d) * Math.cos(da)) /
    cosc;
  const s = (6.15 / 3600) * d;
  const c = (n - 1) / 2;
  return { col: c - xi / s, row: c - eta / s };
}

const cache = new Map<string, Promise<Star[]>>();

/** One VizieR box query, the first host that answers, cached per query. */
function vizier(q: URLSearchParams, cols?: [string, string, string]): Promise<Star[]> {
  const k = q.toString();
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      for (const host of HOSTS) {
        try {
          const r = await fetch(`${host}/viz-bin/asu-tsv?${q}`, {
            signal: AbortSignal.timeout(20000),
          });
          const text = r.ok ? await r.text() : '';
          // VizieR reports database errors inside a 200 answer
          if (r.ok && !text.includes('QUERY_STATUS=ERROR')) return parseTsv(text, cols);
        } catch {
          // try the next host
        }
      }
      throw new Error('The catalogue service (VizieR) is not answering.');
    })();
    cache.set(k, p);
    p.catch(() => cache.delete(k));
  }
  return p;
}

const centre = (ra: number, dec: number) =>
  `${ra.toFixed(6)} ${dec >= 0 ? '+' : ''}${dec.toFixed(6)}`;

/** Gaia DR3 stars in a square `sizeArcmin` across, brightest first, at most MAX_STARS. */
export const gaiaStars = (ra: number, dec: number, sizeArcmin: number) =>
  vizier(
    new URLSearchParams({
      '-source': 'I/355/gaiadr3',
      '-c': centre(ra, dec),
      // a margin for stars that move into the field over the decade since J2016
      '-c.bm': `${sizeArcmin + 1}x${sizeArcmin + 1}`,
      '-out': 'RA_ICRS,DE_ICRS,pmRA,pmDE,Gmag',
      '-sort': 'Gmag',
      '-out.max': String(MAX_STARS),
    }),
  );

/** AllWISE sources in the same kind of square, brightest in W1 first (pmra/pmdec stay null). */
export const allwiseSources = (ra: number, dec: number, sizeArcmin: number) =>
  vizier(
    new URLSearchParams({
      '-source': 'II/328/allwise',
      '-c': centre(ra, dec),
      '-c.bm': `${sizeArcmin}x${sizeArcmin}`,
      '-out': 'RAJ2000,DEJ2000,W1mag',
      '-sort': 'W1mag',
      '-out.max': String(MAX_STARS),
    }),
    ['RAJ2000', 'DEJ2000', 'W1mag'],
  );

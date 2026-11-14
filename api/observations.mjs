// Vercel function: the archived SPHEREx exposures covering one position, from IRSA SIA2 (which
// sends no CORS headers). Metadata only, one collection per request, bounded to MAXREC rows.
import { COLLECTIONS, parsePosition, splitCsv } from "./sia.mjs";

const SIA_URL = "https://irsa.ipac.caltech.edu/SIA";
export const MAXREC = 1000;

/** Science image rows as compact records, oldest first. Wavelengths are converted m → µm. */
export function parseObservations(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], truncated: false };
  const head = splitCsv(lines[0]);
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`unexpected SIA response: no ${name}`);
    return i;
  };
  const c = {
    sub: col("dataproduct_subtype"),
    id: col("obs_id"),
    band: col("energy_bandpassname"),
    emMin: col("em_min"),
    emMax: col("em_max"),
    tMin: col("t_min"),
    tMax: col("t_max"),
    exp: col("t_exptime"),
    url: col("access_url"),
    coll: col("obs_collection"),
  };
  const raw = lines.slice(1).map(splitCsv);
  const rows = raw
    .filter((r) => r[c.sub] === "science" && r[c.url]?.endsWith(".fits"))
    .map((r) => ({
      obsId: r[c.id],
      detector: Number(/D(\d)$/.exec(r[c.band] ?? "")?.[1] ?? NaN),
      emMin: Number(r[c.emMin]) * 1e6,
      emMax: Number(r[c.emMax]) * 1e6,
      mjdStart: Number(r[c.tMin]),
      mjdEnd: Number(r[c.tMax]),
      exposure: Number(r[c.exp]),
      url: r[c.url],
      collection: r[c.coll],
    }))
    .filter((o) => o.detector >= 1 && o.detector <= 6 && o.mjdStart > 0)
    .sort((a, b) => a.mjdStart - b.mjdStart || a.detector - b.detector);
  return { rows, truncated: raw.length >= MAXREC };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const pos = parsePosition(params);
  const collection = params.get("collection") ?? "spherex_dr1";
  if (!pos || !COLLECTIONS.includes(collection))
    return Response.json(
      {
        error: `ra in [0, 360), dec in [-90, 90] degrees; collection one of ${COLLECTIONS.join(", ")}`,
      },
      { status: 400 },
    );
  const q = new URLSearchParams({
    COLLECTION: collection,
    POS: `CIRCLE ${pos.ra} ${pos.dec} 0.001`,
    RESPONSEFORMAT: "CSV",
    MAXREC: String(MAXREC),
  });
  try {
    const res = await fetch(`${SIA_URL}?${q}`, {
      headers: {
        "User-Agent":
          "parallax-web/0.1 (NASA Space Apps 2026; metadata lookup)",
      },
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    if (!res.ok || body.startsWith("Server busy")) throw new Error("IRSA busy");
    return Response.json(
      {
        ...pos,
        collection,
        query: `${SIA_URL}?${q}`,
        ...parseObservations(body),
      },
      { headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  } catch {
    return Response.json(
      { error: "IRSA is unavailable; try again later" },
      { status: 503 },
    );
  }
}

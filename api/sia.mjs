// Vercel function: metadata-only SPHEREx exposure counts at one position (IRSA sends no CORS headers).
// Counts only; no images pass through here, and it keeps no state.
const SIA_URL = "https://irsa.ipac.caltech.edu/SIA";
export const COLLECTIONS = [
  "spherex_dr1",
  "spherex_dr1_deep",
  "spherex_qr3",
  "spherex_qr3_deep",
];
const MAXREC = 500;

/** Parse "ra" and "dec" query values in degrees; null when either is missing or out of range. */
export function parsePosition(params) {
  const ra = Number(params.get("ra"));
  const dec = Number(params.get("dec"));
  const ok =
    params.get("ra")?.trim() &&
    params.get("dec")?.trim() &&
    Number.isFinite(ra) &&
    Number.isFinite(dec);
  return ok && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90
    ? { ra, dec }
    : null;
}

/** Split one CSV line, honouring double-quoted fields. */
export function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') ((cur += '"'), i++);
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) (out.push(cur), (cur = ""));
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Number of science FITS rows in an SIA CSV response, and whether MAXREC cut it short. */
export function countScience(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { exposures: 0, truncated: false };
  const head = splitCsv(lines[0]);
  const sub = head.indexOf("dataproduct_subtype");
  const url = head.indexOf("access_url");
  if (sub < 0 || url < 0) throw new Error("unexpected SIA response");
  const rows = lines.slice(1).map(splitCsv);
  const exposures = rows.filter(
    (r) => r[sub] === "science" && r[url]?.endsWith(".fits"),
  ).length;
  return { exposures, truncated: rows.length >= MAXREC };
}

async function query(collection, { ra, dec }) {
  const q = new URLSearchParams({
    COLLECTION: collection,
    POS: `CIRCLE ${ra} ${dec} 0.001`,
    RESPONSEFORMAT: "CSV",
    MAXREC: String(MAXREC),
  });
  const res = await fetch(`${SIA_URL}?${q}`, {
    headers: {
      "User-Agent": "parallax-web/0.1 (NASA Space Apps 2026; metadata lookup)",
    },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  if (!res.ok || body.startsWith("Server busy")) throw new Error("IRSA busy");
  return { collection, ...countScience(body) };
}

export async function GET(request) {
  const pos = parsePosition(new URL(request.url).searchParams);
  if (!pos)
    return Response.json(
      { error: "ra must be in [0, 360) and dec in [-90, 90] degrees" },
      { status: 400 },
    );
  try {
    const collections = await Promise.all(
      COLLECTIONS.map((c) => query(c, pos)),
    );
    return Response.json(
      { ra: pos.ra, dec: pos.dec, collections },
      { headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  } catch {
    return Response.json(
      { error: "IRSA is unavailable; try again later" },
      { status: 503 },
    );
  }
}

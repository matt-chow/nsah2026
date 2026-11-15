// Shared helpers for the Node archive functions (observations, cutout). The leading underscore
// keeps Vercel from deploying it; /api/sia itself is served by api/index.py.
export const COLLECTIONS = [
  "spherex_dr1",
  "spherex_dr1_deep",
  "spherex_qr3",
  "spherex_qr3_deep",
];

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


// Display-side coordinate helpers. Scientific transforms (WCS, frames) stay in Python/Astropy.

const DEG = Math.PI / 180;

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/** Parse decimal degrees within [min, max) or [min, max] when `inclusiveMax`. */
export function parseDegrees(
  input: string,
  min: number,
  max: number,
  inclusiveMax: boolean,
): ParseResult {
  const s = input.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, error: 'Enter decimal degrees.' };
  const v = Number(s);
  const inRange = v >= min && (inclusiveMax ? v <= max : v < max);
  if (!inRange)
    return { ok: false, error: `Must be ${min} to ${max}${inclusiveMax ? '' : ' (exclusive)'}.` };
  return { ok: true, value: v };
}

/** Great-circle separation in degrees (haversine; stable for small angles). */
export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const dRa = (ra2 - ra1) * DEG;
  const dDec = (dec2 - dec1) * DEG;
  const h =
    Math.sin(dDec / 2) ** 2 + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.sin(dRa / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
}

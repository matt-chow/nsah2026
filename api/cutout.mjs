// Vercel function: a small cutout of one archived SPHEREx Level 2 image from IRSA's cutout
// service (no CORS). Only IRSA SPHEREx Level 2 FITS URLs are accepted, never arbitrary URLs.
// The EPSF table (~4 MB of PSF models) is dropped; every other HDU passes through byte for byte.
import { parsePosition } from "./_sia.mjs";

const BLOCK = 2880;
const MAX_BYTES = 12 * 1024 * 1024; // a 0.1° cutout is ~4.3 MB with EPSF
const URL_RE =
  /^https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/(dr1|qr3)\/level2\/[A-Za-z0-9_./-]+\.fits$/;
export const SIZE_RANGE = [0.005, 0.1]; // degrees

/** The source URL and cutout size, or null when either is not allowed. */
export function parseCutout(params) {
  const url = params.get("url") ?? "";
  const size = Number(params.get("size") ?? 0.05);
  const ok =
    URL_RE.test(url) &&
    !url.includes("..") &&
    size >= SIZE_RANGE[0] &&
    size <= SIZE_RANGE[1];
  return ok ? { url, size } : null;
}

function card(header, key) {
  for (let i = 0; i < header.length; i += 80) {
    const c = header.slice(i, i + 80);
    if (c.slice(0, 8).trimEnd() === key && c.slice(8, 10) === "= ") {
      const v = c.slice(10).split("/")[0].trim();
      return v.startsWith("'") ? v.slice(1, v.lastIndexOf("'")).trim() : v;
    }
  }
  return undefined;
}

/** Copy every HDU except EPSF; throws on anything that is not complete, well-formed FITS. */
export function dropEpsf(bytes) {
  const keep = [];
  let off = 0;
  while (off < bytes.length) {
    let end = -1;
    for (let i = off; i + 80 <= bytes.length; i += 80)
      if (
        String.fromCharCode(...bytes.subarray(i, i + 3)) === "END" &&
        bytes[i + 3] === 32
      ) {
        end = Math.ceil((i + 80) / BLOCK) * BLOCK;
        break;
      }
    if (end < 0) throw new Error("FITS header without END");
    const header = String.fromCharCode(...bytes.subarray(off, end));
    const naxis = Number(card(header, "NAXIS") ?? 0);
    let n = naxis ? Math.abs(Number(card(header, "BITPIX"))) / 8 : 0;
    for (let a = 1; a <= naxis; a++) n *= Number(card(header, `NAXIS${a}`));
    if (naxis)
      n =
        (n + Number(card(header, "PCOUNT") ?? 0)) *
        Number(card(header, "GCOUNT") ?? 1);
    const next = end + Math.ceil(n / BLOCK) * BLOCK;
    if (!Number.isFinite(next) || next > bytes.length)
      throw new Error("truncated FITS");
    if (card(header, "EXTNAME") !== "EPSF")
      keep.push(bytes.subarray(off, next));
    off = next;
  }
  const out = new Uint8Array(keep.reduce((s, k) => s + k.length, 0));
  keep.reduce((at, k) => (out.set(k, at), at + k.length), 0);
  return out;
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const pos = parsePosition(params);
  const cut = parseCutout(params);
  if (!pos || !cut)
    return Response.json(
      {
        error: `need ra, dec, an IRSA SPHEREx Level 2 url, and size in [${SIZE_RANGE}] degrees`,
      },
      { status: 400 },
    );
  try {
    const res = await fetch(
      `${cut.url}?center=${pos.ra},${pos.dec}&size=${cut.size}`,
      {
        headers: {
          "User-Agent": "parallax-web/0.1 (NASA Space Apps 2026; cutout)",
        },
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!res.ok || !res.body) throw new Error(`IRSA HTTP ${res.status}`);
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new Error("cutout larger than expected");
      chunks.push(chunk);
    }
    const all = new Uint8Array(total);
    chunks.reduce((at, c) => (all.set(c, at), at + c.length), 0);
    return new Response(dropEpsf(all), {
      headers: {
        "Content-Type": "application/fits",
        "Cache-Control": "public, s-maxage=604800",
      },
    });
  } catch (e) {
    console.error("cutout", cut.url, e);
    return Response.json(
      { error: "IRSA cutout is unavailable for this image; try again later" },
      { status: 503 },
    );
  }
}

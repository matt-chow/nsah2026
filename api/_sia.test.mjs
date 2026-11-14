// Leading underscore keeps Vercel from deploying this as a function. Run: node --test "api/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { countScience, parsePosition } from "./sia.mjs";

test("parsePosition accepts degrees in range and rejects the rest", () => {
  assert.deepEqual(parsePosition(new URLSearchParams("ra=270.05&dec=66.58")), {
    ra: 270.05,
    dec: 66.58,
  });
  for (const q of [
    "ra=360&dec=0",
    "ra=1&dec=91",
    "ra=&dec=0",
    "dec=0",
    "ra=abc&dec=1",
    "ra=1&dec=1e999",
  ])
    assert.equal(parsePosition(new URLSearchParams(q)), null, q);
});

test("countScience counts science FITS rows only, with quoted fields", () => {
  const csv = [
    "obs_id,dataproduct_subtype,s_region,access_url",
    'a,science,"POLYGON ICRS 1 2, 3 4",https://x/a.fits',
    "b,science,x,https://x/b.fits",
    "c,auxiliary,x,https://x/c.fits",
    "d,science,x,https://x/d.json",
  ].join("\n");
  assert.deepEqual(countScience(csv), { exposures: 2, truncated: false });
  assert.deepEqual(countScience(""), { exposures: 0, truncated: false });
  assert.throws(() => countScience("foo,bar\n1,2"));
});

// Curated destinations. Positions are standard ICRS coordinates of well-known objects (a
// curated alias list, not a name resolver); imagery at each comes from the SPHEREx all-sky map.
// Only the two `field` places have curated time series in this repository.

import type { View } from './projection.ts';

export interface Place {
  id: string;
  name: string;
  aliases: string[];
  ra: number;
  dec: number;
  fov: number; // arrival field of view, degrees
  about: string;
  field?: { manifest: string; featured: string; challenge: 'find' };
}

export const PLACES: Place[] = [
  {
    id: 'sep',
    name: 'South Ecliptic Pole',
    aliases: ['sep', 'sep-d4', 'south pole', 'ecliptic pole south'],
    ra: 90,
    dec: -66.5607,
    fov: 1.4,
    about:
      'SPHEREx passes over this spot on many orbits, so it is watched again and again. ' +
      'This app holds 10 visits to a small patch here, a year apart at most.',
    field: { manifest: 'sep-d4', featured: 'sep-d4-c012', challenge: 'find' },
  },
  {
    id: 'nep',
    name: 'North Ecliptic Pole',
    aliases: ['nep', 'nep-d2', 'north pole', 'ecliptic pole north'],
    ra: 270,
    dec: 66.5607,
    fov: 1.4,
    about:
      'The northern twin of the south pole field: revisited often, in the constellation ' +
      'Draco. This app holds 10 visits to a small patch here.',
    field: { manifest: 'nep-d2', featured: 'nep-d2-c012', challenge: 'find' },
  },
  {
    id: 'orion',
    name: 'Orion Nebula',
    aliases: ['m42', 'orion', 'messier 42', 'ngc 1976'],
    ra: 83.822,
    dec: -5.391,
    fov: 4,
    about:
      'The nearest large star nursery, about 1,300 light-years away. Infrared light gets ' +
      'through much of the dust that hides young stars from our eyes.',
  },
  {
    id: 'gc',
    name: 'Centre of the Milky Way',
    aliases: ['galactic centre', 'galactic center', 'sgr a*', 'sagittarius a*', 'milky way'],
    ra: 266.417,
    dec: -29.008,
    fov: 12,
    about:
      'The middle of our galaxy, 26,000 light-years away. Dust blocks almost all visible ' +
      'light from here; infrared passes through.',
  },
  {
    id: 'lmc',
    name: 'Large Magellanic Cloud',
    aliases: ['lmc', 'magellanic'],
    ra: 80.894,
    dec: -69.756,
    fov: 12,
    about: 'A small galaxy orbiting our own, about 160,000 light-years away.',
  },
  {
    id: 'm31',
    name: 'Andromeda Galaxy',
    aliases: ['m31', 'andromeda', 'messier 31'],
    ra: 10.685,
    dec: 41.269,
    fov: 5,
    about: 'The nearest large spiral galaxy, about 2.5 million light-years away.',
  },
  {
    id: 'pleiades',
    name: 'Pleiades',
    aliases: ['m45', 'seven sisters', 'subaru'],
    ra: 56.75,
    dec: 24.117,
    fov: 4,
    about:
      'A young star cluster about 440 light-years away, passing through a cloud of dust ' +
      'that reflects its light.',
  },
  {
    id: 'rhooph',
    name: 'Rho Ophiuchi cloud',
    aliases: ['rho oph', 'ρ oph', 'ophiuchus', 'l1688'],
    ra: 246.8,
    dec: -24.5,
    fov: 8,
    about:
      'One of the closest star-forming clouds, about 450 light-years away. Its dust is too ' +
      'thick for visible light.',
  },
];

/**
 * The challenge's five test targets: nearby fast movers and young variable stars. Positions as in
 * data/flipbook (fast movers propagated to late 2025); each has a pre-baked copy in
 * data/targets/<id>.json (scripts/bake_targets.py), so it plays without the archive functions.
 */
export interface Target {
  id: string;
  name: string;
  aliases: string[];
  ra: number;
  dec: number;
  band: string; // where it shows best, and the band that is baked
  about: string;
}

export const TARGETS: Target[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    aliases: ['barnard', 'gj 699', 'barnards star'],
    ra: 269.4463,
    dec: 4.7679,
    band: 'D1',
    about:
      'A small red star six light-years away that crosses the sky faster than any other: about ' +
      '10 arcseconds a year, under two SPHEREx pixels over these exposures.',
  },
  {
    id: 'eps-indi-b',
    name: 'Epsilon Indi B',
    aliases: ['eps ind b', 'epsilon indi', 'eps indi b'],
    ra: 331.0964,
    dec: -56.8006,
    band: 'D5',
    about:
      'A pair of brown dwarfs 12 light-years away: objects too small to shine like stars, ' +
      'glowing faintly in infrared and moving about 4.7 arcseconds a year.',
  },
  {
    id: 'wise-0855',
    name: 'WISE 0855',
    aliases: ['wise 0855', 'wise 0855-0714', 'wise j085510.83-071442.5'],
    ra: 133.76,
    dec: -7.2422,
    band: 'D6',
    about:
      'The coldest known brown dwarf, 7.4 light-years away and about as cold as the North Pole. ' +
      'Almost invisible except at the longest infrared wavelengths.',
  },
  {
    id: 'rw-aur',
    name: 'RW Aurigae',
    aliases: ['rw aur', 'rw aurigae'],
    ra: 76.956417,
    dec: 30.401417,
    band: 'D1',
    about:
      'A young star still wrapped in dust, whose brightness changes as the dust shifts. It does ' +
      'not move across the sky like the others; watch its brightness instead.',
  },
  {
    id: 'r-dra',
    name: 'R Draconis',
    aliases: ['r dra', 'r draconis'],
    ra: 248.16742,
    dec: 66.755,
    band: 'D1',
    about:
      'A pulsating giant star that brightens and fades over about eight months. Watch its ' +
      'brightness change between exposures.',
  },
];

/** Degrees, or sexagesimal "08h55m10.8s" / "-7d14m42.5s" / "08:55:10.8" (hours for RA). */
export function parseAngle(text: string, isRa: boolean): number | null {
  const s = text.trim().replace('−', '-');
  let v: number;
  if (/^[+-]?\d+(\.\d*)?$/.test(s)) v = Number(s);
  else {
    const parts = (s.match(/\d+(?:\.\d*)?/g) ?? []).map(Number);
    if (parts.length < 1 || parts.length > 3 || !/^[+-]?[\d.:hdms°'″′" ]+$/i.test(s)) return null;
    v = parts.reduce((a, p, i) => a + p / 60 ** i, 0) * (isRa ? 15 : 1);
    if (s.startsWith('-')) v = -v;
  }
  return (isRa ? v >= 0 && v < 360 : v >= -90 && v <= 90) ? v : null;
}

export const HOME: View = { ra: 83.822, dec: -5.391, fov: 100 };

export const placeView = (p: Place): View => ({ ra: p.ra, dec: p.dec, fov: p.fov });

/**
 * "RA Dec" in degrees or sexagesimal: split at a comma, else at the space before a signed Dec,
 * else (two plain tokens) at the only space.
 */
export function parseCoords(text: string): { ra: number; dec: number } | null {
  const s = text.trim().replace(/−/g, '-');
  const m =
    /^(.+?)\s*,\s*(.+)$/.exec(s) ?? /^(.+?)\s+([+-].+)$/.exec(s) ?? /^(\S+)\s+(\S+)$/.exec(s);
  if (!m) return null;
  const ra = parseAngle(m[1] as string, true);
  const dec = parseAngle(m[2] as string, false);
  return ra === null || dec === null ? null : { ra, dec };
}

/** Curated name match, or "RA Dec" coordinates; never an external lookup. */
export function search(
  text: string,
): { kind: 'places'; places: Place[] } | { kind: 'coords'; ra: number; dec: number } {
  const q = text.trim().toLowerCase();
  const c = parseCoords(q);
  if (c) return { kind: 'coords', ...c };
  if (!q) return { kind: 'places', places: PLACES };
  return {
    kind: 'places',
    places: PLACES.filter(
      (p) => p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.includes(q)),
    ),
  };
}

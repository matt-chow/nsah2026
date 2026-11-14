// SPHEREx spectral coverage as published (Crill et al. 2020, SPIE 11443; NASA/JPL mission pages):
// six detector bands, 0.75–5.0 µm, each read out as 17 channels = 102. The linear variable
// filters make wavelength continuous across each detector, so "channels" are a binning
// convention; here they are spaced at constant resolving power within each band.
// Illustrative education content: real observations carry their own spectral WCS.

export interface Band {
  detector: number;
  min: number; // µm
  max: number;
  resolvingPower: number;
}

export const BANDS: Band[] = [
  { detector: 1, min: 0.75, max: 1.11, resolvingPower: 39 },
  { detector: 2, min: 1.11, max: 1.64, resolvingPower: 41 },
  { detector: 3, min: 1.64, max: 2.42, resolvingPower: 41 },
  { detector: 4, min: 2.42, max: 3.82, resolvingPower: 35 },
  { detector: 5, min: 3.82, max: 4.42, resolvingPower: 112 },
  { detector: 6, min: 4.42, max: 5.0, resolvingPower: 130 },
];

export const PER_BAND = 17;

export interface Channel {
  index: number; // 0..101
  detector: number;
  center: number; // µm
  lo: number;
  hi: number;
}

/** 102 channels, log-spaced within each band so each spans a similar fraction of λ. */
export const CHANNELS: Channel[] = BANDS.flatMap((b, bi) => {
  const r = Math.log(b.max / b.min) / PER_BAND;
  return Array.from({ length: PER_BAND }, (_, i) => {
    const lo = b.min * Math.exp(r * i);
    const hi = b.min * Math.exp(r * (i + 1));
    return { index: bi * PER_BAND + i, detector: b.detector, center: Math.sqrt(lo * hi), lo, hi };
  });
});

export const channelAt = (um: number) => CHANNELS.find((c) => um >= c.lo && um < c.hi) ?? null;

/** Well-known spectral features, laboratory or rest wavelengths (µm). */
export const FEATURES: { um: number; name: string; plain: string }[] = [
  { um: 0.6563, name: 'Hydrogen-α', plain: 'The red glow of hydrogen gas; visible to the eye.' },
  {
    um: 1.282,
    name: 'Paschen-β',
    plain: 'Hydrogen again, deeper in the infrared, from gas lit up by young stars.',
  },
  {
    um: 1.875,
    name: 'Paschen-α',
    plain: 'Hydrogen light that slips through dust which hides visible light.',
  },
  {
    um: 3.05,
    name: 'Water ice',
    plain: 'Frozen water on dust grains in cold clouds absorbs light here.',
  },
  {
    um: 3.3,
    name: 'PAH',
    plain:
      'Carbon-rich molecules (polycyclic aromatic hydrocarbons) glowing when starlight warms them.',
  },
  { um: 4.05, name: 'Brackett-α', plain: 'Hydrogen emission from star-forming regions.' },
  { um: 4.27, name: 'Carbon dioxide ice', plain: 'Frozen CO₂ in cold clouds absorbs here.' },
  {
    um: 4.67,
    name: 'Carbon monoxide ice',
    plain: 'Frozen CO absorbs here, in the coldest clouds.',
  },
];

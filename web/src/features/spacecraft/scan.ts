// The survey idea in miniature: each pointing puts a star on a different part of the linear
// variable filters, so a different wavelength. Both focal-plane arrays see the same sky through
// a dichroic, so every pointing samples one short (bands 1–3) and one long (bands 4–6) channel.
// Illustration only: the brightness curve below is invented, not a SPHEREx measurement.

import { CHANNELS, PER_BAND, type Channel } from '../spectrum/channels.ts';

export const STEPS = 3 * PER_BAND; // 51 pointings → 102 channels

export interface Pointing {
  column: number; // which detector of each array, 0..2
  row: number; // 0..1 position along the filter gradient
  samples: Channel[];
}

export function pointing(i: number): Pointing {
  const column = Math.floor(i / PER_BAND);
  const j = i % PER_BAND;
  return {
    column,
    row: (j + 0.5) / PER_BAND,
    samples: [CHANNELS[column * PER_BAND + j], CHANNELS[(column + 3) * PER_BAND + j]].filter(
      (c) => c !== undefined,
    ),
  };
}

const dip = (um: number, at: number, width: number, depth: number) =>
  1 - depth * Math.exp(-0.5 * ((um - at) / width) ** 2);

/** An invented, smooth "star behind an icy cloud" curve, arbitrary units. */
export const illustrativeFlux = (um: number) =>
  Math.pow(um, -1.2) * dip(um, 3.05, 0.12, 0.45) * dip(um, 4.27, 0.04, 0.3);

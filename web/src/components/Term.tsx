import { useId, type ReactNode } from 'react';

/** Short plain-language definitions, grounded in what this app actually does. */
export const GLOSSARY = {
  infrared:
    'Light with wavelengths longer than red, invisible to our eyes. SPHEREx sees 0.75 to 5 micrometres (µm), where dust glows and cool objects shine.',
  spherex:
    'A NASA space telescope launched in 2025. It photographs the entire sky in 102 infrared colours, and comes back to each patch about every six months.',
  pixel:
    'One square of the image. Each SPHEREx pixel covers 6.15 arcseconds of sky, about the width of a coin seen from 800 metres.',
  subtraction:
    'Take the typical brightness of the sky at each pixel (the median of the other dates) away from one date. Anything steady cancels; whatever changed is left over.',
  uncertainty:
    'The range a measurement could plausibly have, given the noise. "780 ± 100" means the true value is probably between 680 and 880.',
  calibration:
    'Checking the archive’s noise estimate against the image itself. PARALLAX rescales it per date and withholds numbers when the check fails.',
  noise:
    'Random pixel-to-pixel flicker from the detector and from faint glowing dust in the solar system (zodiacal light). Every image has it; real changes must stand out from it.',
  confidence:
    'How many times bigger a change is than the noise, written σ (sigma). Noise alone rarely reaches 5σ in a given pixel, so PARALLAX only flags spots at 5σ or more.',
  wavelength:
    'The colour of infrared light, in micrometres (µm). SPHEREx’s filters change colour across each detector, so PARALLAX only compares dates taken at the same wavelength.',
  coordinates:
    'A position on the sky, like latitude and longitude on Earth: right ascension (RA, 0–360°) and declination (Dec, −90° to +90°).',
} as const;

export type TermKey = keyof typeof GLOSSARY;

/** An inline term with a click/keyboard-opened definition (native popover, no library). */
export function Term({ k, children }: { k: TermKey; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button type="button" className="term" popoverTarget={id} aria-describedby={id}>
        {children}
      </button>
      <span id={id} popover="auto" role="tooltip" className="term-tip">
        {GLOSSARY[k]}
      </span>
    </>
  );
}

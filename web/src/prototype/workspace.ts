// Deep Dive logic with no UI: quality statuses and what two pinned items can honestly share.
// Everything here reads the manifest; nothing is computed from display pixels.

import { checkPair } from '../lib/compare.ts';
import type { Candidate, Manifest } from '../types/manifest.ts';
import type { Pin } from './store.ts';

export type CheckStatus = 'passed' | 'caution' | 'failed' | 'not-assessed';
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export const STATUS_TEXT: Record<CheckStatus, string> = {
  passed: 'Passed',
  caution: 'Caution',
  failed: 'Failed',
  'not-assessed': 'Not assessed',
};

/**
 * The checks behind one comparison (image A against B, at one flagged spot). A check the
 * pipeline never ran is "not assessed", never a pass.
 */
export function qualityChecks(
  m: Manifest,
  a: string,
  b: string,
  c: Candidate | undefined,
): Check[] {
  const oa = m.observations.find((o) => o.observation_id === a);
  const ob = b === 'typical' ? undefined : m.observations.find((o) => o.observation_id === b);
  const out: Check[] = [];

  for (const [k, o] of [
    ['A', oa],
    ['B', ob],
  ] as const) {
    if (!o) continue;
    const dqa = o.quality.notes.find((n) => /DQA/i.test(n));
    out.push({
      id: `dqa-${k}`,
      label: `Archive quality flag, image ${k}`,
      status: !dqa
        ? 'not-assessed'
        : /pass/i.test(dqa)
          ? 'passed'
          : /fail/i.test(dqa)
            ? 'failed'
            : 'caution',
      detail: dqa ? `IRSA reports “${dqa}”.` : 'No archive quality verdict recorded.',
    });
  }

  if (c) {
    const p = c.light_curve.find((l) => l.observation_id === a);
    out.push({
      id: 'masked',
      label: 'Spot measurable on this date',
      status: !p ? 'not-assessed' : p.delta_flux_ujy == null ? 'caution' : 'passed',
      detail: !p
        ? 'This date is not in the spot’s light curve.'
        : p.delta_flux_ujy == null
          ? 'Flagged pixels cover the spot on this date, so there is no measurement.'
          : 'No flagged pixels inside the measuring aperture.',
    });
  }

  if (b === 'typical') {
    const inT = !!m.template?.observation_ids.includes(a);
    out.push({
      id: 'pair',
      label: 'A and B comparable',
      status: !m.template ? 'failed' : inT ? 'passed' : 'caution',
      detail: !m.template
        ? 'No typical image was produced.'
        : inT
          ? `B is the typical image, the median of ${m.template.observation_ids.length} aligned visits including A.`
          : 'A is not one of the visits the typical image was built from.',
    });
  } else {
    const pr = checkPair(m, a, b);
    out.push({
      id: 'pair',
      label: 'A and B comparable',
      status:
        pr.status === 'compatible'
          ? 'passed'
          : pr.status === 'incompatible'
            ? 'failed'
            : pr.status === 'same'
              ? 'caution'
              : 'not-assessed',
      detail:
        pr.status === 'compatible'
          ? 'The pipeline checked detector, wavelength, grid and calibration.'
          : pr.status === 'same'
            ? 'A and B are the same visit.'
            : `${pr.reasons.join('; ')}.`,
    });
  }

  const d = m.differences.find((x) => x.observation_id === a);
  out.push({
    id: 'diff',
    label: 'Change map for image A',
    status: !d ? 'not-assessed' : d.status === 'validated' ? 'passed' : 'caution',
    detail: !d
      ? 'No difference image was produced for this date.'
      : d.status === 'validated'
        ? `Validated against the typical image; spots beyond ${d.threshold_sigma}σ are flagged.`
        : `Display only: ${d.reasons.join('; ')}.`,
  });

  if (oa)
    out.push({
      id: 'variance',
      label: 'Per-pixel uncertainty',
      status: oa.quality.variance_available ? 'passed' : 'failed',
      detail: oa.quality.variance_available
        ? 'Variance from the science file sets every ± shown.'
        : 'No variance plane, so uncertainties cannot be trusted.',
    });

  // the pipeline does not PSF-match; saying "not assessed" keeps a missing check from reading as a pass
  out.push({
    id: 'psf',
    label: 'Sharpness matched between dates',
    status: 'not-assessed',
    detail: 'No PSF matching in this build; a sharper or blurrier date can mimic a change.',
  });
  if (c)
    out.push({
      id: 'catalog',
      label: 'Checked against star catalogues',
      status: 'not-assessed',
      detail: 'Not cross-matched in this build.',
    });
  return out;
}

/** Pipeline evidence that points at a detector or processing cause, kept apart from measurements. */
export function artifactSigns(c: Candidate): string[] {
  return c.evidence.filter((e) => /flagged|only this epoch|edge|persist/i.test(e));
}

export interface PinFacts {
  label: string;
  manifestId: string | null;
  detector: string | null;
  um: number | null;
  band: [number, number] | null;
  unit: string | null;
  dates: { id: string; mjd: number }[];
  masked: number;
  measured: boolean;
}

/** What a pin carries; null until its manifest is loaded, or when the candidate is gone. */
export function pinFacts(pin: Pin, manifests: Record<string, Manifest | 'error'>): PinFacts | null {
  if (pin.kind === 'archive') {
    const s = pin.compare;
    return {
      label: pin.label,
      manifestId: null,
      detector: s.band,
      um: null,
      band: s.a.um,
      unit: null,
      dates: [s.a, s.b].map((f) => ({ id: f.url, mjd: f.mjd })),
      masked: 0,
      measured: false,
    };
  }
  const m = manifests[pin.manifestId];
  if (!m || m === 'error') return null;
  const c = m.candidates.find((x) => x.candidate_id === pin.candidate);
  if (!c) return null;
  const sp = m.observations[0]?.spectral;
  return {
    label: pin.label,
    manifestId: pin.manifestId,
    detector: sp ? `D${sp.detector}` : null,
    um:
      c.measurements.find((x) => x.name === 'wavelength')?.value ??
      sp?.wavelength_center_um ??
      null,
    band: sp ? [sp.wavelength_min_um, sp.wavelength_max_um] : null,
    unit: c.measurements.find((x) => x.name === 'aperture flux change')?.unit ?? null,
    dates: c.light_curve.map((l) => ({ id: l.observation_id, mjd: l.mjd_mid })),
    masked: c.light_curve.filter((l) => l.delta_flux_ujy == null).length,
    measured: true,
  };
}

const HALF_DAY = 0.5;

/**
 * Everything that stops two pins being read side by side as like for like. Dates sync only
 * within one prepared field; framing is never shared, and each chart keeps its own scale.
 */
export function comparePins(x: PinFacts, y: PinFacts): { issues: string[]; syncDates: boolean } {
  const issues: string[] = [];
  for (const p of [x, y])
    if (!p.measured)
      issues.push(`${p.label}: no measurements here. Live archive imagery is display only.`);
  if (x.detector && y.detector && x.detector !== y.detector)
    issues.push(`Different detectors (${x.detector} and ${y.detector}).`);
  if (x.um != null && y.um != null) {
    if (Math.abs(x.um - y.um) > 0.01)
      issues.push(
        `Different wavelengths (${x.um.toFixed(2)} and ${y.um.toFixed(2)} µm): brightness at one is no guide to the other.`,
      );
  } else
    for (const p of [x, y])
      if (p.um == null && p.band)
        issues.push(
          `${p.label}: wavelength at this point not known (the detector covers ${p.band[0]}–${p.band[1]} µm).`,
        );
  if (x.unit && y.unit && x.unit !== y.unit)
    issues.push(`Different units (${x.unit} and ${y.unit}).`);
  const shared = x.dates.filter((d) =>
    y.dates.some((e) => Math.abs(e.mjd - d.mjd) < HALF_DAY),
  ).length;
  if (shared === 0) issues.push('No shared dates: the two were observed on different days.');
  else if (shared < Math.max(x.dates.length, y.dates.length))
    issues.push(`${shared} shared dates of ${Math.max(x.dates.length, y.dates.length)}.`);
  for (const p of [x, y])
    if (p.masked > 0)
      issues.push(
        `${p.label}: ${p.masked} of ${p.dates.length} dates masked, with no measurement.`,
      );
  return { issues, syncDates: !!x.manifestId && x.manifestId === y.manifestId };
}

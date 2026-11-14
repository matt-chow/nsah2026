# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: NASA Space Apps 2026 judges and curious members of the public, often seeing the
project for a few minutes on a laptop or projector. They need to grasp quickly what changed in
the sky, how the app knows, and how sure it is. Secondary: astronomers and students who want
the numbers, provenance and caveats behind each residual. Plain language comes first, and the
science detail sits one click deeper.

## Product Purpose

PARALLAX is a time-domain explorer for NASA SPHEREx infrared images, built for the "Planet X &
SPHEREx" challenge. It finds sky fields that SPHEREx observed many times at the same wavelength,
aligns real IRSA cutouts, and differences each epoch against the others. It then shows what
changed (blink, overlay and difference views) and lists the residuals as candidates, with
evidence and caveats. It succeeds when a viewer can see a real change, judge for themselves
whether it is a source, motion, noise or an artifact, and trace every number back to archive
data.

## Positioning

The workspace uses real SPHEREx Level 2 images (DR1 + QR3) with the noise model calibrated
on the data itself. It is honest about what that model cannot establish: candidates are
triage labels ("needs follow-up", "likely artifact") and never discoveries.

## Operating Context

- It is a static web app. Preprocessed fields ship as manifests plus FITS/PNG assets, and
  there is no persistent backend.
- It is demoed live and in a short video, and judged against the Space Apps criteria.

## Capabilities and Constraints

- Delivered stack: React + TypeScript + Vite (web), and Python + Astropy/NumPy/SciPy (offline
  pipeline).
- Data is limited to 25 MB in total, and initial JS to 100 kB gzip.
- IRSA does not send CORS headers, so the browser cannot query the archive directly.
- Curated real fields so far:
  - North Ecliptic Pole: 1.45 µm, detector 2.
  - South Ecliptic Pole: 2.56 µm, detector 4.
  - Each has 10 epochs, and comes with a labelled synthetic fixture.
- Difference significance is valid only where the comparison is validated. Otherwise it is
  shown as visualization-only.

## Brand Commitments

- Name: PARALLAX. No existing logo, fonts or palette (the user delegated the visual world).
- The brief names the direction: a cinematic astronomy intro that transitions into a precise
  scientific workspace. No generic AI dashboard, and no misleading graphics.
- Not affiliated with or endorsed by NASA, so no NASA logos.

## Evidence on Hand

- Real SPHEREx cutouts and derived products are in `data/processed/`, with manifests in
  `data/manifests/`.
- Every observation records its source URL, SHA-256, release and pipeline build.
- There are no user testimonials, no confirmed discoveries and no follow-up observations.
  None of these may be implied.

## Product Principles

1. Show the pixels: the evidence is the real image, never an illustration of it.
2. Say how sure we are: every highlight carries significance, uncertainty and caveats.
3. Never claim a discovery: candidates are triage, not findings.
4. Label simulation loudly, wherever it appears.
5. Teach in passing: a newcomer should understand blink and difference within one minute.

## Accessibility & Inclusion

The target is WCAG 2.2 AA:
- Full keyboard operation of the viewer and timeline.
- Reduced motion respected, including the intro.
- Information never encoded by colour alone, which matters for diverging difference maps.

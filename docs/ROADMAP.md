# Roadmap

Each phase ends in a **gate**. If the gate fails, take the fallback and do not start the next
phase. Times are per-team estimates of focused hours.

## Phase 0: Foundation (done at bootstrap)
- Contract (`models.py` → schema → TS mirror), validation, cache keys, archive interface, fixture,
  app shell, check script.
- **Gate:** `scripts/check.ps1` passes, and the fixture renders in `npm run dev` with the
  simulated banner.

## Phase 1: Real data retrieval (P0), ~6 h
- Implement `IrsaSpherexAdapter` (pyvo SIA2 → cutout URL with `center`/`size`), using
  `check_cutout_size` and `RequestLimits` and caching into `.cache/parallax/`.
- Extract epoch, detector, center wavelength (spectral WCS), and calibration version from
  headers. Write FITS and PNG to `data/processed/<field>/` and a manifest.
- Choose 1–3 demo fields with ≥ 2 compatible epochs.
- **Acceptance:** `parallax validate` passes on a real manifest with ≥ 2 epochs. Every observation
  has `source_url` and `data_release`. Field data stays ≤ 10 MB.
- **Gate/fallback:** if no compatible pair exists after 2 h of searching, ship a real field with
  comparisons shown as unavailable, and use the fixture only to demonstrate blink (labelled).

## Phase 2: Validated time-series viewer (P0/P1), ~6 h
- Manifest selector, coordinate search across available manifests, blink comparator (timer +
  manual step, reduced-motion aware), registration via `reproject` to a common WCS with a
  residual check.
- **Acceptance:** blink toggles at ≥ 2 Hz without network calls (DevTools). Idle CPU ≈ 0.
  Initial JS ≤ 100 kB gzip. Keyboard operable. Incompatible pairs are refused with reasons.
- **Gate:** this is the minimum viable submission. Freeze it (tag only when asked) before Phase 3.

## Phase 3: Difference engine (P2), ~6 h
- Background-subtracted, variance-weighted significance images with an empirical noise rescale
  and propagated masks. Candidate extraction per SCIENCE.md. Injection-recovery tests.
- **Acceptance:** recovers the fixture's injected mover. Zero candidates on a no-injection pair
  at the chosen threshold. Completeness curve recorded.
- **Fallback:** if false positives dominate real data, show difference images as visualization
  only and produce no candidates.

## Phase 4: Candidate investigation (P3), ~4 h
- Evidence report per candidate: cutout stamps per epoch, measured flux ± σ, positions,
  cross-match results (Horizons/MPC, Gaia/AllWISE), rejection reasons, provenance links.
- **Acceptance:** every candidate shows its evidence and its status vocabulary, and no
  "confirmed" wording appears anywhere.

## Phase 5: Presentation and deployment, ~4 h
- Static deploy (GitHub Pages), demo video, SUBMISSION.md checklist, final claims review.
- **Acceptance:** deployed URL works in a fresh browser profile on an 8 GB laptop. Lighthouse
  accessibility ≥ 90. Checklist complete.

## Measurements log

| Date | What | Result |
|---|---|---|
| 2026-11-13 | Initial JS bundle (bootstrap) | 72.7 kB gzip |
| 2026-11-13 | Initial JS, full workspace (React + app, fonts as CSS) | 83.3 kB gzip JS, 4.0 kB gzip CSS |
| 2026-11-13 | Initial JS + CSS after Discover/Explore/Analyze redesign (adds Instrument Serif, CSS only) | 88.4 kB gzip JS, 4.8 kB gzip CSS |
| 2026-11-14 | Initial JS after Living Observatory (globe, spacecraft, spectrum, journal, arcade as lazy chunks) | 93.8 kB gzip JS, 5.3 kB gzip CSS; pages 2.0–6.4 kB gzip each |
| 2026-11-14 | Initial JS after v3.1 retro-futurist refinement (timeline ruler, bottom sheet, outlier-aware light curve, story art) | 96.9 kB gzip JS, 6.4 kB gzip CSS; pages 2.2–6.8 kB gzip each |
| 2026-11-14 | Sky atlas (lazy chunk) and initial JS | AtlasPage 17.6 kB gzip; initial 97.0 kB gzip JS |
| 2026-11-14 | Atlas projection, 960 × 600 view (Node 24, laptop) | 75–95 ms per full geometry (≈ 210 ms before inlining) |
| 2026-11-14 | Atlas renders against live IRSA (Chromium, local preview) | picture 1.4–2.6 s for 10 tiles; measured values 1.2 s, RGB 1.3–1.6 s (3 tiles × 3 layers) |
| 2026-11-14 | Cutout without the EPSF table (0.05°, 29 × 29 px) | 4,049,280 → 95,040 bytes, 9 ms to strip |
| 2026-11-13 | `data/` total (2 real fields × 10 epochs + fixture) | 6.88 MB |
| 2026-11-15 | Front door = prototype (`index.html`), Inspect lazy; Vite gzip of the preloaded set | 91.1 kB gzip JS (index 15.6, shared 70.7, render 4.5, runtime 0.4); 5.8 kB gzip CSS; Flipbook chunk 5.5 kB |
| 2026-11-15 | Flipbook tools (stack/changes, Measure, Spectrum, Gaia, lazy Aladin Lite); Vite gzip of `dist/index.html`'s scripts | 90.3 kB gzip initial JS (index 15.4, shared 69.9, render 4.5); 6.4 kB gzip CSS; Flipbook chunk 13.8 kB, SkyPanel 1.4 kB + Aladin Lite ~2.4 MB from jsDelivr only when the Sky tab opens |
| 2026-11-15 | Deep Dive workspace (prototype); Vite gzip of `dist/index.html`'s scripts | 94.4 kB gzip initial JS (index 18.9, shared 70.7, render 4.5, runtime 0.3); 7.8 kB gzip CSS; lazy Inspect 9.2 kB, Workspace 8.5 kB, ArchiveCompare 3.8 kB |
| 2026-11-15 | Five baked challenge targets, 6′ cutouts of one band each | 7.6 MB (1.17–1.89 MB per file); `data/` total 14.14 MB |

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

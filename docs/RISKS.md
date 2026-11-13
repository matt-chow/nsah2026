# Risks

Likelihood/impact: H/M/L.

| # | Risk | L | I | Mitigation | Fallback decision |
|---|---|---|---|---|---|
| 1 | IRSA archive slow or unavailable during the event | M | H | Preprocess early; commit small processed sets; cache raw cutouts keyed by `cache_key` | Demo from committed products, since the app is static and never needs IRSA live |
| 2 | No compatible epoch pairs (same detector, close wavelength) at chosen position | H | H | Search candidate fields first (Phase 1 gate); prefer deep fields near ecliptic poles with many visits | Show the field with comparisons *unavailable* and reasons; choose another field for the demo |
| 3 | Wavelength mismatch across epochs (LVF) | H | H | `assess_compatibility` enforces detector + 1% tolerance; check the range across the cutout | Mark pair incompatible; never subtract |
| 4 | Calibration differs between releases/versions | M | H | Record `calibration_version`; mismatch ⇒ incompatible; prefer one consistent release | Use a single release for all epochs of a field |
| 5 | Registration errors after reprojection | M | H | Star-centroid residual test (< 0.2 px assumption) | Pair marked incompatible; blink still possible with a visible "unregistered" warning, or not at all |
| 6 | Missing or misunderstood uncertainty/flag info | M | M | Read Explanatory Supplement Table 10; unit tests on flag decoding | Report "uncertainty not available"; no significance-based highlighting |
| 7 | False-positive "detections" (PSF residuals, cosmic rays, ghosts) | H | H | Conservative criteria (SCIENCE.md), injection tests, cross-match, artifact statuses | Ship P0/P1 only; label P2 output "experimental" or disable it |
| 8 | Laptop limits (8 GB RAM, integrated GPU) | M | M | Cutouts only, memmap, float32, ≤ 2 concurrent downloads, small PNGs | Reduce cutout size; process fewer epochs |
| 9 | Static deployment issues (base path, MIME types for FITS, size limits) | L | M | `base: './'`; size budget in check script; test `npm run preview` | Serve PNGs only and link FITS to IRSA source URLs |
| 10 | Schema drift between Python and TS | M | M | Drift tests; `parseManifest` tested against the committed fixture | Python models win; regenerate |
| 11 | Overstated claims in demo/submission | M | H | Claims checklist in SUBMISSION.md; candidate vocabulary excludes "confirmed" | Remove the claim |
| 12 | Team time overrun | H | M | P-levels; stop/go gates in ROADMAP.md | Cut from P4 upward |
| 13 | DR1/QR3 labels or collections differ from expectation | M | M | Verify on IRSA before Phase 1; store labels verbatim | Use whichever documented release has the needed coverage, stated explicitly |

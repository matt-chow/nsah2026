# AGENTS.md: PARALLAX engineering guide

This is the canonical instruction file for humans and coding agents. `CLAUDE.md` only imports it.
Detailed references: `docs/ARCHITECTURE.md`, `docs/SCIENCE.md`, `docs/DATA_CONTRACT.md`,
`docs/DEVELOPMENT.md`, `docs/RISKS.md`, `docs/ROADMAP.md`, `docs/SUBMISSION.md`.

## 1. Project identity

- **Name:** PARALLAX, *An Open Observatory for the Changing Infrared Sky*.
- **Challenge:** NASA Space Apps Challenge 2026, "Planet X and SPHEREx"
  (<https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/>).
- **Mission:** a static, efficient, scientifically credible web app that makes NASA SPHEREx
  observations accessible for investigating changes in the infrared sky.
- **Users:** students, amateur astronomers, educators, citizen scientists, judges evaluating
  scientific credibility. Assume astronomy curiosity, not FITS expertise.
- **Primary flow:** enter RA/Dec → load real SPHEREx cutouts → view epochs → blink/compare
  compatible pairs → see highlighted candidate changes → inspect evidence and uncertainty →
  trace every pixel back to its archive source.
- **What we never claim:** automated planet discovery, or that an image artifact is an object.
  Candidates are *unconfirmed* by definition.

**Success criteria (judged at submission):**
1. A judge can load at least one real SPHEREx field with ≥ 2 epochs from the deployed static URL.
2. Every displayed observation shows its archive source, release, epoch, and wavelength.
3. Incompatible pairs are visibly refused with reasons, never silently compared.
4. Simulated data is labelled on every screen where it appears.
5. The P0/P1 app works even if P2–P4 code is removed.

## 2. Engineering philosophy

- Simplest thing that is scientifically correct. No speculative abstraction, plugin systems,
  generic "engines", or config for options nobody uses.
- Adding a dependency needs a one-line justification in the PR/handoff. Prefer stdlib, NumPy,
  Astropy, and browser APIs.
- Processing is deterministic: same inputs + same parameters → byte-identical outputs.
- Optimize only measured bottlenecks; record the measurement.
- No backend server, database, or paid API. The build output is static files.
- Keep a working end-to-end vertical slice at all times. Never leave `main` with a broken build.
- Small, reversible changes. Do not implement features outside the current roadmap phase without
  team approval.

## 3. Performance requirements

Targets are **goals to measure**, not achieved guarantees (record results in `docs/ROADMAP.md`).

| Area | Rule / target |
|---|---|
| Initial JS | ≤ 100 kB gzip (measure: `npm run build` output). Bootstrap: 72.7 kB. |
| Images | Display PNGs ≤ 1024 × 1024 px, ≤ 1 MB each; loaded on selection, never all at once. |
| Viewer | Redraw only on image/size/user change. No continuous `requestAnimationFrame` loop when idle. |
| Animation | Blink uses pre-decoded images; no network calls, allocations, or React state per frame. |
| React | Science/derived data computed outside render or memoized; panels are `memo` components. |
| Dataset | Published `data/` ≤ 25 MB total, ≤ 5 MB per file (enforced by `scripts/check.ps1`). |
| Archive | Cutouts only; never full spectral images or survey-scale queries. Bounded by `RequestLimits` (rows, cutout size, MB per run, concurrency ≤ 4, timeout). |
| Memory | Pipeline peak < 2 GB on an 8 GB laptop; use `memmap` for FITS reads; avoid array copies. |
| Caching | Downloads keyed by `cache_key(source_id, params)` in `.cache/parallax/` (disposable). Validated products in `data/processed/` (reusable). |
| Precision | Science arrays float32 unless a computation needs float64 (e.g. coordinates, time). |
| Forbidden without measured need | multiprocessing, GPU, workers pools, distributed compute, IndexedDB caches, heavy chart/vis libraries. |

Reduced motion: honour `prefers-reduced-motion` (blink defaults to manual stepping).

## 4. Scientific integrity (non-negotiable)

1. Real-data claims use real NASA/IPAC IRSA SPHEREx products. Simulated data has
   `data_kind: "simulated"` plus a visible notice; the schema rejects mixing the two.
2. Preserve original FITS HDUs and headers in science cutouts; never overwrite source files.
3. Coordinates are ICRS degrees. All pixel↔sky transforms go through Astropy WCS, never
   hand-rolled math in the browser (display helpers excepted).
4. Before any pixel comparison: same detector, center wavelength within tolerance, same units,
   same calibration version, matching pixel scale, registered to a common WCS. This is enforced by
   `assess_compatibility()`; the browser only displays its result.
5. SPHEREx uses linear variable filters: **wavelength varies across each detector.** Never treat
   pixels, detectors, or epochs as spectrally interchangeable. Use the spectral WCS.
6. Track units, variance, flags/masks, calibration version, and provenance for every product.
7. Never manufacture detections. Candidate statuses exclude "confirmed" by design.
8. Label every output as **visualization** (display PNG, stretch), **measurement** (flux,
   position, with uncertainty), or **inference** (candidate classification).
9. Account for PSF differences, background (zodiacal light), sampling, and correlated noise before
   interpreting a difference.
10. Invalid or unverifiable comparisons are shown as *unavailable* or *unverified*, never as
    "no change".
11. Unresolved scientific assumptions are listed in `docs/SCIENCE.md` §Assumptions.

## 5. Technology rules

**Frontend (`web/`):** React 19, TypeScript (strict, `exactOptionalPropertyTypes`), Vite, plain CSS
with custom properties (no Tailwind: the UI is small and Tailwind adds tooling for little gain).
Canvas 2D for imagery. Tests use Node's built-in `node --test` (no Vitest/Jest). No UI kit, no
state library, no charting library without a measured need. Accessible: labelled controls,
keyboard operable, visible focus, `aria-live` for async results, WCAG AA contrast.

**Science (`science/`):** Python 3.12 via `uv`. NumPy, Astropy, Pydantic (contract models + JSON
Schema export). Add `pyvo` (already an optional `archive` extra) for IRSA in Phase 1. SciPy,
Photutils, or `reproject` only when a specific step needs them; record why. CLI via `argparse`.
Lint/format with Ruff, test with pytest.

**Deployment:** static hosting (GitHub Pages or similar). `web/dist` contains the app plus
`data/`. No secrets are needed at runtime or build time; there is no `.env`.

## 6. Scientific data contract

The manifest contract is defined by `science/src/parallax_science/models.py` (source of truth),
exported to `data/manifests/manifest.schema.json`, mirrored in `web/src/types/manifest.ts`, and
documented in `docs/DATA_CONTRACT.md`. Required per observation: stable `observation_id`;
`data_kind`; epoch (`mjd_mid`, `time_scale`, source keyword); spectral (`detector`, center/min/max
wavelength in µm, derivation basis); image (dimensions, pixel scale, units, celestial WCS cards);
quality (flags/variance availability, masked fraction, notes); assets (science FITS, display PNG,
stretch); provenance (source URL required for real data, source id, calibration version, sha256,
processing command, cache key). Manifest-level: target (ICRS, radius), dataset (mission, archive,
collection, release, citation, acknowledgement), comparisons with status and reasons, candidates
with status/evidence/method.

**Changing the contract:** bump `schema_version`, update models → `uv run parallax schema` →
update the TS mirror and `parseManifest` → regenerate fixtures → update `DATA_CONTRACT.md`. Tests
fail if the committed schema or fixture drift from the code.

## 7. Workflow rules

1. Read the code and docs you are about to change. Plan first if a change spans `science/` and
   `web/` or touches the contract.
2. Build the smallest complete vertical slice; extend it only after it works end to end.
3. Every scientific transformation gets a test with a synthetic fixture where the right answer is
   known (injection/recovery).
4. After meaningful changes run `scripts/check.ps1` (or the relevant subset). Fix failures before
   adding scope.
5. Report what you ran and the actual result. Never claim a test passed that was not executed.
6. Update the relevant doc in the same change when behaviour or assumptions change.
7. **Git:** never commit, push, tag, rebase, or force anything without explicit instruction from
   a human in the current conversation. Never commit large source datasets, `.cache/`, or secrets.

## 8. Priorities

| P | Scope | Must work without the levels below it |
|---|---|---|
| P0 | Real SPHEREx data, coordinate input, multiple epochs, image viewing | yes |
| P1 | Blink comparator, registration to common WCS, metadata, compatibility validation | yes |
| P2 | Difference images, candidate highlighting | |
| P3 | Evidence reports, automated triage | |
| P4 | Spectral analysis, other enhancements | |

P2–P4 code must be removable without breaking P0/P1 (feature folders, no imports from P0/P1 into
P2+ internals).

## 9. Definition of done

- [ ] Feature works end to end in `npm run dev` and in the static build (`npm run preview`).
- [ ] Scientific assumptions written in `docs/SCIENCE.md`.
- [ ] `scripts/check.ps1` passes (ruff, pytest, manifest validation, typecheck, ESLint, Prettier, node tests, build, size budget, secret scan).
- [ ] Keyboard and screen-reader basics checked for new controls.
- [ ] No new dependency without justification; no unbounded loop, download, or array.
- [ ] No wording that overstates a result (see `docs/SUBMISSION.md` claims checklist).

## 10. Agent collaboration

- Contract first: agree on any `models.py` change before parallel work starts.
- Ownership: `science/` (pipeline, validation) and `web/` (UI) have separate owners. Shared files
  (`models.py`, `web/src/types/manifest.ts`, `data/manifests/*`, `AGENTS.md`) change in one
  coordinated edit.
- One feature folder per workstream (`web/src/features/<name>/`) to avoid conflicting edits.
- Prefer one focused reviewer over many parallel agents. Hand off with: what changed, how it was
  verified, open questions, next step. Keep it under 15 lines.

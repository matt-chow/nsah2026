# AGENTS.md: PARALLAX project guide

This is the canonical instruction file for humans and coding agents. `CLAUDE.md` only imports it
and must not duplicate or contradict it. Explicit instructions from the user take precedence over
this guide.

Detailed references: `docs/ARCHITECTURE.md`, `docs/SCIENCE.md`, `docs/DATA_CONTRACT.md`,
`docs/DEVELOPMENT.md`, `docs/RISKS.md`, `docs/ROADMAP.md`, `docs/SUBMISSION.md`, plus the design
context files `PRODUCT.md` and `DESIGN.md`. Where those conflict with this guide, this guide wins
until the conflict is reconciled (see §10).

## 1. Product identity and vision

- **Name:** PARALLAX, *An Open Observatory for the Changing Infrared Sky*.
- **Challenge:** NASA Space Apps Challenge 2026, "Planet X and SPHEREx"
  (<https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/>).
- **Mission:** explore and investigate the infrared sky through NASA SPHEREx observations.

Public exploration and deep scientific investigation are equally important product goals. Provide
**one shared sky explorer**: beginners receive accessible guidance, while experienced users can
expand scientific tools and reach precise controls directly. Preserve the selected field,
observations, and investigation state as tools expand or collapse. Do not build separate beginner
and scientific applications.

Write beginner explanations for teenagers and adults with no astronomy background. Make the
experience welcoming to younger visitors without requiring a dedicated children's mode. Explain
unfamiliar concepts when they become relevant; do not require users to understand coordinates,
FITS, or spectroscopy before they can begin.

**The main UX problem to solve:** beginners cannot easily tell what they are seeing or what to do
next. Every entry point therefore needs a clear starting observation, a plain explanation of the
image and what its colours represent, and an obvious next action. Reduce clutter through
progressive disclosure.

**Two essential journeys** (neither may depend on completing a tour or tutorial):
- *Curious visitor:* opens a curated observation, understands what the image and its colours
  represent, explores available wavelengths, and follows a prompt to examine an interesting
  feature or a valid comparison.
- *Experienced user:* locates a supported target, inspects available observations, expands
  analysis controls, checks quality and provenance, performs scientifically supported operations,
  and exports reproducible results.

**What we never claim:** automated planet discovery, confirmed candidates, or that an image
artifact is an object.

## 2. Scope and roadmap capabilities

Start with a **curated, preprocessed collection of real SPHEREx observations**. Broader on-demand
archive searches are a later capability. Clearly communicate actual collection coverage; never
imply that curated coverage is the whole survey or that an unobserved target does not exist.

SPHEREx is the only astronomical dataset in scope. External documentation and infrastructure are
not additional datasets. If object-name resolution needs an external catalogue or service, raise
it as a scope decision rather than adding it silently; curated target aliases can cover the
initial collection.

The roadmap must cover all six scientific capabilities:
1. Search by coordinates or astronomical object, initially within supported collection coverage.
2. Compare observations over time and inspect possible (candidate) changes.
3. Explore wavelengths, spectra, and colour composites where the observations support them.
4. Measure brightness or position with defensible uncertainties.
5. Inspect data quality, masks, provenance, and processing methods.
6. Export scientific data and reproducible investigation results.

These are roadmap requirements, **not claims of existing implementation or data availability**.
Do not fabricate support, silently drop a capability, or present placeholders as working analysis.

The exploration roadmap also includes short optional guided tours, wavelength and colour controls
with explanations, prompts for noticing changes in valid comparisons, and optional discovery
challenges using clearly labelled examples. Keep educational activities optional and connected to
the shared explorer where practical.

## 3. Audit and agreement before implementation

Before implementing the revised vision, inspect the actual repository, data products, contracts,
tests, documentation, and deployment configuration. Do not infer current behaviour from this
guide or from old descriptions.

Deliver an audit covering:
- What works now, with evidence, and what is partial, broken, simulated, or absent.
- Which of the six capabilities the available SPHEREx products genuinely support, and the missing
  data or prerequisites for the rest.
- Scientific, usability, accessibility, performance, cost, and deployment gaps.
- Existing frontend and backend work to reuse, including ownership.
- Proposed milestones covering all six capabilities and the exploration journeys, with
  dependencies, acceptance criteria, and unresolved decisions.
- Initial collection coverage and a plan for later archive access.

Present the audit and milestones, then **wait for the user's agreement before product
implementation.** Read-only inspection and necessary local audit checks are allowed. Agreement on
a roadmap authorizes only the implementation scope actually agreed; it never authorizes Git or
deployment actions (§10).

After agreement, deliver complete, reviewable increments and keep the existing working experience
usable. Raise material scope changes, new cost exposure, or unsupported scientific assumptions
instead of deciding them silently. Do not turn routine, reversible choices within an agreed
milestone into repeated approval requests.

## 4. Experience and design principles

Prioritize clarity, accessibility, and simplicity. Visual styling is open to experimentation and
appropriate design tools; this guide prescribes no theme, UI kit, or detailed layout.

- Give the sky imagery a clear visual hierarchy; do not show every control at once.
- Keep scientific tools discoverable, with direct access for experienced users.
- Use plain-language labels with precise scientific terms available in context.
- Explain what colours encode, which wavelengths are available, and how controls affect the
  display.
- Preserve the distinction between a display adjustment and a change to measured data.
- Explain charts, units, axes, selected regions, and uncertainty next to the relevant view.
- Provide useful loading, empty, partial-coverage, unavailable, and failure states.
- Make guidance dismissible and revisitable; never force onboarding.
- Support keyboard operation, visible focus, labelled controls, screen-reader status messages
  (`aria-live` for async results), WCAG AA contrast, and `prefers-reduced-motion` (e.g. blink
  defaults to manual stepping). Never encode essential meaning with colour alone.

Full scientific investigation must work on desktop and laptop. Phones must support exploration
and basic inspection with usable touch controls and readable content. Explain any desktop-only
operation and preserve context when practical; full mobile parity for complex analysis is not
required.

## 5. Scientific integrity (non-negotiable)

- Real-data claims must be grounded in traceable NASA/IPAC IRSA SPHEREx products. Preserve
  original FITS HDUs, headers, and source files; record processing provenance.
- Never manufacture observations, measurements, uncertainties, detections, or missing metadata.
  Unknown values remain unknown. Candidate statuses exclude "confirmed" by design.
- Distinguish **visualization** (display PNG, stretch, composite), **measurement** (flux,
  position, with uncertainty), and **inference** (candidate classification) in both data and
  user-facing text.
- Treat candidate changes as unconfirmed and explain alternative causes (PSF, background/zodiacal
  light, sampling, correlated noise, artifacts, moving objects).
- Keep invalid, unavailable, and unverified results distinct from a valid finding of no change.
- Validate compatibility for the specific operation: wavelength coverage, detector, units,
  calibration version, registration to a common WCS, pixel scale, masks, background, PSF, and
  noise as applicable. `assess_compatibility()` in `science/` is the authority; the browser
  displays its result.
- A failed quantitative compatibility check blocks that operation. It need not block browsing
  individually labelled observations, but browsing must not imply a validated comparison.
- SPHEREx uses linear variable filters: **wavelength varies across each detector.** Use the
  spectral WCS/metadata; never treat pixels, detectors, or observations as spectrally
  interchangeable.
- Coordinates are ICRS degrees. Scientific pixel↔sky transforms use established implementations
  (Astropy WCS); browser math is limited to clearly labelled approximate display helpers.
- Derive measurements from science products, never stretched display PNGs. State uncertainty
  methods and material limitations.
- Colour composites and interactive stretches disclose their mapping and preserve source data. Do
  not invent spectral detail or present illustrative colour as measured visible colour.
- When observations cannot support an operation, explain why and offer a valid alternative where
  one exists.
- Simulations live in separate lessons, persistently labelled there and in exports
  (`data_kind: "simulated"`); they never replace a failed real-data operation. Synthetic fixtures
  remain appropriate for tests, isolated from real claims.
- Verify product-specific assumptions against authoritative documentation; record sources and
  unresolved assumptions in `docs/SCIENCE.md` §Assumptions. Do not keep an old restriction only
  because an earlier guide stated it.

## 6. Architecture, tools, and cost

Current stack (verify before relying on it): `web/` is React + TypeScript (strict) + Vite with
plain CSS and Canvas 2D, tested with `node --test`; `science/` is Python 3.12 via `uv` with NumPy,
Astropy, Pydantic, `argparse` CLI, Ruff, and pytest; `api/` holds optional Vercel serverless
functions that proxy IRSA metadata and bounded cutouts. Preserve this stack where practical and
reuse existing components and teammate work rather than starting parallel implementations.

- A backend or database is allowed only for a concrete feature need. Document the need, why
  simpler options are insufficient, deployment implications, and how it stays within the cost
  boundary. Curated data alone does not require one, and the app must stay usable on a static
  host without the functions.
- **Strictly free:** no services, paid APIs, subscriptions, automatic overages, expiring credits
  with billing exposure, or configurations capable of incurring charges. A free tier is acceptable
  only when the configuration cannot generate charges; verify current limits and billing
  behaviour before adopting or expanding a service, otherwise use a demonstrably free alternative
  or report the constraint.
- Justified visualization, UI, testing, astronomy, and processing libraries are allowed. Explain
  material additions in terms of user benefit, maintenance, accessibility, or scientific
  correctness. There is no blanket ban on Tailwind, UI kits, chart libraries, workers, or GPU
  rendering, and no requirement to adopt them.
- Protect secrets: keep credentials out of source control, frontend bundles, logs, and exports.
  Document required configuration without exposing values. Currently no secrets are needed.

## 7. Performance and resource use

Keep browsing responsive on ordinary laptops and exploration usable on phones. Measure before
setting or revising budgets; record hardware, dataset sizes, network conditions, and results in
`docs/ROADMAP.md`.

Current enforced baselines (historical, revisable with evidence, never removed without a
replacement): initial JS ≤ 100 kB gzip; published `data/` ≤ 25 MB total and ≤ 5 MB per file
(`scripts/check.ps1`); display PNGs ≤ 1024 × 1024 px; archive access through cutouts bounded by
`RequestLimits` (rows, cutout size, MB per run, concurrency, timeout); pipeline peak memory well
under an 8 GB laptop.

- Load observations and advanced tools on demand; never load the whole collection at startup.
- Bound downloads, query sizes, processing, concurrency, retries, memory, and storage.
- Keep expensive science out of interactive rendering paths; use preprocessing or workers when
  justified. No idle render loops; blink uses pre-decoded images with no per-frame network,
  allocation, or React state.
- Use suitable numeric precision (float32 science arrays unless float64 is needed, e.g.
  coordinates and time) and avoid needless copies (`memmap` for FITS reads).
- Disposable download caches live in `.cache/parallax/`, keyed by `cache_key(source_id, params)`;
  validated reusable products live in `data/processed/`.
- Provide progress, cancellation where applicable, and clear failures for long operations.

## 8. Data contracts and reproducibility

The manifest contract's source of truth is `science/src/parallax_science/models.py`, exported to
`data/manifests/manifest.schema.json`, mirrored in `web/src/types/manifest.ts` and
`parseManifest`, and documented in `docs/DATA_CONTRACT.md`.

**Changing the contract:** bump `schema_version`, update models → `uv run parallax schema` →
update the TS mirror and `parseManifest` → regenerate fixtures (`uv run parallax make-fixture`) →
update `DATA_CONTRACT.md`. Drift tests fail if the committed schema or fixture diverge from code.

Preserve, as applicable: stable observation identifiers, real/simulated classification, time and
time scale, spatial and spectral coordinates, wavelengths and derivation basis, units,
calibration, dimensions, quality masks, variance availability, processing history, source
identifiers and URLs, archive release, citations, and checksums. Missing metadata stays explicit.
Operation-specific requirements decide whether a product supports browsing, measurement, or
inference.

Reproducible exports include the selected inputs, region, processing parameters, methods and
versions, units, uncertainty definitions, quality caveats, and provenance needed to recreate the
result. Prefer deterministic processing with documented tolerances; do not promise byte-identical
files across environments unless verified.

## 9. Verification and definition of done

Use the repository's actual commands: `scripts/check.ps1` runs Ruff, pytest, manifest
validation, `npm run check` (types, ESLint, Prettier, node tests, build), API tests, the data
size budget, and a secret scan. Update checks when intentionally changing tooling or budgets;
never bypass failures to claim completion. Every scientific transformation gets a known-answer
synthetic test (injection/recovery where appropriate).

A completed milestone satisfies its agreed acceptance criteria and includes:
- End-to-end verification in `npm run dev` and the local production build (`npm run preview`).
- Meaningful tests for changed science, contracts, and important interactions.
- Browser review of the beginner journey and direct scientific-tool access.
- Desktop/laptop investigation checks and phone exploration/basic-inspection checks.
- Keyboard, focus, contrast, reduced-motion, and screen-reader basics for changed controls.
- Accurate real/simulated labels, provenance, scientific limitations, and error states.
- Updated documentation and measured performance evidence for material changes.
- No wording that overstates a result (`docs/SUBMISSION.md` claims checklist).

Report commands actually run, their actual results, and remaining limitations. Never claim an
unexecuted test passed or an unmeasured target was met. Separate completed work from planned,
blocked, and unavailable work.

## 10. Git, deployment, and team coordination

This guide grants **no standing permission** to create branches, commit, push, open pull
requests, merge, tag, rebase, or deploy previews or production. Each needs a separate explicit
instruction for that action. Before a push or merge, check whether it triggers automatic
deployment (`vercel.json` and the README's Vercel URL suggest Git-triggered Vercel deploys;
GitHub Pages also hosts a static mirror). Never force-push or run destructive Git operations
without specific authorization. Read-only Git inspection is allowed.

- Preserve user and teammate changes. Never commit source-data dumps, `.cache/`, generated
  secrets, or credentials.
- Coordinate edits to shared contracts (`models.py`, `web/src/types/manifest.ts`,
  `data/manifests/*`) and this guide in one change. Confirm ownership from the repository or
  team rather than assuming it.
- If parallel work is explicitly authorized, divide it by clear boundaries (one feature folder
  per workstream under `web/src/features/<name>/`) and coordinate shared-file edits.
- Update relevant documentation in the same change as behaviour or assumptions. Reconcile
  conflicting documentation within authorized scope rather than keeping contradictory
  instructions.
- Handoffs are concise: what changed, how it was verified, open scientific or product questions,
  and the next reviewable step.

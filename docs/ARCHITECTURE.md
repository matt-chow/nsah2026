# Architecture

## Overview

```
IRSA SPHEREx (SIA2 query + cutout URLs)
        │  bounded requests (RequestLimits)
        ▼
science/  parallax CLI (Python, offline, on a developer laptop)
  archive adapter ─► .cache/parallax/   (raw cutouts, disposable, keyed by cache_key)
  validate WCS/spectral/flags ─► register ─► display stretch
        │
        ▼
data/   (published, size-budgeted)
  manifests/*.json        versioned contract, validated by `parallax validate`
  processed/<field>/*.fits   science cutouts, original HDUs preserved
  processed/<field>/*.png    8-bit display renderings
        │  static files (Vite publicDir)
        ▼
web/  React + TS + Canvas 2D (browser)
  fetch manifest → parseManifest (trust boundary) → lazy-load PNG per selected epoch
```

All science happens ahead of time in Python. The browser displays products and precomputed
results; it never decides scientific compatibility.

## Components

| Component | Path | Responsibility | Must not |
|---|---|---|---|
| Contract | `science/src/parallax_science/models.py` | Manifest schema, structural rules | depend on I/O |
| Validation | `validation.py` | WCS, footprint, asset, comparability checks | download data |
| Archive | `archive.py` | `ArchiveAdapter` protocol, request bounds | fetch full images |
| Cache | `cache.py` | deterministic keys, file hashing | hold validated products |
| Display | `display.py` | asinh stretch, stdlib PNG writer | be used for measurement |
| Fixture | `fixture.py` | deterministic **simulated** dataset | be shown as real |
| IRSA | `irsa.py`, `spherex.py` | SIA2 search, bounded cutouts, L2 HDU reading, flag masks | download full frames |
| Field build | `field.py`, `align.py`, `difference.py` | epoch selection, resampling to one grid, template differencing, triage | claim identifications |
| CLI | `cli.py` | `validate`, `schema`, `make-fixture`, `build-field`, `index` | |
| Web shell | `web/src/app/` | load manifest, layout, state | compute science |
| Features | `web/src/features/{sky-explorer,timeline,candidates,discover,analysis}` | search, date axis, "What changed?" list + summary + evidence report + light curve, the Discover story (built from the manifest), Analyze checks + calibration table | import each other's internals |
| Living Observatory | `web/src/features/{globe,spacecraft,spectrum,journal,arcade}` | lazy pages behind `#/sky`, `#/spacecraft`, `#/spectrum`, `#/journal`, `#/arcade`; they read the same manifests and index, write only to `localStorage` (journal, arcade progress) | change measurements, import observatory internals |
| Shared UI | `web/src/components/` | `SkyCanvas` (pan/zoom, blink/overlay/split/difference, stretch, loupe, scale bar, markers), `Term` (glossary popovers via native `popover`), `ObservationDetails` | |
| Live lookup | `api/sia.mjs` | optional Vercel function: exposure counts from IRSA SIA2 | proxy images, keep state |
| Web libs | `web/src/lib/` | `checkPair` (reads the pipeline verdict for an A/B pair; never recomputes it), readable dates, manifest/index parsing, TAN pixel↔sky for display, σ decoding, image cache | |

Python modules are flat files rather than subpackages; split a module only when it outgrows one
file.

## Key dependencies

Runtime web: `react`, `react-dom`; `@fontsource/schibsted-grotesk`, `@fontsource/ibm-plex-mono` and `@fontsource/instrument-serif` (display serif for story headings)
(self-hosted typefaces, CSS and woff2 only, no runtime JS). Science: `numpy`, `astropy`, `pydantic`,
`scipy` (`ndimage` labelling and bilinear resampling, which would otherwise be hand-written).
IRSA access uses stdlib `urllib` instead of `pyvo` (two bounded GET requests).
Dev: Vite, TypeScript, ESLint + typescript-eslint + react-hooks, Prettier,
Ruff, pytest. PNG writing uses the stdlib (`zlib`), so there is no Pillow dependency.

## Static-first deployment

`npm run build` emits `web/dist/` containing the app and a copy of `data/`. Any static host
works, and `base: './'` supports sub-path hosting. Production is Vercel (`vercel.json`): the same
static build plus one optional function, `api/sia.mjs`. IRSA sends no CORS headers, so the browser
cannot query it directly. The function returns exposure counts only and stores nothing. Its
failure, or a host without functions, degrades to "live lookup not available". Disposable caches live in `.cache/` outside
`data/`, so they cannot be published by accident.

## Performance reasoning

- **Bottleneck is data volume, not compute.** SPHEREx spectral images are 2040 × 2040 per
  detector with several HDUs, and the cutout service exists for this reason. We request only
  cutouts sized to the target (≤ 600″ by default, about 97 px at 6.2″/px).
- Display PNGs are separate from science FITS so the browser downloads tens of kB per epoch
  rather than MB, and science arrays are never decoded in JS.
- The viewer draws with `drawImage` and nearest-neighbour scaling, and redraws only on image or
  resize changes (`ResizeObserver`), so idle CPU is zero. Decoded images sit in a bounded
  12-entry cache; nothing is preloaded.
- The five Living Observatory pages are separate chunks (2 to 6.5 kB gzip each) loaded on
  navigation. The globe and spacecraft use Canvas 2D (no WebGL, no 3D library), cap DPR at 2,
  redraw only on input or resize, and run `requestAnimationFrame` only while inertia or a fly-to
  is in motion; reduced motion disables both. The scan demo's timer exists only while playing.
- Blink (P1) will toggle between two already decoded images with a timer. Each tick does one
  `drawImage` and no allocation or fetch.
- **Measuring:** bundle size comes from `vite build` output. Rendering is checked in the Chrome
  DevTools Performance panel (idle: no frames; blink: < 4 ms per tick on integrated graphics).
  Pipeline timing and memory use `time` plus `tracemalloc` in a script when needed.

## Tradeoffs and fallbacks

| Decision | Alternative rejected | Why |
|---|---|---|
| Precomputed static products | Live backend proxying IRSA | $0 hosting, no uptime risk, reproducible demo |
| Metadata-only serverless lookup | Live cutouts + differencing per request | Differencing needs Astropy and minutes of downloads; counts are cheap and honest |
| Python validation is authoritative | Re-validating science in JS | One implementation of the science, tested with Astropy |
| Pydantic models → JSON Schema | Hand-written JSON Schema | One source of truth plus drift tests |
| Canvas 2D | WebGL / heavy viewers (Aladin, JS9) | Tiny cutouts don't need GPU; fewer dependencies |
| Plain CSS | Tailwind / UI kits | Small UI, no build plugin |

**Fallback architecture.** If live archive access fails during the event, a teammate runs the
pipeline wherever access works and commits the small processed set, since the app only needs
static files. If P2 (difference imaging) is unreliable, its feature folder stays disabled and
P0/P1 ship alone. If no compatible real epoch pair exists for a field, the UI shows *unavailable*
for it and we pick a field with better coverage (deep fields near the ecliptic poles have many
visits).

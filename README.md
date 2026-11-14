# PARALLAX

**An open observatory for the changing infrared sky.** NASA Space Apps Challenge 2026,
[Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/).

NASA's SPHEREx telescope maps the whole sky in infrared every six months. PARALLAX lines up its
archive images of the same patch of sky, taken months apart, so anyone can see what changed:
blink between epochs, look at what is left after subtracting the steady sky, and judge each
residual with its numbers, light curve and caveats. It never claims a discovery. Every residual
is an unconfirmed lead that needs an independent detection.

## What it does

- **Real data.** Two curated fields of SPHEREx Level 2 spectral images from IRSA, each with
  10 epochs from DR1 and QR3 over 12 to 17 months, selected so every epoch samples the same
  wavelength (±0.25%) on the same detector:
  - North Ecliptic Pole, 1.445 µm, detector 2
  - South Ecliptic Pole, 2.559 µm, detector 4
- **Three modes, one shared state.**
  - **Discover** (the default): a five-step guided investigation of the real North Ecliptic Pole
    field: a patch of sky → the same sky on different dates → switch between dates → highlight
    what changed → weigh the evidence. Every sentence is filled from the manifest, so nothing
    about the sky is pre-written.
  - **Explore**: pick dates A and B and compare them by **Switch dates** (blink), **Fade**
    (opacity), **Split** (draggable divider) or **Highlight changes** (difference). The canvas
    pans and zooms, with an angular scale bar, an optional loupe, a display stretch
    (visualization only) and a live sky-coordinate readout.
  - **Analyze**: the pipeline's compatibility verdict for the A/B pair, a per-date calibration
    table, the full evidence report and metadata/provenance.
- **Plain language first.** Readable dates ("14 Jun 2025") with intervals; MJD, wavelength and
  calibration numbers stay in Analyze. Dotted terms (infrared, SPHEREx, pixel, subtraction,
  uncertainty, calibration, noise, detection confidence) open short definitions.
- **Comparison gate.** Pairs the pipeline marked incompatible are refused on screen with its
  reasons (try the simulated field, dates 1 and 3). A true time-axis timeline marks the dates
  where the selected change was detected. Keyboard controls are listed under *Keys*.
- **What changed, and the evidence.** Residuals are triaged by heuristic into variable-like,
  new-source-like, dipole-like and artifact-like. Each opens an evidence report containing:
  - position, band and detection dates
  - a light curve with ±1σ error bars
  - measured values with units and uncertainties
  - the reasons for its label, and a "Caveats and method" section
  - status vocabulary that has no "confirmed": *needs follow-up*, *likely artifact*, …
- **Honesty guards.**
  - Quantitative values are withheld for any epoch whose noise calibration failed validation.
  - The simulated test field shows a SIMULATED banner and label everywhere it appears.
  - The intro's starfield is labelled illustrative.
- **Search.** Enter an RA/Dec. If a prepared field covers it, PARALLAX pins it. Otherwise, on
  Vercel, a serverless lookup (`api/sia.mjs`) asks IRSA how many SPHEREx exposures exist there,
  then gives the exact pipeline command that would build that field.
- **States.** The app also covers reduced motion, offline, loading, error and
  empty states, and widths down to 360 px.

## Quick start (Windows PowerShell)

```powershell
./scripts/setup.ps1
cd web; npm run dev        # http://localhost:5173
./scripts/check.ps1        # every check: ruff, pytest, manifest validation, web, api, budgets
```

Rebuild a real field from IRSA (cutouts only, cached in `.cache/`):

```powershell
cd science
uv run parallax build-field nep-d2 --ra 270.0 --dec 66.5607 --detector 2 --epochs 10 --title "North Ecliptic Pole, 1.45 um (SPHEREx detector 2)"
uv run parallax index
```

## Layout

| Path | What |
|---|---|
| `science/` | Python pipeline (`parallax` CLI). It queries IRSA, makes cutouts, aligns them, runs difference imaging, classifies residuals and writes manifests. |
| `web/` | React + TypeScript + Vite viewer (Canvas 2D, plain CSS) |
| `api/` | One optional Vercel function: metadata-only IRSA exposure counts |
| `data/` | Published manifests, display PNGs and science FITS (≤ 25 MB total) |
| `docs/` | Architecture, [science methods](docs/SCIENCE.md), [data contract](docs/DATA_CONTRACT.md), development, risks, roadmap, [submission](docs/SUBMISSION.md) |

## Deployment

Live: <https://nsah2026.vercel.app> (with the IRSA lookup) and
<https://matt-chow.github.io/nsah2026/> (static mirror, no lookup).

The app is fully static. `web/dist` contains the app and `data/`. `vercel.json` builds it and
deploys `api/sia.mjs` as the only function. On a host without functions (GitHub Pages), search
still works for prepared fields and reports that the live lookup is unavailable.

## Limitations

- Coverage is limited to two prepared fields of about 15′ × 15′. The browser never downloads
  archive images live.
- There is no PSF matching. Undersampled PSFs shift between epochs, so most residuals at
  bright stars are artifacts. The classifier marks them as artifacts, but it is heuristic.
- Residuals are not cross-matched against catalogues (Gaia, AllWISE, JPL Horizons/MPC).
- The comparison uses a single wavelength on a single detector.
- Error bars come from the archive variance rescaled by an empirical factor, plus an error floor
  calibrated on bright pixels (see [SCIENCE.md](docs/SCIENCE.md)).

## Data, credit and AI use

The data are SPHEREx Level 2 Spectral Images from the NASA/IPAC Infrared Science Archive. The
full IRSA acknowledgement appears in the app and in every manifest. Files under
`data/fixtures/` and the `synthetic-fixture` field are simulated and are not SPHEREx data.

This project is not affiliated with or endorsed by NASA.

AI assistance (Claude) was used for code, documentation and design. The disclosure is in
[docs/SUBMISSION.md](docs/SUBMISSION.md#ai-use-disclosure).

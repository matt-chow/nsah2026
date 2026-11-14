# Data contract: observation manifest v1.0.0

| Artifact | Role |
|---|---|
| `science/src/parallax_science/models.py` | **Source of truth** (Pydantic, `extra="forbid"`) |
| `data/manifests/manifest.schema.json` | Generated JSON Schema (`uv run parallax schema`). Do not edit. |
| `web/src/types/manifest.ts` | Hand-written TS mirror |
| `web/src/lib/manifest.ts` | Browser trust-boundary check (subset) |
| `data/manifests/synthetic-fixture.json` | Reference instance, **SIMULATED** |

Validate any manifest with `uv run parallax validate <path>` (from `science/`). That runs schema
checks plus WCS, footprint, asset existence, FITS shape, and re-derivation of every comparison
status.

## Versioning

`schema_version` is a literal. Increment the minor version for additive optional fields and the
major version for removed, renamed, or retyped fields. The UI refuses unknown versions. Each
bump regenerates the schema and fixture, and tests catch drift.

## Manifest (top level)

| Field | Type | Req | Constraints / meaning |
|---|---|---|---|
| `schema_version` | `"1.1.0"` | ✓ | |
| `manifest_id` | string | ✓ | `^[A-Za-z0-9._-]{1,128}$` |
| `data_kind` | `real` \| `simulated` | ✓ | All observations must match. Simulated ⇒ `notice` set and `dataset.mission="SIMULATED"`. |
| `title` | string | ✓ | |
| `notice` | string \| null | ✓ | Shown as a banner. Required when simulated. |
| `target` | Target | ✓ | |
| `dataset` | Dataset | ✓ | |
| `observations` | Observation[] | ✓ | 1–200, unique `observation_id` |
| `comparisons` | Comparison[] | default [] | IDs must exist |
| `candidates` | Candidate[] | default [] | IDs must exist |
| `generated_by` | {tool, version, command} | ✓ | Reproduction command |

**Target:** `label`; `ra_deg` ∈ [0, 360); `dec_deg` ∈ [−90, 90]; `frame` = `"icrs"`;
`radius_arcsec` ∈ (0, 3600].

**Dataset (provenance of the whole set):** `mission` (`SPHEREx` | `SIMULATED`), `archive`
(e.g. `IRSA`), `collection` (e.g. `spherex_qr3`), `data_release` (exact archive label),
`citation`, `acknowledgement`. Nullable fields are null only for simulations.

## Observation

| Group | Field | Type / unit | Req | Notes |
|---|---|---|---|---|
| | `observation_id` | string | ✓ | Stable; derived from the archive file id |
| | `data_kind` | enum | ✓ | |
| `epoch` | `mjd_mid` | float, days (MJD) | ✓ | Mid-exposure |
| | `time_scale` | `utc`\|`tt`\|`tai`\|`tdb` | ✓ | As stated in the header |
| | `exposure_s` | float, s | opt | > 0 |
| | `source_keyword` | string | opt | FITS keyword the time came from |
| `spectral` | `detector` | int 1–6 \| null | ✓ | null = unknown ⇒ comparisons `unknown` |
| | `wavelength_center_um` | float, µm | ✓ | At cutout center |
| | `wavelength_min_um`, `wavelength_max_um` | float, µm | ✓ | min ≤ center ≤ max, range across the cutout |
| | `basis` | `spectral-wcs`\|`header`\|`simulated` | ✓ | How wavelengths were derived |
| `image` | `width_px`, `height_px` | int 1–4096 | ✓ | Must equal FITS `IMAGE` shape |
| | `pixel_scale_arcsec` | float, ″/px | ✓ | Must match WCS within 1% |
| | `units` | string | ✓ | e.g. `MJy/sr` |
| | `wcs` | {card: str\|num\|bool} | ✓ | Celestial WCS of the science array. Target must be in the footprint. |
| `quality` | `flags_available`, `variance_available` | bool | ✓ | |
| | `masked_fraction` | float [0,1] \| null | opt | |
| | `notes` | string[] | opt | Known issues |
| `assets` | `science_fits` | relative path \| null | ✓ | Original HDUs preserved |
| | `display_png` | relative path | ✓ | 8-bit, for viewing only |
| | `display_stretch` | string | ✓ | e.g. `asinh(p0.5-p99.5, a=0.1)` |
| `provenance` | `source_url` | string \| null | ✓ | **Required for real data** |
| | `source_id` | string | ✓ | |
| | `retrieved_utc` | ISO 8601 string | opt | |
| | `source_sha256` | 64-hex | opt | Hash of the downloaded file |
| | `calibration_version` | string \| null | opt | null ⇒ comparisons `unknown` |
| | `processing` | string | ✓ | Exact command and parameters |
| | `cache_key` | 64-hex | ✓ | `cache_key(source_id, params)` |

Paths are relative to `data/`. Absolute paths, drive letters, and `..` are rejected in both
Python and the browser. The FITS origin is bottom-left, so display PNGs are flipped vertically:
row 0 of the PNG is the top of the displayed image.

## Statuses

**Comparison** `{reference_id, target_id, status, reasons[]}`:

| status | Meaning | UI |
|---|---|---|
| `compatible` | All checks in `assess_compatibility` pass | blink/difference allowed |
| `incompatible` | At least one check failed (reasons list each) | "Unavailable", with reasons |
| `unknown` | A check could not be evaluated | "Unverified", treated as unavailable |

**Candidate** `{candidate_id, status, observation_ids[], ra_deg, dec_deg, evidence[], method}`.
`status` ∈ `unreviewed`, `needs_followup`, `known_object`, `likely_artifact`, `rejected`.
There is no "confirmed" status, and the schema rejects it.

## Example (SYNTHETIC, abridged from `data/manifests/synthetic-fixture.json`)

```json
{
  "schema_version": "1.0.0",
  "manifest_id": "synthetic-fixture-001",
  "data_kind": "simulated",
  "title": "Synthetic fixture: simulated three-epoch field",
  "notice": "SIMULATED DATA. ... not a SPHEREx observation ...",
  "target": { "label": "Synthetic field (not a real sky region)", "ra_deg": 180.0, "dec_deg": 0.0, "frame": "icrs", "radius_arcsec": 198.4 },
  "dataset": { "mission": "SIMULATED", "archive": null, "collection": null, "data_release": null, "citation": "...", "acknowledgement": "..." },
  "observations": [{
    "observation_id": "synthetic-fixture-001.e1",
    "data_kind": "simulated",
    "epoch": { "mjd_mid": 61000.0, "time_scale": "utc", "exposure_s": 112.0, "source_keyword": "MJD-AVG" },
    "spectral": { "detector": 3, "wavelength_center_um": 2.0, "wavelength_min_um": 1.98, "wavelength_max_um": 2.02, "basis": "simulated" },
    "image": { "width_px": 64, "height_px": 64, "pixel_scale_arcsec": 6.2, "units": "MJy/sr",
               "wcs": { "CTYPE1": "RA---TAN", "CTYPE2": "DEC--TAN", "CRVAL1": 180.0, "CRVAL2": 0.0, "CRPIX1": 32.5, "CRPIX2": 32.5, "CDELT1": -0.0017222222222222, "CDELT2": 0.0017222222222222, "RADESYS": "ICRS" } },
    "quality": { "flags_available": true, "variance_available": true, "masked_fraction": 0.0, "notes": ["Simulated Gaussian PSF and white noise; no artifacts modeled."] },
    "assets": { "science_fits": "fixtures/synthetic-fixture-001/e1.fits", "display_png": "fixtures/synthetic-fixture-001/e1.png", "display_stretch": "asinh(p0.5-p99.5, a=0.1)" },
    "provenance": { "source_url": null, "source_id": "synthetic-fixture-001.e1", "calibration_version": "simulated-v1", "processing": "parallax make-fixture (seed=2026)", "cache_key": "e9de…399c" }
  }],
  "comparisons": [
    { "reference_id": "synthetic-fixture-001.e1", "target_id": "synthetic-fixture-001.e2", "status": "compatible", "reasons": [] },
    { "reference_id": "synthetic-fixture-001.e1", "target_id": "synthetic-fixture-001.e3", "status": "incompatible", "reasons": ["different detectors (3 vs 4)", "wavelength offset 50.00% exceeds 1.00%"] }
  ],
  "candidates": [],
  "generated_by": { "tool": "parallax-science", "version": "0.1.0", "command": "parallax make-fixture" }
}
```

The fixture is deliberately built so that e1/e2 are compatible and e3 is on another detector,
which exercises both paths in the UI.

## 1.1.0 additions (difference imaging)

All of these fields are optional and additive. The Python model in `models.py` is authoritative,
and `manifest.schema.json` is generated from it.

| Where | Field | Meaning |
|---|---|---|
| top level | `alignment` | How the epochs were resampled onto one grid, or null. If it is set, every observation must share one size and WCS. A `template` or any `differences` require it. |
| top level | `template` | `{observation_ids, method, display_png, science_fits}`: the median reference image. |
| top level | `differences[]` | One entry per epoch. `status` is `validated` or `visualization_only`, and `reasons` explain why quantitative use is off. Also: `noise_scale` (*k*), `error_floor_fraction` (*f*), `background_mjysr`, `threshold_sigma`, `display_png`, `display_range_sigma`. |
| candidate | `kind` | `new_source_like` \| `variable_like` \| `dipole_like` \| `artifact_like`. These are heuristic resemblance labels, never identifications. |
| candidate | `pixel_x`, `pixel_y` | 0-based position on the shared grid, in FITS orientation (row 0 = bottom) |
| candidate | `measurements[]` | `{name, value, uncertainty (1σ or null), unit}` |
| candidate | `light_curve[]` | `{observation_id, mjd_mid, delta_flux_ujy, uncertainty_ujy}`. Null means masked. |
| candidate | `caveats[]` | Limitations specific to this residual |
| observation `quality` | `psf_fwhm_arcsec` | `PSF_FWHM` header keyword of the L2 image, or null |
| observation `provenance` | `collection`, `data_release` | Per-file IRSA collection and release (`DR1`, `QR3`) |

**Difference PNG encoding.**
- The PNG is 8-bit grey. Value 0 means masked. Values 1 to 255 map linearly onto
  [−`display_range_sigma`, +`display_range_sigma`], so 128 is 0σ.
- The browser decodes it with `decodeSigma()` (`web/src/lib/sky.ts`) for the σ readout, and
  colours it with a diverging map: amber for brighter, blue for fainter.
- Rows are flipped like every display PNG. The display row is H − 1 − the FITS row.

**Index.** `data/manifests/index.json` (`parallax index`) lists the fields the app offers. Each
entry has `manifest_id`, `path`, `title`, `data_kind`, the centre and radius, observation and
candidate counts, the release and the wavelength.

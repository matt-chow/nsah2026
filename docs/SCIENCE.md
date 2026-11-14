# Science notes

The sources of truth are the IRSA SPHEREx documentation and the SPHEREx Explanatory Supplement.
Statements marked **[verify]** have not yet been confirmed against the current documents. Confirm
them before relying on them in code or in claims.

## SPHEREx data characteristics

- All-sky spectrophotometric survey, 0.75–5.0 µm, six detectors (bands) observed simultaneously.
- Linear variable filters (LVFs) mean **wavelength changes across each detector**. A single
  spectral image samples many wavelengths, and the spectral WCS (`WCS-WAVE` extension) maps
  pixel → wavelength. Spectral resolution R is about 35–130, depending on band.
- Pixel scale about 6.2″. PSFs are undersampled and vary with band and field position.
- Level 2 Spectral Image MEF HDUs: `IMAGE` (surface brightness, MJy/sr), `FLAGS` (per-pixel
  bitmask; definitions in Explanatory Supplement Table 10), `VARIANCE` ((MJy/sr)²), `ZODI`
  (zodiacal light model), `EPSF`, `WCS-WAVE`. Verified 2026-11: the cutout service
  (`<file>.fits?center=ra,dec&size=Narcsec`) returns all seven HDUs, about 4 MB per request
  regardless of size because the EPSF table is not cut.
- Releases (verified 2026-11 via SIA2): collections `spherex_dr1`, `spherex_dr1_deep`
  (Data Release 1, `l2b-v27-2026-196`) and `spherex_qr3`, `spherex_qr3_deep` (Quick Release 3,
  `l2b-v27-2026-224`). PARALLAX queries all four and records the release per observation.

## Method as built (pipeline v0.1)

The code is in `science/src/parallax_science/` and runs as
`parallax build-field <name> --ra --dec --detector --epochs --title`. Every parameter below is
a field of `difference.Params` or is written into the manifest.

1. **Epoch selection** (`field.py`)
   - SIA2 lists every L2 exposure whose footprint contains the target, in all four collections
     (`irsa.search`).
   - Each exposure gets a predicted LVF wavelength at the target from its detector geometry.
   - The pipeline keeps the densest ±0.25% wavelength window that contains both DR1 and QR3
     epochs, then spreads the chosen epochs evenly over the baseline.
   - After download, each cutout's exact wavelength from its spectral WCS must fall within 0.4%
     of the window, or the epoch is dropped.
   - Stdlib `urllib` replaces `pyvo` here. Two bounded GET requests do not justify the
     dependency, and the retries handle IRSA's "Server busy" replies.
2. **Alignment** (`align.py`)
   - Cutouts are resampled bilinearly (`scipy.ndimage.map_coordinates`) onto one north-up TAN
     grid: 147 × 147 px at 6.15″/px, centred on the target. The SIP-aware Astropy WCS of each
     cutout drives the resampling.
   - Hard-flagged pixels become NaN.
   - Flags are OR-combined over the 2 × 2 source neighbourhood, so a flag is never lost.
3. **Template** (`difference.template`)
   - The template is the per-pixel median of the background-subtracted epochs. A pixel needs at
     least 3 valid epochs.
   - Its variance is (π/2)·mean(var)/n.
   - Each epoch is differenced against the **leave-one-out** median of the *other* epochs, so a
     transient cannot hide itself in its own template.
   - The background is a 3σ-clipped median that excludes source-flagged pixels.
4. **Noise calibration** (`difference.calibrate`)
   - Pipeline variance is not trusted blindly.
   - The scale *k* is set per epoch so that faint pixels (template S/N < 3) have unit robust
     scatter. The measured *k* is about 0.67 to 0.72 on both fields, so the archive variance is
     conservative at these scales.
   - One pooled fractional error floor *f* is set so that bright pixels (S/N > 20) also have
     unit scatter. It absorbs PSF and registration mismatch at stars (*f* = 0.32 at the NEP).
   - The significance is S = (epoch − bg − template) / √(k²(var + var_t) + (f·template)²).
5. **Validation gate**
   - An epoch's difference is `validated` only when *k* ∈ [0.3, 3] and at least 60% of pixels
     are usable.
   - Otherwise the difference is shown for visualisation only. The UI withholds all
     quantitative values and no detections are extracted.
   - `test_underestimated_variance_disables_quantitative_use` covers this gate.
6. **Detection**
   - Connected regions (8-connected) above 3σ form detections when their peak reaches 5σ, in
     both signs.
   - The centroid is weighted by |S|.
   - Fluxes are summed in a 1.5 px aperture and converted from MJy/sr to µJy with the 6.15″
     pixel solid angle.
7. **Triage** (`difference.classify`, applied in order)
   1. A detection that touches caution flags, or lies within 3 px of the edge, is
      *artifact-like*.
   2. A detection whose aperture change is below 3σ, although its peak pixel is significant, is
      *artifact-like*. This is the signature of an undersampled PSF shifting between pixels.
   3. A detection with an opposite-sign partner within 3 px is *dipole-like*. It is an artifact
      if a steady source sits there; otherwise it needs follow-up.
   4. A detection with a reference source of S/N ≥ 5 is *variable-like*.
   5. A positive residual with no reference source is *new-source-like*.
   6. A negative residual with no source is *artifact-like*.

   The labels say what a residual resembles and identify nothing.
8. **Light curve.** The pipeline measures the aperture residual (µJy, ±1σ) at the candidate
   position in every epoch, against that epoch's own leave-one-out template. Masked epochs are
   null.

**Results on the committed fields.** These come from one heuristic run, are unconfirmed, and are
not cross-matched.

| Field | Residuals | Needs follow-up | Likely artifact |
|---|---|---|---|
| NEP 1.445 µm | 40 | 3 (2 variable-like, 1 new-source-like) | 37 |
| SEP 2.559 µm | 40 | 22 (15 variable-like, 7 new-source-like) | 18 |

The SEP field has many more follow-up leads. A plausible reason is its baseline: eight of its
ten epochs fall within about 10 weeks (2025 weeks 40 to 49), so there is less averaging. We have
not investigated this further. Treat it as a reason for caution, not as a result.

**Injection and false-positive tests** (`science/tests/test_engine.py`):
- Null epochs (noise and stars, nothing injected) produce no candidates.
- An injected mover is recovered in every epoch.
- An injected variable is classified as variable-like.
- Caution flags force artifact-like.
- Injection-recovery completeness is 100% at aperture S/N 15 and ≤ 12.5% at S/N 2.

`test_units.py` and `test_contract.py` cover cutout URLs, polygon parsing, the detector
homography, the significance PNG encoding, compatibility and manifest integrity.

## Observational constraints

- Each sky position is visited a few times per ~6-month survey and more often near the ecliptic
  poles (deep fields). Successive visits can land on **different detectors or different LVF
  positions**, so the wavelength sampled at a source changes between epochs. Same-wavelength
  pairs are therefore limited. Finding them is a first-class pipeline task.
- Exposures are short (on the order of ~100 s) **[verify]**. Moving objects show little trailing
  within an exposure.

## WCS and registration

- Use Astropy `WCS` on the `IMAGE` header for celestial coordinates (ICRS). Validate with
  `validate_manifest`: 2-D celestial WCS, pixel scale agrees with the manifest within 1%, and the
  target lies inside the footprint.
- Pixel comparison (blink, difference) needs both images on a **common pixel grid**. Phase 2 uses
  `reproject` (interp or exact) to the reference epoch's WCS. Resampling correlates noise and
  smooths undersampled PSFs, so propagate variance through the same operation and treat
  per-pixel errors afterwards as approximate.
- Registration check: after reprojection, measure centroid offsets of bright unsaturated stars.
  Median residual must be < 0.2 px **[assumption]** or the pair is marked `incompatible`.
- Time: store mid-exposure MJD with an explicit `time_scale` and the source FITS keyword.
  **[verify]** which keyword and scale SPHEREx L2 headers use. The fixture uses `MJD-AVG`/UTC as a
  placeholder.

## Spectral compatibility

`assess_compatibility()` (science/src/parallax_science/validation.py) requires, for `compatible`:
same data kind, distinct epochs, same time scale, **same detector**, center wavelength offset
≤ 1% (`CompatibilityTolerances.max_wavelength_offset_fraction`), same units, pixel scales within
1%, and the same calibration version. Missing detector or calibration information gives
`unknown`. Every failure gives `incompatible` with reasons. The wavelength used is the one *at
the cutout center* from the spectral WCS. Across a cutout of ~100 px the LVF gradient changes
wavelength too, so Phase 2 must check that the range overlaps, not just the center.

**[assumption]** A 1% tolerance is well within one resolution element (1/R ≈ 0.8–3%), so
astrophysical spectral slope differences stay negligible compared with noise for most sources.
Validate this on real pairs.

## Photometry and uncertainties

- Use `VARIANCE` for per-pixel σ. Use `FLAGS` to mask bad pixels and propagate masks through
  reprojection (any contributing flagged pixel → flagged).
- Aperture or PSF photometry (Photutils, Phase 3) reports flux ± σ in the image units. Always
  state the aperture and background method.
- If variance is missing, mark uncertainty *not available*. Do not estimate it silently.

## Difference imaging limitations

- Subtraction of resampled, PSF-mismatched images leaves dipole residuals around stars. These are
  expected and are not candidates. We do not PSF-match (Alard-Lupton/ZOGY) in the hackathon
  scope. Instead, residuals near catalog stars are flagged.
- The zodiacal background differs between epochs. Subtract the `ZODI` model or a local background
  before differencing.
- Significance image: `D / sqrt(V1 + V2)`. Because resampling correlates noise, the empirical σ of
  the significance image must be measured, and thresholds rescaled, before use.

### What the viewer does and does not do

- **Comparison gate.** Switch dates, Fade and Split show both images only when the pipeline's
  `assess_compatibility` verdict for that pair is `compatible` (or B is the template built from
  the same compatible set). Otherwise the viewer shows A alone and lists the recorded reasons. A
  pair with no recorded verdict is treated as unverified, never as compatible. A test asserts that
  every pair in both real fields has a verdict.
- **Display stretch** (As archived / Faint detail / Bright detail) is a CSS brightness/contrast
  filter on the display PNG: visualization only. It never touches measurements and is disabled
  in Highlight changes, where colour encodes σ.
- **Loupe and scale bar** are display aids. The scale bar uses the manifest pixel scale and is
  approximate across the cutout (TAN projection, ≤ 15′ field).
- **The Discover story** is assembled from manifest values (candidate, σ, flux ± uncertainty,
  dates, artifact count). It leads with the strongest *needs follow-up* change and still calls it
  unconfirmed. Flux numbers appear only for dates whose difference is `validated`.

## Motion vs variability

- **Moving:** source at position p₁ in epoch 1 and p₂ ≠ p₁ in epoch 2, with nothing at p₁ in
  epoch 2. Gives a positive/negative pair in the difference image. With ≥ 3 epochs, require
  positions consistent with linear motion.
- **Variable:** flux changes at a fixed position (within the registration error).
- **Neither:** cosmic ray or hit (single epoch, sharp), persistence, saturation or bleed, ghost,
  edge effects, residuals of reprojection or PSF mismatch.

## Candidate validation (target design)

This is the full design. v0.1 implements the significance, flag, edge and dipole rules (see
"Method as built"). It does **not** yet cross-match catalogues or solar-system objects, so its
`needs_followup` labels come from heuristics alone, and every report says so.

A detection becomes a `candidate` record only with all of: significance above threshold after
the empirical noise rescale; no flags in the footprint; not within a PSF radius of a bright
residual; stable shape across both epochs; and, for movers, a counterpart in the other epoch at
a plausible displacement. Then it is cross-matched against known solar-system objects (JPL
Horizons / MPC, e.g. via `astroquery`) and catalog stars and galaxies (Gaia, AllWISE) before
any status other than `unreviewed`. Status vocabulary: `unreviewed`, `needs_followup`,
`known_object`, `likely_artifact`, `rejected`. There is deliberately **no "confirmed"**.

## False-positive handling

False positives are expected to dominate. Report counts by rejection reason in evidence reports.
Never hide rejected detections from the evidence view, because they show how the method behaves.

## Synthetic injection testing

The fixture (`parallax make-fixture`) injects a known moving source into simulated epochs.
Detection code must recover injected sources at known positions and fluxes, report completeness
versus injected significance, and produce zero candidates on a pair with no injection, within
the expected false-alarm rate. Real-data injection (adding synthetic PSFs to real cutouts) is
the Phase 3 acceptance test.

## Assumptions needing validation

1. ~~Release labels and collections for DR1/QR3.~~ Verified 2026-11 (see above).
2. Time keyword: `MJD-AVG` is read from L2 headers and recorded as UTC. **[verify]** the scale against the Explanatory Supplement.
3. ~~HDUs present in cutout-service output.~~ Verified: all seven.
4. 1% wavelength tolerance is adequate for differencing.
5. < 0.2 px registration residual threshold.
6. FLAGS bits that should mask (from Explanatory Supplement Table 10).
7. Calibration version: taken from the file name (`l2b-v27`). Both releases share it.

## References

- IRSA SPHEREx: <https://irsa.ipac.caltech.edu/Missions/spherex.html>
- SPHEREx Explanatory Supplement (QR): <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf>
- Archive documentation (data products, access): <https://caltech-ipac.github.io/spherex-archive-documentation/>
- Cutout service: <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html>
- IRSA tutorials (intro, cutouts, PSF): <https://caltech-ipac.github.io/irsa-tutorials/>
- Pipeline paper: <https://arxiv.org/abs/2511.15823>
- Mission paper: <https://arxiv.org/abs/2511.02985>

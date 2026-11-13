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
  (zodiacal light model), `PSF`, `WCS-WAVE`. **[verify]** which HDUs the cutout service returns.
  The IRSA tutorial shows IMAGE/FLAGS/VARIANCE in cutouts.
- Releases: IRSA has released Spectral Images weekly since July 2025 (Quick Release), with
  improved calibrations since October 2025. SIA2 collections are `spherex_qr` (wide),
  `spherex_qr_deep`, and `spherex_qr_cal`. Team guidance is to prefer **DR1 + QR3** where
  available. **[verify]** the current release labels and collection names at
  <https://irsa.ipac.caltech.edu/Missions/spherex.html> before Phase 1. Record the label exactly
  as IRSA states it in `dataset.data_release`.

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

## Motion vs variability

- **Moving:** source at position p₁ in epoch 1 and p₂ ≠ p₁ in epoch 2, with nothing at p₁ in
  epoch 2. Gives a positive/negative pair in the difference image. With ≥ 3 epochs, require
  positions consistent with linear motion.
- **Variable:** flux changes at a fixed position (within the registration error).
- **Neither:** cosmic ray or hit (single epoch, sharp), persistence, saturation or bleed, ghost,
  edge effects, residuals of reprojection or PSF mismatch.

## Candidate validation (P2–P3)

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

1. Release labels and collections for DR1/QR3 (see above).
2. Time keyword and time scale in SPHEREx L2 headers.
3. HDUs present in cutout-service output.
4. 1% wavelength tolerance is adequate for differencing.
5. < 0.2 px registration residual threshold.
6. FLAGS bits that should mask (from Explanatory Supplement Table 10).
7. Whether calibration versions are recorded per file (header keyword) for compatibility checks.

## References

- IRSA SPHEREx: <https://irsa.ipac.caltech.edu/Missions/spherex.html>
- SPHEREx Explanatory Supplement (QR): <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf>
- Archive documentation (data products, access): <https://caltech-ipac.github.io/spherex-archive-documentation/>
- Cutout service: <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html>
- IRSA tutorials (intro, cutouts, PSF): <https://caltech-ipac.github.io/irsa-tutorials/>
- Pipeline paper: <https://arxiv.org/abs/2511.15823>
- Mission paper: <https://arxiv.org/abs/2511.02985>

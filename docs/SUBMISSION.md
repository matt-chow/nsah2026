# Submission kit

Check the official requirements on the Space Apps 2026 site before the deadline. The checklist
at the end is ours, not the official one.

## Project description (for the project page)

**PARALLAX: an open observatory for the changing infrared sky.**

SPHEREx maps the whole sky in 102 infrared colours every six months, so every patch of sky gets
photographed again and again. PARALLAX turns those repeat visits into something anyone can
inspect.

- It lines up real SPHEREx archive images of the same field, taken up to 17 months apart, at the
  same wavelength on the same detector.
- It subtracts the steady sky from each epoch, leaving only what changed.
- It lets you blink, overlay and difference the epochs in the browser.

Every residual that survives the pipeline gets an evidence report: where it is, when it was seen,
its light curve with error bars, the measured flux change, and the plain reasons it was labelled
*variable-like*, *new-source-like*, or *likely artifact*. Nothing is called a discovery. The
report says what each residual resembles, why it could be wrong, and that confirming it needs an
independent detection. That is what a careful search for a "Planet X" or any moving or changing
object would require.

The noise model is calibrated on the data, not assumed. The pipeline:
- measures how far the archive's per-pixel uncertainty is off in each epoch
- adds an error floor for star-shaped mismatch
- withholds every number for any epoch where that calibration fails

Injection tests show that real changes are recovered and that blank sky produces no detections.

The app is static, with free hosting, no database and no GPU. One optional serverless function
asks IRSA whether SPHEREx has observed any coordinate you type.

## Judging narrative (impact · creativity · validity · relevance · presentation)

- **Relevance.** The challenge asks how SPHEREx's repeated all-sky survey can reveal changes and
  moving objects. PARALLAX works directly on SPHEREx DR1 and QR3 Level 2 images from IRSA.
  It deals with the hard part of SPHEREx time-domain work: the wavelength at a given position
  changes between visits because of the linear variable filters. So it selects epochs that sample
  the same wavelength (±0.25%) on the same detector.
- **Scientific validity.**
  - Leave-one-out median templates.
  - Empirical noise calibration, recorded per epoch as *k* and *f*.
  - An aperture test that rejects undersampled-PSF jitter.
  - Flag and edge handling, and injection-recovery and null tests.
  - A validation gate that disables quantitative use when calibration fails.
  - A status vocabulary with no "confirmed".
  - At the North Ecliptic Pole, 37 of 40 residuals are marked as likely artifacts. We show them
    rather than hide them, because they show how the method behaves.
- **Impact.** Anyone, from a student to a citizen scientist or an astronomer scouting follow-up
  targets, can see what changed in an infrared field and why the software thinks so, with
  provenance back to the exact IRSA file.
- **Creativity and presentation.**
  - A cinematic intro hands off to a precise workspace.
  - Evidence is set as an astronomical telegram with a stamped status.
  - A guided tour drives the real interface.
  - Full keyboard control, reduced-motion support, and phone-width layout.

## Demo script (≈ 2 min 30 s)

| # | Time | Screen | Narration |
|---|---|---|---|
| 1 | 0:00 | Intro, starfield drifting | "SPHEREx photographs the whole infrared sky every six months. What changes between those photographs?" |
| 2 | 0:12 | Click *Open the workspace*. North Ecliptic Pole, Blink. | "These are ten real SPHEREx images from NASA's IRSA archive, all at 1.445 microns on the same detector, taken over 17 months." |
| 3 | 0:25 | Press Space (blink), then ←/→ along the timeline | "Blinking is how astronomers have hunted for changes for a century, Pluto included." |
| 4 | 0:40 | Press D (Difference) | "Now subtract the steady sky. Amber is brighter than usual, blue is fainter. Most of what's left is noise, and the noise is measured from the data itself." |
| 5 | 0:55 | Click c012 in *Needs follow-up* | "One residual: brighter in a single epoch, with nothing there in the others." |
| 6 | 1:05 | Scroll the evidence report: light curve, measurements | "About 780 microjanskys, plus or minus 100, seen in one epoch out of ten. The light curve shows the other nine are flat." |
| 7 | 1:20 | Open *Caveats and method*, point at the stamp | "And it says what it isn't: a cosmic ray, a detector event or a moving object all look like this. It is unconfirmed until it is seen again." |
| 8 | 1:35 | Click *All 40* and pick an artifact-like residual | "37 of the 40 residuals here are flagged as likely artifacts, mostly stars whose blurry image shifts between pixels. We show them, because hiding them would hide how the method behaves." |
| 9 | 1:50 | Type RA 10, Dec 20 → Find | "Type any coordinate. If we haven't prepared that field, PARALLAX asks IRSA live how many SPHEREx exposures exist there, and prints the command that would build it." |
| 10 | 2:05 | Switch to the SIMULATED field | "Our test field is simulated, and it says so on every screen." |
| 11 | 2:15 | Back to NEP, press Tour | "Everything is open source, reproducible from one command, and free to host. PARALLAX." |

**Storyboard.** These frames match the screenshots taken during QA (1440 × 900):
1. intro
2. workspace (blink)
3. difference with c012 selected
4. evidence report scrolled
5. artifact-like residual
6. search result
7. simulated banner

## Recording instructions

1. Build and serve locally (`cd web; npm run build; npx vite preview`), or use the deployed URL.
   Use Chrome at 1440 × 900 with OS animations on.
2. Open a fresh profile so the intro shows. The intro is skipped once per session, or when the
   URL has a `#field` hash.
3. Record with OBS or the Windows Game Bar (Win + Alt + R) at 1080p, 30 fps. Record the
   narration separately and keep it under 2:30.
4. Step 9 needs the Vercel deployment, because the live lookup is a function. On a static host,
   it shows "live archive lookup is not available on this deployment". Say that instead.
5. Upload as unlisted and put the link on the project page. Add the Limitations list below to
   the video description.

## AI-use disclosure

This project was built with substantial help from an AI coding assistant (Anthropic's Claude,
via Claude Code). It wrote and edited:
- the Python pipeline, the React app and the tests
- the documentation
- the visual design, guided by our brief

Team members directed the work, chose the fields and the scientific criteria, and reviewed the
output. Every scientific number shown comes from running the committed pipeline on IRSA data,
not from the AI.

The test suites can be checked with `scripts/check.ps1`:
- pytest, with injection and null tests
- node tests, including the manifest-integrity tests
- manifest validation

No AI-generated imagery is presented as data. The intro starfield is procedural and labelled
illustrative.

## Limitations (also in README and video description)

- There are two prepared fields of about 15′ × 15′. Other positions get exposure counts only.
- There is no PSF matching, and the classifier is heuristic. Labels describe resemblance.
- Residuals are not cross-matched against Gaia, AllWISE, or JPL Horizons/MPC in this build.
- Each comparison uses a single detector and a single wavelength. No spectra are used.
- The time scale of `MJD-AVG` is recorded as UTC, pending confirmation against the Explanatory
  Supplement.

## Attribution

- SPHEREx Level 2 Spectral Images from the NASA/IPAC Infrared Science Archive (IRSA). Each
  manifest stores the full IRSA acknowledgement, and the app footer shows it.
- Every observation's metadata panel links to its IRSA source URL.
- The app is not affiliated with or endorsed by NASA, and uses no NASA logos.

## Checklist

- [ ] Project page: title, summary (above), challenge "Planet X and SPHEREx", team listed.
- [ ] Public repository link and deployed URL, tested in a fresh browser profile.
- [ ] Demo video link (length and format per the official rules).
- [ ] AI use disclosed (above) if the rules ask for it.
- [ ] NASA data section: SPHEREx DR1 + QR3 via IRSA, collections `spherex_dr1`,
      `spherex_dr1_deep`, `spherex_qr3_deep`.
- [ ] No use of "confirmed", "discovered", or "detected a new…" anywhere (the app, the video,
      the page).
- [ ] `scripts/check.ps1` passes on the submitted commit.
- [ ] Deployed site: no console errors, works at 360 px, keyboard-only walkthrough works,
      reduced motion respected.

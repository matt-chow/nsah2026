# PARALLAX production audit

- **Site:** <https://nsah2026.vercel.app> (deployed commit `dda5efa`)
- **Date:** 2026-11-14
- **Browser:** Chromium 1254 (Playwright-core), fresh profile per run
- **Viewports:** desktop 1440×900; mobile 390×844 (DPR 2, touch); plus a reduced-motion run and an idle/offline run
- **Scope:** read-only. No application code was changed, and nothing was committed, pushed or deployed.

**Outputs**
- `screenshots/`: 58 full-page or viewport PNGs, `desktop-*` and `mobile-*`. Not kept in the repo because they show the pre-v3.1 build. `audit/parallax-contact-sheet.png` keeps 10 of them (7 desktop, 3 mobile, each tile captioned with its filename). The other filenames cited below are no longer in the repo.
- `audit/routes.json`: per-route facts (URL, title, headings, overflow, accessibility counts, timings, bytes) plus the dataset metadata.
- `audit/console-errors.txt`: console, page-error and network-failure log.
- `audit/raw-steps.json`: every scripted step with its result.
- `audit/arcade-rerun.json`: the rerun of Arcade missions 2 and 3 (see the note below).

## Summary

| Area | Result |
|---|---|
| Console errors / warnings / uncaught page errors | **0** across all runs |
| Failed requests or HTTP ≥ 400 | **0** |
| Scripted interaction checks | 96 run (6 Arcade steps counted from the rerun), 94 pass. Both failures are the same expected item, on desktop and mobile: the time-lapse is not deployed. |
| Real SPHEREx data | Both real fields load and draw real pixels. A sampled IRSA source URL returns a genuine FITS file. |
| Horizontal overflow | None on any route, desktop or mobile |
| Unlabelled buttons/inputs, `<img>` without alt | None |
| Idle animation loop | None: 0 `requestAnimationFrame` calls in 2 s idle on the observatory, globe and spacecraft |
| Initial load | DOMContentLoaded 287 ms; 10 requests, 237 kB transferred, 93 kB JS. Each lazy page adds 2–7 kB JS. |

**Note on the Arcade failures in the first run.** Missions 2 and 3 timed out in the first pass. The cause was my script, not the app:
- The script picked the n-th "Start" button.
- After mission 1 is finished, that card's button reads "Play again", so the index pointed at the wrong card.
- I reran both missions with selectors scoped to each card (`arcade2.mjs`). Both pass at both viewports.

## Screenshots of the requested pages

| Page | Desktop | Mobile |
|---|---|---|
| Observatory (intro) | `desktop-01-intro.png` | `mobile-01-intro.png` |
| Observatory: Discover | `desktop-02-…discover.png`, `-03-…step5.png` | same names, `mobile-` |
| Observatory: Explore modes | `desktop-04-observatory-{blink,fade,split,difference}.png` | same |
| Observatory: evidence / Analyze / search | `-05-…evidence`, `-06-…analyze`, `-07-…search` | same |
| Observatory: SEP, simulated, refused pair | `-08-…sep`, `-08-…synthetic`, `-09-…refused` | same |
| Celestial Globe | `desktop-10-globe.png`, `-11-globe-selected.png` | same |
| Spacecraft | `desktop-12-spacecraft.png`, `-13-spacecraft-scan.png` | same |
| Infrared Lab (Spectrum) | `desktop-14-spectrum.png` | `mobile-14-spectrum.png` |
| Discovery Arcade | `-15-arcade-hub` … `-22b-arcade-fair-done` (hub plus all three missions) | same |
| Journal | `desktop-23-journal.png` | `mobile-23-journal.png` |
| Unknown route fallback | `desktop-24-unknown-route.png` | same |

## Routes

All routes are hash routes on the single page, and every one has the document title "PARALLAX" with `lang="en"`.

| URL | h1 | Desktop height | Notes |
|---|---|---|---|
| `/` | "Has the sky changed?" (intro) | 900 | The intro overlay appears only when there is no hash and it is the first visit in the session. |
| `/#nep-d2`, `/#sep-d4`, `/#synthetic-fixture-001` (+ `/cand`) | **none** | 900 | Observatory workspace |
| `/#/sky` | "The sky SPHEREx maps" | 968 | Globe |
| `/#/spacecraft` | "Inside SPHEREx" | 1564 | Schematic plus scan demo |
| `/#/spectrum` | "Colours the eye cannot see" | 933 | Infrared Lab |
| `/#/arcade` | "Discovery Arcade" | 900 | Hub plus three missions |
| `/#/journal` | "Your field notebook" | 1036 | |
| `/#/does-not-exist` | – | – | Falls back to the observatory |

## Datasets verified

- **Index:** `/manifests/index.json`, three fields, all with `schema_version` 1.1.0.
- **Display PNGs:** each HEAD request returns 200 `image/png` at 3.5–16 kB.
- **Source check:**
  - IRSA rejects HEAD requests with 405.
  - A GET of the first NEP source URL returned **200 `application/fits`, 4.73 MB in 3.8 s**, and its header starts with `SIMPLE = T`.

| Field | Kind | Target (ICRS) | Release | Collections | Detector / λ | Obs | Comparisons | Candidates |
|---|---|---|---|---|---|---|---|---|
| `nep-d2` | real | RA 270.0000°, Dec +66.5607°, r 452″ | DR1 + QR3 | spherex_dr1, spherex_dr1_deep, spherex_qr3_deep | D2, 1.4452–1.4478 µm | 10 | 45 compatible | 2 needs follow-up, 38 likely artifact |
| `sep-d4` | real | RA 90.0000°, Dec −66.5607°, r 452″ | DR1 + QR3 | spherex_dr1_deep, spherex_qr3_deep | D4, 2.5577–2.5653 µm | 10 | 45 compatible | 20 needs follow-up, 20 likely artifact |
| `synthetic-fixture-001` | **simulated** | RA 180, Dec 0, r 198″ | – | – | 2.0 / 2.005 / 3.0 µm | 3 | 1 compatible, 2 incompatible | 0 |

**Properties shared by every real observation:**
- Image: 147×147 px at 6.15″/px, in MJy/sr.
- Calibration: `l2b-v27`.
- Time: `mjd_mid` on the UTC scale.
- Provenance: an IRSA IBE cutout URL and a sha256 hash.

**Observation IDs (MJD, release):**
- **nep-d2:**
  - 2025W17_4B_0206_4 (60791.107, DR1)
  - 2025W25_2A_0549_4 (60848.239)
  - 2025W34_1B_0650_3 (60908.428)
  - 2025W41_2B_0471_3 (60959.712)
  - 2025W51_1A_0020_3 (61024.087)
  - 2026W07_1A_0435_3 (61081.866)
  - 2026W10_2B_0350_3 (61106.375, DR1)
  - 2026W23_2A_0025_4 (61195.649, QR3)
  - 2026W31_1B_0475_3 (61250.495)
  - 2026W39_2A_0642_4 (61310.570, QR3)
- **sep-d4:**
  - 2025W40_1A_0475_2 (60949.146, DR1)
  - 2025W45_2A_0348_2
  - 2025W48_2A_0268_3
  - 2025W48_2A_0717_3
  - 2025W49_1A_0388_3
  - 2025W49_2A_0330_2
  - 2025W49_2A_0598_2
  - 2025W49_2A_0732_4 (61016.853, DR1)
  - 2026W40_1A_0347_1 (61312.566, QR3)
  - 2026W40_2A_0128_2 (61315.079, QR3)

  Seven of its ten dates fall within 10 days of each other (MJD 61007–61017), so the time baseline is uneven.

## What works (verified by script)

### Observatory
- **Intro:** the intro shows, and entering it lands on Discover.
- **Real pixels:** the NEP canvas holds real pixels (337 lit samples out of a sparse probe).
- **Discover:** the story steps through all five steps.
- **Explore modes:** Switch dates, Fade, Split and Highlight changes each set `aria-pressed` and update the caption. Play cycles the frames, and Loupe toggles.
- **Timeline:** clicking works, and ←/→ step between dates.
- **Evidence:** selecting a candidate opens the evidence with σ, flux ± error in µJy, and the "UNCONFIRMED" label.
- **Analyze:** shows IRSA, DR1, QR3, MJD, µm and the calibration version.
- **Coordinate search:**
  - A position inside NEP says it is inside that field.
  - M31 (10.68, 41.27) gets a live IRSA lookup: "IRSA lists 362 SPHEREx exposures here (spherex_dr1 226, spherex_qr3 136). No prepared field covers it yet."
- **Other fields:** SEP loads. The synthetic field shows the SIMULATED banner.
- **Refused pair:**
  - Comparing synthetic dates 1 and 3 is refused with the reasons "different detectors (3 vs 4); wavelength offset 50.00% exceeds 1.00%".
  - The view then shows date A alone instead of comparing (success criterion 3).

### Globe
- Dragging rotates it (the RA/Dec readout changes).
- The + button zooms to ×1.6.
- The keys `+`, the arrows and `0` work.
- Field card → detail → "open" link reaches `#nep-d2` with the workspace loaded.

### Spacecraft
- All 5 hotspots select their part: shields, telescope, detectors and filters, bus, solar panel.
- Dragging rotates the model, and the hotspots follow it.
- Zoom and Reset work, and "More detail" expands.
- The scan demo plays to "Pointing 51 of 51 · 102 of 102".

### Infrared Lab
- 102 channel rects.
- The slider is keyboard-operable with `aria-valuetext` (e.g. "Channel 69, 3.836 micrometres, band 5").
- Clicking a channel updates the panel.
- The field link opens the observatory.

### Arcade
1. **The one that appeared:**
   - Two deliberate misses give hint feedback.
   - "Show me" reveals the target.
   - Evaluate and conclude both work.
   - "Save to journal" works.
2. **Glitch or genuine?:** all 6 cases run, ending with the summary "agreed on 4 of 6".
3. **Fair comparison?:**
   - It carries the simulated label.
   - All 3 pairs give correct feedback ("Agreed…", or "Look again" when I deliberately answered "fair" for a refused pair).
- Progress ("Finished 1×") survives a reload.

### Journal
- A bookmark made in the observatory appears in the list, along with the Arcade entry.
- The hypothesis text survives a reload.
- The JSON export downloads `parallax-notebook.json` (2 items).
- "Reopen" returns to `#nep-d2`.

### Reduced motion
- A globe fly-to makes only 2 rAF calls (it jumps instead of animating).
- Discover does not auto-blink.

### Offline
- Going offline after load shows an offline notice.

## Findings

Severity: **H** blocks a success criterion, **M** is a real usability or accessibility problem, **L** is polish.

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| 1 | M | Observatory, a11y | **Timeline date ticks are 6×16 px hit targets** (desktop and mobile), well below the 24×24 WCAG 2.2 minimum. Keyboard ←/→ works, but on touch they are hard to hit. On mobile only the first date label is visible, so the ticks are unlabelled visually. | `routes.json` smallTargets; `mobile-02-observatory-discover.png` |
| 2 | M | Observatory, a11y | **The observatory has no `<h1>`.** Every other page has one, so screen-reader users get no page heading on the main view. | `routes.json` h1=[] for `#nep-d2` |
| 3 | M | Production vs local | **"Play all dates" (time-lapse) is not on production.** It is implemented locally and uncommitted (`web/src/app/App.tsx`), so the deployed app has no play-all animation. | 2 failed steps, "time-lapse present" |
| 4 | L | Spacecraft | The scan demo's y-axis label **"bright" overlaps the 6th filter bar**. | `desktop-12-spacecraft.png` |
| 5 | L | Infrared Lab | **Field triangles overlap the "band 2" / "band 3" labels**, and "band 5 band 6" run together at the right end. | `desktop-14-spectrum.png` |
| 6 | L | Observatory, mobile | **The field select is truncated** ("North Ecliptic Pole, 1.45 um (SPHEREx detecto…") at 390 px. | `mobile-02-observatory-discover.png` |
| 7 | L | Observatory, mobile | **On mobile the evidence and story text sit below the image and timeline** (page height 2619 px). After pressing Next the user has to scroll to see what changed. | `mobile-03-observatory-discover-step5.png` |
| 8 | L | Journal, a11y | **"source 1" archive links are 46×15 px**, and the link text does not say where it goes. | `routes.json` smallTargets |
| 9 | L | Glossary terms | **Inline term buttons ("pixel" 29×20, "infrared" 48×20, "Infrared" 46×18) are below 24 px tall.** Inline text is exempt from the WCAG target rule, so this is advisory only. | `routes.json` |
| 10 | L | Observatory | **The `.showing` caption is `aria-live="polite"` and changes on every blink frame**, so a screen reader announces each flip while Play runs. The local, unreleased time-lapse already mutes this for its own playback, but blink Play is unchanged. | code review + blink test |
| 11 | L | Copy | **Wavelength is written "1.45 um" in field titles** (from the manifest label) but "1.45 µm" everywhere else. Visible in the select, the globe cards, the Journal and the Spectrum link. | screenshots 02, 10, 14, 23 |
| 12 | L | Evidence chart | **On NEP c012 the light curve's y-axis runs 0–883 µJy for one high point**, so the other nine dates are squashed onto the baseline and their error bars are hard to read. | `desktop-04-observatory-difference.png` |
| 13 | L | Globe | **There is an unlabelled dot on the right limb** near the ecliptic (approximately x 830, y 680), and it is unclear what it is. | `desktop-10-globe.png` |
| 14 | info | Data | **sep-d4 has 7 of its 10 dates within 10 days.** That is a short baseline for "changes over time". It is honest, but the UI does not call it out. | dataset table |

**No H-severity findings.** All five success criteria in AGENTS.md hold on production:
1. A real field with ≥2 epochs loads.
2. Every observation shows its source, release, epoch and wavelength.
3. The incompatible pair is refused with reasons.
4. The simulated field is labelled on the observatory, globe and Arcade.
5. The lazy P2+ pages are separate chunks.

## Not checked or limits

- **LCP:** not captured (the PerformanceObserver returned no entry in headless mode). Navigation timings in `routes.json` repeat for later routes because it is one SPA session; only the first load is meaningful.
- **Globe tooltip:** the hover check at the canvas centre found no tooltip after selecting a field. That is inconclusive (the marker may not sit exactly at the centre), so it is not reported as a bug.
- **Coverage:** no real screen reader (only DOM checks), no colour-contrast measurement, no Safari or Firefox, and no slow-network throttling.
- **Wheel zoom:** not exercised (buttons and keys were). Pinch on touch was not exercised either.

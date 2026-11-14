---
name: PARALLAX
description: An open observatory for the changing infrared sky, set as an astronomical telegram.
colors:
  ink: "#0b0d12"
  sky-well: "#07080b"
  rail: "#10141b"
  rail-2: "#161b24"
  hair: "#262d39"
  hair-2: "#343c4b"
  paper: "#e9e4d8"
  paper-dim: "#a8a395"
  paper-faint: "#8a8679"
  signal: "#f2a33a"
  signal-hover: "#f7b558"
  signal-ink: "#1a1206"
  cold: "#609cec"
  alert: "#ef7a6a"
  caution-bg: "#3a2506"
  caution-text: "#ffd8a1"
typography:
  display:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(3rem, 11vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.125rem, 2.2vw, 1.375rem)"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "0.06em"
  stamp:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  none: "0px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button:
    backgroundColor: "{colors.rail-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "34px"
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "{colors.signal-ink}"
  segmented-pressed:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "34px"
  status-stamp:
    textColor: "{colors.signal}"
    typography: "{typography.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  evidence-report:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "14px 16px 16px"
  story-heading:
    textColor: "{colors.paper}"
    typography: "Instrument Serif 400, 2rem/1.1"
    width: "340px"
  banner-simulated:
    backgroundColor: "{colors.caution-bg}"
    textColor: "{colors.caution-text}"
    padding: "8px 16px"
---

# Design System: PARALLAX

## Overview

**Creative North Star: "The Astronomical Telegram"**

PARALLAX reads like a circular bulletin wired from an observatory at night: position, epoch, flux, uncertainty, status. The ground is night ink, the rails are cool graphite, text is warm bulletin paper, and one sodium-amber signal marks what the eye should go to. The sky image is the largest thing on every screen; the chrome around it is hairline-thin and square.

Density is instrument-grade: 15px body, 34px controls, monospace columns for every number. Decoration is absent. Atmosphere comes only from the intro's illustrative starfield, which is labelled as illustration.

**Key Characteristics:**
- Night-ink ground, paper text, one amber signal.
- Every number is mono, tabular, in a fixed column.
- 1px hairlines and square corners everywhere.
- Status is stamped, never celebrated; candidates are always "unconfirmed".
- Meaning never rides on colour alone: shape glyphs, dashes and labels carry it too.

## Colors

A dark observatory palette: cool blue-black surfaces, warm paper type, a single amber accent and a cold blue that exists only as its counterweight in the difference map.

### Primary
- **Sodium Amber** (signal): selection, the primary action, focus rings, the reference-epoch tag, epochs where a residual was detected, the "needs follow-up" stamp, and the positive arm of the difference map. `signal-hover` is its hover step; `signal-ink` is the near-black text set on it.

### Secondary
- **Cold Plate Blue** (cold): the negative arm of the diverging difference scale and its legend ramp only. Never a UI accent.

### Neutral
- **Night Ink** (ink): page ground, inputs, the evidence report.
- **Sky Well** (sky-well): the canvas behind sky imagery, a step darker than ink.
- **Graphite Rail / Rail Raised** (rail, rail-2): top bar and right rail; buttons and hover rows.
- **Hairline / Hairline Strong** (hair, hair-2): dividers and control borders.
- **Bulletin Paper** (paper): primary text; the inverse ground of pressed segments.
- **Paper Dim / Paper Faint** (paper-dim, paper-faint): secondary text; tertiary metadata (timeline years, epoch release tags, placeholders, axis ticks).
- **Alert Coral** (alert): errors only.
- **Caution Umber** (caution-bg, caution-text): the simulated-data banner and incompatibility warnings.

### Named Rules
**The One Signal Rule.** Amber marks exactly one kind of thing: what is selected, actionable or flagged. If two unrelated things are amber, one is wrong.

**The Diverging Pair Rule.** The difference map runs cold blue (negative) through near-black (zero) to amber (positive), with lightness tracking magnitude so it still reads in greyscale; masked pixels are a neutral grey (#34302c). Blue appears nowhere else.

## Typography

**Display / Body Font:** Schibsted Grotesk (400, 600, 800), system-ui fallback
**Data Font:** IBM Plex Mono (400, 500), tabular numerals

**Character:** A sturdy newsroom grotesk for words, a typewriter-plain mono for every coordinate, date, flux and sigma, like a telegram's ephemeris lines.

### Hierarchy
- **Display** (800, clamp 3–6rem, 0.95): the intro title only.
- **Headline** (400, clamp 1.125–1.375rem, 1.45): the intro lede.
- **Title** (600, 0.9375rem): rail and report section heads.
- **Atlas serif** (Instrument Serif 400): the intro title, Discover step headings (2rem) and the change summary head (1.5rem). Words only; never numbers.
- **Body** (400, 15px/1.5): prose, controls.
- **Body small** (0.8125rem): captions, rows, credits; error copy capped at 60ch.
- **Data** (mono, tabular): all measurements, IDs, dates, the viewer caption, the sky readout.
- **Label** (mono, 0.6875rem, uppercase, 0.06em): report row keys (CLASS, POSITION, BAND) in a fixed 5.5rem column.
- **Wordmark** (800, 0.08em tracking): PARALLAX in the top bar.

### Named Rules
**The Ephemeris Rule.** If it is a number with a unit, it is mono, tabular and right-aligned or in a fixed column.

## Layout

The workspace is a full-height column: top bar, optional banner, then a stage grid of the viewer (fluid) and a right rail (320–400px). The viewer stacks mode bar, sky canvas (min 320px), caption line and a time-true timeline. The rail stacks candidate list (max 260px, scrolls), evidence report, collapsible metadata, and credits pinned to the bottom.

Spacing runs on 4/6/8/12/16/20/24px; panels pad 12–16px, rail sections gap 20px. Below 900px the stage collapses to one column, the canvas takes 62vh, the rail moves under a top hairline, and only the selected epoch keeps its timeline label.

## Elevation & Depth

Flat. Depth comes from tonal steps (sky-well < ink < rail < rail-2) and hairlines. Soft shadows appear only on floating overlays that sit above the workspace.

### Shadow Vocabulary
- **Overlay lift** (`box-shadow: 0 12px 32px rgba(0,0,0,0.5)`; popovers `0 16px 40px rgba(0,0,0,0.55)`): the keys dialog and glossary popovers.

### Named Rules
**The Flat Instrument Rule.** Panels at rest have no shadow. Only something floating over the workspace earns one.

## Shapes

Square corners throughout (0 radius); the loading spinner is the only circle. Borders are 1px hairlines; report sections divide with 1px dashed hair-2 rules; the status stamp uses a 1.5px currentColor border. Adjacent buttons in segmented groups and zoom stacks overlap by 1px so they share one rule.

## Components

### Buttons
- **Shape:** square, 34px tall (44px on the intro).
- **Default:** rail-2 fill, hair-2 border, paper text; hover lifts the border to paper-dim (150ms ease-out).
- **Primary:** amber fill, signal-ink text, weight 600.
- **Link:** no box, underlined in amber with 3px offset.
- **Focus:** 2px amber outline, 2px offset, on everything.

### Segmented control
Joined square buttons; the pressed one inverts to paper fill with ink text. Used for view mode (Switch dates / Fade / Split / Highlight changes) and candidate filter. The Discover / Explore / Analyze tabs use the same frame with an amber underline on the current mode.

### Inputs / Fields
Ink fill, hair-2 border, square, amber caret, paper-faint placeholder. Errors render below in alert coral, inside an `aria-live` line.

### Candidate list
Full-width rows on a hairline grid: shape glyph, mono ID, class, mono sigma, mono date. Selected row gets rail-2 fill, a 1px inset amber rule and an amber glyph.

### Evidence report (signature)
The telegram block: ink panel with a hair-2 border, mono ID head, a stamped status line ("NEEDS FOLLOW-UP · UNCONFIRMED"), fixed-column label/value rows, a light curve, a measurement table, and dashed rules between sections. Non-follow-up statuses stamp in paper-dim.

### Sky canvas markers
Stroked shape glyphs per candidate kind (square variable-like, circle new-source-like, diamond dipole-like, cross otherwise). Off-epoch markers are dashed paper at 45%; on-epoch solid at 95%; the selected one is amber over an ink halo with four reticle ticks.

### Timeline
Epochs placed on true time along a hair-2 rule: 2px paper-dim stems, the active one 4px paper; epochs with a detection get an amber stem and an 8px amber square above.

### Discover story
A numbered step list (the current number filled amber), a mono "STEP n OF 5" kicker, a serif heading and short paragraphs; Back / Next below. Entering a step fades the body up 6px over 420ms (none under reduced motion).

### Glossary term
Dotted amber underline on the word; a native popover card (rail-2, amber left rule) anchored below it.

## Do's and Don'ts

### Do:
- **Do** set every coordinate, date, flux and sigma in IBM Plex Mono with tabular numerals.
- **Do** keep amber for selection, primary action, focus and flagged residuals only.
- **Do** pair every colour-coded state with a shape, dash or text label.
- **Do** stamp candidate status with "unconfirmed" and keep it typographic, not iconic.
- **Do** label simulated data with the caution-umber banner on every screen it appears.
- **Do** keep corners square and rules 1px.

### Don't:
- **Don't** use blue as a UI accent; it belongs to the negative arm of the difference map.
- **Don't** put shadows on resting panels.
- **Don't** add celebratory or "discovery" treatments to candidates.
- **Don't** set measurements in the proportional grotesk.

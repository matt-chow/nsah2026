# Frontend experience

The observatory has three layers: shared global navigation, the observation workspace,
and a collapsible contextual inspector. Discover, Explore and Analyze share the selected
field, date, reference and candidate. On smaller screens the inspector follows the image
instead of covering it. The same navigation and design tokens apply to the learning pages.

Discover introduces one observation task per chapter. Explore keeps comparison controls
beside the image; stretch and loupe live under Display, while Change field includes the
prepared-field picker and coordinate search. Analyze adds comparison checks and progressively
reveals calibration, measurements, caveats and observation provenance. Warnings remain in
the workspace even when the inspector is closed.

The timeline's ruler uses true chronological spacing, linked to separated touch-sized date
buttons. Set A/Set B choose which input a date button changes. Both input dates, selected-lead
dates and pipeline-refused/unverified pairs have text/shape indicators. A combined reference
is not assigned a fabricated date. In change-map mode the pipeline reference stays fixed;
Set B is disabled and timeline tooltips describe the published change-map status.

Candidate selection pauses playback, shows a flagged date and centres the selected spot.
Changing story steps stops timeline playback before applying the chapter view. All leads
remain unconfirmed. Fullscreen is native and exits with Escape; unsupported browsers show
a message. Light-curve measurements also have a keyboard-accessible date list.

`src/styles/observatory.css` holds the shared visual tokens and observatory layout. Existing
Canvas drawing, scientific measurements, compatibility decisions, calibration and provenance
remain pipeline-owned. No generated concept imagery is used as observation data.

Use Node 24 and run `npm ci`, then `npm run check` and `npm run dev`. The existing Node test
runner also checks rendered timeline labels, refusal reasons and progressive disclosure;
the TypeScript dev dependency supplies JSX transformation for those component checks.

Manually verify Discover → Explore → select a lead → Analyze at desktop, tablet, 360px and
390px widths. Include keyboard-only and reduced-motion use, inspector collapse, fullscreen,
A/B timeline selection, every comparison mode, the simulated fixture's refused comparison,
and real fields with validated and visualization-only change maps.

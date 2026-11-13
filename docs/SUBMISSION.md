# Submission checklist

Confirm the official requirements on the Space Apps 2026 site before the deadline. This list is
our own, not the official one.

## Requirements
- [ ] Project page: title, summary, challenge selected ("Planet X and SPHEREx").
- [ ] Public repository link and deployed static URL (tested in a fresh browser profile).
- [ ] Demo video (length/format per official rules), public or unlisted link.
- [ ] Team members listed. Use of AI tools disclosed if the rules require it.
- [ ] NASA data and resources section completed.

## NASA resource attribution
- [ ] SPHEREx data credited, using IRSA's requested acknowledgement text for SPHEREx (copy it
      verbatim from the IRSA SPHEREx pages) and the release label used.
- [ ] Every displayed observation links to its IRSA source (`provenance.source_url`).
- [ ] Other services credited where used (IRSA cutout service, JPL Horizons, MPC, Gaia, AllWISE).
- [ ] "Not affiliated with or endorsed by NASA" remains in the footer. No NASA logos.

## Demo video
- [ ] States the problem and who it helps within the first 20 s.
- [ ] Shows a real SPHEREx field: coordinate entry → epochs → blink → metadata → provenance.
- [ ] Shows an incompatible pair being refused with reasons (scientific honesty is a feature).
- [ ] If candidates are shown, says clearly that they are *unconfirmed* and explains the evidence.
- [ ] Any simulated data is labelled on screen and in narration.

## Scientific claims checklist (each must be true)
- [ ] No claim of discovering a planet, Planet X, or any new object.
- [ ] "Candidate" always means unconfirmed. No use of "confirmed", "discovered", or "detected a new…".
- [ ] Visualizations (stretched PNGs) are not described as measurements.
- [ ] Every number shown has units and, where applicable, an uncertainty or "not available".
- [ ] Limitations below appear in the README and the video description.

## Reproducibility
- [ ] `docs/DEVELOPMENT.md` setup works from a fresh clone on Windows.
- [ ] Each manifest's `generated_by.command` and `provenance.processing` regenerate its products.
- [ ] Release labels, collections, and retrieval dates recorded in manifests.
- [ ] `scripts/check.ps1` passes on the submitted commit.

## Known limitations (update before submission)
- Coverage is limited to the preprocessed fields. There is no live archive search in the browser.
- No PSF matching, so difference images contain residuals around stars.
- Compatibility tolerances are assumptions (docs/SCIENCE.md §Assumptions).

## Deployment verification
- [ ] `npm run build` succeeds; `web/dist` is within the size budget.
- [ ] Deployed site loads manifests and images (no 404s in the console) under its sub-path.
- [ ] Works on Chrome and Firefox, and at 360 px width.
- [ ] Lighthouse accessibility ≥ 90; reduced-motion respected.

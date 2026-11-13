# PARALLAX

**An Open Observatory for the Changing Infrared Sky.** NASA Space Apps Challenge 2026,
[Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/).

PARALLAX is a static web app for exploring NASA SPHEREx observations of a sky region across
epochs. You can blink compatible observations, inspect metadata and provenance, and, in later
phases, review candidate changes with transparent evidence. It does not claim discoveries.
Candidates are unconfirmed by definition.

> **Status: bootstrap.** The app currently shows only a **simulated** fixture. Real SPHEREx data
> retrieval is Phase 1 (see `docs/ROADMAP.md`).

## Quick start (Windows PowerShell)

```powershell
./scripts/setup.ps1
cd web; npm run dev        # http://localhost:5173
./scripts/check.ps1        # all checks
```

## Layout

| Path | What |
|---|---|
| `AGENTS.md` | Engineering rules (canonical). `CLAUDE.md` imports it. |
| `docs/` | Architecture, science, data contract, development, risks, roadmap, submission |
| `science/` | Python pipeline (`parallax` CLI): contract models, validation, fixture |
| `web/` | React + TypeScript + Vite viewer |
| `data/` | Published manifests and assets (size-budgeted) |
| `scripts/` | `setup.ps1`, `check.ps1` |

## Data and attribution

Real observations will come from NASA SPHEREx via NASA/IPAC IRSA, credited per IRSA's
guidelines. Files under `data/fixtures/` are synthetic and are not SPHEREx data. This project
is not affiliated with or endorsed by NASA.

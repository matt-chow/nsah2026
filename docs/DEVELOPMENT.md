# Development

## Prerequisites (Windows 10/11)

| Tool | Version | Install |
|---|---|---|
| Git | any recent | <https://git-scm.com> |
| Node.js | 22 LTS or newer (developed on 24) | <https://nodejs.org> |
| uv | 0.5+ | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |

A system Python is not needed: `uv` downloads Python 3.12 into its own store
(`science/.python-version`).

## Setup (PowerShell)

```powershell
git clone https://github.com/matt-chow/nsah2026.git
cd nsah2026
./scripts/setup.ps1          # uv sync (science) + npm ci (web)
```

If scripts are blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or run once with
`powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`.

## Run

```powershell
cd web
npm run dev                  # http://localhost:5173, serves data/ as static files
npm run build; npm run preview   # production build in web/dist, preview at :4173
```

## Checks

```powershell
./scripts/check.ps1          # everything below plus data size budget and secret scan

# web/
npm run typecheck; npm run lint; npm run format:check; npm test; npm run build
# science/
uv run ruff check .; uv run ruff format --check .; uv run pytest
uv run parallax validate ../data/manifests/synthetic-fixture.json
```

To auto-format, run `npm run format` (web) and `uv run ruff format .` (science).

## Python pipeline

```powershell
cd science
uv run parallax --help
uv run parallax schema        # after any models.py change
uv run parallax make-fixture  # regenerate the SIMULATED fixture (deterministic)
uv run parallax validate <manifest.json>
```

## Data preprocessing workflow (Phase 1 onward)

1. Choose a field and record why (coverage, compatible epochs).
2. Query IRSA (SIA2) through the archive adapter. Download **cutouts only** into `.cache/parallax/`.
3. Validate WCS, flags, spectral WCS, calibration version, and epoch, then compute comparisons.
4. Write science FITS (original HDUs) and display PNGs to `data/processed/<field>/` and the
   manifest to `data/manifests/<field>.json`.
5. `uv run parallax validate data/manifests/<field>.json`, then `./scripts/check.ps1`.
6. Point the web app at the manifest (currently `MANIFEST_URL` in `web/src/app/App.tsx`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `python` opens the Microsoft Store | Ignore it and use `uv run …`. Or disable the alias under Settings → Apps → Advanced app settings → App execution aliases. |
| `uv sync` cannot find Python 3.12 | `uv python install 3.12` |
| `npm ci` fails with a lockfile mismatch | Run `npm install` once and commit the updated `package-lock.json` (only when asked to commit). |
| `test_committed_schema_is_current` fails | `uv run parallax schema` |
| `test_committed_fixture_matches_generator` fails | `uv run parallax make-fixture`, then review the diff |
| UI says "could not load manifest (404)" | Start Vite from `web/`, since `publicDir` is `../data` |
| CRLF diffs in git | `.gitattributes` normalises to LF. Run `git add --renormalize .` |
| Long-path errors in node_modules | `git config --global core.longpaths true` |
| IRSA timeouts | Lower `RequestLimits.max_results` or cutout size and retry later. Cached cutouts are reused. |

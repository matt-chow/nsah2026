# One-time setup: Python env (uv) + web dependencies. Safe to re-run.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv not found. Install: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm not found. Install Node.js 22+ LTS from https://nodejs.org'
}

Push-Location "$root/science"
try { uv sync } finally { Pop-Location }

Push-Location "$root/web"
try { npm ci } finally { Pop-Location }

Write-Host 'Setup complete. Start the viewer with: cd web; npm run dev'

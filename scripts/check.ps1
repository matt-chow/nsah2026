# Full local verification. Exit code is non-zero if anything fails.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failed = @()

function Step($name, [scriptblock]$block) {
  Write-Host "==> $name"
  & $block
  if ($LASTEXITCODE -ne 0) { $script:failed += $name }
}

Push-Location "$root/science"
try {
  Step 'ruff lint' { uv run ruff check . }
  Step 'ruff format' { uv run ruff format --check . }
  Step 'pytest' { uv run pytest }
  Get-ChildItem ../data/manifests/*.json -Exclude manifest.schema.json, index.json | ForEach-Object {
    $m = $_.FullName
    Step "validate $($_.Name)" { uv run parallax validate $m }
  }
} finally { Pop-Location }

Push-Location "$root/web"
try { Step 'web check (types, lint, format, tests, build)' { npm run check } } finally { Pop-Location }

Step 'api tests' { uv run --no-project --with fastapi --with httpx --with pytest pytest -q "$root/api/_test_sia.py" }
Step 'flipbook api self-checks' { uv run --no-project python "$root/api/_test_spherex.py" }
Step 'atlas api tests' { node --test "$root/api/*.test.mjs" }

Write-Host '==> data size budget (25 MB total, 5 MB per file)'
$files = Get-ChildItem "$root/data" -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum / 1MB
$big = $files | Where-Object { $_.Length -gt 5MB }
if ($total -gt 25 -or $big) { $failed += 'data size'; $big | ForEach-Object { Write-Host "  too large: $($_.FullName)" } }
Write-Host ("  data/ = {0:N2} MB" -f $total)

Write-Host '==> secret scan (tracked + untracked, excluding ignored)'
$hits = git -C $root grep -nIE --untracked '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20,})' -- ':!*.lock' ':!*package-lock.json'
if ($hits) { $failed += 'secret scan'; $hits }

if ($failed.Count) { Write-Host "FAILED: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed.' -ForegroundColor Green
exit 0 # git grep exits 1 when it finds nothing

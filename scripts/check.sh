#!/bin/sh
# Full local verification (Linux/macOS twin of check.ps1). Exit code is non-zero if anything fails.
root=$(cd "$(dirname "$0")/.." && pwd)
failed=""

step() {
  name=$1
  shift
  echo "==> $name"
  "$@" || failed="$failed${failed:+, }$name"
}

cd "$root/science" || exit 1
step 'ruff lint' uv run ruff check .
step 'ruff format' uv run ruff format --check .
step 'pytest' uv run pytest
for m in ../data/manifests/*.json; do
  case "${m##*/}" in manifest.schema.json | index.json) continue ;; esac
  step "validate ${m##*/}" uv run parallax validate "$m"
done

cd "$root/web" || exit 1
step 'web check (types, lint, format, tests, build)' npm run check

step 'api tests' uv run --no-project --with fastapi --with httpx --with pytest pytest -q "$root"/api/_test_sia.py
step 'flipbook api self-checks' python3 "$root"/api/_test_spherex.py

echo '==> data size budget (25 MB total, 5 MB per file)'
big=$(find "$root/data" -type f -size +5M)
total=$(find "$root/data" -type f -exec cat {} + | wc -c)
if [ -n "$big" ] || [ "$total" -gt $((25 * 1024 * 1024)) ]; then
  failed="$failed${failed:+, }data size"
  for f in $big; do echo "  too large: $f"; done
fi
awk -v b="$total" 'BEGIN { printf "  data/ = %.2f MB\n", b / 1048576 }'

echo '==> secret scan (tracked + untracked, excluding ignored)'
if git -C "$root" grep -nIE --untracked \
  '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20,})' \
  -- ':!*.lock' ':!*package-lock.json'; then
  failed="$failed${failed:+, }secret scan"
fi

if [ -n "$failed" ]; then
  printf '\033[31mFAILED: %s\033[0m\n' "$failed"
  exit 1
fi
printf '\033[32mAll checks passed.\033[0m\n'

#!/usr/bin/env bash
# test-local-first.sh — Pre-flight checks for local development.
#
# Usage:
#   bash scripts/test-local-first.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Use printf for separator lines (not JS .repeat())
SEP='=================================================='

pass=0
fail=0

check() {
  local name="$1"
  shift
  echo -n "  $name... "
  if "$@" > /tmp/test-local-$$ 2>&1; then
    echo "PASS"
    pass=$((pass + 1))
  else
    echo "FAIL"
    cat /tmp/test-local-$$ | head -5
    fail=$((fail + 1))
  fi
  rm -f /tmp/test-local-$$
}

echo "$SEP"
echo "  Local-First Pre-flight Checks"
echo "$SEP"
echo ""

# 1. Shell syntax checks
echo "1. Shell script syntax"
check "dev.sh" bash -n dev.sh
check "setup.sh" bash -n setup.sh
check "scripts/safe-migrate.sh" bash -n scripts/safe-migrate.sh
echo ""

# 2. .env file exists
echo "2. Environment file"
if [ -f ".env" ]; then
  echo "  .env exists... PASS"
  pass=$((pass + 1))
  if grep -q "^DATABASE_URL=" .env; then
    echo "  DATABASE_URL set... PASS"
    pass=$((pass + 1))
  else
    echo "  DATABASE_URL set... FAIL"
    fail=$((fail + 1))
  fi
  if grep -q "^JWT_SECRET=" .env; then
    echo "  JWT_SECRET set... PASS"
    pass=$((pass + 1))
  else
    echo "  JWT_SECRET set... FAIL"
    fail=$((fail + 1))
  fi
else
  echo "  .env exists... FAIL (run setup first)"
  fail=$((fail + 1))
fi
echo ""

# 3. No hardcoded absolute paths (ignore comments)
echo "3. Portable paths (no /home/z/my-project)"
# Only check non-comment lines for hardcoded paths
HARDCODED=$(grep -nE '^[[:space:]]*[^#].*/home/z/my-project' \
  dev.sh setup.sh scripts/safe-migrate.sh scripts/install.ps1 \
  scripts/backup-db.ts scripts/restore-db.ts 2>/dev/null || true)
if [ -z "$HARDCODED" ]; then
  echo "  No hardcoded paths... PASS"
  pass=$((pass + 1))
else
  echo "  Hardcoded paths found:"
  echo "$HARDCODED" | head -3
  echo "  ... FAIL"
  fail=$((fail + 1))
fi
echo ""

# 4. i18n check
echo "4. Translation coverage"
if command -v bun >/dev/null 2>&1; then
  check "i18n check" bun run scripts/check-i18n.ts
else
  echo "  (skipped - bun not found)"
fi
echo ""

# 5. Prisma schema validation
echo "5. Prisma schema"
if command -v bunx >/dev/null 2>&1 || command -v npx >/dev/null 2>&1; then
  PKG="bunx"
  command -v bunx >/dev/null 2>&1 || PKG="npx"
  check "prisma validate" "$PKG" prisma validate
else
  echo "  (skipped - no bunx/npx)"
fi
echo ""

# 6. Lockfile exists
echo "6. Lockfile"
if [ -f "bun.lock" ] || [ -f "bun.lockb" ] || [ -f "package-lock.json" ]; then
  echo "  Lockfile present... PASS"
  pass=$((pass + 1))
else
  echo "  Lockfile missing... FAIL"
  fail=$((fail + 1))
fi
echo ""

# Summary
echo "$SEP"
echo "  Results: $pass passed, $fail failed"
echo "$SEP"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0

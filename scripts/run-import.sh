#!/bin/bash
# scripts/run-import.sh — wrapper to load .env before running tsx scripts
# Usage: ./scripts/run-import.sh scripts/test-batch-helper.ts
#        ./scripts/run-import.sh scripts/import-production-batch.ts --only=meter

set -e

# Find project root (where .env lives).
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env (override shell env that may have SQLite URL).
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

exec bunx tsx "$@"

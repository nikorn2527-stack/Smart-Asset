#!/usr/bin/env bash
# dev.sh — loads .env then starts dev server
# P0-01 fix: use portable path resolution instead of hardcoded /home/z/my-project
set -Eeuo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

set -a
source .env
set +a
exec bun run dev

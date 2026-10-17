#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f /workspace/.itam/development.env ]; then
  echo 'Run bash scripts/setup-smart-asset.sh first.' >&2
  exit 1
fi
set -a
. /workspace/.itam/development.env
set +a
exec node --max-old-space-size=4096 node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port "${SMART_ASSET_PORT:-3000}"

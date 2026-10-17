#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export HOST=127.0.0.1
export PORT="${SMART_ASSET_PORT:-8000}"
export ASSET_DB_PATH=/workspace/.govasset/smart-asset-demo.sqlite3
export PYTHONUNBUFFERED=1
exec /workspace/.venvs/govasset/bin/python server.py

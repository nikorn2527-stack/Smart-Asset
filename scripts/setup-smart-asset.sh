#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ is required"'
if [ ! -x /workspace/.venvs/govasset/bin/python ]; then
  python3 -m venv /workspace/.venvs/govasset
fi
export PIP_CACHE_DIR=/workspace/.cache/pip
/workspace/.venvs/govasset/bin/python -m pip install --disable-pip-version-check -r requirements.txt
/workspace/.venvs/govasset/bin/python -m pip check
mkdir -p /workspace/.govasset

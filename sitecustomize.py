"""Ensure project .venv/Lib/site-packages is importable when running system Python."""
import sys
from pathlib import Path

_venv_site = Path(__file__).resolve().parent / ".venv" / "Lib" / "site-packages"
if _venv_site.is_dir():
    _venv_str = str(_venv_site)
    if _venv_str not in sys.path:
        sys.path.insert(0, _venv_str)

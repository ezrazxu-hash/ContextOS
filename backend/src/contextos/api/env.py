from __future__ import annotations

import os
from pathlib import Path


def load_backend_env(path: Path | None = None) -> None:
    env_path = path or _default_env_path()
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def _default_env_path() -> Path:
    return Path(__file__).resolve().parents[3] / ".env"

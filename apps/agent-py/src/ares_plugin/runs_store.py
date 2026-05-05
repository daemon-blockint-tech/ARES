"""Scan run status files under ``<repo>/.asst/runs/{run_id}.json``."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


def _path(repo_root: str, run_id: str) -> Path:
    root = Path(repo_root).resolve()
    d = root / ".asst" / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{run_id}.json"


def write_run(repo_root: str, run_id: str, fields: dict[str, Any]) -> None:
    p = _path(repo_root, run_id)
    data: dict[str, Any] = {
        "run_id": run_id,
        "repo_root": str(Path(repo_root).resolve()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    data.update(fields)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def read_run(repo_root: str, run_id: str) -> dict[str, Any] | None:
    p = _path(repo_root, run_id)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

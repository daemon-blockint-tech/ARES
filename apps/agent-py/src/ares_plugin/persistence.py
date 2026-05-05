"""Lightweight chat history persistence (JSONL under ``.asst/``)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class JsonlPersistence:
    def __init__(self, repo_root: str) -> None:
        self.repo_root = Path(repo_root)
        self.path = self.repo_root / ".asst" / "chat-history.jsonl"

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    async def add_history(self, role: str, content: str) -> None:
        await self.init()
        row = {
            "role": role,
            "content": content,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    async def get_history(self, limit: int) -> list[dict[str, Any]]:
        await self.init()
        lines = self.path.read_text(encoding="utf-8").splitlines()
        rows = [json.loads(line) for line in lines if line.strip()]
        rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return rows[:limit]

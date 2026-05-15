from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class MemoryItem:
    role: str
    content: str
    created_at: str

    def compact(self, max_chars: int = 240) -> str:
        text = re.sub(r"\s+", " ", self.content).strip()
        if len(text) > max_chars:
            text = text[: max_chars - 3] + "..."
        return f"{self.role}: {text}"


class LocalMemory:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    def add(self, role: str, content: str) -> None:
        if not self.path or not content.strip():
            return
        item = MemoryItem(
            role=role,
            content=content.strip(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item.__dict__, sort_keys=True) + "\n")

    def search(self, query: str, limit: int = 5) -> list[str]:
        if not self.path or not self.path.exists():
            return []
        terms = {term.lower() for term in re.findall(r"[a-zA-Z0-9_]{3,}", query)}
        scored: list[tuple[int, int, MemoryItem]] = []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            try:
                raw = json.loads(line)
                item = MemoryItem(**raw)
            except (TypeError, json.JSONDecodeError):
                continue
            haystack = item.content.lower()
            score = sum(1 for term in terms if term in haystack)
            if score:
                scored.append((score, index, item))
        scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return [item.compact() for _, _, item in scored[:limit]]


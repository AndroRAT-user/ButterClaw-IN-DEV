from __future__ import annotations

import re
from pathlib import Path


class SkillLoader:
    def __init__(self, skills_dir: Path | None, max_chars: int = 4000) -> None:
        self.skills_dir = skills_dir
        self.max_chars = max_chars

    def relevant_to(self, query: str, limit: int = 3) -> list[str]:
        if not self.skills_dir or not self.skills_dir.exists():
            return []
        terms = {term.lower() for term in re.findall(r"[a-zA-Z0-9_]{3,}", query)}
        scored: list[tuple[int, str, Path]] = []
        for path in self.skills_dir.glob("*.md"):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            haystack = f"{path.stem}\n{text}".lower()
            score = sum(1 for term in terms if term in haystack)
            if score:
                scored.append((score, path.name, path))
        scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
        skills: list[str] = []
        for _, _, path in scored[:limit]:
            text = path.read_text(encoding="utf-8").strip()
            if len(text) > self.max_chars:
                text = text[: self.max_chars - 3] + "..."
            skills.append(f"# Skill: {path.stem}\n{text}")
        return skills


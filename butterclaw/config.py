from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


def default_config_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "butterclaw"
    return Path.home() / ".config" / "butterclaw"


def config_path() -> Path:
    return default_config_dir() / "config.json"


@dataclass
class ButterclawConfig:
    provider: str = "mock"
    model: str = "mock-cheap"
    base_url: str | None = None
    api_key_env: str = "BUTTERCLAW_API_KEY"
    workspace: Path = Path.cwd()
    config_dir: Path = default_config_dir()
    max_steps: int = 6
    max_context_chars: int = 12_000
    max_skill_chars: int = 4_000
    memory_items: int = 5
    daily_budget_usd: float = 0.25
    prompt_usd_per_million: float = 0.15
    completion_usd_per_million: float = 0.60
    shell_mode: str = "deny"
    allow_outside_workspace: bool = False
    cheap_mode: bool = True
    request_timeout_seconds: int = 60
    shell_timeout_seconds: int = 20
    skills_dir: Path | None = None
    memory_path: Path | None = None

    def __post_init__(self) -> None:
        self.workspace = Path(self.workspace).resolve()
        self.config_dir = Path(self.config_dir).resolve()
        if self.skills_dir is None:
            self.skills_dir = self.config_dir / "skills"
        else:
            self.skills_dir = Path(self.skills_dir).resolve()
        if self.memory_path is None:
            self.memory_path = self.config_dir / "memory.jsonl"
        else:
            self.memory_path = Path(self.memory_path).resolve()

    def to_jsonable(self) -> dict[str, Any]:
        data = asdict(self)
        for key in ["workspace", "config_dir", "skills_dir", "memory_path"]:
            value = data.get(key)
            if value is not None:
                data[key] = str(value)
        return data


def load_config(path: Path | None = None) -> ButterclawConfig:
    path = path or config_path()
    if not path.exists():
        return ButterclawConfig()
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ["workspace", "config_dir", "skills_dir", "memory_path"]:
        if data.get(key):
            data[key] = Path(data[key])
    return ButterclawConfig(**data)


def save_config(config: ButterclawConfig, path: Path | None = None) -> None:
    path = path or config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config.to_jsonable(), indent=2, sort_keys=True), encoding="utf-8")


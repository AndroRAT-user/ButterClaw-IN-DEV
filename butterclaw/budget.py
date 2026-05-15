from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from butterclaw.config import ButterclawConfig
from butterclaw.providers import Message, ProviderResponse, estimate_tokens


class BudgetLimitExceeded(RuntimeError):
    pass


@dataclass
class BudgetTracker:
    usage_path: Path
    daily_budget_usd: float
    prompt_usd_per_million: float = 0.15
    completion_usd_per_million: float = 0.60
    free: bool = False

    @classmethod
    def from_config(cls, config: ButterclawConfig) -> "BudgetTracker":
        usage_dir = config.config_dir
        usage_dir.mkdir(parents=True, exist_ok=True)
        usage_path = usage_dir / f"usage-{date.today().isoformat()}.json"
        return cls(
            usage_path=usage_path,
            daily_budget_usd=config.daily_budget_usd,
            prompt_usd_per_million=config.prompt_usd_per_million,
            completion_usd_per_million=config.completion_usd_per_million,
            free=config.provider in {"mock", "ollama"},
        )

    def ensure_request_allowed(self, messages: list[Message]) -> None:
        if self.free:
            return
        projected = self.current_spend_usd() + self.estimate_messages_cost(messages)
        if projected > self.daily_budget_usd:
            raise BudgetLimitExceeded(
                f"Daily budget would be exceeded: ${projected:.4f} > ${self.daily_budget_usd:.4f}"
            )

    def estimate_messages_cost(self, messages: list[Message]) -> float:
        tokens = estimate_tokens("\n".join(message["content"] for message in messages))
        return tokens * self.prompt_usd_per_million / 1_000_000

    def record(self, response: ProviderResponse) -> float:
        if self.free:
            return 0.0
        prompt_tokens = response.prompt_tokens or 0
        completion_tokens = response.completion_tokens or estimate_tokens(response.content)
        cost = (
            prompt_tokens * self.prompt_usd_per_million / 1_000_000
            + completion_tokens * self.completion_usd_per_million / 1_000_000
        )
        data = self._read()
        data["requests"] = int(data.get("requests", 0)) + 1
        data["prompt_tokens"] = int(data.get("prompt_tokens", 0)) + prompt_tokens
        data["completion_tokens"] = int(data.get("completion_tokens", 0)) + completion_tokens
        data["spent_usd"] = float(data.get("spent_usd", 0.0)) + cost
        self.usage_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
        return cost

    def current_spend_usd(self) -> float:
        return float(self._read().get("spent_usd", 0.0))

    def _read(self) -> dict[str, object]:
        if not self.usage_path.exists():
            return {}
        try:
            return json.loads(self.usage_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}


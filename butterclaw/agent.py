from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from butterclaw.budget import BudgetLimitExceeded, BudgetTracker
from butterclaw.config import ButterclawConfig
from butterclaw.memory import LocalMemory
from butterclaw.providers import Message, Provider, ProviderResponse, build_provider
from butterclaw.skills import SkillLoader
from butterclaw.tools import ToolRegistry, build_default_registry


@dataclass
class AgentRun:
    answer: str
    steps: int
    spent_usd: float


class ButterclawAgent:
    """Small agent loop that works with plain chat-completion providers."""

    def __init__(
        self,
        config: ButterclawConfig,
        provider: Provider | None = None,
        registry: ToolRegistry | None = None,
        memory: LocalMemory | None = None,
        budget: BudgetTracker | None = None,
    ) -> None:
        self.config = config
        self.provider = provider or build_provider(config)
        self.registry = registry or build_default_registry(config)
        self.memory = memory or LocalMemory(config.memory_path)
        self.budget = budget or BudgetTracker.from_config(config)
        self.skills = SkillLoader(config.skills_dir, max_chars=config.max_skill_chars)

    def run(self, user_input: str) -> AgentRun:
        messages = self._build_messages(user_input)
        spent = 0.0

        for step in range(1, self.config.max_steps + 1):
            self.budget.ensure_request_allowed(messages)
            response = self.provider.complete(messages)
            spent += self.budget.record(response)

            tool_call = parse_tool_call(response.content)
            if tool_call is None:
                self.memory.add("user", user_input)
                self.memory.add("assistant", response.content)
                return AgentRun(answer=response.content, steps=step, spent_usd=spent)

            tool_name = str(tool_call.get("tool") or tool_call.get("name") or "")
            args = tool_call.get("args") or {}
            if not isinstance(args, dict):
                args = {}

            result = self.registry.call(tool_name, args)
            messages.append({"role": "assistant", "content": response.content})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Tool result for {tool_name}:\n{result.to_text()}\n\n"
                        "Continue. If the task is complete, answer in plain text."
                    ),
                }
            )
            messages = trim_messages(messages, self.config.max_context_chars)

        fallback = (
            "I reached the configured step limit before finishing. "
            "Try raising --max-steps or splitting the task into smaller pieces."
        )
        self.memory.add("user", user_input)
        self.memory.add("assistant", fallback)
        return AgentRun(answer=fallback, steps=self.config.max_steps, spent_usd=spent)

    def _build_messages(self, user_input: str) -> list[Message]:
        relevant_memory = self.memory.search(user_input, limit=self.config.memory_items)
        relevant_skills = self.skills.relevant_to(user_input)
        system = build_system_prompt(self.registry, relevant_memory, relevant_skills)
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user_input},
        ]


def build_system_prompt(
    registry: ToolRegistry,
    memory_items: list[str],
    skills: list[str],
) -> str:
    tool_docs = registry.describe()
    memory_block = "\n".join(f"- {item}" for item in memory_items) or "- No relevant memory yet."
    skills_block = "\n\n".join(skills) or "No relevant skills loaded."
    return f"""You are Butterclaw, a lightweight local-first agent for budget users.

Use short, direct reasoning. Prefer cheap actions. Do not ask for expensive or
unbounded work when a smaller step will solve the user's problem.

Available tools:
{tool_docs}

To use a tool, respond with one JSON object and nothing else:
{{"tool": "tool_name", "args": {{"key": "value"}}}}

For normal answers, respond in plain text. Do not wrap final answers in JSON.

Relevant memory:
{memory_block}

Relevant skills:
{skills_block}
"""


def parse_tool_call(content: str) -> dict[str, Any] | None:
    text = content.strip()
    if not text:
        return None

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    elif not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        text = text[start : end + 1]

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None
    if "tool" in payload or "name" in payload:
        return payload
    return None


def trim_messages(messages: list[Message], max_chars: int) -> list[Message]:
    total = sum(len(message["content"]) for message in messages)
    if total <= max_chars:
        return messages

    trimmed = [messages[0]]
    running = len(messages[0]["content"])
    for message in reversed(messages[1:]):
        size = len(message["content"])
        if running + size > max_chars:
            continue
        trimmed.insert(1, message)
        running += size
    return trimmed


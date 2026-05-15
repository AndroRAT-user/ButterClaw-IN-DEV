from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol, TypedDict

from butterclaw.config import ButterclawConfig


class Message(TypedDict):
    role: str
    content: str


@dataclass
class ProviderResponse:
    content: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    raw: dict[str, object] | None = None


class Provider(Protocol):
    def complete(self, messages: list[Message]) -> ProviderResponse:
        ...


class ProviderError(RuntimeError):
    pass


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def build_provider(config: ButterclawConfig) -> Provider:
    if config.provider == "mock":
        return MockProvider()
    if config.provider == "ollama":
        return OllamaProvider(
            model=config.model,
            base_url=config.base_url or "http://localhost:11434",
            timeout=config.request_timeout_seconds,
        )
    if config.provider == "openai-compatible":
        return OpenAICompatibleProvider(
            model=config.model,
            base_url=config.base_url or "https://api.openai.com/v1",
            api_key=os.environ.get(config.api_key_env, ""),
            timeout=config.request_timeout_seconds,
        )
    raise ProviderError(f"Unknown provider: {config.provider}")


class MockProvider:
    """Deterministic provider used for smoke tests and offline demos."""

    def complete(self, messages: list[Message]) -> ProviderResponse:
        last = messages[-1]["content"].lower()
        if "tool result for" in last:
            return ProviderResponse(content="I checked the workspace and finished the requested step.")
        if "list" in last and ("file" in last or "workspace" in last):
            return ProviderResponse(content='{"tool": "list_dir", "args": {"path": "."}}')
        if "read" in last and "readme" in last:
            return ProviderResponse(content='{"tool": "read_file", "args": {"path": "README.md"}}')
        return ProviderResponse(
            content=(
                "Butterclaw mock provider is running. Switch to --provider ollama "
                "or --provider openai-compatible for real model reasoning."
            )
        )


class OpenAICompatibleProvider:
    def __init__(self, model: str, base_url: str, api_key: str, timeout: int = 60) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def complete(self, messages: list[Message]) -> ProviderResponse:
        if not self.api_key:
            raise ProviderError("Missing API key. Set the configured api_key_env variable.")
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
        }
        raw = post_json(
            f"{self.base_url}/chat/completions",
            payload,
            timeout=self.timeout,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        try:
            message = raw["choices"][0]["message"]["content"]  # type: ignore[index]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"Unexpected OpenAI-compatible response: {raw}") from exc
        usage = raw.get("usage", {}) if isinstance(raw, dict) else {}
        return ProviderResponse(
            content=str(message or ""),
            prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage.get("completion_tokens", 0) or 0),
            raw=raw if isinstance(raw, dict) else None,
        )


class OllamaProvider:
    def __init__(self, model: str, base_url: str, timeout: int = 60) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def complete(self, messages: list[Message]) -> ProviderResponse:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.2},
        }
        raw = post_json(f"{self.base_url}/api/chat", payload, timeout=self.timeout, headers={})
        try:
            content = raw["message"]["content"]  # type: ignore[index]
        except (KeyError, TypeError) as exc:
            raise ProviderError(f"Unexpected Ollama response: {raw}") from exc
        return ProviderResponse(content=str(content or ""), raw=raw if isinstance(raw, dict) else None)


def post_json(
    url: str,
    payload: dict[str, object],
    timeout: int,
    headers: dict[str, str],
) -> dict[str, object]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            **headers,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderError(f"Provider HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ProviderError(f"Provider request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderError(f"Provider returned non-JSON response: {text[:500]}") from exc
    if not isinstance(parsed, dict):
        raise ProviderError(f"Provider returned unexpected JSON: {parsed!r}")
    return parsed


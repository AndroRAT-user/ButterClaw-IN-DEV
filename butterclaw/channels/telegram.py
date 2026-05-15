from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from butterclaw.agent import ButterclawAgent
from butterclaw.budget import BudgetLimitExceeded
from butterclaw.config import ButterclawConfig


class TelegramError(RuntimeError):
    pass


class TelegramClientProtocol(Protocol):
    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]:
        ...

    def send_message(
        self,
        chat_id: int | str,
        text: str,
        reply_to_message_id: int | None = None,
    ) -> None:
        ...

    def send_chat_action(self, chat_id: int | str, action: str) -> None:
        ...


@dataclass
class TelegramMessage:
    update_id: int
    chat_id: int | str
    message_id: int
    text: str
    sender_label: str


class TelegramClient:
    def __init__(
        self,
        token: str,
        base_url: str = "https://api.telegram.org",
        timeout: int = 60,
    ) -> None:
        if not token:
            raise TelegramError("Telegram token is empty.")
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get_me(self) -> dict[str, Any]:
        result = self._call("getMe", {})
        if not isinstance(result, dict):
            raise TelegramError(f"Unexpected getMe result: {result!r}")
        return result

    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "timeout": timeout,
            "allowed_updates": ["message"],
        }
        if offset is not None:
            payload["offset"] = offset
        result = self._call("getUpdates", payload)
        if not isinstance(result, list):
            raise TelegramError(f"Unexpected getUpdates result: {result!r}")
        return [item for item in result if isinstance(item, dict)]

    def send_message(
        self,
        chat_id: int | str,
        text: str,
        reply_to_message_id: int | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if reply_to_message_id is not None:
            payload["reply_to_message_id"] = reply_to_message_id
        self._call("sendMessage", payload)

    def send_chat_action(self, chat_id: int | str, action: str) -> None:
        self._call("sendChatAction", {"chat_id": chat_id, "action": action})

    def _call(self, method: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/bot{self.token}/{method}",
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw_text = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise TelegramError(f"Telegram HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise TelegramError(f"Telegram request failed: {exc.reason}") from exc

        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise TelegramError(f"Telegram returned non-JSON response: {raw_text[:500]}") from exc

        if not isinstance(raw, dict) or not raw.get("ok"):
            raise TelegramError(f"Telegram API error: {raw!r}")
        return raw.get("result")


class TelegramChannel:
    def __init__(
        self,
        config: ButterclawConfig,
        client: TelegramClientProtocol | None = None,
    ) -> None:
        self.config = config
        self.client = client or TelegramClient(
            token=os.environ.get(config.telegram_token_env, ""),
            base_url=config.telegram_base_url,
            timeout=config.request_timeout_seconds,
        )
        self.allowed_chats = set(config.telegram_allowed_chats)
        self.state_path = config.telegram_state_path
        if self.state_path:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)

    def run_forever(self, agent: ButterclawAgent, once: bool = False) -> int:
        processed_total = 0
        print("Butterclaw Telegram channel is polling. Press Ctrl+C to stop.")
        while True:
            processed = self.poll_once(agent)
            processed_total += processed
            if once:
                return processed_total
            if processed == 0:
                time.sleep(self.config.telegram_idle_sleep_seconds)

    def poll_once(self, agent: ButterclawAgent) -> int:
        state = self._load_state()
        offset = state.get("offset")
        updates = self.client.get_updates(
            offset=int(offset) if isinstance(offset, int) else None,
            timeout=self.config.telegram_poll_timeout_seconds,
        )
        processed = 0
        for update in updates:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                state["offset"] = update_id + 1
                self._save_state(state)

            message = extract_text_message(update)
            if message is None:
                continue
            if not self._chat_allowed(message.chat_id):
                print(f"Ignored Telegram message from unauthorized chat {message.chat_id}.")
                continue

            processed += 1
            self._handle_message(agent, message)
        return processed

    def _handle_message(self, agent: ButterclawAgent, message: TelegramMessage) -> None:
        command = message.text.strip().split(maxsplit=1)[0].split("@", maxsplit=1)[0].lower()
        if command in {"/start", "/help"}:
            self._reply(
                message,
                "Butterclaw is online. Send a task in plain language. "
                "Use /tools to list local tools. Shell stays disabled unless the host started me with --allow-shell.",
            )
            return
        if command == "/tools":
            self._reply(message, agent.registry.describe())
            return
        if command == "/budget":
            self._reply(message, f"Estimated spend today: ${agent.budget.current_spend_usd():.5f}")
            return

        try:
            self.client.send_chat_action(message.chat_id, "typing")
        except TelegramError:
            pass

        try:
            result = agent.run(message.text)
            answer = result.answer
            if result.spent_usd:
                answer += f"\n\nSpent this run: ${result.spent_usd:.5f}"
        except BudgetLimitExceeded as exc:
            answer = f"Budget stopped the run: {exc}"
        except Exception as exc:
            answer = f"Butterclaw failed: {type(exc).__name__}: {exc}"
        self._reply(message, answer)

    def _reply(self, message: TelegramMessage, text: str) -> None:
        chunks = split_telegram_text(text, self.config.telegram_max_reply_chars)
        for index, chunk in enumerate(chunks):
            self.client.send_message(
                chat_id=message.chat_id,
                text=chunk,
                reply_to_message_id=message.message_id if index == 0 else None,
            )

    def _chat_allowed(self, chat_id: int | str) -> bool:
        if not self.allowed_chats:
            return True
        return str(chat_id) in self.allowed_chats

    def _load_state(self) -> dict[str, Any]:
        if not self.state_path or not self.state_path.exists():
            return {}
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def _save_state(self, state: dict[str, Any]) -> None:
        if not self.state_path:
            return
        self.state_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def extract_text_message(update: dict[str, Any]) -> TelegramMessage | None:
    update_id = update.get("update_id")
    raw_message = update.get("message")
    if not isinstance(update_id, int) or not isinstance(raw_message, dict):
        return None
    text = raw_message.get("text")
    chat = raw_message.get("chat")
    message_id = raw_message.get("message_id")
    if not isinstance(text, str) or not isinstance(chat, dict) or not isinstance(message_id, int):
        return None
    chat_id = chat.get("id")
    if not isinstance(chat_id, (int, str)):
        return None
    sender = raw_message.get("from")
    sender_label = "unknown"
    if isinstance(sender, dict):
        sender_label = str(sender.get("username") or sender.get("first_name") or sender.get("id") or "unknown")
    return TelegramMessage(
        update_id=update_id,
        chat_id=chat_id,
        message_id=message_id,
        text=text,
        sender_label=sender_label,
    )


def split_telegram_text(text: str, max_chars: int = 3900) -> list[str]:
    if max_chars < 100:
        max_chars = 100
    text = text or "(empty response)"
    chunks: list[str] = []
    remaining = text
    while len(remaining) > max_chars:
        split_at = remaining.rfind("\n", 0, max_chars)
        if split_at < max_chars // 2:
            split_at = remaining.rfind(" ", 0, max_chars)
        if split_at < max_chars // 2:
            split_at = max_chars
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks or ["(empty response)"]

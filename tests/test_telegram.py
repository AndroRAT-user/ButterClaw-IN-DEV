from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any

from butterclaw.agent import ButterclawAgent
from butterclaw.channels.telegram import TelegramChannel, extract_text_message, split_telegram_text
from butterclaw.config import ButterclawConfig


class FakeTelegramClient:
    def __init__(self, updates: list[dict[str, Any]]) -> None:
        self.updates = updates
        self.sent: list[tuple[int | str, str, int | None]] = []
        self.actions: list[tuple[int | str, str]] = []
        self.last_offset: int | None = None

    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]:
        self.last_offset = offset
        return self.updates

    def send_message(
        self,
        chat_id: int | str,
        text: str,
        reply_to_message_id: int | None = None,
    ) -> None:
        self.sent.append((chat_id, text, reply_to_message_id))

    def send_chat_action(self, chat_id: int | str, action: str) -> None:
        self.actions.append((chat_id, action))


class TelegramTests(unittest.TestCase):
    def test_extract_text_message(self) -> None:
        message = extract_text_message(
            {
                "update_id": 4,
                "message": {
                    "message_id": 9,
                    "text": "hello",
                    "chat": {"id": 123},
                    "from": {"username": "ana"},
                },
            }
        )
        self.assertIsNotNone(message)
        assert message is not None
        self.assertEqual(message.chat_id, 123)
        self.assertEqual(message.text, "hello")

    def test_split_telegram_text(self) -> None:
        chunks = split_telegram_text("a" * 250, max_chars=100)
        self.assertEqual([len(chunk) for chunk in chunks], [100, 100, 50])

    def test_channel_handles_help_and_saves_offset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = ButterclawConfig(
                workspace=root,
                config_dir=root / ".config",
                telegram_allowed_chats=["123"],
            )
            client = FakeTelegramClient(
                [
                    {
                        "update_id": 10,
                        "message": {
                            "message_id": 5,
                            "text": "/help",
                            "chat": {"id": 123},
                            "from": {"first_name": "Anant"},
                        },
                    }
                ]
            )
            channel = TelegramChannel(config, client=client)
            agent = ButterclawAgent(config)
            processed = channel.poll_once(agent)
            self.assertEqual(processed, 1)
            self.assertEqual(client.sent[0][0], 123)
            self.assertEqual(client.sent[0][2], 5)
            state = config.telegram_state_path.read_text(encoding="utf-8")
            self.assertIn('"offset": 11', state)


if __name__ == "__main__":
    unittest.main()

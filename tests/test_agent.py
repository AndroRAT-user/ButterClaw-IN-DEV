from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from butterclaw.agent import ButterclawAgent, parse_tool_call
from butterclaw.config import ButterclawConfig


class AgentTests(unittest.TestCase):
    def test_parse_tool_call_from_json(self) -> None:
        payload = parse_tool_call('{"tool": "list_dir", "args": {"path": "."}}')
        self.assertEqual(payload, {"tool": "list_dir", "args": {"path": "."}})

    def test_mock_agent_runs_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hello.txt").write_text("hi", encoding="utf-8")
            config = ButterclawConfig(
                provider="mock",
                workspace=root,
                config_dir=root / ".config",
                memory_path=root / ".config" / "memory.jsonl",
            )
            result = ButterclawAgent(config).run("list the files in this workspace")
            self.assertIn("finished", result.answer)
            self.assertGreaterEqual(result.steps, 2)


if __name__ == "__main__":
    unittest.main()


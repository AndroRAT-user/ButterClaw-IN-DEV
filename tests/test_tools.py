from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from butterclaw.config import ButterclawConfig
from butterclaw.tools import WorkspaceTools


class ToolTests(unittest.TestCase):
    def test_workspace_write_and_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = ButterclawConfig(workspace=Path(tmp), config_dir=Path(tmp) / ".config")
            tools = WorkspaceTools(config)
            write = tools.write_file({"path": "notes/todo.txt", "content": "ship it"})
            self.assertTrue(write.ok)
            read = tools.read_file({"path": "notes/todo.txt"})
            self.assertTrue(read.ok)
            self.assertEqual(read.output, "ship it")

    def test_workspace_blocks_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = ButterclawConfig(workspace=Path(tmp), config_dir=Path(tmp) / ".config")
            tools = WorkspaceTools(config)
            result = tools.read_file({"path": "../outside.txt"})
            self.assertFalse(result.ok)
            self.assertIn("escapes workspace", result.output)


if __name__ == "__main__":
    unittest.main()


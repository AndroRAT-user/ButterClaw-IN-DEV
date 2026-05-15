from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from butterclaw.config import ButterclawConfig


@dataclass
class ToolResult:
    ok: bool
    output: str

    def to_text(self) -> str:
        prefix = "OK" if self.ok else "ERROR"
        return f"{prefix}: {self.output}"


ToolHandler = Callable[[dict[str, Any]], ToolResult]


@dataclass
class ToolSpec:
    name: str
    description: str
    args: dict[str, str]
    handler: ToolHandler


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def call(self, name: str, args: dict[str, Any]) -> ToolResult:
        spec = self._tools.get(name)
        if spec is None:
            return ToolResult(False, f"Unknown tool: {name}")
        try:
            return spec.handler(args)
        except Exception as exc:
            return ToolResult(False, f"{type(exc).__name__}: {exc}")

    def describe(self) -> str:
        lines: list[str] = []
        for spec in self._tools.values():
            arg_docs = ", ".join(f"{key}: {value}" for key, value in spec.args.items())
            lines.append(f"- {spec.name}: {spec.description}. Args: {arg_docs or 'none'}")
        return "\n".join(lines)


class WorkspaceTools:
    def __init__(self, config: ButterclawConfig) -> None:
        self.root = config.workspace.resolve()
        self.allow_outside = config.allow_outside_workspace
        self.shell_mode = config.shell_mode
        self.shell_timeout = config.shell_timeout_seconds

    def resolve(self, user_path: str | os.PathLike[str]) -> Path:
        raw = Path(user_path or ".")
        candidate = raw.resolve() if raw.is_absolute() else (self.root / raw).resolve()
        if not self.allow_outside and not candidate.is_relative_to(self.root):
            raise ValueError(f"Path escapes workspace: {user_path}")
        return candidate

    def list_dir(self, args: dict[str, Any]) -> ToolResult:
        try:
            path = self.resolve(str(args.get("path", ".")))
        except ValueError as exc:
            return ToolResult(False, str(exc))
        if not path.exists():
            return ToolResult(False, f"Path does not exist: {path}")
        if not path.is_dir():
            return ToolResult(False, f"Path is not a directory: {path}")
        rows = []
        for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))[:200]:
            marker = "/" if child.is_dir() else ""
            size = "" if child.is_dir() else f" {child.stat().st_size} bytes"
            rows.append(f"{child.name}{marker}{size}")
        return ToolResult(True, "\n".join(rows) or "(empty)")

    def read_file(self, args: dict[str, Any]) -> ToolResult:
        try:
            path = self.resolve(str(args.get("path", "")))
        except ValueError as exc:
            return ToolResult(False, str(exc))
        max_chars = int(args.get("max_chars", 20_000))
        if not path.exists() or not path.is_file():
            return ToolResult(False, f"File does not exist: {path}")
        text = path.read_text(encoding="utf-8", errors="replace")
        if len(text) > max_chars:
            text = text[: max_chars - 35] + "\n...[truncated by Butterclaw]..."
        return ToolResult(True, text)

    def write_file(self, args: dict[str, Any]) -> ToolResult:
        try:
            path = self.resolve(str(args.get("path", "")))
        except ValueError as exc:
            return ToolResult(False, str(exc))
        content = str(args.get("content", ""))
        mode = str(args.get("mode", "overwrite"))
        path.parent.mkdir(parents=True, exist_ok=True)
        if mode == "append":
            with path.open("a", encoding="utf-8") as handle:
                handle.write(content)
        elif mode == "overwrite":
            path.write_text(content, encoding="utf-8")
        else:
            return ToolResult(False, "mode must be 'overwrite' or 'append'")
        return ToolResult(True, f"Wrote {len(content)} characters to {path}")

    def search_files(self, args: dict[str, Any]) -> ToolResult:
        query = str(args.get("query", "")).lower().strip()
        try:
            root = self.resolve(str(args.get("path", ".")))
        except ValueError as exc:
            return ToolResult(False, str(exc))
        max_matches = int(args.get("max_matches", 50))
        if not query:
            return ToolResult(False, "query is required")
        matches: list[str] = []
        for path in root.rglob("*"):
            if len(matches) >= max_matches:
                break
            if path.is_dir():
                continue
            rel = path.relative_to(self.root)
            if query in path.name.lower():
                matches.append(f"{rel}: filename match")
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for line_no, line in enumerate(text.splitlines(), start=1):
                if query in line.lower():
                    matches.append(f"{rel}:{line_no}: {line.strip()[:200]}")
                    break
        return ToolResult(True, "\n".join(matches) or "No matches")

    def run_shell(self, args: dict[str, Any]) -> ToolResult:
        if self.shell_mode != "allow":
            return ToolResult(False, "Shell tool is disabled. Re-run with --allow-shell to enable it.")
        command = str(args.get("command", "")).strip()
        timeout = min(int(args.get("timeout", self.shell_timeout)), self.shell_timeout)
        if not command:
            return ToolResult(False, "command is required")
        completed = subprocess.run(
            command,
            cwd=self.root,
            shell=True,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        output = completed.stdout
        if completed.stderr:
            output += ("\n" if output else "") + completed.stderr
        if len(output) > 20_000:
            output = output[:19_965] + "\n...[truncated by Butterclaw]..."
        return ToolResult(completed.returncode == 0, output or f"exit code {completed.returncode}")


def build_default_registry(config: ButterclawConfig) -> ToolRegistry:
    workspace = WorkspaceTools(config)
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="list_dir",
            description="List files and folders in the workspace",
            args={"path": "relative directory path, default '.'"},
            handler=workspace.list_dir,
        )
    )
    registry.register(
        ToolSpec(
            name="read_file",
            description="Read a UTF-8 text file from the workspace",
            args={"path": "relative file path", "max_chars": "optional character limit"},
            handler=workspace.read_file,
        )
    )
    registry.register(
        ToolSpec(
            name="write_file",
            description="Write or append a UTF-8 text file in the workspace",
            args={"path": "relative file path", "content": "text", "mode": "overwrite or append"},
            handler=workspace.write_file,
        )
    )
    registry.register(
        ToolSpec(
            name="search_files",
            description="Search file names and text content in the workspace",
            args={"query": "text to find", "path": "relative directory", "max_matches": "optional limit"},
            handler=workspace.search_files,
        )
    )
    registry.register(
        ToolSpec(
            name="run_shell",
            description="Run a shell command in the workspace when explicitly enabled",
            args={"command": "command string", "timeout": "seconds, capped by config"},
            handler=workspace.run_shell,
        )
    )
    return registry

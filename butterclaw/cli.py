from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from butterclaw import __version__
from butterclaw.agent import ButterclawAgent
from butterclaw.budget import BudgetLimitExceeded
from butterclaw.channels.telegram import TelegramChannel, TelegramError
from butterclaw.config import ButterclawConfig, config_path, load_config, save_config
from butterclaw.tools import build_default_registry


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.version:
        print(f"butterclaw {__version__}")
        return 0

    config = load_config(Path(args.config) if args.config else None)
    apply_overrides(config, args)

    if args.init_config:
        save_config(config, Path(args.config) if args.config else config_path())
        config.skills_dir.mkdir(parents=True, exist_ok=True)
        config.memory_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Wrote config to {Path(args.config) if args.config else config_path()}")
        return 0

    if args.show_tools:
        print(build_default_registry(config).describe())
        return 0

    if args.telegram_poll:
        return run_telegram(config, once=args.telegram_once)

    task = " ".join(args.task).strip()
    if not task:
        return repl(config)

    return run_once(config, task)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="butterclaw",
        description="Tiny budget-first local agent runtime.",
    )
    parser.add_argument("task", nargs="*", help="Task for the agent. Omit for REPL mode.")
    parser.add_argument("--config", help="Path to config JSON.")
    parser.add_argument("--init-config", action="store_true", help="Write a starter config.")
    parser.add_argument("--show-tools", action="store_true", help="Print available tools.")
    parser.add_argument("--version", action="store_true", help="Print version.")
    parser.add_argument("--provider", choices=["mock", "ollama", "openai-compatible"])
    parser.add_argument("--model")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env")
    parser.add_argument("--workspace")
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--max-context-chars", type=int)
    parser.add_argument("--budget-usd", type=float)
    parser.add_argument("--allow-shell", action="store_true", help="Enable shell tool.")
    parser.add_argument("--allow-outside-workspace", action="store_true")
    parser.add_argument("--telegram-poll", action="store_true", help="Run the Telegram long-polling channel.")
    parser.add_argument("--telegram-once", action="store_true", help="Poll Telegram once and exit.")
    parser.add_argument("--telegram-token-env", help="Environment variable containing the Telegram bot token.")
    parser.add_argument("--telegram-base-url", help="Telegram Bot API base URL.")
    parser.add_argument(
        "--telegram-allowed-chat",
        action="append",
        default=[],
        help="Allowed Telegram chat ID. Can be repeated or comma-separated.",
    )
    parser.add_argument("--telegram-timeout", type=int, help="Long-poll timeout in seconds.")
    parser.add_argument("--telegram-idle-sleep", type=float, help="Sleep between empty polls in seconds.")
    return parser.parse_args(argv)


def apply_overrides(config: ButterclawConfig, args: argparse.Namespace) -> None:
    if args.provider:
        config.provider = args.provider
    if args.model:
        config.model = args.model
    if args.base_url:
        config.base_url = args.base_url
    if args.api_key_env:
        config.api_key_env = args.api_key_env
    if args.workspace:
        config.workspace = Path(args.workspace).resolve()
    if args.max_steps is not None:
        config.max_steps = args.max_steps
    if args.max_context_chars is not None:
        config.max_context_chars = args.max_context_chars
    if args.budget_usd is not None:
        config.daily_budget_usd = args.budget_usd
    if args.allow_shell:
        config.shell_mode = "allow"
    if args.allow_outside_workspace:
        config.allow_outside_workspace = True
    if args.telegram_token_env:
        config.telegram_token_env = args.telegram_token_env
    if args.telegram_base_url:
        config.telegram_base_url = args.telegram_base_url
    allowed_chats = expand_csv(args.telegram_allowed_chat)
    if allowed_chats:
        config.telegram_allowed_chats = allowed_chats
    if args.telegram_timeout is not None:
        config.telegram_poll_timeout_seconds = args.telegram_timeout
    if args.telegram_idle_sleep is not None:
        config.telegram_idle_sleep_seconds = args.telegram_idle_sleep


def expand_csv(values: list[str]) -> list[str]:
    expanded: list[str] = []
    for value in values:
        expanded.extend(part.strip() for part in value.split(",") if part.strip())
    return expanded


def run_once(config: ButterclawConfig, task: str) -> int:
    try:
        result = ButterclawAgent(config).run(task)
    except BudgetLimitExceeded as exc:
        print(f"Budget stopped the run: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Butterclaw failed: {exc}", file=sys.stderr)
        return 1

    print(result.answer)
    if result.spent_usd:
        print(f"\nSpent this run: ${result.spent_usd:.5f}")
    return 0


def run_telegram(config: ButterclawConfig, once: bool = False) -> int:
    try:
        channel = TelegramChannel(config)
        agent = ButterclawAgent(config)
        channel.run_forever(agent, once=once)
    except KeyboardInterrupt:
        print()
        return 0
    except TelegramError as exc:
        print(f"Telegram failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Butterclaw Telegram channel failed: {exc}", file=sys.stderr)
        return 1


def repl(config: ButterclawConfig) -> int:
    print("Butterclaw REPL. Type 'exit' or press Ctrl+C to quit.")
    agent = ButterclawAgent(config)
    while True:
        try:
            task = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if task.lower() in {"exit", "quit"}:
            return 0
        if not task:
            continue
        try:
            result = agent.run(task)
        except BudgetLimitExceeded as exc:
            print(f"Budget stopped the run: {exc}")
            continue
        print(result.answer)


def _json_dump(data: object) -> str:
    return json.dumps(data, indent=2, sort_keys=True)

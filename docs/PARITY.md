# OpenClaw Parity Target

Butterclaw is a clean-room project, not a fork. These notes translate the
public OpenClaw product shape into a lightweight TypeScript target.

OpenClaw's public GitHub repository is MIT licensed. Butterclaw can learn from
its documented architecture and product logic, but does not copy OpenClaw
source code:

- https://github.com/openclaw/openclaw
- https://github.com/openclaw/openclaw/blob/main/LICENSE

Public OpenClaw docs describe a local, self-hosted agent platform with many
channels, thousands of skills, model-agnostic providers, privacy-first storage,
and sandboxed skill execution:

- https://openclawdoc.com/
- https://openclaw.ai/

TechRadar describes the OpenClaw architecture as a local gateway between chat
channels and the chosen AI model, with local session state and tool execution:

- https://www.techradar.com/pro/what-is-openclaw

## Feature Map

| Area | OpenClaw-shaped capability | Butterclaw status |
| --- | --- | --- |
| Language/runtime | TypeScript/npm ecosystem | Started: TypeScript Node CLI |
| Local-first runtime | Own data and tool execution locally | Started: CLI runtime, local files, local memory |
| First-run setup | Guided install and configuration | Started: interactive setup command |
| Model agnostic | Switch providers and models | Started: mock, Ollama, OpenAI-compatible APIs |
| Low-end hardware | Small context and minimal services | Started: no runtime dependencies, short prompts |
| Skills | Reusable workflows | Started: Markdown skill loading |
| Memory | Persistent context | Started: JSONL local memory with relevance search |
| Tools | Files, shell, APIs, browser, apps | Started: workspace files and opt-in shell |
| Permissions | Fine-grained access control | Started: workspace guard, shell deny-by-default, tool profiles, allow rules, deny rules |
| Channels | WhatsApp, Discord, Telegram, Slack, etc. | Started: Telegram long polling, WhatsApp bridge/cloud/webhook layer |
| GitHub | Issues, PRs, CI, repo operations | Started: `gh` CLI tools using gh OAuth |
| Scheduling | Reminders, heartbeats, background tasks | Planned: SQLite task queue and scheduler |
| Browser/app control | Operate real user workflows | Planned: opt-in adapters with explicit permissions |
| Multi-agent | Delegate and coordinate roles | Started: saved agents, teams, and bounded sub-agents |
| Local commands | Runtime control without model calls | Started: `/status`, `/tools`, `/tool-policy`, `/new`, `/doctor`, `/backup` |
| Session hygiene | Inspect, reset, compact, and prune state | Started: named sessions with max-turn pruning |

## Design Rules

- Keep the core package small.
- Load only relevant memory and skills into context.
- Make every heavier feature optional.
- Prefer plain files and SQLite over server stacks.
- Deny risky tools by default.
- Let deny rules win over profile and allow rules.
- Keep local control commands out of model context.
- Prefer existing OAuth/device login surfaces such as `gh auth login` instead of storing app tokens.
- Keep channel access fail-closed until explicit allowlists or open mode are configured.
- Make hosted APIs and local models first-class.


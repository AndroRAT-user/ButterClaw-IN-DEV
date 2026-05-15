# OpenClaw Parity Target

Butterclaw is a clean-room project, not a fork. These notes translate the
public OpenClaw product shape into a lightweight target for budget users.

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
| Local-first runtime | Own data and tool execution locally | Started: CLI runtime, local files, local memory |
| Model agnostic | Switch providers and models | Started: mock, Ollama, OpenAI-compatible APIs |
| Low-end hardware | Small context and minimal services | Started: no runtime deps, short prompts, budget caps |
| Skills | Reusable workflows | Started: Markdown skill loading |
| Memory | Persistent context | Started: JSONL local memory with relevance search |
| Tools | Files, shell, APIs, browser, apps | Started: workspace files and opt-in shell |
| Permissions | Fine-grained access control | Started: workspace guard and shell deny-by-default |
| Channels | WhatsApp, Discord, Telegram, Slack, etc. | Planned: lightweight gateway adapters |
| Scheduling | Reminders, heartbeats, background tasks | Planned: SQLite task queue and scheduler |
| Browser/app control | Operate real user workflows | Planned: opt-in adapters with explicit permissions |
| Multi-agent | Delegate and coordinate roles | Planned after sessions and scheduler |

## Design Rules

- Keep the core package dependency-free.
- Load only relevant memory and skills into context.
- Make every expensive feature optional.
- Prefer plain files and SQLite over servers.
- Deny risky tools by default.
- Make cheap/local providers first-class, not fallback paths.


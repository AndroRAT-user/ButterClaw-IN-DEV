# Butterclaw Roadmap

Butterclaw is aiming for OpenClaw-grade usefulness with a smaller footprint.
The target is not to copy OpenClaw. The target is to give people the same core
powers with fewer moving pieces.

## Milestone 0: Lightweight Core

- TypeScript Node CLI
- polished terminal UI
- first-run setup/onboarding command
- doctor diagnostics
- local backups
- mock, Ollama, and OpenAI-compatible providers
- saved agent profiles
- saved agent teams
- resumable named sessions
- named-session pruning
- Gmail and Google Calendar tools
- GitHub tools through gh OAuth
- WhatsApp bridge/cloud/webhook channel
- loopback HTTP gateway with authenticated wake/agent hooks
- gateway idempotency and OpenAI-compatible chat/responses endpoints
- local background task ledger
- 65-feature local operator pack for memory, sessions, skills, tasks, schedules, gateway state, and workspace utility tools
- workspace-confined file tools and workspace mapping
- tool profiles with allow and deny rules
- skill metadata with required tool gates
- local slash commands
- optional shell tool
- bounded sub-agents for focused delegated tasks
- JSONL memory
- Markdown skills
- Telegram long-polling channel
- local schedule store for reminders and recurring jobs
- local usage tracking
- unit tests

## Milestone 1: Better Local Agent Experience

- streaming output
- richer planning traces
- richer per-skill permission declarations
- prompt compaction for smaller-context models
- model profiles for low-RAM local models

## Milestone 2: Lightweight Gateway

- WebSocket control/RPC on the local gateway
- mapped webhook transforms for selected integrations; Telegram starts with long polling
- optional SQLite-backed task queue when JSON storage becomes too small
- progress notifications for scheduled and background work without a heavy daemon stack

## Milestone 3: Practical Integrations

- Telegram and WhatsApp command polish and attachment handling
- email draft mode
- calendar read and propose mode
- deeper GitHub issue, pull request, and CI workflows
- browser automation through a separate opt-in adapter
- local document indexing
- simple CRM/contact CSV workflows

## Milestone 4: Community Skills Without Bloat

- skill pack format
- signed or checksummed skill installs
- permission review before activation
- only load relevant skills into the model context
- small curated skill registry focused on common lightweight workflows

## Milestone 5: OpenClaw-Grade Usefulness

Butterclaw should feel competitive when it can:

- complete multi-step local tasks reliably
- remember project and user preferences across sessions
- use tools without wasting context
- run well on 4 GB to 8 GB RAM machines
- keep risky actions behind human-controlled permissions
- support hosted APIs and local models equally well


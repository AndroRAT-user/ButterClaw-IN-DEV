# Butterclaw Roadmap

Butterclaw is aiming for OpenClaw-grade usefulness with a smaller footprint.
The target is not to copy OpenClaw. The target is to give people the same core
powers with fewer moving pieces.

## Milestone 0: Lightweight Core

- TypeScript Node CLI
- first-run setup/onboarding command
- mock, Ollama, and OpenAI-compatible providers
- workspace-confined file tools
- optional shell tool
- JSONL memory
- Markdown skills
- Telegram long-polling channel
- local usage tracking
- unit tests

## Milestone 1: Better Local Agent Experience

- resumable sessions
- streaming output
- richer planning traces
- per-tool permissions
- skill metadata with required permissions
- prompt compaction for smaller-context models
- model profiles for low-RAM local models

## Milestone 2: Lightweight Gateway

- local HTTP gateway bound to `127.0.0.1`
- webhook receiver for selected integrations; Telegram starts with long polling
- scheduler for reminders and recurring jobs
- background task queue using SQLite
- progress notifications without a heavy daemon stack

## Milestone 3: Practical Integrations

- Telegram command polish and attachment handling
- email draft mode
- calendar read and propose mode
- GitHub issues and pull request summaries
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


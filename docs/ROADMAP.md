# Butterclaw Roadmap

Butterclaw is aiming for OpenClaw-grade usefulness with a smaller footprint.
The target is not to copy OpenClaw. The target is to give budget users the same
core powers with fewer moving pieces.

## Milestone 0: Tiny Useful Core

- CLI agent loop
- mock, Ollama, and OpenAI-compatible providers
- workspace-confined file tools
- optional shell tool
- JSONL memory
- Markdown skills
- budget guard
- unit tests

## Milestone 1: Better Local Agent Experience

- resumable sessions
- streaming output
- richer planning traces
- per-tool permissions
- skill metadata with required permissions
- prompt compaction for small-context models
- model profiles for low-RAM local models

## Milestone 2: Lightweight Gateway

- local HTTP gateway bound to `127.0.0.1`
- webhook receiver for selected integrations
- scheduler for reminders and recurring jobs
- background task queue using SQLite
- progress notifications without a heavy daemon stack

## Milestone 3: Practical Integrations

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
- small curated skill registry focused on common budget-user workflows

## Milestone 5: "Just As Good" Bar

Butterclaw should feel competitive when it can:

- complete multi-step local tasks reliably
- remember project and user preferences across sessions
- use tools without wasting context
- operate under explicit budget caps
- run well on 4 GB to 8 GB RAM machines
- keep risky actions behind human-controlled permissions
- support cheap cloud APIs and small local models equally well


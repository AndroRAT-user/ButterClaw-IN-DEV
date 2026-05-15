# Butterclaw

Butterclaw is a tiny, budget-first personal agent runtime for low-end PCs.
It is inspired by the local-first shape of OpenClaw, but it is a clean-room,
lightweight implementation: one Python package, standard-library runtime, no
daemon required, and tight defaults around cost and system access.

## Why

OpenClaw-style agents are powerful because they combine chat, memory, local
tools, skills, and app integrations. They can also be heavy, complex, and easy
to misconfigure. Butterclaw starts from the opposite end:

- run on older laptops without a big Node stack or database
- work with Ollama, local models, or cheap OpenAI-compatible APIs
- keep memory and skills as plain local files
- inject only the useful context for the current task
- block shell execution unless the user explicitly enables it
- estimate token spend and stop before a daily budget is crossed

## Current Features

- CLI agent loop with a simple JSON tool-call protocol
- provider adapters for `mock`, `ollama`, and OpenAI-compatible chat APIs
- local file tools: list, read, write, and search inside a workspace
- optional shell tool with timeout and workspace guard
- JSONL local memory with simple relevance search
- Markdown skill loading from a local skills folder
- daily budget tracker with token estimation
- no runtime dependencies outside Python's standard library

## Quick Start

Run the mock provider first. It needs no API key and proves the agent loop and
tool runtime are working:

```powershell
python -m butterclaw --provider mock "list the files in this workspace"
```

Use Ollama for a fully local setup:

```powershell
python -m butterclaw --provider ollama --model llama3.2:3b "summarize README.md"
```

Use an OpenAI-compatible endpoint:

```powershell
$env:BUTTERCLAW_API_KEY = "your-key"
python -m butterclaw --provider openai-compatible --base-url https://api.example.com/v1 --model cheap-model "make a plan for my project"
```

Enable shell commands only when you actually need them:

```powershell
python -m butterclaw --allow-shell "run the tests and tell me what failed"
```

## Configuration

Create a starter config:

```powershell
python -m butterclaw --init-config
```

Config defaults to `%APPDATA%\butterclaw\config.json` on Windows and
`~/.config/butterclaw/config.json` elsewhere. CLI flags override config values.

## Tool Call Protocol

Butterclaw asks models to respond with plain text for normal answers, or with a
single JSON object for a tool call:

```json
{"tool": "read_file", "args": {"path": "README.md"}}
```

After the tool runs, Butterclaw sends the result back to the model and asks it
to continue. This keeps the runtime portable across cheap providers that do not
support native tool calling.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).
See [docs/PARITY.md](docs/PARITY.md) for the OpenClaw-grade feature target.

## Safety

Butterclaw is intentionally conservative. It confines file tools to the chosen
workspace by default, denies shell commands by default, and keeps memory local.
Agents with tools can still make mistakes. Review generated writes, do not run
untrusted skills, and keep API keys out of prompts and memory.

# Butterclaw

Butterclaw is a lightweight, local-first personal agent runtime. It is built in
TypeScript like OpenClaw's main project, with a smaller core that can also run
comfortably on low-end PCs.

It gives the model a local workspace, memory, skills, tools, setup flow, and a
Telegram channel without requiring a large service stack.

## Features

- TypeScript Node CLI
- first-run setup command
- provider adapters for `mock`, `ollama`, and OpenAI-compatible chat APIs
- saved agent profiles with custom instructions
- Gmail and Google Calendar tools using Google OAuth
- Telegram long-polling channel for phone/chat access
- local file tools: list, read, write, and search inside a workspace
- optional shell tool with timeout and workspace guard
- bounded sub-agents for delegated worker tasks
- JSONL local memory with simple relevance search
- Markdown skill loading from a local skills folder
- local usage tracking

## Quick Start

Install the CLI from the repo:

```cmd
npm install
npm install -g .
```

Run first-time setup:

```cmd
butterclaw --setup
```

Start Butterclaw:

```cmd
butterclaw
```

Create and use an agent:

```cmd
butterclaw agent create debugger --description "Finds bugs" --instructions "Find root causes first. Reproduce before fixing."
butterclaw --agent debugger "inspect this workspace"
```

Create a skill:

```cmd
butterclaw skill create bug-hunt --description "Use for debugging." --body "Check reproduction, logs, tests, and the smallest fix."
```

Run a one-off task:

```cmd
butterclaw --provider mock "hello"
```

## Providers

Use Ollama:

```cmd
butterclaw --provider ollama --model llama3.2:3b "summarize README.md"
```

Use an OpenAI-compatible endpoint:

```cmd
set MODEL_PROVIDER_API_KEY=your-provider-api-key
butterclaw --provider openai-compatible --base-url https://openrouter.ai/api/v1 --model openai/gpt-oss-120b:free "make a plan for my project"
```

Enable shell commands only when you actually need them:

```cmd
butterclaw --allow-shell "run the tests and tell me what failed"
```

## Telegram

```cmd
set TELEGRAM_BOT_TOKEN=123456:your-token
butterclaw --telegram-poll --provider ollama --model llama3.2:3b --telegram-allowed-chat 123456789
```

The Telegram channel uses long polling, stores its update offset locally, and
responds to `/start`, `/help`, `/tools`, `/usage`, and normal task messages.
Set `--telegram-allowed-chat` to avoid exposing the bot to unexpected chats.

See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## Google Workspace

Butterclaw can search/read Gmail, create Gmail drafts, list Calendar events,
and create Calendar events after you connect Google OAuth:

```cmd
set GOOGLE_CLIENT_ID=your-google-oauth-client-id
set GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
butterclaw google login
butterclaw "search gmail for unread messages from today"
butterclaw "create a calendar event called Focus Block tomorrow from 10:00 to 11:00"
```

Use `butterclaw google status` to check the connection and
`butterclaw google logout` to remove the saved OAuth credentials. See
[docs/GOOGLE.md](docs/GOOGLE.md).

## Setup

Interactive setup:

```cmd
butterclaw --setup
```

Or:

```cmd
butterclaw setup
```

Create a starter config without prompts:

```cmd
butterclaw --init-config
```

Config defaults to `%APPDATA%\butterclaw\config.json` on Windows and
`~/.config/butterclaw/config.json` elsewhere. CLI flags override config values.
Secrets stay in environment variables. Butterclaw does not issue its own API
key; use the key from your chosen model provider.

## Agents And Skills

Agents are saved JSON profiles in your Butterclaw config folder. Use them for
roles like `debugger`, `reviewer`, `builder`, or `researcher`.

```cmd
butterclaw agent list
butterclaw agent show debugger
butterclaw agent create reviewer --description "Reviews code" --instructions "Find bugs, missing tests, and risky behavior first."
butterclaw --agent reviewer "review the current project"
```

Skills are local Markdown files that Butterclaw loads when they match the task.

```cmd
butterclaw skill list
butterclaw skill show bug-hunt
butterclaw skill create release-check --description "Use before releases." --body "Run tests, inspect docs, and check version notes."
```

## Tool Call Protocol

Butterclaw asks models to respond with plain text for normal answers, or with a
single JSON object for a tool call:

```json
{"tool":"read_file","args":{"path":"README.md"}}
```

After the tool runs, Butterclaw sends the result back to the model and asks it
to continue. This keeps the runtime portable across providers that do not
support native tool calling.

Butterclaw also exposes a `delegate_task` tool to the main agent. It starts a
bounded sub-agent with the same workspace tools, asks it to finish one focused
task, and returns the worker's result to the main conversation. Sub-agents can
use saved agent profiles through the `agent` argument, but they do not get their
own delegation tool, so delegation stays simple and finite.

## Development

```cmd
npm install
npm test
```

## Safety

Butterclaw confines file tools to the chosen workspace by default, denies shell
commands by default, and keeps memory local. Agents with tools can still make
mistakes. Review generated writes, do not run untrusted skills, and keep API
keys out of prompts and memory.

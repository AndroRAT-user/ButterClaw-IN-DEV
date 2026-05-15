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
- Telegram long-polling channel for phone/chat access
- local file tools: list, read, write, and search inside a workspace
- optional shell tool with timeout and workspace guard
- JSONL local memory with simple relevance search
- Markdown skill loading from a local skills folder
- local usage tracking

## Quick Start

Install dependencies and build:

```cmd
npm install
npm run build
```

Run first-time setup:

```cmd
npm run setup
```

Try the local mock provider:

```cmd
npm start -- --provider mock "list the files in this workspace"
```

After `npm install -g .` or `npm link`, you can use the direct CLI:

```cmd
butterclaw --provider mock "hello"
```

## Providers

Use Ollama:

```cmd
npm start -- --provider ollama --model llama3.2:3b "summarize README.md"
```

Use an OpenAI-compatible endpoint:

```cmd
set BUTTERCLAW_API_KEY=your-api-key
npm start -- --provider openai-compatible --base-url https://api.openai.com/v1 --model gpt-4.1-mini "make a plan for my project"
```

Enable shell commands only when you actually need them:

```cmd
npm start -- --allow-shell "run the tests and tell me what failed"
```

## Telegram

```cmd
set TELEGRAM_BOT_TOKEN=123456:your-token
npm start -- --telegram-poll --provider ollama --model llama3.2:3b --telegram-allowed-chat 123456789
```

The Telegram channel uses long polling, stores its update offset locally, and
responds to `/start`, `/help`, `/tools`, `/usage`, and normal task messages.
Set `--telegram-allowed-chat` to avoid exposing the bot to unexpected chats.

See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## Setup

Interactive setup:

```cmd
npm run setup
```

Or:

```cmd
npm start -- setup
```

Create a starter config without prompts:

```cmd
npm start -- --init-config
```

Config defaults to `%APPDATA%\butterclaw\config.json` on Windows and
`~/.config/butterclaw/config.json` elsewhere. CLI flags override config values.
Secrets stay in environment variables.

## Tool Call Protocol

Butterclaw asks models to respond with plain text for normal answers, or with a
single JSON object for a tool call:

```json
{"tool":"read_file","args":{"path":"README.md"}}
```

After the tool runs, Butterclaw sends the result back to the model and asks it
to continue. This keeps the runtime portable across providers that do not
support native tool calling.

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


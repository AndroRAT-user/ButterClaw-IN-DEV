# Butterclaw [IN DEV]

Butterclaw is a lightweight, local-first personal agent runtime. It is built in
TypeScript like OpenClaw's main project, with a smaller core that can also run
comfortably on low-end PCs.

It gives the model a local workspace, memory, skills, tools, setup flow, and a
Telegram channel without requiring a large service stack.

## Features

- TypeScript Node CLI
- polished terminal UI with panels, status pills, and button-like command labels
- first-run setup command
- doctor diagnostics for setup, provider, workspace, and OAuth state
- local JSON backup for agents, teams, skills, sessions, schedules, task records, and memory
- local scheduler for one-shot reminders and recurring agent jobs, with task ledger records
- loopback HTTP gateway with health, model listing, authenticated webhooks, OpenAI-compatible endpoints, and task inspection
- provider adapters for `mock`, `ollama`, and OpenAI-compatible chat APIs, plus ordered model failover
- saved agent profiles with custom instructions
- saved agent teams that can delegate one task to several specialists
- resumable named sessions with local transcripts
- automatic named-session pruning with a configurable turn cap
- Gmail and Google Calendar tools using Google OAuth
- GitHub tools through the `gh` CLI, using `gh auth login` OAuth state
- WhatsApp channel tools with bridge-command and Cloud API modes
- WhatsApp webhook receiver with OpenClaw-style DM/group policy gates
- Telegram long-polling channel for phone/chat access
- local file tools: list, read, write, search, and workspace mapping
- OpenClaw-inspired tool profiles, allow rules, and deny rules
- optional shell tool with timeout and workspace guard
- bounded sub-agents for delegated worker tasks
- local slash commands for status, tools, policy, reset, doctor, and backup
- JSONL local memory with simple relevance search
- Markdown skill loading from a local skills folder with metadata gates for required tools
- local background task ledger for gateway hooks, compatibility calls, and scheduled runs
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
butterclaw agent run debugger "inspect this workspace"
butterclaw --agent debugger "inspect this workspace"
```

Create a team and use it through the main agent:

```cmd
butterclaw agent create reviewer --description "Reviews code" --instructions "Find bugs, missing tests, and risky behavior first."
butterclaw team create review-crew --agents debugger,reviewer --description "Debug and review together"
butterclaw "ask the review-crew team to inspect this project"
```

Resume a named working session:

```cmd
butterclaw --session butter-build "remember the current goal and inspect the workspace"
butterclaw --session butter-build "continue from where we left off"
butterclaw session prune butter-build 80
```

Check and back up local state:

```cmd
butterclaw doctor
butterclaw backup create
```

Inspect the runtime without sending anything to the model:

```cmd
butterclaw /status
butterclaw /tools
butterclaw /tool-policy
butterclaw --session butter-build /new
butterclaw /schedule
butterclaw /tasks
butterclaw /github
butterclaw /whatsapp
```

Schedule a reminder or recurring local agent task:

```cmd
butterclaw schedule add --name check-in --at 20m --message "remind me to review the build"
butterclaw schedule add --name morning-brief --every 1d --message "summarize this workspace"
butterclaw schedule list
butterclaw schedule run --due
butterclaw tasks list
```

Start the local gateway and receive authenticated hooks:

```cmd
set BUTTERCLAW_GATEWAY_TOKEN=choose-a-local-token
butterclaw gateway serve
curl -X POST http://127.0.0.1:18789/hooks/agent -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"message\":\"hello\"}"
curl -X POST http://127.0.0.1:18789/v1/chat/completions -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"
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
butterclaw --request-timeout-seconds 180 "review this project"
```

Add ordered fallback models when you want Butterclaw to keep moving if the
primary provider/model fails:

```cmd
butterclaw --provider mock --model mock-fail --model-fallback mock/mock-local "hello"
butterclaw --provider ollama --model llama3.2:3b --model-fallback ollama/qwen2.5-coder:7b "review this project"
```

Enable shell commands only when you actually need them:

```cmd
butterclaw --allow-shell "run the tests and tell me what failed"
```

## Tool Policy

Butterclaw uses an OpenClaw-style tool policy layer. Profiles choose a default
tool surface, `--allow-tool` can replace that default, and `--deny-tool` always
wins.

```cmd
butterclaw --tool-profile minimal /tools
butterclaw --tool-profile coding --deny-tool run_shell "inspect this repo"
butterclaw --allow-tool read_file,workspace_map "summarize this workspace"
```

Profiles:

- `minimal`: read-only workspace discovery
- `coding`: workspace tools, shell tool registration, and sub-agents
- `google`: read-only workspace discovery, Google tools, and sub-agents
- `full`: everything Butterclaw knows how to register

Groups accepted by `--allow-tool` and `--deny-tool`: `group:read`,
`group:write`, `group:fs`, `group:runtime`, `group:google`, `group:agents`,
`group:github`, `group:automation`, `group:whatsapp`, `group:channels`, and
`group:all`. Wildcards like `gmail_*` are also supported.

## Scheduling

Butterclaw has a small local scheduler inspired by OpenClaw's automation model,
but implemented as a lightweight JSON store. Jobs live in your config folder,
can run in a named session, and can target a saved agent profile.

```cmd
butterclaw schedule add --name release-nudge --at 2026-05-17T09:00:00Z --message "check release blockers" --session release-work
butterclaw schedule add --name repo-sweep --every 2h --message "inspect project status" --agent debugger
butterclaw schedule run --due
butterclaw schedule daemon
```

Agent tools: `schedule_list`, `schedule_add`, and `schedule_remove`.

## Background Tasks

Gateway hook runs, OpenAI-compatible gateway calls, and scheduled jobs are
recorded in a local task ledger. This gives you a lightweight background-work
view without running a database service.

```cmd
butterclaw tasks list
butterclaw tasks list --status succeeded
butterclaw tasks show task_12345678
butterclaw /tasks
```

Agent tools: `task_list` and `task_show`.

## Gateway And Webhooks

Butterclaw's gateway is a small loopback HTTP process for local control and
automation. It exposes health, model discovery, and authenticated hooks without
pulling in a heavy daemon stack.

```cmd
set BUTTERCLAW_GATEWAY_TOKEN=choose-a-local-token
butterclaw gateway status
butterclaw gateway serve
```

Endpoints:

- `GET /health` and `GET /status`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /hooks/wake`
- `POST /hooks/agent`
- `GET /tasks`
- `GET /tasks/<id>`

Hook auth uses `Authorization: Bearer <token>` or `x-butterclaw-token`. Query
string tokens are rejected. See [docs/GATEWAY.md](docs/GATEWAY.md).

## GitHub

Butterclaw follows OpenClaw's GitHub skill pattern: use the `gh` CLI for GitHub
operations, and let `gh auth login` own OAuth. Butterclaw does not store a
GitHub token.

```cmd
gh auth login -h github.com -p https -w
gh auth setup-git
butterclaw github status
butterclaw --github-default-repo AndroRAT-user/ButterClaw-IN-DEV github prs
butterclaw "use github_pr_list to check my open PRs"
```

GitHub tools: `github_status`, `github_pr_list`, `github_pr_view`,
`github_issue_list`, `github_issue_create`, and `github_run_list`.

## Telegram

```cmd
set TELEGRAM_BOT_TOKEN=123456:your-token
butterclaw --telegram-poll --provider ollama --model llama3.2:3b --telegram-allowed-chat 123456789
```

The Telegram channel uses long polling, stores its update offset locally, and
responds to `/start`, `/help`, `/tools`, `/usage`, and normal task messages.
Set `--telegram-allowed-chat` to avoid exposing the bot to unexpected chats.

See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## WhatsApp

Butterclaw's WhatsApp layer recreates the important channel behavior without
pulling in the full gateway stack: channel policies, default targets, chunked
replies, webhook verification, and a status surface.

Bridge mode lets you connect any local WhatsApp sender command:

```cmd
set BUTTERCLAW_WHATSAPP_SEND_CMD=node C:\path\to\send-whatsapp.js --to {to} --text {text}
butterclaw --whatsapp-mode bridge --whatsapp-dm-policy open --whatsapp-allowed-chat * whatsapp send +15555550123 "hello from Butterclaw"
```

Cloud mode uses Meta WhatsApp Cloud API:

```cmd
set WHATSAPP_CLOUD_TOKEN=your-meta-cloud-api-token
set WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
butterclaw --whatsapp-mode cloud whatsapp send +15555550123 "hello from Butterclaw"
```

Inbound webhook mode:

```cmd
set WHATSAPP_VERIFY_TOKEN=choose-a-verify-token
butterclaw --whatsapp-webhook --whatsapp-dm-policy open --whatsapp-allowed-chat *
```

The webhook listens on
`http://127.0.0.1:8787/whatsapp-webhook` by default. It accepts Meta Cloud API
message webhooks and simple bridge JSON payloads shaped like:

```json
{"from":"+15555550123","text":"hello","chatType":"direct"}
```

Policies:

- `--whatsapp-dm-policy pairing|allowlist|open|disabled`
- `--whatsapp-group-policy allowlist|open|disabled`
- `--whatsapp-allowed-chat <id>` for DMs
- `--whatsapp-group-allowed-chat <id>` for groups
- group messages require a mention by default, using `butterclaw` and
  `@butterclaw` as mention patterns

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

Check your setup at any time:

```cmd
butterclaw doctor
```

Config defaults to `%APPDATA%\butterclaw\config.json` on Windows and
`~/.config/butterclaw/config.json` elsewhere. CLI flags override config values.
Secrets stay in environment variables. Butterclaw does not issue its own API
key; use the key from your chosen model provider.

## Agents, Teams, Sessions, And Skills

Agents are saved JSON profiles in your Butterclaw config folder. Use them for
roles like `debugger`, `reviewer`, `builder`, or `researcher`.
They are not configured through `butterclaw.yaml`; use the commands below.

```cmd
butterclaw agent list
butterclaw agent --list
butterclaw agent help
butterclaw agent show debugger
butterclaw agent create reviewer --description "Reviews code" --instructions "Find bugs, missing tests, and risky behavior first."
butterclaw agent run reviewer "review the current project"
butterclaw --agent reviewer "review the current project"
```

On Windows `cmd`, use `cd /d` to move into another folder and do not include the
prompt's trailing `>` in the command:

```cmd
cd /d C:\Users\cap_p\Downloads\flutta\office
butterclaw agent create builder --description "Builds websites" --instructions "Create HTML, CSS, and JavaScript files with write_file when the user asks for files."
butterclaw agent run builder "create a hello world page in abc.html"
```

Windows `cmd` has `dir` by default. Commands like `ls`, `nano`, and `touch`
only work if you install Unix-style tools or use PowerShell/Git Bash alternatives.

Teams are saved JSON profiles that point at multiple agents. The main agent can
call them through `delegate_team`, and each member runs as a bounded sub-agent.
Use `team run` when you want the team report printed directly without relying on
the main model to summarize it.

```cmd
butterclaw team list
butterclaw team show review-crew
butterclaw team create review-crew --agents debugger,reviewer --description "Debug and review together"
butterclaw team run review-crew "inspect this project"
```

Sessions save exact user/assistant turns locally so one-off commands can resume
context without mixing it into long-term memory.

```cmd
butterclaw --session release-work "check what is left for release"
butterclaw session list
butterclaw session show release-work
butterclaw session clear release-work
butterclaw session prune release-work 80
```

Backups are local JSON files that include agents, teams, skills, sessions,
schedules, and memory. OAuth token state and usage files are excluded.

```cmd
butterclaw backup create
butterclaw backup create C:\path\to\butterclaw-backup.json
```

Skills are local Markdown files that Butterclaw loads when they match the task.
Frontmatter can require enabled tools or disable model prompt injection for a
skill that is meant to be used only by other tooling.

```cmd
butterclaw skill list
butterclaw skill show bug-hunt
butterclaw skill create release-check --description "Use before releases." --body "Run tests, inspect docs, and check version notes."
```

```markdown
---
requires-tools: read_file, search_files
---
# release-check
Run tests, inspect docs, and check version notes.
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

Butterclaw also exposes `workspace_map`, `delegate_task`, `delegate_team`,
`schedule_*`, and `task_*` tools. The map tool gives the model a compact
project outline.
`delegate_task` starts one bounded sub-agent with the same workspace tools,
while `delegate_team` runs several saved agent profiles on the same task and
combines their reports. Sub-agents do not get their own delegation tool, so
delegation stays simple and finite. Butterclaw keeps delegated reports visible
in the final answer so agent work does not disappear behind a vague summary.

Local slash commands such as `/status`, `/tools`, `/tool-policy`, `/new`,
`/doctor`, `/backup`, `/schedule`, `/tasks`, `/github`, and `/whatsapp` are
handled by the CLI itself and are never sent to the model.

## Development

```cmd
npm install
npm test
```

## Safety

Butterclaw confines file tools to the chosen workspace by default, denies shell
commands by default, and keeps memory local. WhatsApp direct chats default to
pairing-style blocking until you explicitly allow senders or opt into open mode
with `--whatsapp-allowed-chat *`. Agents with tools can still make mistakes.
Review generated writes, do not run untrusted skills, and keep API keys out of
prompts and memory.

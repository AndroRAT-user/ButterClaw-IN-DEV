# First-Run Setup

Butterclaw includes a small onboarding command:

```cmd
butterclaw --setup
```

You can also run:

```cmd
butterclaw setup
```

The setup flow:

- checks Node.js, Git, and whether Ollama is reachable
- asks which provider to use: `mock`, `ollama`, or `openai-compatible`
- asks for model, workspace, and step limits
- keeps shell access disabled unless you explicitly enable it
- optionally configures Telegram chat access
- creates the config file, memory file, schedule file, task ledger, agents
  folder, teams folder, sessions folder, and skills folder
- writes a tiny starter skill
- prints the command to run next

After setup, run a quick diagnostic:

```cmd
butterclaw doctor
```

## Suggested Lightweight Setup

For a lightweight local setup, choose:

- provider: `ollama`
- model: `llama3.2:3b` or another compact local model
- shell tool: `no` until you need it

For a hosted API, choose:

- provider: `openai-compatible`
- model: `openai/gpt-oss-120b:free` or the model you want to use

Butterclaw does not issue its own API key. It stores the environment variable
name for your chosen model provider's key, not the secret itself.

You can add model failover from the CLI when a run should try another model
after provider failure:

```cmd
butterclaw --provider mock --model mock-fail --model-fallback mock/mock-local "hello"
```

## Telegram During Setup

If you choose Telegram setup, Butterclaw stores allowed chat IDs and the token
environment variable name. Set the token before running Telegram:

```cmd
set TELEGRAM_BOT_TOKEN=123456:your-token
butterclaw --telegram-poll
```

## Google Workspace

Set Google OAuth client credentials, then login once:

```cmd
set GOOGLE_CLIENT_ID=your-google-oauth-client-id
set GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
butterclaw google login
butterclaw "list my calendar events"
```

Use `butterclaw google status` to check the connection and
`butterclaw google logout` to disconnect. Use `--google-calendar-id` to override
the calendar ID.

## Agents, Teams, Sessions, And Skills

After setup, create reusable agent profiles, teams, sessions, and skills:

```cmd
butterclaw agent create debugger --description "Finds bugs" --instructions "Find root causes first."
butterclaw agent create reviewer --description "Reviews code" --instructions "Find bugs, missing tests, and risky behavior first."
butterclaw team create review-crew --agents debugger,reviewer --description "Debug and review together."
butterclaw skill create bug-hunt --description "Use for debugging." --body "Reproduce, inspect logs, run tests, then fix."
```

Run with a saved agent or a named session:

```cmd
butterclaw --agent debugger "inspect this workspace"
butterclaw --session release-work "continue the release checklist"
```

Inspect local state:

```cmd
butterclaw team list
butterclaw session list
butterclaw session show release-work
```

Create a local backup before large changes:

```cmd
butterclaw backup create
```

The backup includes agents, teams, skills, sessions, schedules, task records,
and memory. OAuth token state and usage files are excluded.

## Local Schedules

Butterclaw can store one-shot reminders and recurring jobs in the config folder:

```cmd
butterclaw schedule add --name check-in --at 20m --message "remind me to review the build"
butterclaw schedule add --name morning-brief --every 1d --message "summarize this workspace"
butterclaw schedule run --due
butterclaw tasks list
```

See [SCHEDULING.md](SCHEDULING.md) for the command surface.
See [TASKS.md](TASKS.md) for background task records.

## Gateway Hooks

For local automation hooks, set a token and start the gateway:

```cmd
set BUTTERCLAW_GATEWAY_TOKEN=choose-a-local-token
butterclaw gateway serve
```

Use `butterclaw gateway status` or `/gateway` to inspect the configured host,
port, hook path, and token environment variable. See [GATEWAY.md](GATEWAY.md).

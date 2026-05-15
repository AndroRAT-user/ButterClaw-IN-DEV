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
- creates the config file, memory file, agents folder, and skills folder
- writes a tiny starter skill
- prints the command to run next

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

## Agents And Skills

After setup, create reusable agent profiles and skills:

```cmd
butterclaw agent create debugger --description "Finds bugs" --instructions "Find root causes first."
butterclaw skill create bug-hunt --description "Use for debugging." --body "Reproduce, inspect logs, run tests, then fix."
```

Run with a saved agent:

```cmd
butterclaw --agent debugger "inspect this workspace"
```

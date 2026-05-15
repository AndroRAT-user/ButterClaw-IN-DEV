# Telegram Channel

Butterclaw's first chat channel is a small Telegram long-polling adapter. It
uses the official Bot API directly through Python's standard library, so there
are no extra runtime dependencies.

## Setup

1. Create a bot with `@BotFather` in Telegram.
2. Set the token in your shell:

```powershell
$env:TELEGRAM_BOT_TOKEN = "123456:your-token"
```

3. Start Butterclaw:

```powershell
python -m butterclaw --telegram-poll --provider ollama --model llama3.2:3b --telegram-allowed-chat 123456789
```

## Finding Your Chat ID

Temporarily start without `--telegram-allowed-chat`, message the bot, then stop
it and check the terminal output or `%APPDATA%\butterclaw\telegram-state.json`.
After that, restart with the allowed chat ID.

## Commands

- `/start` or `/help`: show a short status message.
- `/tools`: list available local tools.
- `/budget`: show today's estimated spend.
- Any other text: send the task to the Butterclaw agent.

## Safety

Use `--telegram-allowed-chat` in real use. Without it, anyone who can message
the bot can ask Butterclaw to act within the permissions you gave the host
process. The shell tool is still disabled unless the host starts Butterclaw with
`--allow-shell`.


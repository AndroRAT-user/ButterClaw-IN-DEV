# First-Run Setup

Butterclaw includes a small onboarding command:

```cmd
npm run setup
```

You can also run:

```cmd
npm start -- setup
```

The setup flow:

- checks Node.js, Git, and whether Ollama is reachable
- asks which provider to use: `mock`, `ollama`, or `openai-compatible`
- asks for model, workspace, and step limits
- keeps shell access disabled unless you explicitly enable it
- optionally configures Telegram chat access
- creates the config file, memory file, and skills folder
- writes a tiny starter skill
- prints the command to run next

## Suggested Lightweight Setup

For a lightweight local setup, choose:

- provider: `ollama`
- model: `llama3.2:3b` or another compact local model
- shell tool: `no` until you need it

For a hosted API, choose:

- provider: `openai-compatible`
- model: the model you want to use

Butterclaw stores the API key environment variable name in config, not the
secret itself.

## Telegram During Setup

If you choose Telegram setup, Butterclaw stores allowed chat IDs and the token
environment variable name. Set the token before running Telegram:

```cmd
set TELEGRAM_BOT_TOKEN=123456:your-token
npm start -- --telegram-poll
```

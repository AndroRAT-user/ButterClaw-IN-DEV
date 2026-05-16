# Integrations

Butterclaw keeps integrations lightweight and local-first. The design is based
on the public OpenClaw channel model: a channel has a config surface, access
policy, status command, target routing, chunked delivery, and optional webhook
entrypoint.

## Scheduling

Scheduling uses a local JSON store and the existing Butterclaw agent runtime.
Use it for reminders and recurring checks without running a heavy gateway stack:

```cmd
butterclaw schedule add --name ops-sweep --every 2h --message "inspect project status"
butterclaw schedule list
butterclaw schedule run --due
```

Agent tools:

- `schedule_list`
- `schedule_add`
- `schedule_remove`

## Gateway Hooks

Butterclaw Gateway exposes local authenticated hooks for external automation:

```cmd
set BUTTERCLAW_GATEWAY_TOKEN=choose-a-local-token
butterclaw gateway serve
```

Agent hook:

```cmd
curl -X POST http://127.0.0.1:18789/hooks/agent -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"message\":\"summarize this workspace\"}"
```

Wake hook:

```cmd
curl -X POST http://127.0.0.1:18789/hooks/wake -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"text\":\"check the build\"}"
```

OpenAI-compatible local calls:

```cmd
curl -X POST http://127.0.0.1:18789/v1/chat/completions -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"summarize this workspace\"}]}"
curl -X POST http://127.0.0.1:18789/v1/responses -H "Authorization: Bearer choose-a-local-token" -H "Content-Type: application/json" -d "{\"input\":\"summarize this workspace\"}"
```

Use an `Idempotency-Key` header with wake or agent hooks when retrying from an
external service so the gateway does not duplicate the run.

Task inspection:

```cmd
butterclaw tasks list
curl http://127.0.0.1:18789/tasks -H "Authorization: Bearer choose-a-local-token"
```

See [GATEWAY.md](GATEWAY.md).

## GitHub

GitHub uses the official `gh` CLI. Sign in once with OAuth:

```cmd
gh auth login -h github.com -p https -w
gh auth setup-git
```

Then use:

```cmd
butterclaw github status
butterclaw --github-default-repo owner/repo github prs
butterclaw github pr 1 owner/repo
butterclaw github issues owner/repo
butterclaw github runs owner/repo
```

Agent tools:

- `github_status`
- `github_pr_list`
- `github_pr_view`
- `github_issue_list`
- `github_issue_create`
- `github_run_list`

## WhatsApp

WhatsApp can run in two modes.

Bridge mode delegates sending to your own local command:

```cmd
set BUTTERCLAW_WHATSAPP_SEND_CMD=node C:\path\to\send-whatsapp.js --to {to} --text {text}
butterclaw --whatsapp-mode bridge whatsapp send +15555550123 "hello"
```

Cloud mode sends through Meta WhatsApp Cloud API:

```cmd
set WHATSAPP_CLOUD_TOKEN=your-meta-token
set WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
butterclaw --whatsapp-mode cloud whatsapp send +15555550123 "hello"
```

Webhook mode receives inbound messages:

```cmd
set WHATSAPP_VERIFY_TOKEN=your-webhook-verify-token
butterclaw --whatsapp-webhook --whatsapp-dm-policy open --whatsapp-allowed-chat *
```

Default webhook URL:

```text
http://127.0.0.1:8787/whatsapp-webhook
```

Bridge JSON payload:

```json
{"from":"+15555550123","text":"hello","chatType":"direct"}
```

Access policies:

- Direct chats: `pairing`, `allowlist`, `open`, `disabled`
- Groups: `allowlist`, `open`, `disabled`
- `open` direct chat mode requires `--whatsapp-allowed-chat *`
- group messages require mention patterns unless disabled

Agent tools:

- `whatsapp_status`
- `whatsapp_send`

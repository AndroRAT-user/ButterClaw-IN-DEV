# Background Tasks

Butterclaw keeps a local background task ledger for work that happens outside a
single foreground CLI turn. It is a compact JSON store in the config folder, not
a service dependency.

Recorded task sources:

- gateway agent hooks
- gateway wake hooks
- OpenAI-compatible gateway requests
- scheduled job runs

Common task kinds:

- `agent-hook`
- `wake-hook`
- `compat-chat`
- `compat-responses`
- `schedule`

## Commands

```cmd
butterclaw tasks list
butterclaw tasks list --status succeeded
butterclaw tasks list --kind agent-hook
butterclaw tasks list --source gateway --limit 20
butterclaw tasks show task_12345678
butterclaw tasks cancel task_12345678 "operator cancelled"
butterclaw tasks stats
butterclaw tasks clear --status succeeded
butterclaw tasks prune --keep 100
butterclaw tasks export C:\path\to\tasks.json
```

`show` also accepts a stored run ID when the task has one.

Slash command:

```cmd
butterclaw /tasks
```

Agent tools:

- `task_list`
- `task_show`
- `task_cancel`
- `task_stats`

Task statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

The ledger keeps the newest 500 records and truncates large outputs so the
config folder stays small.

# Scheduling

Butterclaw includes a lightweight local scheduler for reminders and recurring
agent work. It is inspired by OpenClaw's automation shape, but it is not a copy:
jobs are stored in Butterclaw's own small JSON format and run through the same
CLI agent runtime as normal tasks.

## Add Jobs

Create a one-shot reminder:

```cmd
butterclaw schedule add --name build-check --at 20m --message "remind me to check the build"
```

Create a recurring job:

```cmd
butterclaw schedule add --name morning-brief --every 1d --message "summarize this workspace"
```

Supported time formats:

- `now`
- relative durations such as `30s`, `20m`, `2h`, or `1d`
- ISO timestamps such as `2026-05-17T09:00:00Z`

One-shot jobs delete themselves after a successful run by default. Recurring
jobs compute their next run time from the previous finish time.

## Run Jobs

Run due jobs once:

```cmd
butterclaw schedule run --due
```

Run one job manually:

```cmd
butterclaw schedule run sch_12345678
```

Keep a local scheduler loop running:

```cmd
butterclaw schedule daemon
```

The daemon is intentionally local and foreground-first. Use your operating
system's normal service manager if you want it to stay running after logout.

Every schedule run also writes a background task record. Use this when you want
the latest scheduled work and its output without digging through run history:

```cmd
butterclaw tasks list --kind schedule
butterclaw tasks show task_12345678
```

## Sessions And Agents

Jobs can keep context in a named session:

```cmd
butterclaw schedule add --name release-nudge --at 2026-05-17T09:00:00Z --session release-work --message "check release blockers"
```

Jobs can also run through a saved agent profile:

```cmd
butterclaw agent create debugger --description "Finds bugs" --instructions "Inspect before changing files."
butterclaw schedule add --name repo-sweep --every 2h --agent debugger --message "inspect project status"
```

## Inspect And Remove

```cmd
butterclaw schedule list
butterclaw schedule show sch_12345678
butterclaw schedule runs sch_12345678
butterclaw schedule remove sch_12345678
```

Agent tools:

- `schedule_list`
- `schedule_add`
- `schedule_remove`

Tool policy group:

- `group:automation`

Related task tools:

- `task_list`
- `task_show`

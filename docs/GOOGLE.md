# Google Workspace

Butterclaw includes direct Google Workspace tools for Gmail and Google Calendar.
They use Google's OAuth 2.0 desktop app flow with PKCE, then call Google's REST
APIs through Node's built-in `fetch`, so there are no extra runtime
dependencies.

## Setup

Create an OAuth client in Google Cloud Console, enable the Gmail API and Google
Calendar API, then put the client credentials in environment variables:

```cmd
set GOOGLE_CLIENT_ID=your-google-oauth-client-id
set GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

Login once:

```cmd
butterclaw google login
```

Butterclaw opens Google consent in your browser, receives the callback on
`127.0.0.1`, and stores refresh credentials in your Butterclaw config folder.
After that, run Butterclaw normally:

```cmd
butterclaw "search gmail for unread messages"
butterclaw "list my calendar events for tomorrow"
```

Useful commands:

```cmd
butterclaw google status
butterclaw google logout
```

Use `--google-client-id-env` or `--google-client-secret-env` if your OAuth
client credentials live in different environment variables. Use
`--google-calendar-id` to target a calendar other than `primary`.

## OAuth Scopes

Use the least-powerful scopes that match what you want Butterclaw to do:

- Gmail search/read: `https://www.googleapis.com/auth/gmail.readonly`
- Gmail draft creation: `https://www.googleapis.com/auth/gmail.compose`
- Calendar event read/write: `https://www.googleapis.com/auth/calendar.events`

Butterclaw requests offline access so it can refresh Google access internally
without asking you to paste tokens. Butterclaw creates Gmail drafts but does not
send Gmail messages directly.

## Tools

- `gmail_search`: search messages and return concise metadata.
- `gmail_read`: read a message by Gmail message ID.
- `gmail_create_draft`: create a draft email without sending it.
- `calendar_list_events`: list events from a calendar.
- `calendar_create_event`: create an event on a calendar.

Calendar IDs default to `primary`. Dates and datetimes should be ISO strings,
for example `2026-05-16` or `2026-05-16T10:00:00+05:30`.

## Safety

OAuth refresh credentials are stored locally at the `google-oauth.json` path in
your Butterclaw config folder. Do not commit that file. Keep OAuth scopes narrow
and use `butterclaw google logout` when you want to disconnect.

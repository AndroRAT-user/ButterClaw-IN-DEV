import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { buildAuthUrl, googleStatus, logoutGoogle } from "../src/google.js";
import { buildDefaultRegistry } from "../src/tools.js";

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-google-"));
  return defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    googleCalendarId: "primary"
  });
}

test("google tools require OAuth login", async () => {
  const result = await buildDefaultRegistry(tempConfig()).call("gmail_search", { query: "from:ana" });
  assert.equal(result.ok, false);
  assert.match(result.output, /Google OAuth is not connected/);
});

test("google auth url uses offline access and PKCE", () => {
  const url = new URL(
    buildAuthUrl({
      clientId: "client",
      redirectUri: "http://127.0.0.1:1234/oauth2callback",
      scopes: ["scope-a", "scope-b"],
      state: "state",
      codeChallenge: "challenge"
    })
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "scope-a scope-b");
});

test("gmail tools search, read, and create drafts through Google APIs", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const config = tempConfig();
  seedOAuth(config.googleOAuthPath);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      assert.match(String(init?.body), /grant_type=refresh_token/);
      return json({ access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" });
    }
    if (url.includes("/messages?")) {
      return json({ messages: [{ id: "m1" }] });
    }
    if (url.includes("/messages/m1?") && url.includes("format=metadata")) {
      return json(gmailMessage("m1", "metadata snippet"));
    }
    if (url.includes("/messages/m1?") && url.includes("format=full")) {
      return json(gmailMessage("m1", "full snippet", "hello from gmail"));
    }
    if (url.endsWith("/drafts")) {
      return json({ id: "draft-1" });
    }
    return json({ error: "unexpected url", url }, 404);
  }) as typeof fetch;

  try {
    const registry = buildDefaultRegistry(config);
    const search = await registry.call("gmail_search", { query: "from:ana", maxResults: 1 });
    const read = await registry.call("gmail_read", { id: "m1" });
    const draft = await registry.call("gmail_create_draft", { to: "ana@example.com", subject: "Hello", body: "Draft body" });

    assert.equal(search.ok, true);
    assert.match(search.output, /m1/);
    assert.match(search.output, /Subject line/);
    assert.equal(read.ok, true);
    assert.match(read.output, /hello from gmail/);
    assert.equal(draft.ok, true);
    assert.match(draft.output, /draft-1/);

    const draftBody = JSON.parse(String(requests.find((request) => request.url.endsWith("/drafts"))?.init?.body));
    const raw = String(draftBody.message.raw);
    assert.match(decodeBase64Url(raw), /To: ana@example.com/);
    assert.match(decodeBase64Url(raw), /Draft body/);
    const apiRequests = requests.filter((request) => !request.url.includes("oauth2.googleapis.com"));
    assert.equal(apiRequests.every((request) => request.init?.headers && String((request.init.headers as Record<string, string>).Authorization).includes("fresh-token")), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("calendar tools list and create events through Google APIs", async () => {
  const previousFetch = globalThis.fetch;
  let createdEvent: any;
  const config = tempConfig();
  seedOAuth(config.googleOAuthPath, "usable-token", new Date(Date.now() + 3_600_000).toISOString());
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/calendar/v3/calendars/primary/events?")) {
      return json({
        items: [{ id: "event-1", summary: "Standup", start: { dateTime: "2026-05-15T09:00:00Z" }, end: { dateTime: "2026-05-15T09:30:00Z" } }]
      });
    }
    if (url.endsWith("/calendar/v3/calendars/primary/events")) {
      createdEvent = JSON.parse(String(init?.body));
      return json({ id: "event-2", summary: createdEvent.summary, htmlLink: "https://calendar.google.com/event?eid=event-2" });
    }
    return json({ error: "unexpected url", url }, 404);
  }) as typeof fetch;

  try {
    const registry = buildDefaultRegistry(config);
    const list = await registry.call("calendar_list_events", { timeMin: "2026-05-15T00:00:00Z", maxResults: 1 });
    const create = await registry.call("calendar_create_event", {
      summary: "Planning",
      start: "2026-05-16T10:00:00+05:30",
      end: "2026-05-16T10:30:00+05:30",
      attendees: "ana@example.com, ben@example.com"
    });

    assert.equal(list.ok, true);
    assert.match(list.output, /Standup/);
    assert.equal(create.ok, true);
    assert.match(create.output, /event-2/);
    assert.equal(createdEvent.summary, "Planning");
    assert.deepEqual(createdEvent.attendees, [{ email: "ana@example.com" }, { email: "ben@example.com" }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("google status and logout use local OAuth file", () => {
  const config = tempConfig();
  seedOAuth(config.googleOAuthPath);
  assert.match(googleStatus(config), /Google OAuth connected/);
  assert.equal(logoutGoogle(config), "Google OAuth credentials removed.");
  assert.match(googleStatus(config), /not connected/);
});

function gmailMessage(id: string, snippet: string, body = "") {
  return {
    id,
    threadId: "thread-1",
    snippet,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Ana <ana@example.com>" },
        { name: "To", value: "You <you@example.com>" },
        { name: "Subject", value: "Subject line" },
        { name: "Date", value: "Fri, 15 May 2026 10:00:00 +0530" }
      ],
      body: body ? { data: encodeBase64Url(body) } : {}
    }
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function seedOAuth(file: string, accessToken = "expired-token", expiresAt = new Date(Date.now() - 1000).toISOString()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        accessToken,
        expiresAt,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"]
      },
      null,
      2
    ),
    "utf8"
  );
}

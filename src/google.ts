import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { ButterclawConfig } from "./config.js";
import type { ToolResult } from "./tools.js";
import { isRecord, readJsonFile, splitCsv, truncate, writeJsonFile } from "./util.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events"
];

type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

interface RegistryLike {
  register(spec: {
    name: string;
    description: string;
    args: Record<string, string>;
    handler: ToolHandler;
  }): void;
}

interface GoogleRequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  queryList?: Array<[string, string]>;
  body?: unknown;
}

interface GoogleOAuthState {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleLoginOptions {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  openBrowser?: boolean;
  timeoutMs?: number;
  output?: (line: string) => void;
}

export function registerGoogleTools(registry: RegistryLike, config: ButterclawConfig): void {
  const google = new GoogleWorkspaceTools(config);
  registry.register({
    name: "gmail_search",
    description: "Search Gmail messages and return concise metadata",
    args: { query: "Gmail search query", maxResults: "optional result limit, default 5" },
    handler: (args) => google.searchGmail(args)
  });
  registry.register({
    name: "gmail_read",
    description: "Read a Gmail message by id",
    args: { id: "Gmail message id", maxChars: "optional body character limit" },
    handler: (args) => google.readGmail(args)
  });
  registry.register({
    name: "gmail_create_draft",
    description: "Create a Gmail draft without sending it",
    args: { to: "recipient email(s)", subject: "draft subject", body: "plain text body", cc: "optional", bcc: "optional" },
    handler: (args) => google.createGmailDraft(args)
  });
  registry.register({
    name: "calendar_list_events",
    description: "List Google Calendar events",
    args: { calendarId: "optional calendar id, default config", timeMin: "optional ISO start", timeMax: "optional ISO end", maxResults: "optional limit" },
    handler: (args) => google.listCalendarEvents(args)
  });
  registry.register({
    name: "calendar_create_event",
    description: "Create a Google Calendar event",
    args: { summary: "event title", start: "ISO date or datetime", end: "ISO date or datetime", calendarId: "optional", description: "optional", attendees: "optional comma-separated emails" },
    handler: (args) => google.createCalendarEvent(args)
  });
}

export async function loginGoogle(config: ButterclawConfig, options: GoogleLoginOptions = {}): Promise<string> {
  const output = options.output ?? console.log;
  const clientId = options.clientId?.trim() || process.env[config.googleClientIdEnv]?.trim();
  const clientSecret = options.clientSecret?.trim() || process.env[config.googleClientSecretEnv]?.trim();
  if (!clientId) {
    throw new Error(`Missing Google OAuth client ID. Pass --client-id or set ${config.googleClientIdEnv}.`);
  }

  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const scopes = options.scopes?.length ? options.scopes : GOOGLE_WORKSPACE_SCOPES;
  const server = await listenForOAuthCode(state, options.timeoutMs ?? 180_000);
  const authUrl = buildAuthUrl({
    clientId,
    redirectUri: server.redirectUri,
    scopes,
    state,
    codeChallenge: sha256Base64Url(verifier)
  });

  output("Opening Google OAuth consent in your browser.");
  output(authUrl);
  if (options.openBrowser !== false) {
    openBrowser(authUrl);
  }

  const code = await server.code;
  const token = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri: server.redirectUri, codeVerifier: verifier });
  if (!token.refresh_token) {
    throw new Error("Google did not return a refresh token. Re-run login and approve offline access/consent.");
  }
  saveOAuthState(config, {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes,
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    expiresAt: expiresAt(token.expires_in),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return `Google OAuth connected. Saved credentials to ${config.googleOAuthPath}`;
}

export function googleStatus(config: ButterclawConfig): string {
  const state = loadOAuthState(config);
  if (!state.refreshToken) {
    return "Google OAuth is not connected. Run: butterclaw google login";
  }
  return [
    "Google OAuth connected.",
    `Client ID: ${state.clientId ?? "(unknown)"}`,
    `Scopes: ${(state.scopes ?? []).join(", ") || "(unknown)"}`,
    `Access token expires: ${state.expiresAt ?? "(unknown)"}`,
    `Stored at: ${config.googleOAuthPath}`
  ].join("\n");
}

export function logoutGoogle(config: ButterclawConfig): string {
  if (fs.existsSync(config.googleOAuthPath)) {
    fs.rmSync(config.googleOAuthPath);
  }
  return "Google OAuth credentials removed.";
}

export function buildAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    state: input.state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(input: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return tokenRequest({
    client_id: input.clientId,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code"
  });
}

class GoogleOAuth {
  constructor(private readonly config: ButterclawConfig) {}

  async accessToken(): Promise<string> {
    const state = loadOAuthState(this.config);
    if (!state.refreshToken || !state.clientId) {
      throw new Error("Google OAuth is not connected. Run: butterclaw google login");
    }
    if (state.accessToken && state.expiresAt && Date.parse(state.expiresAt) > Date.now() + 60_000) {
      return state.accessToken;
    }
    const token = await tokenRequest({
      client_id: state.clientId,
      ...(state.clientSecret ? { client_secret: state.clientSecret } : {}),
      refresh_token: state.refreshToken,
      grant_type: "refresh_token"
    });
    if (!token.access_token) {
      throw new Error("Google OAuth refresh did not return an access token.");
    }
    const next = {
      ...state,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? state.refreshToken,
      expiresAt: expiresAt(token.expires_in),
      updatedAt: new Date().toISOString()
    };
    saveOAuthState(this.config, next);
    return next.accessToken;
  }
}

class GoogleWorkspaceTools {
  private readonly oauth: GoogleOAuth;

  constructor(private readonly config: ButterclawConfig) {
    this.oauth = new GoogleOAuth(config);
  }

  async searchGmail(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    const maxResults = boundedInt(args.maxResults, 1, 10, 5);
    const list = await this.gmail("messages", {
      query: { q: query || undefined, maxResults, includeSpamTrash: Boolean(args.includeSpamTrash) || undefined }
    });
    const messages = Array.isArray(list.messages) ? list.messages.filter(isRecord) : [];
    if (!messages.length) {
      return { ok: true, output: "No Gmail messages found." };
    }
    const rows = [];
    for (const message of messages.slice(0, maxResults)) {
      const id = String(message.id ?? "");
      if (!id) continue;
      const detail = await this.gmail(`messages/${encodeURIComponent(id)}`, {
        query: { format: "metadata" },
        queryList: ["From", "To", "Subject", "Date"].map((header) => ["metadataHeaders", header])
      });
      rows.push(formatGmailSummary(detail));
    }
    return { ok: true, output: rows.join("\n") || "No Gmail messages found." };
  }

  async readGmail(args: Record<string, unknown>): Promise<ToolResult> {
    const id = String(args.id ?? "").trim();
    if (!id) {
      return { ok: false, output: "id is required" };
    }
    const maxChars = boundedInt(args.maxChars, 500, 50_000, 8_000);
    const message = await this.gmail(`messages/${encodeURIComponent(id)}`, { query: { format: "full" } });
    const headers = headersFrom(message);
    const body = truncate(extractPayloadText(message.payload).trim() || String(message.snippet ?? ""), maxChars);
    return {
      ok: true,
      output: [
        `Id: ${String(message.id ?? id)}`,
        `Thread: ${String(message.threadId ?? "")}`,
        `Date: ${headers.date ?? ""}`,
        `From: ${headers.from ?? ""}`,
        `To: ${headers.to ?? ""}`,
        `Subject: ${headers.subject ?? ""}`,
        `Snippet: ${String(message.snippet ?? "")}`,
        "",
        body || "(empty message body)"
      ].join("\n")
    };
  }

  async createGmailDraft(args: Record<string, unknown>): Promise<ToolResult> {
    const to = String(args.to ?? "").trim();
    const subject = String(args.subject ?? "").trim();
    const body = String(args.body ?? "");
    if (!to || !subject) {
      return { ok: false, output: "to and subject are required" };
    }
    const raw = encodeBase64Url(
      buildMimeMessage({
        to,
        cc: String(args.cc ?? "").trim(),
        bcc: String(args.bcc ?? "").trim(),
        subject,
        body
      })
    );
    const draft = await this.gmail("drafts", { method: "POST", body: { message: { raw } } });
    return { ok: true, output: `Created Gmail draft ${String(draft.id ?? "(unknown id)")} for ${to}: ${subject}` };
  }

  async listCalendarEvents(args: Record<string, unknown>): Promise<ToolResult> {
    const calendarId = this.calendarId(args.calendarId);
    const now = new Date().toISOString();
    const result = await this.calendar(calendarId, "events", {
      query: {
        timeMin: String(args.timeMin ?? now),
        timeMax: optionalString(args.timeMax),
        maxResults: boundedInt(args.maxResults, 1, 25, 10),
        singleEvents: true,
        orderBy: "startTime"
      }
    });
    const events = Array.isArray(result.items) ? result.items.filter(isRecord) : [];
    if (!events.length) {
      return { ok: true, output: "No calendar events found." };
    }
    return {
      ok: true,
      output: events
        .map((event) => {
          const start = eventDate(event.start);
          const end = eventDate(event.end);
          return `${start}${end ? ` - ${end}` : ""}: ${String(event.summary ?? "(untitled)")} [${String(event.id ?? "")}]`;
        })
        .join("\n")
    };
  }

  async createCalendarEvent(args: Record<string, unknown>): Promise<ToolResult> {
    const calendarId = this.calendarId(args.calendarId);
    const summary = String(args.summary ?? "").trim();
    const start = String(args.start ?? "").trim();
    const end = String(args.end ?? "").trim();
    if (!summary || !start || !end) {
      return { ok: false, output: "summary, start, and end are required" };
    }
    const timeZone = optionalString(args.timeZone);
    const event = await this.calendar(calendarId, "events", {
      method: "POST",
      query: { sendUpdates: optionalString(args.sendUpdates) },
      body: {
        summary,
        description: optionalString(args.description),
        location: optionalString(args.location),
        start: eventTime(start, timeZone),
        end: eventTime(end, timeZone),
        attendees: splitCsv(String(args.attendees ?? "")).map((email) => ({ email }))
      }
    });
    return {
      ok: true,
      output: `Created calendar event ${String(event.id ?? "(unknown id)")}: ${String(event.summary ?? summary)}${event.htmlLink ? `\n${String(event.htmlLink)}` : ""}`
    };
  }

  private async gmail(path: string, options: GoogleRequestOptions = {}): Promise<Record<string, unknown>> {
    return this.request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, options);
  }

  private async calendar(calendarId: string, path: string, options: GoogleRequestOptions = {}): Promise<Record<string, unknown>> {
    return this.request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/${path}`, options);
  }

  private async request(url: string, options: GoogleRequestOptions): Promise<Record<string, unknown>> {
    const response = await fetch(withQuery(url, options.query, options.queryList), {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${await this.oauth.accessToken()}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(removeUndefined(options.body)),
      signal: AbortSignal.timeout(this.config.requestTimeoutSeconds * 1000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Google API HTTP ${response.status}: ${truncate(text, 500)}`);
    }
    if (!text.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : {};
    } catch {
      throw new Error(`Google API returned non-JSON response: ${truncate(text, 500)}`);
    }
  }

  private calendarId(value: unknown): string {
    return String(value ?? this.config.googleCalendarId ?? "primary").trim() || "primary";
  }
}

function loadOAuthState(config: ButterclawConfig): GoogleOAuthState {
  return readJsonFile<GoogleOAuthState>(config.googleOAuthPath, {});
}

function saveOAuthState(config: ButterclawConfig, state: GoogleOAuthState): void {
  writeJsonFile(config.googleOAuthPath, state);
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString()
  });
  const text = await response.text();
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Google OAuth returned non-JSON response: ${truncate(text, 500)}`);
  }
  if (!response.ok || parsed.error) {
    throw new Error(`Google OAuth failed: ${parsed.error_description ?? parsed.error ?? text}`);
  }
  return parsed;
}

function listenForOAuthCode(expectedState: string, timeoutMs: number): Promise<{ redirectUri: string; code: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google OAuth callback."));
    }, timeoutMs);
    const code = new Promise<string>((codeResolve, codeReject) => {
      server.on("request", (request, response) => {
        try {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          const actualState = url.searchParams.get("state");
          const error = url.searchParams.get("error");
          const authCode = url.searchParams.get("code");
          if (actualState !== expectedState) {
            throw new Error("OAuth state mismatch.");
          }
          if (error) {
            throw new Error(`Google OAuth error: ${error}`);
          }
          if (!authCode) {
            throw new Error("OAuth callback did not include a code.");
          }
          response.writeHead(200, { "Content-Type": "text/plain" });
          response.end("Butterclaw Google OAuth is connected. You can close this tab.");
          clearTimeout(timer);
          server.close();
          codeResolve(authCode);
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end(error instanceof Error ? error.message : String(error));
          clearTimeout(timer);
          server.close();
          codeReject(error);
        }
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!isRecord(address) || typeof address.port !== "number") {
        reject(new Error("Could not start local OAuth callback server."));
        return;
      }
      resolve({ redirectUri: `http://127.0.0.1:${address.port}/oauth2callback`, code });
    });
  });
}

function openBrowser(url: string): void {
  const command: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = childProcess.spawn(command[0], command[1], { detached: true, stdio: "ignore", shell: false });
  child.unref();
}

function randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function expiresAt(expiresIn = 3600): string {
  return new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
}

function formatGmailSummary(message: Record<string, unknown>): string {
  const headers = headersFrom(message);
  return [
    String(message.id ?? "(no id)"),
    headers.date ?? "",
    headers.from ?? "",
    headers.subject ?? "(no subject)",
    truncate(String(message.snippet ?? ""), 160)
  ]
    .filter(Boolean)
    .join(" | ");
}

function headersFrom(message: Record<string, unknown>): Record<string, string> {
  const payload = isRecord(message.payload) ? message.payload : {};
  const headers = Array.isArray(payload.headers) ? payload.headers.filter(isRecord) : [];
  const output: Record<string, string> = {};
  for (const header of headers) {
    const name = String(header.name ?? "").toLowerCase();
    if (name) output[name] = String(header.value ?? "");
  }
  return output;
}

function extractPayloadText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const mimeType = String(payload.mimeType ?? "");
  const body = isRecord(payload.body) && typeof payload.body.data === "string" ? decodeBase64Url(payload.body.data) : "";
  if (mimeType === "text/plain" && body) {
    return body;
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const plain = parts.map(extractPayloadText).filter(Boolean).join("\n").trim();
  if (plain) {
    return plain;
  }
  if (mimeType === "text/html" && body) {
    return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return body;
}

function buildMimeMessage(message: { to: string; cc: string; bcc: string; subject: string; body: string }): string {
  const headers = [
    ["To", message.to],
    ["Cc", message.cc],
    ["Bcc", message.bcc],
    ["Subject", encodeHeader(message.subject)],
    ["MIME-Version", "1.0"],
    ["Content-Type", 'text/plain; charset="UTF-8"']
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${cleanHeader(value)}`);
  return `${headers.join("\r\n")}\r\n\r\n${message.body}`;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function cleanHeader(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function withQuery(url: string, query: GoogleRequestOptions["query"] = {}, queryList: Array<[string, string]> = []): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  for (const [key, value] of queryList) {
    params.append(key, value);
  }
  const text = params.toString();
  return text ? `${url}?${text}` : url;
}

function eventTime(value: string, timeZone?: string): Record<string, string> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: value };
  }
  return { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

function eventDate(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return String(value.dateTime ?? value.date ?? "");
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, removeUndefined(entry)]));
}

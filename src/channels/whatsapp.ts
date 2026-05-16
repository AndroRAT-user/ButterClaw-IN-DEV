import childProcess from "node:child_process";
import http from "node:http";
import { ButterclawAgent } from "../agent.js";
import { ButterclawConfig } from "../config.js";
import type { ToolResult, ToolSpec } from "../tools.js";
import { ensureParent, isRecord, readJsonFile, truncate, writeJsonFile } from "../util.js";
import { channelSessionName, chunkChannelText, decideChannelAccess, ChannelChatType } from "./policy.js";

export class WhatsAppError extends Error {}

export interface WhatsAppClientProtocol {
  sendText(to: string, text: string): Promise<void>;
  status(): string;
}

export interface WhatsAppInboundMessage {
  from: string;
  text: string;
  chatType: ChannelChatType;
  conversationId?: string;
  messageId?: string;
  mentioned?: boolean;
}

interface RegistryLike {
  register(spec: ToolSpec): void;
}

export function registerWhatsAppTools(
  registry: RegistryLike,
  config: ButterclawConfig,
  client: WhatsAppClientProtocol = buildWhatsAppClient(config)
): void {
  const channel = new WhatsAppChannel(config, client);
  registry.register({
    name: "whatsapp_status",
    description: "Check WhatsApp channel mode, policy, and outbound readiness",
    args: {},
    handler: () => ({ ok: true, output: whatsappStatus(config, client) })
  });
  registry.register({
    name: "whatsapp_send",
    description: "Send a WhatsApp text message through the configured bridge or Cloud API",
    args: { to: "E.164 number, WhatsApp id, or bridge target", text: "message text" },
    handler: (args) => channel.sendTool(args)
  });
}

export function buildWhatsAppClient(config: ButterclawConfig): WhatsAppClientProtocol {
  return config.whatsappMode === "cloud" ? new WhatsAppCloudClient(config) : new WhatsAppBridgeClient(config);
}

export function whatsappStatus(config: ButterclawConfig, client: WhatsAppClientProtocol = buildWhatsAppClient(config)): string {
  return [
    `Mode: ${config.whatsappMode}`,
    `Default target: ${config.whatsappDefaultTo || "(none)"}`,
    `DM policy: ${config.whatsappDmPolicy}`,
    `Group policy: ${config.whatsappGroupPolicy}`,
    `Webhook: http://127.0.0.1:${config.whatsappWebhookPort}${config.whatsappWebhookPath}`,
    client.status()
  ].join("\n");
}

export class WhatsAppBridgeClient implements WhatsAppClientProtocol {
  constructor(private readonly config: ButterclawConfig) {}

  async sendText(to: string, text: string): Promise<void> {
    const template = process.env[this.config.whatsappBridgeCommandEnv]?.trim();
    if (!template) {
      throw new WhatsAppError(`Missing bridge command. Set ${this.config.whatsappBridgeCommandEnv} to a command that sends {text} to {to}.`);
    }
    const command = template.includes("{to}") || template.includes("{text}") ? fillCommandTemplate(template, { to, text }) : `${template} ${quoteForShell(to)} ${quoteForShell(text)}`;
    const result = childProcess.spawnSync(command, {
      cwd: this.config.workspace,
      shell: true,
      encoding: "utf8",
      timeout: this.config.requestTimeoutSeconds * 1000
    });
    if (result.status !== 0) {
      throw new WhatsAppError(truncate(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || result.error?.message || "WhatsApp bridge command failed.", 2000));
    }
  }

  status(): string {
    return process.env[this.config.whatsappBridgeCommandEnv]
      ? `Bridge command env ${this.config.whatsappBridgeCommandEnv} is set.`
      : `Bridge command env ${this.config.whatsappBridgeCommandEnv} is not set.`;
  }
}

export class WhatsAppCloudClient implements WhatsAppClientProtocol {
  constructor(private readonly config: ButterclawConfig) {}

  async sendText(to: string, text: string): Promise<void> {
    const token = process.env[this.config.whatsappCloudTokenEnv]?.trim();
    const phoneNumberId = process.env[this.config.whatsappPhoneNumberIdEnv]?.trim();
    if (!token || !phoneNumberId) {
      throw new WhatsAppError(`Missing WhatsApp Cloud API env vars: ${this.config.whatsappCloudTokenEnv} and ${this.config.whatsappPhoneNumberIdEnv}.`);
    }
    const response = await fetch(`https://graph.facebook.com/${this.config.whatsappGraphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text }
      }),
      signal: AbortSignal.timeout(this.config.requestTimeoutSeconds * 1000)
    });
    const body = await response.text();
    if (!response.ok) {
      throw new WhatsAppError(`WhatsApp Cloud API HTTP ${response.status}: ${truncate(body, 1000)}`);
    }
  }

  status(): string {
    const hasToken = Boolean(process.env[this.config.whatsappCloudTokenEnv]);
    const hasPhone = Boolean(process.env[this.config.whatsappPhoneNumberIdEnv]);
    return [
      `Cloud API version: ${this.config.whatsappGraphApiVersion}`,
      `${this.config.whatsappCloudTokenEnv}: ${hasToken ? "set" : "not set"}`,
      `${this.config.whatsappPhoneNumberIdEnv}: ${hasPhone ? "set" : "not set"}`
    ].join("\n");
  }
}

export class WhatsAppChannel {
  private readonly statePath: string;

  constructor(
    private readonly config: ButterclawConfig,
    private readonly client: WhatsAppClientProtocol = buildWhatsAppClient(config)
  ) {
    this.statePath = config.whatsappStatePath;
    ensureParent(this.statePath);
  }

  async sendTool(args: Record<string, unknown>): Promise<ToolResult> {
    const to = String(args.to ?? this.config.whatsappDefaultTo ?? "").trim();
    const text = String(args.text ?? args.message ?? "").trim();
    if (!to) {
      return { ok: false, output: "to is required, or set whatsappDefaultTo." };
    }
    if (!text) {
      return { ok: false, output: "text is required." };
    }
    try {
      await this.sendText(to, text);
      return { ok: true, output: `Sent WhatsApp message to ${to}` };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  async runWebhook(agentFactory: (sessionName: string) => ButterclawAgent = (sessionName) => new ButterclawAgent(this.config, { sessionName })): Promise<number> {
    const server = http.createServer((req, res) => {
      void this.handleWebhookRequest(req, res, agentFactory);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.whatsappWebhookPort, "127.0.0.1", () => resolve());
    });
    console.log(`Butterclaw WhatsApp webhook listening on http://127.0.0.1:${this.config.whatsappWebhookPort}${this.config.whatsappWebhookPath}`);
    return new Promise<number>((resolve) => {
      server.once("close", () => resolve(0));
    });
  }

  async handleMessage(agent: ButterclawAgent, message: WhatsAppInboundMessage): Promise<string> {
    const decision = decideChannelAccess({
      chatType: message.chatType,
      from: message.from,
      conversationId: message.conversationId,
      text: message.text,
      mentioned: message.mentioned,
      dmPolicy: this.config.whatsappDmPolicy,
      groupPolicy: this.config.whatsappGroupPolicy,
      allowFrom: this.config.whatsappAllowedChats,
      groupAllowFrom: this.config.whatsappGroupAllowedChats,
      requireMentionInGroups: this.config.whatsappRequireMentionInGroups,
      mentionPatterns: this.config.whatsappMentionPatterns
    });
    if (!decision.ok) {
      return `Ignored WhatsApp message from ${message.from}: ${decision.reason}`;
    }

    if (message.text.trim() === "/help" || message.text.trim() === "/start") {
      await this.sendText(message.from, "Butterclaw is online on WhatsApp. Send a task or /tools.");
      return "sent help";
    }
    if (message.text.trim() === "/tools") {
      await this.sendText(message.from, agent.registry.describe());
      return "sent tools";
    }

    const result = await agent.run(message.text);
    await this.sendText(message.from, result.answer);
    this.saveState({ lastMessageAt: new Date().toISOString(), lastFrom: message.from });
    return "processed";
  }

  private async sendText(to: string, text: string): Promise<void> {
    for (const chunk of chunkChannelText(text, this.config.whatsappTextChunkLimit, this.config.whatsappChunkMode)) {
      await this.client.sendText(to, chunk);
    }
  }

  private async handleWebhookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agentFactory: (sessionName: string) => ButterclawAgent
  ): Promise<void> {
    if (!req.url?.startsWith(this.config.whatsappWebhookPath)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    if (req.method === "GET") {
      this.handleWebhookVerify(req, res);
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      res.end("Method Not Allowed");
      return;
    }
    try {
      const body = await readBody(req, 1024 * 1024);
      const payload = body ? JSON.parse(body) : {};
      const messages = extractWhatsAppMessages(payload);
      res.statusCode = 200;
      res.end("OK");
      for (const message of messages) {
        const sessionName = channelSessionName("whatsapp", message.chatType, message.conversationId ?? message.from);
        await this.handleMessage(agentFactory(sessionName), message);
      }
    } catch (error) {
      res.statusCode = 400;
      res.end(error instanceof Error ? error.message : String(error));
    }
  }

  private handleWebhookVerify(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const expected = process.env[this.config.whatsappVerifyTokenEnv] ?? "";
    const actual = url.searchParams.get("hub.verify_token") ?? url.searchParams.get("verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (!expected || actual !== expected) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    res.statusCode = 200;
    res.end(challenge || "OK");
  }

  private saveState(state: Record<string, unknown>): void {
    writeJsonFile(this.statePath, { ...readJsonFile<Record<string, unknown>>(this.statePath, {}), ...state });
  }
}

export function extractWhatsAppMessages(payload: unknown): WhatsAppInboundMessage[] {
  if (!isRecord(payload)) {
    return [];
  }
  if (typeof payload.from === "string" && typeof payload.text === "string") {
    return [
      {
        from: payload.from,
        text: payload.text,
        chatType: payload.chatType === "group" ? "group" : "direct",
        conversationId: typeof payload.conversationId === "string" ? payload.conversationId : undefined,
        messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
        mentioned: Boolean(payload.mentioned)
      }
    ];
  }

  const messages: WhatsAppInboundMessage[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry.filter(isRecord) : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes.filter(isRecord) : [];
    for (const change of changes) {
      const value = isRecord(change.value) ? change.value : {};
      const rawMessages = Array.isArray(value.messages) ? value.messages.filter(isRecord) : [];
      for (const raw of rawMessages) {
        const text = isRecord(raw.text) && typeof raw.text.body === "string" ? raw.text.body : "";
        const from = typeof raw.from === "string" ? raw.from : "";
        if (!from || !text) continue;
        messages.push({
          from,
          text,
          chatType: "direct",
          messageId: typeof raw.id === "string" ? raw.id : undefined,
          conversationId: from
        });
      }
    }
  }
  return messages;
}

function fillCommandTemplate(template: string, values: { to: string; text: string }): string {
  return template.replace(/\{to\}/g, quoteForShell(values.to)).replace(/\{text\}/g, quoteForShell(values.text));
}

function quoteForShell(value: string): string {
  return JSON.stringify(value);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

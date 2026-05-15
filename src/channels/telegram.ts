import { ButterclawAgent } from "../agent.js";
import { ButterclawConfig } from "../config.js";
import { ensureParent, isRecord, readJsonFile, trimTrailingSlash, writeJsonFile } from "../util.js";

export class TelegramError extends Error {}

export interface TelegramClientProtocol {
  getUpdates(offset: number | null, timeout: number): Promise<Record<string, unknown>[]>;
  sendMessage(chatId: number | string, text: string, replyToMessageId?: number): Promise<void>;
  sendChatAction(chatId: number | string, action: string): Promise<void>;
}

export interface TelegramMessage {
  updateId: number;
  chatId: number | string;
  messageId: number;
  text: string;
  senderLabel: string;
}

export class TelegramClient implements TelegramClientProtocol {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.telegram.org",
    private readonly timeoutSeconds = 60
  ) {
    if (!token) {
      throw new TelegramError("Telegram token is empty.");
    }
  }

  async getUpdates(offset: number | null, timeout: number): Promise<Record<string, unknown>[]> {
    const payload: Record<string, unknown> = { timeout, allowed_updates: ["message"] };
    if (offset !== null) {
      payload.offset = offset;
    }
    const result = await this.call("getUpdates", payload);
    return Array.isArray(result) ? result.filter(isRecord) : [];
  }

  async sendMessage(chatId: number | string, text: string, replyToMessageId?: number): Promise<void> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    };
    if (replyToMessageId !== undefined) {
      payload.reply_to_message_id = replyToMessageId;
    }
    await this.call("sendMessage", payload);
  }

  async sendChatAction(chatId: number | string, action: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${trimTrailingSlash(this.baseUrl)}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutSeconds * 1000)
    });
    const text = await response.text();
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new TelegramError(`Telegram returned non-JSON response: ${text.slice(0, 500)}`);
    }
    if (!response.ok || !raw.ok) {
      throw new TelegramError(`Telegram API error: ${text}`);
    }
    return raw.result;
  }
}

export class TelegramChannel {
  private readonly allowedChats: Set<string>;
  private readonly statePath: string;

  constructor(
    private readonly config: ButterclawConfig,
    private readonly client: TelegramClientProtocol = new TelegramClient(
      process.env[config.telegramTokenEnv] ?? "",
      config.telegramBaseUrl,
      config.requestTimeoutSeconds
    )
  ) {
    this.allowedChats = new Set(config.telegramAllowedChats);
    this.statePath = config.telegramStatePath;
    ensureParent(this.statePath);
  }

  async runForever(agent: ButterclawAgent, once = false): Promise<number> {
    let processedTotal = 0;
    console.log("Butterclaw Telegram channel is polling. Press Ctrl+C to stop.");
    while (true) {
      const processed = await this.pollOnce(agent);
      processedTotal += processed;
      if (once) {
        return processedTotal;
      }
      if (processed === 0) {
        await sleep(this.config.telegramIdleSleepSeconds * 1000);
      }
    }
  }

  async pollOnce(agent: ButterclawAgent): Promise<number> {
    const state = this.loadState();
    const offset = typeof state.offset === "number" ? state.offset : null;
    const updates = await this.client.getUpdates(offset, this.config.telegramPollTimeoutSeconds);
    let processed = 0;
    for (const update of updates) {
      const updateId = update.update_id;
      if (typeof updateId === "number") {
        state.offset = updateId + 1;
        this.saveState(state);
      }
      const message = extractTextMessage(update);
      if (!message) {
        continue;
      }
      if (!this.chatAllowed(message.chatId)) {
        console.log(`Ignored Telegram message from unauthorized chat ${message.chatId}.`);
        continue;
      }
      processed += 1;
      await this.handleMessage(agent, message);
    }
    return processed;
  }

  private async handleMessage(agent: ButterclawAgent, message: TelegramMessage): Promise<void> {
    const command = message.text.trim().split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
    if (command === "/start" || command === "/help") {
      await this.reply(
        message,
        "Butterclaw is online. Send a task in plain language. Use /tools to list local tools. Shell stays disabled unless the host started me with --allow-shell."
      );
      return;
    }
    if (command === "/tools") {
      await this.reply(message, agent.registry.describe());
      return;
    }
    if (command === "/usage") {
      const usage = agent.usage.current();
      await this.reply(
        message,
        `Today: ${usage.requests} requests, ${usage.promptTokens} prompt tokens, ${usage.completionTokens} completion tokens.`
      );
      return;
    }

    try {
      await this.client.sendChatAction(message.chatId, "typing");
    } catch {
      // Typing indicators are nice to have, not required.
    }

    try {
      const result = await agent.run(message.text);
      await this.reply(message, result.answer);
    } catch (error) {
      await this.reply(message, `Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async reply(message: TelegramMessage, text: string): Promise<void> {
    const chunks = splitTelegramText(text, this.config.telegramMaxReplyChars);
    for (const [index, chunk] of chunks.entries()) {
      await this.client.sendMessage(message.chatId, chunk, index === 0 ? message.messageId : undefined);
    }
  }

  private chatAllowed(chatId: string | number): boolean {
    return this.allowedChats.size === 0 || this.allowedChats.has(String(chatId));
  }

  private loadState(): Record<string, unknown> {
    return readJsonFile<Record<string, unknown>>(this.statePath, {});
  }

  private saveState(state: Record<string, unknown>): void {
    writeJsonFile(this.statePath, state);
  }
}

export function extractTextMessage(update: Record<string, unknown>): TelegramMessage | null {
  const updateId = update.update_id;
  const rawMessage = update.message;
  if (typeof updateId !== "number" || !isRecord(rawMessage)) {
    return null;
  }
  const text = rawMessage.text;
  const chat = rawMessage.chat;
  const messageId = rawMessage.message_id;
  if (typeof text !== "string" || !isRecord(chat) || typeof messageId !== "number") {
    return null;
  }
  const chatId = chat.id;
  if (typeof chatId !== "number" && typeof chatId !== "string") {
    return null;
  }
  const sender = rawMessage.from;
  let senderLabel = "unknown";
  if (isRecord(sender)) {
    senderLabel = String(sender.username ?? sender.first_name ?? sender.id ?? "unknown");
  }
  return { updateId, chatId, messageId, text, senderLabel };
}

export function splitTelegramText(text: string, maxChars = 3900): string[] {
  maxChars = Math.max(maxChars, 100);
  let remaining = text || "(empty response)";
  const chunks: string[] = [];
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < maxChars / 2) {
      splitAt = remaining.lastIndexOf(" ", maxChars);
    }
    if (splitAt < maxChars / 2) {
      splitAt = maxChars;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length ? chunks : ["(empty response)"];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent } from "../src/agent.js";
import { extractTextMessage, splitTelegramText, TelegramChannel, TelegramClientProtocol } from "../src/channels/telegram.js";
import { defaultConfig } from "../src/config.js";

class FakeTelegramClient implements TelegramClientProtocol {
  sent: Array<[number | string, string, number | undefined]> = [];
  actions: Array<[number | string, string]> = [];
  lastOffset: number | null = null;

  constructor(private readonly updates: Record<string, unknown>[]) {}

  async getUpdates(offset: number | null): Promise<Record<string, unknown>[]> {
    this.lastOffset = offset;
    return this.updates;
  }

  async sendMessage(chatId: number | string, text: string, replyToMessageId?: number): Promise<void> {
    this.sent.push([chatId, text, replyToMessageId]);
  }

  async sendChatAction(chatId: number | string, action: string): Promise<void> {
    this.actions.push([chatId, action]);
  }
}

test("extractTextMessage reads Telegram updates", () => {
  const message = extractTextMessage({
    update_id: 4,
    message: { message_id: 9, text: "hello", chat: { id: 123 }, from: { username: "ana" } }
  });
  assert.equal(message?.chatId, 123);
  assert.equal(message?.text, "hello");
});

test("splitTelegramText chunks long messages", () => {
  assert.deepEqual(
    splitTelegramText("a".repeat(250), 100).map((chunk) => chunk.length),
    [100, 100, 50]
  );
});

test("channel handles help and saves offset", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-telegram-"));
  const config = defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    telegramAllowedChats: ["123"],
    telegramStatePath: path.join(root, ".config", "telegram-state.json")
  });
  const client = new FakeTelegramClient([
    {
      update_id: 10,
      message: { message_id: 5, text: "/help", chat: { id: 123 }, from: { first_name: "Anant" } }
    }
  ]);
  const processed = await new TelegramChannel(config, client).pollOnce(new ButterclawAgent(config));
  assert.equal(processed, 1);
  assert.equal(client.sent[0][0], 123);
  assert.equal(client.sent[0][2], 5);
  assert.match(fs.readFileSync(config.telegramStatePath, "utf8"), /"offset": 11/);
});


import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent } from "../src/agent.js";
import { chunkChannelText, decideChannelAccess } from "../src/channels/policy.js";
import { extractWhatsAppMessages, WhatsAppChannel, WhatsAppClientProtocol } from "../src/channels/whatsapp.js";
import { defaultConfig } from "../src/config.js";

class FakeWhatsAppClient implements WhatsAppClientProtocol {
  sent: Array<[string, string]> = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push([to, text]);
  }

  status(): string {
    return "fake client ready";
  }
}

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-wa-"));
  return defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    whatsappDmPolicy: "open",
    whatsappAllowedChats: ["*"],
    whatsappTextChunkLimit: 120,
    whatsappStatePath: path.join(root, ".config", "whatsapp-state.json")
  });
}

test("channel policy follows OpenClaw-style deny, allowlist, open, and mention gates", () => {
  assert.equal(
    decideChannelAccess({
      chatType: "direct",
      from: "1555",
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      allowFrom: ["1555"],
      groupAllowFrom: []
    }).ok,
    true
  );
  assert.equal(
    decideChannelAccess({
      chatType: "direct",
      from: "1555",
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      allowFrom: [],
      groupAllowFrom: []
    }).reason,
    "pairing required for unknown sender"
  );
  assert.equal(
    decideChannelAccess({
      chatType: "group",
      from: "1555",
      conversationId: "group-1",
      text: "hello",
      dmPolicy: "open",
      groupPolicy: "open",
      allowFrom: ["*"],
      groupAllowFrom: [],
      requireMentionInGroups: true,
      mentionPatterns: ["butterclaw"]
    }).ok,
    false
  );
});

test("whatsapp text chunks respect channel limits", () => {
  assert.deepEqual(
    chunkChannelText("a".repeat(250), 100).map((chunk) => chunk.length),
    [100, 100, 50]
  );
  assert.deepEqual(chunkChannelText("one\ntwo", 100, "newline"), ["one", "two"]);
});

test("extractWhatsAppMessages reads bridge and Meta Cloud API payloads", () => {
  assert.deepEqual(extractWhatsAppMessages({ from: "1555", text: "hi", chatType: "group", conversationId: "g1", mentioned: true }), [
    { from: "1555", text: "hi", chatType: "group", conversationId: "g1", mentioned: true, messageId: undefined }
  ]);

  const meta = extractWhatsAppMessages({
    entry: [{ changes: [{ value: { messages: [{ from: "1666", id: "wamid.1", text: { body: "hello" } }] } }] }]
  });
  assert.equal(meta.length, 1);
  assert.equal(meta[0].from, "1666");
  assert.equal(meta[0].text, "hello");
});

test("whatsapp channel sends agent replies through the configured client", async () => {
  const config = tempConfig();
  const client = new FakeWhatsAppClient();
  const channel = new WhatsAppChannel(config, client);

  const outcome = await channel.handleMessage(new ButterclawAgent(config), {
    from: "1555",
    text: "hello",
    chatType: "direct"
  });

  assert.equal(outcome, "processed");
  assert.equal(client.sent[0][0], "1555");
  assert.match(client.sent[0][1], /Butterclaw mock provider/);
  assert.match(fs.readFileSync(config.whatsappStatePath, "utf8"), /lastFrom/);
});

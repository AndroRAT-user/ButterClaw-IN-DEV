import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent, parseToolCall } from "../src/agent.js";
import { defaultConfig } from "../src/config.js";

test("parseToolCall reads JSON tool calls", () => {
  assert.deepEqual(parseToolCall('{"tool":"list_dir","args":{"path":"."}}'), {
    tool: "list_dir",
    args: { path: "." }
  });
});

test("mock agent runs a tool", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-agent-"));
  fs.writeFileSync(path.join(root, "hello.txt"), "hi", "utf8");
  const config = defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    memoryPath: path.join(root, ".config", "memory.jsonl"),
    skillsDir: path.join(root, ".config", "skills"),
    telegramStatePath: path.join(root, ".config", "telegram-state.json")
  });
  const result = await new ButterclawAgent(config).run("list the files in this workspace");
  assert.match(result.answer, /finished/);
  assert.equal(result.steps, 2);
});


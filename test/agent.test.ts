import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent, buildSystemPrompt, parseToolCall } from "../src/agent.js";
import { defaultConfig } from "../src/config.js";
import { buildDefaultRegistry } from "../src/tools.js";

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

test("agent can delegate to a bounded sub-agent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-agent-"));
  fs.writeFileSync(path.join(root, "hello.txt"), "hi", "utf8");
  const config = defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    memoryPath: path.join(root, ".config", "memory.jsonl"),
    skillsDir: path.join(root, ".config", "skills"),
    telegramStatePath: path.join(root, ".config", "telegram-state.json")
  });
  const agent = new ButterclawAgent(config);
  const delegated = await agent.registry.call("delegate_task", {
    role: "scout",
    task: "list the files in this workspace"
  });

  assert.equal(delegated.ok, true);
  assert.match(delegated.output, /Sub-agent scout finished/);
  assert.match(delegated.output, /finished/);
  assert.equal(fs.existsSync(config.memoryPath), false);
});

test("system prompt only mentions delegation when the tool is present", () => {
  const config = defaultConfig();
  const workerPrompt = buildSystemPrompt(buildDefaultRegistry(config), [], []);
  const parentPrompt = buildSystemPrompt(new ButterclawAgent(config).registry, [], []);

  assert.doesNotMatch(workerPrompt, /Use delegate_task/);
  assert.match(parentPrompt, /Use delegate_task/);
});


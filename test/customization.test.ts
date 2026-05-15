import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent } from "../src/agent.js";
import { AgentProfile, AgentStore } from "../src/agents.js";
import { runAgentCommand, runSkillCommand } from "../src/cli.js";
import { defaultConfig } from "../src/config.js";
import { Message, Provider, ProviderResponse } from "../src/providers.js";

class RecordingProvider implements Provider {
  messages: Message[][] = [];

  async complete(messages: Message[]): Promise<ProviderResponse> {
    this.messages.push(messages);
    return { content: "done" };
  }
}

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-custom-"));
  return defaultConfig({
    workspace: root,
    configDir: path.join(root, ".config"),
    agentsDir: path.join(root, ".config", "agents"),
    skillsDir: path.join(root, ".config", "skills"),
    memoryPath: path.join(root, ".config", "memory.jsonl"),
    telegramStatePath: path.join(root, ".config", "telegram-state.json")
  });
}

test("agent command creates and lists profiles", () => {
  const config = tempConfig();
  const lines: string[] = [];

  assert.equal(
    runAgentCommand(
      config,
      ["create", "Debugger", "--description", "Finds bugs", "--instructions", "Find root causes first.", "--max-steps", "2"],
      (line) => lines.push(line)
    ),
    0
  );

  const agent = new AgentStore(config.agentsDir).get("debugger");
  assert.equal(agent?.name, "debugger");
  assert.equal(agent?.description, "Finds bugs");
  assert.equal(agent?.instructions, "Find root causes first.");
  assert.equal(agent?.maxSteps, 2);

  lines.length = 0;
  assert.equal(runAgentCommand(config, ["list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /debugger: Finds bugs/);
});

test("skill command creates and shows markdown skills", () => {
  const config = tempConfig();
  const lines: string[] = [];

  assert.equal(
    runSkillCommand(
      config,
      ["create", "Bug Hunt", "--description", "Use for debugging.", "--body", "Check reproduction, logs, and tests."],
      (line) => lines.push(line)
    ),
    0
  );

  lines.length = 0;
  assert.equal(runSkillCommand(config, ["show", "bug-hunt"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /# bug-hunt/);
  assert.match(lines.join("\n"), /Check reproduction/);
});

test("active agent profile is included in the system prompt", async () => {
  const config = tempConfig();
  const provider = new RecordingProvider();
  const profile: AgentProfile = {
    name: "debugger",
    description: "Finds bugs",
    instructions: "Find root causes first."
  };

  await new ButterclawAgent(config, { provider, agentProfile: profile }).run("inspect this");

  const system = provider.messages[0][0].content;
  assert.match(system, /Active agent:/);
  assert.match(system, /Name: debugger/);
  assert.match(system, /Find root causes first/);
});

test("delegation can target a saved agent profile", async () => {
  const config = tempConfig();
  fs.writeFileSync(path.join(config.workspace, "hello.txt"), "hi", "utf8");
  new AgentStore(config.agentsDir).create({
    name: "scout",
    description: "Lists workspace files",
    instructions: "List files and report only what matters."
  });

  const agent = new ButterclawAgent(config);
  const result = await agent.registry.call("delegate_task", {
    agent: "scout",
    task: "list the files in this workspace"
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /Sub-agent scout finished/);
});

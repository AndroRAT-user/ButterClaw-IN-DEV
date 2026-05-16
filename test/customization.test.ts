import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent } from "../src/agent.js";
import { AgentProfile, AgentStore } from "../src/agents.js";
import { runAgentCommand, runBackupCommand, runDoctorCommand, runSessionCommand, runSkillCommand, runTeamCommand } from "../src/cli.js";
import { defaultConfig } from "../src/config.js";
import { Message, Provider, ProviderResponse } from "../src/providers.js";
import { SessionStore } from "../src/sessions.js";
import { createLocalFiles } from "../src/setup.js";
import { TeamStore } from "../src/teams.js";

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

test("team command creates and lists agent teams", () => {
  const config = tempConfig();
  const lines: string[] = [];

  assert.equal(
    runTeamCommand(
      config,
      ["create", "Review Crew", "--agents", "debugger,writer", "--description", "Checks code from two angles"],
      (line) => lines.push(line)
    ),
    0
  );

  const team = new TeamStore(config.teamsDir).get("review-crew");
  assert.deepEqual(team?.agents, ["debugger", "writer"]);
  assert.equal(team?.description, "Checks code from two angles");

  lines.length = 0;
  assert.equal(runTeamCommand(config, ["list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /review-crew: debugger, writer/);
});

test("session command shows and clears saved transcripts", () => {
  const config = tempConfig();
  const store = new SessionStore(config.sessionsDir);
  const lines: string[] = [];

  store.append("Build Log", "user", "ship the feature");
  store.append("Build Log", "assistant", "done");

  assert.equal(runSessionCommand(config, ["list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /build-log: 2 turn/);

  lines.length = 0;
  assert.equal(runSessionCommand(config, ["show", "build-log"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /ship the feature/);
  assert.match(lines.join("\n"), /done/);

  lines.length = 0;
  assert.equal(runSessionCommand(config, ["clear", "build-log"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /Cleared session build-log/);
  assert.deepEqual(store.read("build-log"), []);
});

test("doctor command reports local runtime health", async () => {
  const config = tempConfig();
  createLocalFiles(config);
  const lines: string[] = [];

  assert.equal(await runDoctorCommand(config, (line) => lines.push(line)), 0);

  const output = lines.join("\n");
  assert.match(output, /Doctor/);
  assert.match(output, /Node\.js/);
  assert.match(output, /Workspace/);
  assert.match(output, /Provider: mock provider/);
  assert.match(output, /\[WARN\] Google OAuth/);
});

test("backup command saves local state without OAuth tokens", () => {
  const config = tempConfig();
  createLocalFiles(config);
  new AgentStore(config.agentsDir).create({ name: "debugger", description: "Finds bugs", instructions: "Debug carefully." });
  new TeamStore(config.teamsDir).create({ name: "triage", agents: ["debugger"], description: "Triage team" });
  fs.writeFileSync(path.join(config.skillsDir, "release.md"), "# release\n", "utf8");
  new SessionStore(config.sessionsDir).append("build", "user", "ship it");
  fs.appendFileSync(config.memoryPath, JSON.stringify({ role: "user", content: "remember me" }) + "\n", "utf8");
  fs.writeFileSync(config.googleOAuthPath, JSON.stringify({ refresh_token: "secret-refresh-token" }), "utf8");
  const backupPath = path.join(config.workspace, "backup.json");
  const lines: string[] = [];

  assert.equal(runBackupCommand(config, ["create", backupPath], (line) => lines.push(line)), 0);

  const backupText = fs.readFileSync(backupPath, "utf8");
  const backup = JSON.parse(backupText) as { files: Array<{ path: string; content: string }>; excluded: string[] };
  assert.match(lines.join("\n"), /Saved/);
  assert.equal(backup.files.some((file) => file.path === "agents/debugger.json"), true);
  assert.equal(backup.files.some((file) => file.path === "teams/triage.json"), true);
  assert.equal(backup.files.some((file) => file.path === "skills/release.md"), true);
  assert.equal(backup.files.some((file) => file.path === "sessions/build.jsonl"), true);
  assert.equal(backup.files.some((file) => file.path === "memory.jsonl"), true);
  assert.equal(backupText.includes("secret-refresh-token"), false);
  assert.equal(backup.excluded.includes("google-oauth.json"), true);
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

test("delegation can target a saved agent team", async () => {
  const config = tempConfig();
  fs.writeFileSync(path.join(config.workspace, "hello.txt"), "hi", "utf8");
  const agents = new AgentStore(config.agentsDir);
  agents.create({
    name: "scout",
    description: "Lists workspace files",
    instructions: "List files and report only what matters."
  });
  agents.create({
    name: "reviewer",
    description: "Reviews workspace files",
    instructions: "Check the file list and report concise findings."
  });
  new TeamStore(config.teamsDir).create({
    name: "triage",
    agents: ["scout", "reviewer"],
    description: "Two-agent triage team"
  });

  const agent = new ButterclawAgent(config);
  const result = await agent.registry.call("delegate_team", {
    team: "triage",
    task: "list the files in this workspace"
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /Team triage finished successfully/);
  assert.match(result.output, /## scout/);
  assert.match(result.output, /## reviewer/);
});

test("named sessions persist turns and replay them into later prompts", async () => {
  const config = tempConfig();
  const provider = new RecordingProvider();
  const agent = new ButterclawAgent(config, { provider, sessionName: "long-build" });

  await agent.run("first request");
  await agent.run("second request");

  const turns = new SessionStore(config.sessionsDir).read("long-build");
  assert.equal(turns.length, 4);
  assert.equal(turns[0].content, "first request");
  assert.equal(turns[1].content, "done");

  const secondPrompt = provider.messages[1];
  assert.equal(secondPrompt.at(-1)?.content, "second request");
  assert.equal(secondPrompt.some((message) => message.role === "user" && message.content === "first request"), true);
  assert.equal(secondPrompt.some((message) => message.role === "assistant" && message.content === "done"), true);
});

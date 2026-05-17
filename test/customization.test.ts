import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ButterclawAgent } from "../src/agent.js";
import { AgentProfile, AgentStore } from "../src/agents.js";
import {
  localHelpForTask,
  runAgentCommand,
  runAgentRunCommand,
  runBackupCommand,
  runDoctorCommand,
  runMemoryCommand,
  runScheduleCommand,
  runSessionCommand,
  runSkillCommand,
  runSlashCommand,
  runTaskCommand,
  runTeamCommand,
  runTeamRunCommand
} from "../src/cli.js";
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

  lines.length = 0;
  assert.equal(runAgentCommand(config, ["--list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /debugger: Finds bugs/);

  lines.length = 0;
  assert.equal(runAgentCommand(config, ["help"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /butterclaw agent run reviewer/);
});

test("agent run command executes a saved profile and prints an answer", async () => {
  const config = tempConfig();
  const lines: string[] = [];
  new AgentStore(config.agentsDir).create({
    name: "debugger",
    description: "Finds bugs",
    instructions: "Find root causes first."
  });

  assert.equal(await runAgentRunCommand(config, ["run", "debugger", "hello from this agent"], (line) => lines.push(line)), 0);

  assert.match(lines.join("\n"), /Butterclaw mock provider/);
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

test("skill metadata gates prompt loading by required tools", async () => {
  const config = tempConfig();
  config.toolProfile = "minimal";
  fs.mkdirSync(config.skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.skillsDir, "readme-helper.md"),
    "---\nrequires-tools: read_file\n---\n# readme-helper\n\nUse for README work.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(config.skillsDir, "writer-helper.md"),
    "---\nrequires-tools: write_file\n---\n# writer-helper\n\nUse for writing files.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(config.skillsDir, "hidden-helper.md"),
    "---\ndisable-model-invocation: true\n---\n# hidden-helper\n\nShould stay out of prompts.\n",
    "utf8"
  );
  const provider = new RecordingProvider();

  await new ButterclawAgent(config, { provider }).run("readme helper task");

  const system = provider.messages[0][0].content;
  assert.match(system, /readme-helper/);
  assert.doesNotMatch(system, /writer-helper/);
  assert.doesNotMatch(system, /hidden-helper/);
});

test("skill command searches, inspects, copies, renames, validates, and deletes skills", () => {
  const config = tempConfig();
  const lines: string[] = [];

  assert.equal(runSkillCommand(config, ["create", "Release Check", "--body", "Run tests before shipping."], (line) => lines.push(line)), 0);
  lines.length = 0;
  assert.equal(runSkillCommand(config, ["search", "shipping"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /release-check/);
  lines.length = 0;
  assert.equal(runSkillCommand(config, ["info", "release-check"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /eligible/);
  assert.equal(runSkillCommand(config, ["copy", "release-check", "release-copy"], (line) => lines.push(line)), 0);
  assert.equal(runSkillCommand(config, ["rename", "release-copy", "release-renamed"], (line) => lines.push(line)), 0);
  assert.equal(runSkillCommand(config, ["validate"], (line) => lines.push(line)), 0);
  assert.equal(runSkillCommand(config, ["delete", "release-renamed"], (line) => lines.push(line)), 0);
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

  lines.length = 0;
  assert.equal(runTeamCommand(config, ["--list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /review-crew: debugger, writer/);
});

test("team run command returns the team report directly", async () => {
  const config = tempConfig();
  const lines: string[] = [];
  const agents = new AgentStore(config.agentsDir);
  agents.create({ name: "scout", description: "Lists files", instructions: "List files." });
  agents.create({ name: "reviewer", description: "Reviews files", instructions: "Review files." });
  new TeamStore(config.teamsDir).create({ name: "triage", agents: ["scout", "reviewer"], description: "Triage team" });

  assert.equal(await runTeamRunCommand(config, ["triage", "list the files in this workspace"], (line) => lines.push(line)), 0);

  assert.match(lines.join("\n"), /Team triage finished successfully/);
  assert.match(lines.join("\n"), /## scout/);
  assert.match(lines.join("\n"), /## reviewer/);
  assert.doesNotMatch(lines.join("\n"), /Unknown tool: delegate_task/);
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

test("session command prunes old turns", () => {
  const config = tempConfig();
  const store = new SessionStore(config.sessionsDir);
  const lines: string[] = [];

  store.append("Build Log", "user", "one");
  store.append("Build Log", "assistant", "two");
  store.append("Build Log", "user", "three");

  assert.equal(runSessionCommand(config, ["prune", "build-log", "2"], (line) => lines.push(line)), 0);
  const turns = store.read("build-log");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].content, "two");
  assert.equal(turns[1].content, "three");
  assert.match(lines.join("\n"), /Pruned 1 old turn/);
});

test("session command supports search, stats, append, copy, rename, export, and all-session cleanup", () => {
  const config = tempConfig();
  const store = new SessionStore(config.sessionsDir);
  const lines: string[] = [];
  store.append("Build Log", "user", "ship the feature");
  store.append("Build Log", "assistant", "ready to ship");

  assert.equal(runSessionCommand(config, ["search", "ship"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /build-log/);
  lines.length = 0;
  assert.equal(runSessionCommand(config, ["stats"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /Turns: 2/);
  assert.equal(runSessionCommand(config, ["append", "build-log", "--role", "user", "third turn"], (line) => lines.push(line)), 0);
  assert.equal(runSessionCommand(config, ["copy", "build-log", "build-copy"], (line) => lines.push(line)), 0);
  assert.equal(runSessionCommand(config, ["rename", "build-copy", "build-renamed"], (line) => lines.push(line)), 0);
  const exportPath = path.join(config.workspace, "session.md");
  assert.equal(runSessionCommand(config, ["export", "build-renamed", exportPath], (line) => lines.push(line)), 0);
  assert.equal(fs.existsSync(exportPath), true);
  assert.equal(runSessionCommand(config, ["clear", "--all"], (line) => lines.push(line)), 0);
  assert.deepEqual(store.list(), []);
});

test("memory command supports local memory management", () => {
  const config = tempConfig();
  const lines: string[] = [];

  assert.equal(runMemoryCommand(config, ["add", "--role", "user", "remember release checklist"], (line) => lines.push(line)), 0);
  assert.equal(runMemoryCommand(config, ["add", "--role", "assistant", "tests pass"], (line) => lines.push(line)), 0);
  lines.length = 0;
  assert.equal(runMemoryCommand(config, ["search", "release"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /release checklist/);
  lines.length = 0;
  assert.equal(runMemoryCommand(config, ["stats"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /Items: 2/);
  const exportPath = path.join(config.workspace, "memory.json");
  assert.equal(runMemoryCommand(config, ["export", exportPath], (line) => lines.push(line)), 0);
  assert.equal(fs.existsSync(exportPath), true);
  assert.equal(runMemoryCommand(config, ["forget", "1"], (line) => lines.push(line)), 0);
  assert.equal(runMemoryCommand(config, ["import", exportPath], (line) => lines.push(line)), 0);
  assert.equal(runMemoryCommand(config, ["prune", "--keep", "1"], (line) => lines.push(line)), 0);
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
  fs.writeFileSync(config.whatsappStatePath, JSON.stringify({ lastFrom: "secret-chat" }), "utf8");
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
  assert.equal(backup.files.some((file) => file.path === "schedule.json"), true);
  assert.equal(backup.files.some((file) => file.path === "tasks.json"), true);
  assert.equal(backupText.includes("secret-refresh-token"), false);
  assert.equal(backupText.includes("secret-chat"), false);
  assert.equal(backup.excluded.includes("google-oauth.json"), true);
  assert.equal(backup.excluded.includes("whatsapp-state.json"), true);
});

test("task command lists and shows background task records", () => {
  const config = tempConfig();
  createLocalFiles(config);
  const taskFile = config.taskPath;
  fs.writeFileSync(
    taskFile,
    JSON.stringify({
      version: 1,
      tasks: [
        {
          id: "task_demo",
          kind: "agent-hook",
          source: "gateway",
          status: "succeeded",
          summary: "demo task",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:01.000Z"
        }
      ]
    }),
    "utf8"
  );
  const lines: string[] = [];

  assert.equal(runTaskCommand(config, ["list"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /task_demo/);

  lines.length = 0;
  assert.equal(runTaskCommand(config, ["show", "task_demo"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /demo task/);
});

test("task command filters, cancels, exports, prunes, clears, and reports stats", () => {
  const config = tempConfig();
  createLocalFiles(config);
  fs.writeFileSync(
    config.taskPath,
    JSON.stringify({
      version: 1,
      tasks: [
        { id: "task_one", kind: "agent-hook", source: "gateway", status: "running", summary: "one", createdAt: "2026-05-16T00:00:00.000Z", updatedAt: "2026-05-16T00:00:00.000Z" },
        { id: "task_two", kind: "schedule", source: "cli", status: "succeeded", summary: "two", createdAt: "2026-05-16T00:00:01.000Z", updatedAt: "2026-05-16T00:00:01.000Z" }
      ]
    }),
    "utf8"
  );
  const lines: string[] = [];

  assert.equal(runTaskCommand(config, ["list", "--source", "cli", "--limit", "1"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /task_two/);
  assert.doesNotMatch(lines.join("\n"), /task_one/);
  assert.equal(runTaskCommand(config, ["cancel", "task_one", "stop"], (line) => lines.push(line)), 0);
  lines.length = 0;
  assert.equal(runTaskCommand(config, ["stats"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /cancelled/);
  const exportPath = path.join(config.workspace, "tasks.json");
  assert.equal(runTaskCommand(config, ["export", exportPath], (line) => lines.push(line)), 0);
  assert.equal(fs.existsSync(exportPath), true);
  assert.equal(runTaskCommand(config, ["prune", "--keep", "1"], (line) => lines.push(line)), 0);
  assert.equal(runTaskCommand(config, ["clear", "--status", "succeeded"], (line) => lines.push(line)), 0);
});

test("schedule command supports pause, resume, due, stats, and export", async () => {
  const config = tempConfig();
  createLocalFiles(config);
  const lines: string[] = [];

  assert.equal(await runScheduleCommand(config, ["add", "--name", "quick", "--at", "now", "--message", "hello"], (line) => lines.push(line)), 0);
  assert.equal(await runScheduleCommand(config, ["due"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /quick/);
  assert.equal(await runScheduleCommand(config, ["disable", "quick"], (line) => lines.push(line)), 0);
  assert.equal(await runScheduleCommand(config, ["enable", "quick"], (line) => lines.push(line)), 0);
  lines.length = 0;
  assert.equal(await runScheduleCommand(config, ["stats"], (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /Jobs: 1/);
  const exportPath = path.join(config.workspace, "schedule.json");
  assert.equal(await runScheduleCommand(config, ["export", exportPath], (line) => lines.push(line)), 0);
  assert.equal(fs.existsSync(exportPath), true);
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

test("tool policy can disable delegation tools", async () => {
  const config = tempConfig();
  config.toolDeny = ["group:agents"];
  const agent = new ButterclawAgent(config);

  assert.equal(agent.registry.names().includes("delegate_task"), false);
  assert.match((await agent.registry.call("delegate_task", { task: "work" })).output, /Unknown tool/);
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

test("named sessions are pruned after runs", async () => {
  const config = tempConfig();
  config.sessionMaxTurns = 2;
  const provider = new RecordingProvider();
  const agent = new ButterclawAgent(config, { provider, sessionName: "long-build" });

  await agent.run("first request");
  await agent.run("second request");

  const turns = new SessionStore(config.sessionsDir).read("long-build");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].content, "second request");
  assert.equal(turns[1].content, "done");
});

test("slash commands are handled locally without calling the provider", async () => {
  const config = tempConfig();
  const provider = new RecordingProvider();
  const agent = new ButterclawAgent(config, { provider, sessionName: "slash-work" });
  const store = new SessionStore(config.sessionsDir);
  const lines: string[] = [];
  store.append("slash-work", "user", "old request");

  assert.equal(await runSlashCommand(config, "/status", { agent, sessionName: "slash-work", outputFunc: (line) => lines.push(line) }), true);
  assert.match(lines.join("\n"), /Butterclaw Status/);
  assert.match(lines.join("\n"), /Tool profile: full/);

  lines.length = 0;
  assert.equal(await runSlashCommand(config, "/new", { agent, sessionName: "slash-work", outputFunc: (line) => lines.push(line) }), true);
  assert.deepEqual(store.read("slash-work"), []);
  assert.equal(provider.messages.length, 0);
});

test("natural agent help returns real Butterclaw commands", () => {
  const help = localHelpForTask("how can i configure agents in butterclaw?");
  assert.ok(help);
  assert.match(help, /butterclaw agent create reviewer/);
  assert.match(help, /not butterclaw\.yaml/);

  const pathHelp = localHelpForTask("i want the command to create and run an agent in C:\\Users\\cap_p\\Downloads\\flutta\\office>");
  assert.match(pathHelp ?? "", /cd \/d C:\\Users\\cap_p\\Downloads\\flutta\\office/);
});

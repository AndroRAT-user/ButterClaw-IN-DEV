import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isSetupTask, parseArgs } from "../src/cli.js";
import { defaultConfig, loadConfig } from "../src/config.js";
import { runSetup } from "../src/setup.js";

test("setup alias detection", () => {
  assert.equal(isSetupTask(["setup"]), true);
  assert.equal(isSetupTask(["onboard"]), true);
  assert.equal(isSetupTask(["setup", "my", "project"]), false);
});

test("cli parser reads flags and task text", () => {
  const args = parseArgs([
    "--provider",
    "ollama",
    "--agent",
    "debugger",
    "--session",
    "long-build",
    "--request-timeout-seconds",
    "180",
    "--session-max-turns",
    "40",
    "--tool-profile",
    "coding",
    "--allow-tool",
    "read_file,workspace_map",
    "--deny-tool",
    "run_shell",
    "--allow-shell",
    "--telegram-allowed-chat",
    "123,456",
    "--google-client-id-env",
    "GOOGLE_CLIENT",
    "--google-client-secret-env",
    "GOOGLE_SECRET",
    "--google-calendar-id",
    "primary",
    "--github-default-repo",
    "owner/repo",
    "--whatsapp-mode",
    "cloud",
    "--whatsapp-allowed-chat",
    "1555,1666",
    "--whatsapp-group-policy",
    "open",
    "--whatsapp-webhook",
    "list",
    "files"
  ]);
  assert.equal(args.provider, "ollama");
  assert.equal(args.agent, "debugger");
  assert.equal(args.session, "long-build");
  assert.equal(args.requestTimeoutSeconds, 180);
  assert.equal(args.sessionMaxTurns, 40);
  assert.equal(args.toolProfile, "coding");
  assert.deepEqual(args.toolAllow, ["read_file", "workspace_map"]);
  assert.deepEqual(args.toolDeny, ["run_shell"]);
  assert.equal(args.allowShell, true);
  assert.deepEqual(args.telegramAllowedChat, ["123", "456"]);
  assert.equal(args.googleClientIdEnv, "GOOGLE_CLIENT");
  assert.equal(args.googleClientSecretEnv, "GOOGLE_SECRET");
  assert.equal(args.googleCalendarId, "primary");
  assert.equal(args.githubDefaultRepo, "owner/repo");
  assert.equal(args.whatsappMode, "cloud");
  assert.deepEqual(args.whatsappAllowedChat, ["1555", "1666"]);
  assert.equal(args.whatsappGroupPolicy, "open");
  assert.equal(args.whatsappWebhook, true);
  assert.deepEqual(args.task, ["list", "files"]);
});

test("setup writes config and starter skill", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-setup-"));
  const config = defaultConfig({
    workspace: path.join(root, "workspace"),
    configDir: path.join(root, "config"),
    baseUrl: "http://127.0.0.1:1",
    memoryPath: path.join(root, "config", "memory.jsonl"),
    skillsDir: path.join(root, "config", "skills"),
    telegramStatePath: path.join(root, "config", "telegram-state.json")
  });
  const answers = ["", "", "", "", "", ""];
  const lines: string[] = [];
  await runSetup(config, path.join(root, "config.json"), () => answers.shift() ?? "", (line) => lines.push(line));
  assert.equal(fs.existsSync(path.join(root, "config.json")), true);
  assert.equal(fs.existsSync(path.join(root, "config", "agents")), true);
  assert.equal(fs.existsSync(path.join(root, "config", "teams")), true);
  assert.equal(fs.existsSync(path.join(root, "config", "sessions")), true);
  assert.equal(fs.existsSync(path.join(root, "config", "memory.jsonl")), true);
  assert.equal(fs.existsSync(path.join(root, "config", "skills", "starter.md")), true);
  assert.match(lines.join("\n"), /Wrote config/);
});

test("setup with custom config keeps files nearby", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-setup-"));
  const config = defaultConfig({ baseUrl: "http://127.0.0.1:1" });
  const answers = ["", "", "", "", "", ""];
  await runSetup(config, path.join(root, "custom", "butterclaw.json"), () => answers.shift() ?? "", () => undefined);
  assert.equal(fs.existsSync(path.join(root, "custom", "agents")), true);
  assert.equal(fs.existsSync(path.join(root, "custom", "teams")), true);
  assert.equal(fs.existsSync(path.join(root, "custom", "sessions")), true);
  assert.equal(fs.existsSync(path.join(root, "custom", "skills", "starter.md")), true);
  assert.equal(fs.existsSync(path.join(root, "custom", "memory.jsonl")), true);
});

test("missing custom config defaults nearby", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-config-"));
  const config = loadConfig(path.join(root, "custom", "butterclaw.json"));
  assert.equal(config.configDir, path.join(root, "custom"));
  assert.equal(config.agentsDir, path.join(root, "custom", "agents"));
  assert.equal(config.teamsDir, path.join(root, "custom", "teams"));
  assert.equal(config.sessionsDir, path.join(root, "custom", "sessions"));
  assert.equal(config.skillsDir, path.join(root, "custom", "skills"));
  assert.equal(config.whatsappStatePath, path.join(root, "custom", "whatsapp-state.json"));
});

test("openai-compatible setup defaults to OpenRouter gpt-oss free model", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-setup-"));
  const config = defaultConfig({ baseUrl: null });
  const answers = ["3", "", "", "", "", "", ""];
  await runSetup(config, path.join(root, "config.json"), () => answers.shift() ?? "", () => undefined);

  const saved = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(saved.provider, "openai-compatible");
  assert.equal(saved.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(saved.model, "openai/gpt-oss-120b:free");
  assert.equal(saved.requestTimeoutSeconds, 120);
});

test("setup rejects invalid provider key environment variable names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-setup-"));
  const config = defaultConfig({ baseUrl: null });
  const answers = ["3", "", "", "my api", "MODEL_PROVIDER_API_KEY", "", "", ""];
  const lines: string[] = [];

  await runSetup(config, path.join(root, "config.json"), () => answers.shift() ?? "", (line) => lines.push(line));

  const saved = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(saved.apiKeyEnv, "MODEL_PROVIDER_API_KEY");
  assert.match(lines.join("\n"), /No spaces or equals signs/);
});

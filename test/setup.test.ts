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
    "--allow-shell",
    "--telegram-allowed-chat",
    "123,456",
    "--google-client-id-env",
    "GOOGLE_CLIENT",
    "--google-client-secret-env",
    "GOOGLE_SECRET",
    "--google-calendar-id",
    "primary",
    "list",
    "files"
  ]);
  assert.equal(args.provider, "ollama");
  assert.equal(args.agent, "debugger");
  assert.equal(args.allowShell, true);
  assert.deepEqual(args.telegramAllowedChat, ["123", "456"]);
  assert.equal(args.googleClientIdEnv, "GOOGLE_CLIENT");
  assert.equal(args.googleClientSecretEnv, "GOOGLE_SECRET");
  assert.equal(args.googleCalendarId, "primary");
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
  assert.equal(fs.existsSync(path.join(root, "custom", "skills", "starter.md")), true);
  assert.equal(fs.existsSync(path.join(root, "custom", "memory.jsonl")), true);
});

test("missing custom config defaults nearby", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-config-"));
  const config = loadConfig(path.join(root, "custom", "butterclaw.json"));
  assert.equal(config.configDir, path.join(root, "custom"));
  assert.equal(config.agentsDir, path.join(root, "custom", "agents"));
  assert.equal(config.skillsDir, path.join(root, "custom", "skills"));
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

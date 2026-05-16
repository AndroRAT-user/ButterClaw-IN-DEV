import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ButterclawConfig, configPath, defaultConfigDir, saveConfig } from "./config.js";
import { button, commandRow, labelValue, panel, statusPill, successLine } from "./ui.js";
import { ensureDir, ensureParent, splitCsv, trimTrailingSlash } from "./util.js";

type InputFunc = (question: string) => string | Promise<string>;
type OutputFunc = (line: string) => void;

export async function runSetup(
  config: ButterclawConfig,
  targetPath = configPath(),
  inputFunc?: InputFunc,
  outputFunc: OutputFunc = console.log
): Promise<number> {
  alignConfigDirWithCustomPath(config, targetPath);
  let rl: readline.Interface | null = null;
  if (!inputFunc) {
    rl = readline.createInterface({ input, output });
    inputFunc = async (question: string) => {
      try {
        return await rl!.question(question);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ERR_USE_AFTER_CLOSE") {
          return "";
        }
        throw error;
      }
    };
  }

  try {
    outputFunc(
      panel("Butterclaw setup", [
        "Build a local agent workspace with config, memory, agents, teams,",
        "sessions, skills, and optional channels.",
        "",
        commandRow(["provider", "workspace", "tools", "channels", "finish"])
      ])
    );
    outputFunc("");

    outputFunc("System check:");
    for (const [label, ok, detail] of await systemChecks(config)) {
      outputFunc(`${statusPill(ok)} ${label}${detail ? `: ${detail}` : ""}`);
    }
    outputFunc("");

    await configureProvider(config, inputFunc, outputFunc);
    await configureRuntime(config, inputFunc);
    await configureTelegram(config, inputFunc);

    createLocalFiles(config);
    saveConfig(config, targetPath);
    outputFunc("");
    outputFunc(successLine(`Wrote config: ${targetPath}`));
    outputFunc(labelValue("Agents folder", config.agentsDir));
    outputFunc(labelValue("Teams folder", config.teamsDir));
    outputFunc(labelValue("Sessions folder", config.sessionsDir));
    outputFunc(labelValue("Skills folder", config.skillsDir));
    outputFunc(labelValue("Memory file", config.memoryPath));
    outputFunc("");
    outputFunc(`${button("run")} Try it now:`);
    outputFunc(`  butterclaw --config "${targetPath}" "list the files in this workspace"`);
    if (config.provider === "ollama") {
      outputFunc("");
      outputFunc(`${button("telegram")} For Telegram with Ollama:`);
      outputFunc(`  set ${config.telegramTokenEnv}=123456:your-token`);
      outputFunc(`  butterclaw --config "${targetPath}" --telegram-poll --telegram-allowed-chat YOUR_CHAT_ID`);
    } else if (config.provider === "openai-compatible") {
      outputFunc("");
      outputFunc(`${button("env")} Before using the model provider:`);
      outputFunc(`  set ${config.apiKeyEnv}=paste-your-provider-key-here`);
    }
    return 0;
  } finally {
    rl?.close();
  }
}

export function alignConfigDirWithCustomPath(config: ButterclawConfig, targetPath: string): void {
  const defaultDir = path.resolve(defaultConfigDir());
  const requestedPath = path.resolve(targetPath);
  if (requestedPath === path.resolve(configPath()) || path.resolve(config.configDir) !== defaultDir) {
    return;
  }

  config.configDir = path.dirname(requestedPath);
  config.agentsDir = path.join(config.configDir, "agents");
  config.teamsDir = path.join(config.configDir, "teams");
  config.sessionsDir = path.join(config.configDir, "sessions");
  config.skillsDir = path.join(config.configDir, "skills");
  config.memoryPath = path.join(config.configDir, "memory.jsonl");
  config.telegramStatePath = path.join(config.configDir, "telegram-state.json");
}

export async function systemChecks(config: ButterclawConfig): Promise<Array<[string, boolean, string]>> {
  return [
    ["Node.js", majorNodeVersion() >= 22, process.version],
    ["Git", commandExists("git"), commandExists("git") ? "available" : "not found"],
    ["Ollama", await ollamaReachable(config.baseUrl ?? "http://localhost:11434"), config.baseUrl ?? "http://localhost:11434"]
  ];
}

export async function ollamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

export function createLocalFiles(config: ButterclawConfig): void {
  ensureDir(config.configDir);
  ensureDir(config.workspace);
  ensureDir(config.agentsDir);
  ensureDir(config.teamsDir);
  ensureDir(config.sessionsDir);
  ensureDir(config.skillsDir);
  const starter = path.join(config.skillsDir, "starter.md");
  if (!fs.existsSync(starter)) {
    fs.writeFileSync(
      starter,
      "# Starter\n\nUse this skill for everyday local assistant work. Prefer small, reversible steps. Ask before destructive file changes, purchases, messages, or shell commands with broad impact.\n",
      "utf8"
    );
  }
  ensureParent(config.memoryPath);
  fs.closeSync(fs.openSync(config.memoryPath, "a"));
  ensureParent(config.telegramStatePath);
}

async function configureProvider(config: ButterclawConfig, inputFunc: InputFunc, outputFunc: OutputFunc): Promise<void> {
  const provider = await choose(inputFunc, outputFunc, "Choose provider", ["mock", "ollama", "openai-compatible"], config.provider);
  config.provider = provider as ButterclawConfig["provider"];
  config.model = await prompt(inputFunc, "Model", defaultModelFor(config.provider, config.model));

  if (config.provider === "openai-compatible") {
    config.baseUrl = await prompt(inputFunc, "OpenAI-compatible base URL", config.baseUrl ?? "https://openrouter.ai/api/v1");
    outputFunc("Butterclaw does not issue API keys. Use a key from your chosen model provider.");
    config.apiKeyEnv = await promptEnvName(inputFunc, outputFunc, "Environment variable for your model provider key", config.apiKeyEnv);
  } else if (config.provider === "ollama") {
    config.baseUrl = await prompt(inputFunc, "Ollama base URL", config.baseUrl ?? "http://localhost:11434");
  }
}

async function configureRuntime(config: ButterclawConfig, inputFunc: InputFunc): Promise<void> {
  config.workspace = path.resolve(await prompt(inputFunc, "Workspace folder", config.workspace));
  config.maxSteps = await promptInt(inputFunc, "Max agent steps per task", config.maxSteps);
  config.shellMode = (await yesNo(inputFunc, "Enable shell tool?", false)) ? "allow" : "deny";
}

async function configureTelegram(config: ButterclawConfig, inputFunc: InputFunc): Promise<void> {
  if (!(await yesNo(inputFunc, "Configure Telegram channel?", false))) {
    return;
  }
  config.telegramTokenEnv = await prompt(inputFunc, "Telegram token environment variable", config.telegramTokenEnv);
  const chats = await prompt(inputFunc, "Allowed Telegram chat IDs, comma-separated", config.telegramAllowedChats.join(","));
  config.telegramAllowedChats = splitCsv(chats);
}

function defaultModelFor(provider: ButterclawConfig["provider"], current: string): string {
  if (provider === "mock") {
    return "mock-local";
  }
  if (provider === "ollama") {
    return current && current !== "mock-local" ? current : "llama3.2:3b";
  }
  return current && current !== "mock-local" ? current : "openai/gpt-oss-120b:free";
}

async function choose(
  inputFunc: InputFunc,
  outputFunc: OutputFunc,
  label: string,
  options: string[],
  defaultValue: string
): Promise<string> {
  const normalizedDefault = options.includes(defaultValue) ? defaultValue : options[0];
  outputFunc(`${label}:`);
  options.forEach((option, index) => outputFunc(`  ${button(String(index + 1))} ${option}${option === normalizedDefault ? " (default)" : ""}`));
  while (true) {
    const value = (await inputFunc(`${label} [${normalizedDefault}]: `)).trim();
    if (!value) {
      return normalizedDefault;
    }
    if (options.includes(value)) {
      return value;
    }
    const asNumber = Number(value);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
      return options[asNumber - 1];
    }
    outputFunc(`Please choose one of: ${options.join(", ")}`);
  }
}

async function prompt(inputFunc: InputFunc, label: string, defaultValue: string): Promise<string> {
  const value = (await inputFunc(`${label} [${defaultValue}]: `)).trim();
  return value || defaultValue;
}

async function promptEnvName(
  inputFunc: InputFunc,
  outputFunc: OutputFunc,
  label: string,
  defaultValue: string
): Promise<string> {
  while (true) {
    const value = await prompt(inputFunc, label, defaultValue);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      return value;
    }
    outputFunc("Use a variable name like MODEL_PROVIDER_API_KEY. No spaces or equals signs.");
  }
}

async function promptInt(inputFunc: InputFunc, label: string, defaultValue: number): Promise<number> {
  while (true) {
    const value = (await inputFunc(`${label} [${defaultValue}]: `)).trim();
    if (!value) {
      return defaultValue;
    }
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
    console.log("Please enter a whole number.");
  }
}

async function yesNo(inputFunc: InputFunc, label: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const value = (await inputFunc(`${label} [${suffix}]: `)).trim().toLowerCase();
    if (!value) {
      return defaultValue;
    }
    if (value === "y" || value === "yes") {
      return true;
    }
    if (value === "n" || value === "no") {
      return false;
    }
    console.log("Please answer yes or no.");
  }
}

function commandExists(command: string): boolean {
  const result = childProcess.spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    stdio: "ignore",
    shell: false
  });
  return result.status === 0;
}

function majorNodeVersion(): number {
  return Number(process.versions.node.split(".")[0] ?? 0);
}

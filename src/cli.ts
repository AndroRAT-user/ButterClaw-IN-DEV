#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { ButterclawAgent } from "./agent.js";
import { TelegramChannel, TelegramError } from "./channels/telegram.js";
import { ButterclawConfig, configPath, loadConfig, saveConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { buildDefaultRegistry } from "./tools.js";

interface Args {
  task: string[];
  config?: string;
  setup: boolean;
  initConfig: boolean;
  showTools: boolean;
  version: boolean;
  help: boolean;
  provider?: ButterclawConfig["provider"];
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  workspace?: string;
  maxSteps?: number;
  maxContextChars?: number;
  allowShell: boolean;
  allowOutsideWorkspace: boolean;
  telegramPoll: boolean;
  telegramOnce: boolean;
  telegramTokenEnv?: string;
  telegramBaseUrl?: string;
  telegramAllowedChat: string[];
  telegramTimeout?: number;
  telegramIdleSleep?: number;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.version) {
    console.log("butterclaw 0.2.0");
    return 0;
  }
  if (args.help) {
    printHelp();
    return 0;
  }
  const configFile = args.config ?? configPath();
  const config = loadConfig(args.config);
  applyOverrides(config, args);

  if (args.setup || isSetupTask(args.task)) {
    return runSetup(config, configFile);
  }
  if (args.initConfig) {
    saveConfig(config, configFile);
    console.log(`Wrote config to ${configFile}`);
    return 0;
  }
  if (args.showTools) {
    console.log(buildDefaultRegistry(config).describe());
    return 0;
  }
  if (args.telegramPoll) {
    return runTelegram(config, args.telegramOnce);
  }

  const task = args.task.join(" ").trim();
  if (!task) {
    return repl(config);
  }
  return runOnce(config, task);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    task: [],
    setup: false,
    initConfig: false,
    showTools: false,
    version: false,
    help: false,
    allowShell: false,
    allowOutsideWorkspace: false,
    telegramPoll: false,
    telegramOnce: false,
    telegramAllowedChat: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? "";
    };
    switch (arg) {
      case "--config":
        args.config = next();
        break;
      case "--setup":
        args.setup = true;
        break;
      case "--init-config":
        args.initConfig = true;
        break;
      case "--show-tools":
        args.showTools = true;
        break;
      case "--version":
        args.version = true;
        break;
      case "--provider":
        args.provider = next() as ButterclawConfig["provider"];
        break;
      case "--model":
        args.model = next();
        break;
      case "--base-url":
        args.baseUrl = next();
        break;
      case "--api-key-env":
        args.apiKeyEnv = next();
        break;
      case "--workspace":
        args.workspace = next();
        break;
      case "--max-steps":
        args.maxSteps = Number(next());
        break;
      case "--max-context-chars":
        args.maxContextChars = Number(next());
        break;
      case "--allow-shell":
        args.allowShell = true;
        break;
      case "--allow-outside-workspace":
        args.allowOutsideWorkspace = true;
        break;
      case "--telegram-poll":
        args.telegramPoll = true;
        break;
      case "--telegram-once":
        args.telegramOnce = true;
        break;
      case "--telegram-token-env":
        args.telegramTokenEnv = next();
        break;
      case "--telegram-base-url":
        args.telegramBaseUrl = next();
        break;
      case "--telegram-allowed-chat":
        args.telegramAllowedChat.push(...expandCsv(next()));
        break;
      case "--telegram-timeout":
        args.telegramTimeout = Number(next());
        break;
      case "--telegram-idle-sleep":
        args.telegramIdleSleep = Number(next());
        break;
      case "--help":
      case "-h":
        args.help = true;
        return args;
      default:
        args.task.push(arg);
        break;
    }
  }
  return args;
}

export function isSetupTask(task: string[]): boolean {
  return task.length === 1 && ["setup", "onboard", "onboarding"].includes(task[0].toLowerCase());
}

function applyOverrides(config: ButterclawConfig, args: Args): void {
  if (args.provider) config.provider = args.provider;
  if (args.model) config.model = args.model;
  if (args.baseUrl) config.baseUrl = args.baseUrl;
  if (args.apiKeyEnv) config.apiKeyEnv = args.apiKeyEnv;
  if (args.workspace) config.workspace = args.workspace;
  if (args.maxSteps !== undefined) config.maxSteps = args.maxSteps;
  if (args.maxContextChars !== undefined) config.maxContextChars = args.maxContextChars;
  if (args.allowShell) config.shellMode = "allow";
  if (args.allowOutsideWorkspace) config.allowOutsideWorkspace = true;
  if (args.telegramTokenEnv) config.telegramTokenEnv = args.telegramTokenEnv;
  if (args.telegramBaseUrl) config.telegramBaseUrl = args.telegramBaseUrl;
  if (args.telegramAllowedChat.length) config.telegramAllowedChats = args.telegramAllowedChat;
  if (args.telegramTimeout !== undefined) config.telegramPollTimeoutSeconds = args.telegramTimeout;
  if (args.telegramIdleSleep !== undefined) config.telegramIdleSleepSeconds = args.telegramIdleSleep;
}

async function runOnce(config: ButterclawConfig, task: string): Promise<number> {
  try {
    const result = await new ButterclawAgent(config).run(task);
    console.log(result.answer);
    return 0;
  } catch (error) {
    console.error(`Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function runTelegram(config: ButterclawConfig, once: boolean): Promise<number> {
  try {
    await new TelegramChannel(config).runForever(new ButterclawAgent(config), once);
    return 0;
  } catch (error) {
    const prefix = error instanceof TelegramError ? "Telegram failed" : "Butterclaw Telegram channel failed";
    console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function repl(config: ButterclawConfig): Promise<number> {
  console.log("Butterclaw REPL. Type 'exit' or press Ctrl+C to quit.");
  const rl = readline.createInterface({ input, output });
  const agent = new ButterclawAgent(config);
  try {
    while (true) {
      const task = (await rl.question("> ")).trim();
      if (!task) continue;
      if (task === "exit" || task === "quit") return 0;
      const result = await agent.run(task);
      console.log(result.answer);
    }
  } finally {
    rl.close();
  }
}

function expandCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function printHelp(): void {
  console.log(`Usage: butterclaw [options] [task...]

Options:
  --setup                         Run first-time setup
  --init-config                   Write a starter config
  --show-tools                    Print available tools
  --version                       Print version
  --provider <mock|ollama|openai-compatible>
  --model <model>
  --base-url <url>
  --api-key-env <name>
  --workspace <path>
  --max-steps <number>
  --max-context-chars <number>
  --allow-shell
  --allow-outside-workspace
  --telegram-poll
  --telegram-once
  --telegram-token-env <name>
  --telegram-base-url <url>
  --telegram-allowed-chat <id>
  --telegram-timeout <seconds>
  --telegram-idle-sleep <seconds>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}

#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ButterclawAgent } from "./agent.js";
import { AgentProfile, AgentStore, applyAgentProfile } from "./agents.js";
import { TelegramChannel, TelegramError } from "./channels/telegram.js";
import { ButterclawConfig, configPath, loadConfig, saveConfig } from "./config.js";
import { GOOGLE_WORKSPACE_SCOPES, googleStatus, loginGoogle, logoutGoogle } from "./google.js";
import { runSetup } from "./setup.js";
import { SkillLoader } from "./skills.js";
import { splitCsv } from "./util.js";

interface Args {
  task: string[];
  config?: string;
  setup: boolean;
  initConfig: boolean;
  showTools: boolean;
  version: boolean;
  help: boolean;
  agent?: string;
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
  googleClientIdEnv?: string;
  googleClientSecretEnv?: string;
  googleCalendarId?: string;
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
  const command = args.task[0]?.toLowerCase();
  if (command === "agent" || command === "agents") {
    return handleCommand(() => runAgentCommand(config, args.task.slice(1)));
  }
  if (command === "skill" || command === "skills") {
    return handleCommand(() => runSkillCommand(config, args.task.slice(1)));
  }
  if (command === "google") {
    return handleAsyncCommand(() => runGoogleCommand(config, args.task.slice(1)));
  }
  const agentProfile = args.agent ? new AgentStore(config.agentsDir).get(args.agent) : null;
  if (args.agent && !agentProfile) {
    console.error(`Butterclaw failed: Unknown agent: ${args.agent}`);
    return 1;
  }
  if (agentProfile) {
    applyAgentProfile(config, agentProfile);
  }
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
    console.log(new ButterclawAgent(config, { ...(agentProfile ? { agentProfile } : {}) }).registry.describe());
    return 0;
  }
  if (args.telegramPoll) {
    return runTelegram(config, args.telegramOnce, agentProfile ?? undefined);
  }

  const task = args.task.join(" ").trim();
  if (!task) {
    return repl(config);
  }
  return runOnce(config, task, agentProfile ?? undefined);
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

  const valueOptions: Record<string, (value: string) => void> = {
    "--config": (value) => (args.config = value),
    "--agent": (value) => (args.agent = value),
    "--provider": (value) => (args.provider = value as ButterclawConfig["provider"]),
    "--model": (value) => (args.model = value),
    "--base-url": (value) => (args.baseUrl = value),
    "--api-key-env": (value) => (args.apiKeyEnv = value),
    "--workspace": (value) => (args.workspace = value),
    "--max-steps": (value) => (args.maxSteps = Number(value)),
    "--max-context-chars": (value) => (args.maxContextChars = Number(value)),
    "--telegram-token-env": (value) => (args.telegramTokenEnv = value),
    "--telegram-base-url": (value) => (args.telegramBaseUrl = value),
    "--telegram-allowed-chat": (value) => args.telegramAllowedChat.push(...splitCsv(value)),
    "--telegram-timeout": (value) => (args.telegramTimeout = Number(value)),
    "--telegram-idle-sleep": (value) => (args.telegramIdleSleep = Number(value)),
    "--google-client-id-env": (value) => (args.googleClientIdEnv = value),
    "--google-client-secret-env": (value) => (args.googleClientSecretEnv = value),
    "--google-calendar-id": (value) => (args.googleCalendarId = value)
  };
  const flagOptions: Record<string, () => void> = {
    "--setup": () => (args.setup = true),
    "--init-config": () => (args.initConfig = true),
    "--show-tools": () => (args.showTools = true),
    "--version": () => (args.version = true),
    "--allow-shell": () => (args.allowShell = true),
    "--allow-outside-workspace": () => (args.allowOutsideWorkspace = true),
    "--telegram-poll": () => (args.telegramPoll = true),
    "--telegram-once": () => (args.telegramOnce = true)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      return args;
    }
    if (arg in valueOptions) {
      index += 1;
      valueOptions[arg](argv[index] ?? "");
    } else if (arg in flagOptions) {
      flagOptions[arg]();
    } else {
      args.task.push(arg);
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
  if (args.googleClientIdEnv) config.googleClientIdEnv = args.googleClientIdEnv;
  if (args.googleClientSecretEnv) config.googleClientSecretEnv = args.googleClientSecretEnv;
  if (args.googleCalendarId) config.googleCalendarId = args.googleCalendarId;
}

async function runOnce(config: ButterclawConfig, task: string, agentProfile?: AgentProfile): Promise<number> {
  try {
    const result = await new ButterclawAgent(config, { ...(agentProfile ? { agentProfile } : {}) }).run(task);
    console.log(result.answer);
    return 0;
  } catch (error) {
    console.error(`Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function runTelegram(config: ButterclawConfig, once: boolean, agentProfile?: AgentProfile): Promise<number> {
  try {
    await new TelegramChannel(config).runForever(new ButterclawAgent(config, { ...(agentProfile ? { agentProfile } : {}) }), once);
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

export function runAgentCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new AgentStore(config.agentsDir);
  const command = argv[0]?.toLowerCase() ?? "list";
  if (command === "list") {
    const agents = store.list();
    outputFunc(agents.length ? agents.map((agent) => `${agent.name}: ${agent.description}`).join("\n") : "No agents yet.");
    return 0;
  }
  if (command === "show") {
    const name = argv[1] ?? "";
    const agent = store.get(name);
    if (!agent) throw new Error(`Unknown agent: ${name}`);
    outputFunc(JSON.stringify(agent, null, 2));
    return 0;
  }
  if (command === "create") {
    const parsed = parseCommandOptions(argv.slice(1));
    const name = parsed.positionals[0] ?? "";
    const agent = store.create({
      name,
      description: parsed.values.description,
      instructions: parsed.values.instructions ?? parsed.values.prompt,
      provider: parsed.values.provider as ButterclawConfig["provider"] | undefined,
      model: parsed.values.model,
      baseUrl: parsed.values["base-url"],
      maxSteps: parsed.values["max-steps"] ? Number(parsed.values["max-steps"]) : undefined,
      skills: parsed.values.skills ? splitCsv(parsed.values.skills) : undefined,
      overwrite: parsed.flags.has("force")
    });
    outputFunc(`Created agent ${agent.name} in ${config.agentsDir}`);
    return 0;
  }
  throw new Error("Usage: butterclaw agent list | show <name> | create <name> [--description text] [--instructions text] [--model name] [--provider name] [--force]");
}

export function runSkillCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const loader = new SkillLoader(config.skillsDir, config.maxSkillChars);
  const command = argv[0]?.toLowerCase() ?? "list";
  if (command === "list") {
    const skills = loader.list();
    outputFunc(skills.length ? skills.join("\n") : "No skills yet.");
    return 0;
  }
  if (command === "show") {
    const name = argv[1] ?? "";
    const skill = loader.read(name);
    if (skill === null) throw new Error(`Unknown skill: ${name}`);
    outputFunc(skill);
    return 0;
  }
  if (command === "create") {
    const parsed = parseCommandOptions(argv.slice(1));
    const name = parsed.positionals[0] ?? "";
    const file = loader.create({
      name,
      description: parsed.values.description,
      body: parsed.values.body ?? parsed.values.instructions,
      overwrite: parsed.flags.has("force")
    });
    outputFunc(`Created skill ${name} at ${file}`);
    return 0;
  }
  throw new Error("Usage: butterclaw skill list | show <name> | create <name> [--description text] [--body text] [--force]");
}

export async function runGoogleCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const command = argv[0]?.toLowerCase() ?? "status";
  if (command === "status") {
    outputFunc(googleStatus(config));
    return 0;
  }
  if (command === "logout") {
    outputFunc(logoutGoogle(config));
    return 0;
  }
  if (command === "login") {
    const parsed = parseCommandOptions(argv.slice(1));
    const message = await loginGoogle(config, {
      clientId: parsed.values["client-id"],
      clientSecret: parsed.values["client-secret"],
      scopes: parsed.values.scopes ? splitCsv(parsed.values.scopes) : GOOGLE_WORKSPACE_SCOPES,
      openBrowser: !parsed.flags.has("no-browser"),
      output: outputFunc
    });
    outputFunc(message);
    return 0;
  }
  throw new Error("Usage: butterclaw google login [--client-id id] [--client-secret secret] [--scopes scope1,scope2] | status | logout");
}

function handleCommand(command: () => number): number {
  try {
    return command();
  } catch (error) {
    console.error(`Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function handleAsyncCommand(command: () => Promise<number>): Promise<number> {
  try {
    return await command();
  } catch (error) {
    console.error(`Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseCommandOptions(argv: string[]): { positionals: string[]; values: Record<string, string>; flags: Set<string> } {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "force") {
      flags.add(key);
      continue;
    }
    index += 1;
    values[key] = argv[index] ?? "";
  }
  return { positionals, values, flags };
}

function printHelp(): void {
  console.log(`Usage: butterclaw [options] [task...]

Options:
  --setup                         Run first-time setup
  --init-config                   Write a starter config
  --show-tools                    Print available tools
  --version                       Print version
  --agent <name>                  Run as a saved agent profile
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
  --telegram-idle-sleep <seconds>
  --google-client-id-env <name>
  --google-client-secret-env <name>
  --google-calendar-id <id>

Commands:
  butterclaw agent list
  butterclaw agent create <name> --description <text> --instructions <text>
  butterclaw skill list
  butterclaw skill create <name> --description <text> --body <text>
  butterclaw google login
  butterclaw google status
  butterclaw google logout`);
}

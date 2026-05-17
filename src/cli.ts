#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ButterclawAgent } from "./agent.js";
import { AgentProfile, AgentStore, applyAgentProfile } from "./agents.js";
import { createBackup } from "./backup.js";
import { TelegramChannel, TelegramError } from "./channels/telegram.js";
import { WhatsAppChannel, WhatsAppError, whatsappStatus } from "./channels/whatsapp.js";
import { ButterclawConfig, configPath, loadConfig, saveConfig } from "./config.js";
import { doctorChecks } from "./doctor.js";
import { ButterclawGateway, gatewayStatus } from "./gateway.js";
import { githubStatus } from "./github.js";
import { GOOGLE_WORKSPACE_SCOPES, googleStatus, loginGoogle, logoutGoogle } from "./google.js";
import { formatMemoryItems, formatMemoryStats, LocalMemory } from "./memory.js";
import { formatScheduleList, formatScheduleRuns, formatScheduleStats, ScheduleJob, ScheduleStore } from "./scheduler.js";
import { formatSessionSearch, formatSessionStats, SessionRole, SessionStore } from "./sessions.js";
import { runSetup } from "./setup.js";
import { formatSkillInfo, SkillLoader } from "./skills.js";
import { TeamStore } from "./teams.js";
import { formatTasks, formatTaskStats, parseTaskStatus, TaskStore } from "./tasks.js";
import { enabledToolNames, toolPolicySummary } from "./tool-policy.js";
import { button, panel, renderCollection, renderHelp, statusPill, successLine } from "./ui.js";
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
  session?: string;
  provider?: ButterclawConfig["provider"];
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  workspace?: string;
  maxSteps?: number;
  maxContextChars?: number;
  requestTimeoutSeconds?: number;
  sessionMaxTurns?: number;
  toolProfile?: ButterclawConfig["toolProfile"];
  toolAllow: string[];
  toolDeny: string[];
  modelFallback: string[];
  allowShell: boolean;
  allowOutsideWorkspace: boolean;
  telegramPoll: boolean;
  telegramOnce: boolean;
  whatsappWebhook: boolean;
  telegramTokenEnv?: string;
  telegramBaseUrl?: string;
  telegramAllowedChat: string[];
  telegramTimeout?: number;
  telegramIdleSleep?: number;
  googleClientIdEnv?: string;
  googleClientSecretEnv?: string;
  googleCalendarId?: string;
  githubCliPath?: string;
  githubDefaultRepo?: string;
  githubMaxItems?: number;
  gatewayHost?: string;
  gatewayPort?: number;
  gatewayHookPath?: string;
  gatewayTokenEnv?: string;
  gatewayMaxBodyBytes?: number;
  whatsappMode?: ButterclawConfig["whatsappMode"];
  whatsappDefaultTo?: string;
  whatsappAllowedChat: string[];
  whatsappGroupAllowedChat: string[];
  whatsappDmPolicy?: ButterclawConfig["whatsappDmPolicy"];
  whatsappGroupPolicy?: ButterclawConfig["whatsappGroupPolicy"];
  whatsappMentionPattern: string[];
  whatsappTextChunkLimit?: number;
  whatsappWebhookPath?: string;
  whatsappWebhookPort?: number;
  whatsappGraphApiVersion?: string;
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
  const command = args.task[0]?.toLowerCase();
  if (command === "agent" || command === "agents") {
    if (isAgentRunCommand(args.task.slice(1))) {
      return handleAsyncCommand(() => runAgentRunCommand(config, args.task.slice(1)));
    }
    return handleCommand(() => runAgentCommand(config, args.task.slice(1)));
  }
  if (command === "team" || command === "teams") {
    if (isTeamRunCommand(args.task.slice(1))) {
      return handleAsyncCommand(() => runTeamRunCommand(config, args.task.slice(1)));
    }
    return handleCommand(() => runTeamCommand(config, args.task.slice(1)));
  }
  if (command === "skill" || command === "skills") {
    return handleCommand(() => runSkillCommand(config, args.task.slice(1)));
  }
  if (command === "session" || command === "sessions") {
    return handleCommand(() => runSessionCommand(config, args.task.slice(1)));
  }
  if (command === "memory" || command === "mem") {
    return handleCommand(() => runMemoryCommand(config, args.task.slice(1)));
  }
  if (command === "doctor" || command === "check" || command === "diagnose") {
    return handleAsyncCommand(() => runDoctorCommand(config));
  }
  if (command === "backup" || command === "export") {
    return handleCommand(() => runBackupCommand(config, args.task.slice(1)));
  }
  if (command === "google") {
    return handleAsyncCommand(() => runGoogleCommand(config, args.task.slice(1)));
  }
  if (command === "github" || command === "gh") {
    return handleAsyncCommand(() => runGitHubCommand(config, args.task.slice(1)));
  }
  if (command === "gateway" || command === "gw") {
    return handleAsyncCommand(() => runGatewayCommand(config, args.task.slice(1)));
  }
  if (command === "schedule" || command === "schedules" || command === "cron") {
    return handleAsyncCommand(() => runScheduleCommand(config, args.task.slice(1)));
  }
  if (command === "task" || command === "tasks") {
    return handleCommand(() => runTaskCommand(config, args.task.slice(1)));
  }
  if (command === "whatsapp" || command === "wa") {
    return handleAsyncCommand(() => runWhatsAppCommand(config, args.task.slice(1)));
  }
  const agentProfile = args.agent ? new AgentStore(config.agentsDir).get(args.agent) : null;
  if (args.agent && !agentProfile) {
    console.error(`Butterclaw failed: Unknown agent: ${args.agent}`);
    return 1;
  }
  if (agentProfile) {
    applyAgentProfile(config, agentProfile);
  }

  if (args.setup || isSetupTask(args.task)) {
    return runSetup(config, configFile);
  }
  if (args.initConfig) {
    saveConfig(config, configFile);
    console.log(successLine(`Wrote config to ${configFile}`));
    return 0;
  }
  if (args.showTools) {
    console.log(new ButterclawAgent(config, { ...(agentProfile ? { agentProfile } : {}) }).registry.describe());
    return 0;
  }
  if (args.telegramPoll) {
    return runTelegram(config, args.telegramOnce, agentProfile ?? undefined);
  }
  if (args.whatsappWebhook) {
    return runWhatsAppWebhook(config, agentProfile ?? undefined);
  }

  const task = args.task.join(" ").trim();
  if (!task) {
    return repl(config, agentProfile ?? undefined, args.session);
  }
  return runOnce(config, task, agentProfile ?? undefined, args.session);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    task: [],
    setup: false,
    initConfig: false,
    showTools: false,
    version: false,
    help: false,
    toolAllow: [],
    toolDeny: [],
    modelFallback: [],
    allowShell: false,
    allowOutsideWorkspace: false,
    telegramPoll: false,
    telegramOnce: false,
    whatsappWebhook: false,
    telegramAllowedChat: [],
    whatsappAllowedChat: [],
    whatsappGroupAllowedChat: [],
    whatsappMentionPattern: []
  };

  const valueOptions: Record<string, (value: string) => void> = {
    "--config": (value) => (args.config = value),
    "--agent": (value) => (args.agent = value),
    "--session": (value) => (args.session = value),
    "--provider": (value) => (args.provider = value as ButterclawConfig["provider"]),
    "--model": (value) => (args.model = value),
    "--base-url": (value) => (args.baseUrl = value),
    "--api-key-env": (value) => (args.apiKeyEnv = value),
    "--workspace": (value) => (args.workspace = value),
    "--max-steps": (value) => (args.maxSteps = Number(value)),
    "--max-context-chars": (value) => (args.maxContextChars = Number(value)),
    "--request-timeout-seconds": (value) => (args.requestTimeoutSeconds = Number(value)),
    "--timeout": (value) => (args.requestTimeoutSeconds = Number(value)),
    "--session-max-turns": (value) => (args.sessionMaxTurns = Number(value)),
    "--tool-profile": (value) => (args.toolProfile = value as ButterclawConfig["toolProfile"]),
    "--allow-tool": (value) => args.toolAllow.push(...splitCsv(value)),
    "--tool-allow": (value) => args.toolAllow.push(...splitCsv(value)),
    "--deny-tool": (value) => args.toolDeny.push(...splitCsv(value)),
    "--tool-deny": (value) => args.toolDeny.push(...splitCsv(value)),
    "--model-fallback": (value) => args.modelFallback.push(...splitCsv(value)),
    "--telegram-token-env": (value) => (args.telegramTokenEnv = value),
    "--telegram-base-url": (value) => (args.telegramBaseUrl = value),
    "--telegram-allowed-chat": (value) => args.telegramAllowedChat.push(...splitCsv(value)),
    "--telegram-timeout": (value) => (args.telegramTimeout = Number(value)),
    "--telegram-idle-sleep": (value) => (args.telegramIdleSleep = Number(value)),
    "--google-client-id-env": (value) => (args.googleClientIdEnv = value),
    "--google-client-secret-env": (value) => (args.googleClientSecretEnv = value),
    "--google-calendar-id": (value) => (args.googleCalendarId = value),
    "--github-cli-path": (value) => (args.githubCliPath = value),
    "--github-default-repo": (value) => (args.githubDefaultRepo = value),
    "--github-max-items": (value) => (args.githubMaxItems = Number(value)),
    "--gateway-host": (value) => (args.gatewayHost = value),
    "--gateway-port": (value) => (args.gatewayPort = Number(value)),
    "--gateway-hook-path": (value) => (args.gatewayHookPath = value),
    "--gateway-token-env": (value) => (args.gatewayTokenEnv = value),
    "--gateway-max-body-bytes": (value) => (args.gatewayMaxBodyBytes = Number(value)),
    "--whatsapp-mode": (value) => (args.whatsappMode = value as ButterclawConfig["whatsappMode"]),
    "--whatsapp-default-to": (value) => (args.whatsappDefaultTo = value),
    "--whatsapp-allowed-chat": (value) => args.whatsappAllowedChat.push(...splitCsv(value)),
    "--whatsapp-group-allowed-chat": (value) => args.whatsappGroupAllowedChat.push(...splitCsv(value)),
    "--whatsapp-dm-policy": (value) => (args.whatsappDmPolicy = value as ButterclawConfig["whatsappDmPolicy"]),
    "--whatsapp-group-policy": (value) => (args.whatsappGroupPolicy = value as ButterclawConfig["whatsappGroupPolicy"]),
    "--whatsapp-mention-pattern": (value) => args.whatsappMentionPattern.push(...splitCsv(value)),
    "--whatsapp-text-chunk-limit": (value) => (args.whatsappTextChunkLimit = Number(value)),
    "--whatsapp-webhook-path": (value) => (args.whatsappWebhookPath = value),
    "--whatsapp-webhook-port": (value) => (args.whatsappWebhookPort = Number(value)),
    "--whatsapp-graph-api-version": (value) => (args.whatsappGraphApiVersion = value)
  };
  const flagOptions: Record<string, () => void> = {
    "--setup": () => (args.setup = true),
    "--init-config": () => (args.initConfig = true),
    "--show-tools": () => (args.showTools = true),
    "--version": () => (args.version = true),
    "--allow-shell": () => (args.allowShell = true),
    "--allow-outside-workspace": () => (args.allowOutsideWorkspace = true),
    "--telegram-poll": () => (args.telegramPoll = true),
    "--telegram-once": () => (args.telegramOnce = true),
    "--whatsapp-webhook": () => (args.whatsappWebhook = true)
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
  if (args.requestTimeoutSeconds !== undefined) config.requestTimeoutSeconds = args.requestTimeoutSeconds;
  if (args.sessionMaxTurns !== undefined) config.sessionMaxTurns = args.sessionMaxTurns;
  if (args.toolProfile) config.toolProfile = args.toolProfile;
  if (args.toolAllow.length) config.toolAllow = [...config.toolAllow, ...args.toolAllow];
  if (args.toolDeny.length) config.toolDeny = [...config.toolDeny, ...args.toolDeny];
  if (args.modelFallback.length) config.modelFallbacks = [...config.modelFallbacks, ...args.modelFallback];
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
  if (args.githubCliPath) config.githubCliPath = args.githubCliPath;
  if (args.githubDefaultRepo) config.githubDefaultRepo = args.githubDefaultRepo;
  if (args.githubMaxItems !== undefined) config.githubMaxItems = args.githubMaxItems;
  if (args.gatewayHost) config.gatewayHost = args.gatewayHost;
  if (args.gatewayPort !== undefined) config.gatewayPort = args.gatewayPort;
  if (args.gatewayHookPath) config.gatewayHookPath = args.gatewayHookPath;
  if (args.gatewayTokenEnv) config.gatewayTokenEnv = args.gatewayTokenEnv;
  if (args.gatewayMaxBodyBytes !== undefined) config.gatewayMaxBodyBytes = args.gatewayMaxBodyBytes;
  if (args.whatsappMode) config.whatsappMode = args.whatsappMode;
  if (args.whatsappDefaultTo) config.whatsappDefaultTo = args.whatsappDefaultTo;
  if (args.whatsappAllowedChat.length) config.whatsappAllowedChats = args.whatsappAllowedChat;
  if (args.whatsappGroupAllowedChat.length) config.whatsappGroupAllowedChats = args.whatsappGroupAllowedChat;
  if (args.whatsappDmPolicy) config.whatsappDmPolicy = args.whatsappDmPolicy;
  if (args.whatsappGroupPolicy) config.whatsappGroupPolicy = args.whatsappGroupPolicy;
  if (args.whatsappMentionPattern.length) config.whatsappMentionPatterns = args.whatsappMentionPattern;
  if (args.whatsappTextChunkLimit !== undefined) config.whatsappTextChunkLimit = args.whatsappTextChunkLimit;
  if (args.whatsappWebhookPath) config.whatsappWebhookPath = args.whatsappWebhookPath;
  if (args.whatsappWebhookPort !== undefined) config.whatsappWebhookPort = args.whatsappWebhookPort;
  if (args.whatsappGraphApiVersion) config.whatsappGraphApiVersion = args.whatsappGraphApiVersion;
}

async function runOnce(config: ButterclawConfig, task: string, agentProfile?: AgentProfile, sessionName?: string): Promise<number> {
  try {
    const localHelp = localHelpForTask(task);
    if (localHelp) {
      console.log(localHelp);
      return 0;
    }
    const agent = new ButterclawAgent(config, {
      ...(agentProfile ? { agentProfile } : {}),
      ...(sessionName ? { sessionName } : {})
    });
    if (await runSlashCommand(config, task, { agent, agentProfile, sessionName })) {
      return 0;
    }
    const result = await agent.run(task);
    console.log(result.answer || "Butterclaw finished, but the provider returned an empty answer.");
    return 0;
  } catch (error) {
    console.error(formatCliError(error));
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

async function repl(config: ButterclawConfig, agentProfile?: AgentProfile, sessionName?: string): Promise<number> {
  console.log("Butterclaw REPL. Type 'exit' or press Ctrl+C to quit.");
  const rl = readline.createInterface({ input, output });
  const agent = new ButterclawAgent(config, {
    ...(agentProfile ? { agentProfile } : {}),
    ...(sessionName ? { sessionName } : {})
  });
  try {
    while (true) {
      let task: string;
      try {
        task = (await rl.question("> ")).trim();
      } catch (error) {
        if (isAbortError(error)) {
          console.log("");
          return 0;
        }
        throw error;
      }
      if (!task) continue;
      if (task === "exit" || task === "quit") return 0;
      const localHelp = localHelpForTask(task);
      if (localHelp) {
        console.log(localHelp);
        continue;
      }
      if (await runSlashCommand(config, task, { agent, agentProfile, sessionName })) continue;
      try {
        const result = await agent.run(task);
        console.log(result.answer || "Butterclaw finished, but the provider returned an empty answer.");
      } catch (error) {
        console.error(formatCliError(error));
      }
    }
  } finally {
    rl.close();
  }
}

async function runWhatsAppWebhook(config: ButterclawConfig, agentProfile?: AgentProfile): Promise<number> {
  try {
    return await new WhatsAppChannel(config).runWebhook((sessionName) => new ButterclawAgent(config, { ...(agentProfile ? { agentProfile } : {}), sessionName }));
  } catch (error) {
    const prefix = error instanceof WhatsAppError ? "WhatsApp failed" : "Butterclaw WhatsApp webhook failed";
    console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function runSlashCommand(
  config: ButterclawConfig,
  rawInput: string,
  context: { agent: ButterclawAgent; agentProfile?: AgentProfile; sessionName?: string; outputFunc?: (line: string) => void }
): Promise<boolean> {
  const input = rawInput.trim();
  if (!input.startsWith("/")) {
    return false;
  }
  const outputFunc = context.outputFunc ?? console.log;
  const [token = ""] = input.split(/\s+/, 1);
  const command = token.slice(1).toLowerCase();
  const rest = input.slice(token.length).trim();

  if (command === "help" || command === "?") {
    outputFunc(
      panel("Slash Commands", [
        `${button("/status")} runtime, workspace, session, and tool profile`,
        `${button("/tools")} list the active tool surface`,
        `${button("/tool-policy")} show profile, allow, and deny rules`,
        `${button("/new")} clear the current named session`,
        `${button("/reset")} same as /new`,
        `${button("/doctor")} run local diagnostics`,
        `${button("/backup")} save local agents, teams, skills, sessions, schedules, and memory`,
        `${button("/memory")} show or search local memory`,
        `${button("/schedule")} show local reminders and recurring jobs`,
        `${button("/gateway")} show local gateway and hook status`,
        `${button("/tasks")} list local background task records`,
        `${button("/github")} show gh OAuth and repo status`,
        `${button("/whatsapp")} show WhatsApp channel status`
      ])
    );
    return true;
  }

  if (command === "status") {
    outputFunc(
      panel("Butterclaw Status", [
        `Provider: ${config.provider} ${config.model}`,
        `Workspace: ${config.workspace}`,
        `Agent: ${context.agentProfile?.name ?? "default"}`,
        `Session: ${context.sessionName ?? "(none)"}`,
        `Tool profile: ${config.toolProfile}`,
        `Tools: ${context.agent.registry.names().join(", ") || "none"}`
      ])
    );
    return true;
  }

  if (command === "tools") {
    outputFunc(context.agent.registry.describe() || "No tools enabled.");
    return true;
  }

  if (command === "tool-policy" || command === "policy") {
    outputFunc(panel("Tool Policy", toolPolicySummary(config).split("\n")));
    return true;
  }

  if (command === "new" || command === "reset") {
    if (!context.sessionName) {
      outputFunc("No named session is active. Start one with --session <name>.");
      return true;
    }
    const cleared = new SessionStore(config.sessionsDir).clear(context.sessionName);
    outputFunc(cleared ? successLine(`Cleared session ${context.sessionName}`) : successLine(`Started fresh session ${context.sessionName}`));
    return true;
  }

  if (command === "doctor" || command === "check") {
    await runDoctorCommand(config, outputFunc);
    return true;
  }

  if (command === "backup" || command === "export") {
    runBackupCommand(config, rest ? ["create", rest] : ["create"], outputFunc);
    return true;
  }

  if (command === "memory" || command === "mem") {
    const memory = new LocalMemory(config.memoryPath);
    const items = rest ? memory.searchItems(rest, 20).map((entry) => entry.item) : memory.items(20);
    outputFunc(panel("Memory", formatMemoryItems(items).split("\n")));
    return true;
  }

  if (command === "schedule" || command === "cron") {
    outputFunc(panel("Schedule", formatScheduleList(new ScheduleStore(config.schedulePath).list()).split("\n")));
    return true;
  }

  if (command === "gateway" || command === "gw") {
    outputFunc(panel("Gateway", gatewayStatus(config).split("\n")));
    return true;
  }

  if (command === "tasks" || command === "task") {
    outputFunc(panel("Tasks", formatTasks(new TaskStore(config.taskPath).list()).split("\n")));
    return true;
  }

  if (command === "github" || command === "gh") {
    outputFunc(panel("GitHub", githubStatus(config).split("\n")));
    return true;
  }

  if (command === "whatsapp" || command === "wa") {
    outputFunc(panel("WhatsApp", whatsappStatus(config).split("\n")));
    return true;
  }

  outputFunc(`Unknown slash command: /${command || ""}. Try /help.`);
  return true;
}

export function runAgentCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new AgentStore(config.agentsDir);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list") {
    const agents = store.list();
    outputFunc(
      renderCollection(
        "Agents",
        agents.map((agent) => `${button("agent")} ${agent.name}: ${agent.description}`),
        "No agents yet."
      )
    );
    return 0;
  }
  if (command === "help") {
    outputFunc(agentHelp());
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
    outputFunc(successLine(`Created agent ${agent.name} in ${config.agentsDir}`));
    return 0;
  }
  throw new Error("Usage: butterclaw agent list | show <name> | create <name> [--description text] [--instructions text] [--model name] [--provider name] [--force] | run <name> <task...>");
}

export async function runAgentRunCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const parsed = parseRunTarget(argv);
  if (!parsed.name || !parsed.task) {
    throw new Error("Usage: butterclaw agent run <name> <task...>");
  }
  const profile = new AgentStore(config.agentsDir).get(parsed.name);
  if (!profile) {
    throw new Error(`Unknown agent: ${parsed.name}`);
  }
  const agentConfig = { ...config };
  applyAgentProfile(agentConfig, profile);
  const result = await new ButterclawAgent(agentConfig, { agentProfile: profile }).run(parsed.task);
  outputFunc(result.answer);
  return 0;
}

export function runTeamCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new TeamStore(config.teamsDir);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list") {
    const teams = store.list();
    outputFunc(
      renderCollection(
        "Teams",
        teams.map((team) => `${button("team")} ${team.name}: ${team.agents.join(", ")} - ${team.description}`),
        "No teams yet."
      )
    );
    return 0;
  }
  if (command === "help") {
    outputFunc(teamHelp());
    return 0;
  }
  if (command === "show") {
    const name = argv[1] ?? "";
    const team = store.get(name);
    if (!team) throw new Error(`Unknown team: ${name}`);
    outputFunc(JSON.stringify(team, null, 2));
    return 0;
  }
  if (command === "create") {
    const parsed = parseCommandOptions(argv.slice(1));
    const name = parsed.positionals[0] ?? "";
    const agents = parsed.values.agents ?? parsed.values.agent ?? parsed.positionals.slice(1).join(",");
    const team = store.create({
      name,
      agents,
      description: parsed.values.description,
      instructions: parsed.values.instructions ?? parsed.values.prompt,
      overwrite: parsed.flags.has("force")
    });
    outputFunc(successLine(`Created team ${team.name} in ${config.teamsDir}`));
    return 0;
  }
  throw new Error("Usage: butterclaw team list | show <name> | create <name> --agents <agent1,agent2> [--description text] [--instructions text] [--force] | run <name> <task...>");
}

export async function runTeamRunCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const parsed = parseRunTarget(argv);
  if (!parsed.name || !parsed.task) {
    throw new Error("Usage: butterclaw team run <name> <task...>");
  }
  const team = new TeamStore(config.teamsDir).get(parsed.name);
  if (!team) {
    throw new Error(`Unknown team: ${parsed.name}`);
  }
  const agent = new ButterclawAgent(config);
  const result = await agent.registry.call("delegate_team", { team: team.name, task: parsed.task });
  outputFunc(result.output);
  return result.ok ? 0 : 1;
}

export function runSkillCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const loader = new SkillLoader(config.skillsDir, config.maxSkillChars, enabledToolNames(config));
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list") {
    const parsed = parseCommandOptions(argv.slice(1));
    if (parsed.flags.has("verbose")) {
      outputFunc(panel("Skills", formatSkillInfo(loader.listInfo()).split("\n")));
    } else {
      const skills = loader.list();
      outputFunc(renderCollection("Skills", skills.map((skill) => `${button("skill")} ${skill}`), "No skills yet."));
    }
    return 0;
  }
  if (command === "show") {
    const name = argv[1] ?? "";
    const skill = loader.read(name);
    if (skill === null) throw new Error(`Unknown skill: ${name}`);
    outputFunc(skill);
    return 0;
  }
  if (command === "info") {
    const info = loader.info(argv[1] ?? "");
    if (!info) throw new Error(`Unknown skill: ${argv[1] ?? ""}`);
    outputFunc(formatSkillInfo([info]));
    return 0;
  }
  if (command === "search" || command === "find") {
    const parsed = parseCommandOptions(argv.slice(1));
    const query = parsed.positionals.join(" ");
    outputFunc(formatSkillInfo(loader.search(query, Number(parsed.values.limit ?? 20))));
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
    outputFunc(successLine(`Created skill ${name} at ${file}`));
    return 0;
  }
  if (command === "delete" || command === "remove" || command === "rm") {
    const name = argv[1] ?? "";
    const removed = loader.remove(name);
    outputFunc(removed ? successLine(`Deleted skill ${name}`) : `No skill found: ${name}`);
    return removed ? 0 : 1;
  }
  if (command === "rename" || command === "mv") {
    const parsed = parseCommandOptions(argv.slice(1));
    const [oldName = "", newName = ""] = parsed.positionals;
    const renamed = loader.rename(oldName, newName, parsed.flags.has("force"));
    outputFunc(renamed ? successLine(`Renamed skill ${oldName} to ${newName}`) : `No skill found: ${oldName}`);
    return renamed ? 0 : 1;
  }
  if (command === "copy" || command === "cp") {
    const parsed = parseCommandOptions(argv.slice(1));
    const [oldName = "", newName = ""] = parsed.positionals;
    const copied = loader.copy(oldName, newName, parsed.flags.has("force"));
    outputFunc(copied ? successLine(`Copied skill ${oldName} to ${newName}`) : `No skill found: ${oldName}`);
    return copied ? 0 : 1;
  }
  if (command === "validate" || command === "doctor") {
    const messages = loader.validate(argv[1]);
    outputFunc(messages.length ? messages.join("\n") : successLine("Skills validated."));
    return messages.length ? 1 : 0;
  }
  throw new Error(
    "Usage: butterclaw skill list [--verbose] | show <name> | info <name> | search <query> | create <name> [--description text] [--body text] [--force] | delete <name> | rename <old> <new> [--force] | copy <old> <new> [--force] | validate [name]"
  );
}

export function runMemoryCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const memory = new LocalMemory(config.memoryPath);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list" || command === "tail") {
    const parsed = parseCommandOptions(argv.slice(1));
    outputFunc(panel("Memory", formatMemoryItems(memory.items(Number(parsed.values.limit ?? parsed.positionals[0] ?? 50))).split("\n")));
    return 0;
  }
  if (command === "search" || command === "find") {
    const parsed = parseCommandOptions(argv.slice(1));
    const query = parsed.positionals.join(" ");
    outputFunc(panel("Memory", formatMemoryItems(memory.searchItems(query, Number(parsed.values.limit ?? 20)).map((entry) => entry.item)).split("\n")));
    return 0;
  }
  if (command === "add" || command === "remember") {
    const parsed = parseCommandOptions(argv.slice(1));
    const content = parsed.values.content ?? parsed.values.text ?? parsed.positionals.join(" ");
    memory.add(parsed.values.role ?? "user", content);
    outputFunc(successLine("Memory saved."));
    return 0;
  }
  if (command === "show" || command === "get") {
    const item = memory.get(argv[1] ?? "");
    if (!item) throw new Error(`Unknown memory: ${argv[1] ?? ""}`);
    outputFunc(JSON.stringify(item, null, 2));
    return 0;
  }
  if (command === "forget" || command === "delete" || command === "rm") {
    const id = argv[1] ?? "";
    const removed = memory.forget(id);
    outputFunc(removed ? successLine(`Forgot memory ${id}`) : `No memory found: ${id}`);
    return removed ? 0 : 1;
  }
  if (command === "clear") {
    const removed = memory.clear();
    outputFunc(successLine(`Cleared ${removed} memory item(s).`));
    return 0;
  }
  if (command === "stats") {
    outputFunc(panel("Memory Stats", formatMemoryStats(memory.stats()).split("\n")));
    return 0;
  }
  if (command === "export") {
    const target = argv[1] ?? "butterclaw-memory-export.json";
    memory.exportJson(target);
    outputFunc(successLine(`Exported memory to ${target}`));
    return 0;
  }
  if (command === "import") {
    const source = argv[1] ?? "";
    const count = memory.importJson(source);
    outputFunc(successLine(`Imported ${count} memory item(s).`));
    return 0;
  }
  if (command === "prune") {
    const parsed = parseCommandOptions(argv.slice(1));
    const keep = Number(parsed.values.keep ?? parsed.positionals[0] ?? 100);
    const removed = memory.prune(keep);
    outputFunc(successLine(`Pruned ${removed} memory item(s).`));
    return 0;
  }
  throw new Error(
    "Usage: butterclaw memory list [--limit n] | search <query> [--limit n] | add [--role role] <text...> | show <id|index> | forget <id|index> | stats | export [path] | import <path> | prune --keep <n> | clear"
  );
}

export function runSessionCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new SessionStore(config.sessionsDir);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list") {
    const sessions = store.list();
    outputFunc(
      renderCollection(
        "Sessions",
        sessions.map((session) => `${button("session")} ${session.name}: ${session.turns} turn(s), updated ${session.updatedAt}`),
        "No sessions yet."
      )
    );
    return 0;
  }
  if (command === "show") {
    const name = argv[1] ?? "";
    outputFunc(store.format(name));
    return 0;
  }
  if (command === "tail") {
    const name = argv[1] ?? "";
    const count = Number(argv[2] ?? 10);
    outputFunc(store.tail(name, count));
    return 0;
  }
  if (command === "search" || command === "find") {
    const parsed = parseCommandOptions(argv.slice(1));
    outputFunc(formatSessionSearch(store.search(parsed.positionals.join(" "), Number(parsed.values.limit ?? 20))));
    return 0;
  }
  if (command === "stats") {
    outputFunc(panel("Session Stats", formatSessionStats(store.stats(argv[1])).split("\n")));
    return 0;
  }
  if (command === "append") {
    const parsed = parseCommandOptions(argv.slice(1));
    const name = parsed.positionals[0] ?? "";
    const role = (parsed.values.role ?? "user") as SessionRole;
    if (role !== "user" && role !== "assistant") throw new Error("role must be user or assistant");
    const content = parsed.values.content ?? parsed.values.text ?? parsed.positionals.slice(1).join(" ");
    store.append(name, role, content);
    outputFunc(successLine(`Appended ${role} turn to ${name}`));
    return 0;
  }
  if (command === "rename" || command === "mv") {
    const parsed = parseCommandOptions(argv.slice(1));
    const [oldName = "", newName = ""] = parsed.positionals;
    const renamed = store.rename(oldName, newName, parsed.flags.has("force"));
    outputFunc(renamed ? successLine(`Renamed session ${oldName} to ${newName}`) : `No session found: ${oldName}`);
    return renamed ? 0 : 1;
  }
  if (command === "copy" || command === "cp") {
    const parsed = parseCommandOptions(argv.slice(1));
    const [oldName = "", newName = ""] = parsed.positionals;
    const copied = store.copy(oldName, newName, parsed.flags.has("force"));
    outputFunc(copied ? successLine(`Copied session ${oldName} to ${newName}`) : `No session found: ${oldName}`);
    return copied ? 0 : 1;
  }
  if (command === "export") {
    const name = argv[1] ?? "";
    const target = argv[2] ?? `${name || "session"}.md`;
    store.export(name, target);
    outputFunc(successLine(`Exported session ${name} to ${target}`));
    return 0;
  }
  if (command === "clear" || command === "delete" || command === "rm") {
    const parsed = parseCommandOptions(argv.slice(1));
    if (parsed.flags.has("all")) {
      const count = store.clearAll();
      outputFunc(successLine(`Cleared ${count} session(s).`));
      return 0;
    }
    const name = argv[1] ?? "";
    const cleared = store.clear(name);
    outputFunc(cleared ? successLine(`Cleared session ${name}`) : `No session found: ${name}`);
    return 0;
  }
  if (command === "prune") {
    const parsed = parseCommandOptions(argv.slice(1));
    const maxTurns = Number(parsed.values.keep ?? parsed.positionals.at(-1) ?? config.sessionMaxTurns);
    const removed = parsed.flags.has("all") ? store.pruneAll(maxTurns) : store.prune(parsed.positionals[0] ?? "", maxTurns);
    outputFunc(successLine(`Pruned ${removed} old turn(s).`));
    return 0;
  }
  throw new Error(
    "Usage: butterclaw session list | show <name> | tail <name> [count] | search <query> | stats [name] | append <name> [--role user|assistant] <text...> | rename <old> <new> [--force] | copy <old> <new> [--force] | export <name> [path] | clear <name>|--all | prune <name>|--all [maxTurns]"
  );
}

export async function runDoctorCommand(config: ButterclawConfig, outputFunc = console.log): Promise<number> {
  const checks = await doctorChecks(config);
  outputFunc(
    panel(
      "Doctor",
      checks.map((check) => `${statusPill(check.ok)} ${check.label}: ${check.detail}`)
    )
  );
  return 0;
}

export function runBackupCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const command = argv[0]?.toLowerCase() ?? "create";
  if (command === "create") {
    const result = createBackup(config, argv[1]);
    outputFunc(
      panel("Backup", [
        successLine(`Saved ${result.files} local file(s)`),
        `Path: ${result.path}`,
        `Excluded: ${result.excluded.join(", ")}`
      ])
    );
    return 0;
  }
  throw new Error("Usage: butterclaw backup create [path]");
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

export async function runGitHubCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const command = argv[0]?.toLowerCase() ?? "status";
  const agent = new ButterclawAgent(config);
  if (command === "status") {
    outputFunc(panel("GitHub", githubStatus(config).split("\n")));
    return 0;
  }
  if (command === "prs" || command === "pulls") {
    const result = await agent.registry.call("github_pr_list", cliRepoArgs(config, argv.slice(1)));
    outputFunc(result.output);
    return result.ok ? 0 : 1;
  }
  if (command === "pr") {
    const result = await agent.registry.call("github_pr_view", { ...cliRepoArgs(config, argv.slice(2)), pr: argv[1] ?? "" });
    outputFunc(result.output);
    return result.ok ? 0 : 1;
  }
  if (command === "issues") {
    const result = await agent.registry.call("github_issue_list", cliRepoArgs(config, argv.slice(1)));
    outputFunc(result.output);
    return result.ok ? 0 : 1;
  }
  if (command === "runs") {
    const result = await agent.registry.call("github_run_list", cliRepoArgs(config, argv.slice(1)));
    outputFunc(result.output);
    return result.ok ? 0 : 1;
  }
  throw new Error("Usage: butterclaw github status | prs [repo] | pr <number|url> [repo] | issues [repo] | runs [repo]");
}

export async function runGatewayCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const command = argv[0]?.toLowerCase() ?? "status";
  const gateway = new ButterclawGateway(config);
  if (command === "status" || command === "health") {
    outputFunc(panel("Gateway", gateway.status().split("\n")));
    return 0;
  }
  if (command === "serve" || command === "start" || command === "run") {
    return gateway.serve();
  }
  throw new Error("Usage: butterclaw gateway status | serve");
}

export async function runScheduleCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const store = new ScheduleStore(config.schedulePath);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list" || command === "status") {
    outputFunc(panel("Schedule", formatScheduleList(store.list()).split("\n")));
    return 0;
  }
  if (command === "due") {
    outputFunc(panel("Schedule Due", formatScheduleList(store.due()).split("\n")));
    return 0;
  }
  if (command === "stats") {
    outputFunc(panel("Schedule Stats", formatScheduleStats(store.stats()).split("\n")));
    return 0;
  }
  if (command === "show" || command === "get") {
    const job = store.get(argv[1] ?? "");
    if (!job) throw new Error(`Unknown schedule: ${argv[1] ?? ""}`);
    outputFunc(JSON.stringify(job, null, 2));
    return 0;
  }
  if (command === "runs" || command === "history") {
    const job = argv[1] ? store.get(argv[1]) : null;
    outputFunc(formatScheduleRuns(store.runs(job?.id ?? argv[1], 50)));
    return 0;
  }
  if (command === "add" || command === "create") {
    const parsed = parseCommandOptions(argv.slice(1));
    const message = parsed.values.message ?? parsed.values.task ?? parsed.positionals.join(" ");
    const job = store.add({
      name: parsed.values.name ?? parsed.positionals[0],
      at: parsed.values.at,
      every: parsed.values.every,
      message,
      session: parsed.values.session,
      agent: parsed.values.agent,
      deleteAfterRun: parsed.flags.has("delete-after-run") ? true : undefined,
      enabled: !parsed.flags.has("disabled")
    });
    outputFunc(
      panel("Schedule", [
        successLine(`Created ${job.name}`),
        `ID: ${job.id}`,
        `Next run: ${job.nextRunAt}`,
        `Kind: ${job.kind}${job.everySeconds ? ` (${job.everySeconds}s)` : ""}`
      ])
    );
    return 0;
  }
  if (command === "remove" || command === "delete" || command === "rm") {
    const target = argv[1] ?? "";
    const removed = store.remove(target);
    outputFunc(removed ? successLine(`Removed schedule ${target}`) : `No schedule found: ${target}`);
    return removed ? 0 : 1;
  }
  if (command === "enable" || command === "resume") {
    const target = argv[1] ?? "";
    const job = store.setEnabled(target, true);
    outputFunc(job ? successLine(`Enabled schedule ${job.name}`) : `No schedule found: ${target}`);
    return job ? 0 : 1;
  }
  if (command === "disable" || command === "pause") {
    const target = argv[1] ?? "";
    const job = store.setEnabled(target, false);
    outputFunc(job ? successLine(`Disabled schedule ${job.name}`) : `No schedule found: ${target}`);
    return job ? 0 : 1;
  }
  if (command === "export") {
    const target = argv[1] ?? "butterclaw-schedule-export.json";
    store.exportJson(target);
    outputFunc(successLine(`Exported schedules to ${target}`));
    return 0;
  }
  if (command === "run") {
    const parsed = parseCommandOptions(argv.slice(1));
    const dueOnly = parsed.flags.has("due") || !parsed.positionals[0] || parsed.positionals[0] === "--due";
    const jobs = dueOnly ? store.due() : [store.get(parsed.positionals[0] ?? "")].filter((job): job is ScheduleJob => job !== null);
    if (!jobs.length) {
      outputFunc(dueOnly ? "No schedules are due." : `Unknown schedule: ${parsed.positionals[0] ?? ""}`);
      return dueOnly ? 0 : 1;
    }
    return runScheduleJobs(config, store, jobs, outputFunc);
  }
  if (command === "daemon" || command === "watch") {
    const parsed = parseCommandOptions(argv.slice(1));
    const pollSeconds = Math.max(1, Math.trunc(Number(parsed.values["poll-seconds"] ?? parsed.values.poll ?? 30)));
    outputFunc(`Butterclaw schedule daemon polling every ${pollSeconds}s. Press Ctrl+C to stop.`);
    while (true) {
      await runScheduleJobs(config, store, store.due(), outputFunc, true);
      if (parsed.flags.has("once")) {
        return 0;
      }
      await sleep(pollSeconds * 1000);
    }
  }
  throw new Error(
    "Usage: butterclaw schedule list | due | stats | add --at <time>|--every <duration> --message <task> [--name name] [--session name] [--agent name] | run [--due|id] | runs [id] | enable <id> | disable <id> | export [path] | remove <id>"
  );
}

export function runTaskCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new TaskStore(config.taskPath);
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "list");
  if (command === "list" || command === "status") {
    const parsed = parseCommandOptions(argv.slice(1));
    const status = parseTaskStatus(parsed.values.status);
    if (parsed.values.status && !status) {
      throw new Error("Unknown task status. Use queued, running, succeeded, failed, or cancelled.");
    }
    outputFunc(
      panel(
        "Tasks",
        formatTasks(
          store.list({
            status,
            kind: parsed.values.kind,
            source: parsed.values.source
          }, Number(parsed.values.limit ?? 50))
        ).split("\n")
      )
    );
    return 0;
  }
  if (command === "show" || command === "get") {
    const task = store.get(argv[1] ?? "");
    if (!task) throw new Error(`Unknown task: ${argv[1] ?? ""}`);
    outputFunc(JSON.stringify(task, null, 2));
    return 0;
  }
  if (command === "cancel") {
    const task = store.cancel(argv[1] ?? "", argv.slice(2).join(" ") || undefined);
    outputFunc(task ? successLine(`Cancelled task ${task.id}`) : `No task found: ${argv[1] ?? ""}`);
    return task ? 0 : 1;
  }
  if (command === "stats") {
    outputFunc(panel("Task Stats", formatTaskStats(store.stats()).split("\n")));
    return 0;
  }
  if (command === "clear") {
    const parsed = parseCommandOptions(argv.slice(1));
    const status = parseTaskStatus(parsed.values.status);
    if (parsed.values.status && !status) throw new Error("Unknown task status. Use queued, running, succeeded, failed, or cancelled.");
    const removed = store.clear({ status, kind: parsed.values.kind, source: parsed.values.source });
    outputFunc(successLine(`Cleared ${removed} task record(s).`));
    return 0;
  }
  if (command === "prune") {
    const parsed = parseCommandOptions(argv.slice(1));
    const keep = Number(parsed.values.keep ?? parsed.positionals[0] ?? 100);
    const removed = store.prune(keep);
    outputFunc(successLine(`Pruned ${removed} task record(s).`));
    return 0;
  }
  if (command === "export") {
    const target = argv[1] ?? "butterclaw-tasks-export.json";
    store.exportJson(target);
    outputFunc(successLine(`Exported tasks to ${target}`));
    return 0;
  }
  throw new Error("Usage: butterclaw tasks list [--status status] [--kind kind] [--source source] [--limit n] | show <taskId|runId> | cancel <id> [reason] | stats | clear [--status status] [--kind kind] [--source source] | prune --keep <n> | export [path]");
}

export async function runWhatsAppCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): Promise<number> {
  const command = argv[0]?.toLowerCase() ?? "status";
  const channel = new WhatsAppChannel(config);
  if (command === "status") {
    outputFunc(panel("WhatsApp", whatsappStatus(config).split("\n")));
    return 0;
  }
  if (command === "send") {
    const to = argv[1] ?? config.whatsappDefaultTo;
    const text = argv.slice(2).join(" ");
    const result = await channel.sendTool({ to, text });
    outputFunc(result.ok ? successLine(result.output) : result.output);
    return result.ok ? 0 : 1;
  }
  if (command === "webhook") {
    return runWhatsAppWebhook(config);
  }
  throw new Error("Usage: butterclaw whatsapp status | send <to> <text...> | webhook");
}

async function runScheduleJobs(
  config: ButterclawConfig,
  store: ScheduleStore,
  jobs: ScheduleJob[],
  outputFunc: (line: string) => void,
  quietWhenEmpty = false
): Promise<number> {
  if (!jobs.length) {
    if (!quietWhenEmpty) {
      outputFunc("No schedules are due.");
    }
    return 0;
  }
  let ok = true;
  const taskStore = new TaskStore(config.taskPath);
  for (const job of jobs) {
    const startedAt = new Date();
    const task = taskStore.create({ kind: "schedule", source: "cli", summary: job.message, runId: job.id, session: job.session });
    taskStore.start(task.id);
    outputFunc(`Running schedule ${job.name} (${job.id})...`);
    try {
      const runConfig = { ...config };
      let profile: AgentProfile | undefined;
      if (job.agent) {
        const loaded = new AgentStore(config.agentsDir).get(job.agent);
        if (!loaded) {
          throw new Error(`Unknown agent profile for schedule ${job.name}: ${job.agent}`);
        }
        profile = loaded;
        applyAgentProfile(runConfig, profile);
      }
      const result = await new ButterclawAgent(runConfig, {
        ...(profile ? { agentProfile: profile } : {}),
        ...(job.session ? { sessionName: job.session } : {})
      }).run(job.message);
      const run = store.recordRun(job, "ok", result.answer, startedAt);
      taskStore.finish(task.id, "succeeded", { output: result.answer });
      outputFunc(successLine(`Schedule ${job.name} finished as ${run.id}`));
      outputFunc(result.answer);
    } catch (error) {
      ok = false;
      const message = error instanceof Error ? error.message : String(error);
      const run = store.recordRun(job, "error", message, startedAt);
      taskStore.finish(task.id, "failed", { error: message });
      outputFunc(`Schedule ${job.name} failed as ${run.id}: ${message}`);
    }
  }
  return ok ? 0 : 1;
}

function cliRepoArgs(config: ButterclawConfig, argv: string[]): Record<string, unknown> {
  const repo = argv.find((arg) => arg.includes("/")) ?? config.githubDefaultRepo;
  return repo ? { repo } : {};
}

function handleCommand(command: () => number): number {
  try {
    return command();
  } catch (error) {
    console.error(formatCliError(error));
    return 1;
  }
}

async function handleAsyncCommand(command: () => Promise<number>): Promise<number> {
  try {
    return await command();
  } catch (error) {
    console.error(formatCliError(error));
    return 1;
  }
}

function parseCommandOptions(argv: string[]): { positionals: string[]; values: Record<string, string>; flags: Set<string> } {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const booleanFlags = new Set(["force", "no-browser", "delete-after-run", "disabled", "due", "once", "all", "verbose"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key) || index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      flags.add(key);
      continue;
    }
    index += 1;
    values[key] = argv[index] ?? "";
  }
  return { positionals, values, flags };
}

function isAgentRunCommand(argv: string[]): boolean {
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "");
  return Boolean(command && command !== "list" && command !== "show" && command !== "create" && command !== "help");
}

function isTeamRunCommand(argv: string[]): boolean {
  const command = normalizeListCommand(argv[0]?.toLowerCase() ?? "");
  return Boolean(command && command !== "list" && command !== "show" && command !== "create" && command !== "help");
}

function parseRunTarget(argv: string[]): { name: string; task: string } {
  const [first = "", second = "", ...rest] = argv;
  if (first.toLowerCase() === "run" || first.toLowerCase() === "ask") {
    return { name: second, task: rest.join(" ").trim() };
  }
  return { name: first, task: [second, ...rest].join(" ").trim() };
}

function printHelp(): void {
  console.log(renderHelp("butterclaw 0.2.0"));
}

function normalizeListCommand(command: string): string {
  if (command === "--list" || command === "-l" || command === "ls") {
    return "list";
  }
  if (command === "--help" || command === "-h" || command === "?") {
    return "help";
  }
  return command;
}

export function localHelpForTask(task: string): string | null {
  const lower = task.toLowerCase();
  const asksAboutAgents = /\bagents?\b/.test(lower);
  const asksForHelp = /\b(configure|create|run|use|setup|help|command|commands)\b/.test(lower) || lower.includes("how can i");
  if (asksAboutAgents && asksForHelp) {
    return agentHelp(extractWindowsPath(task));
  }
  return null;
}

function agentHelp(workspacePath?: string | null): string {
  const rows = [
    "Agents are saved JSON profiles in your Butterclaw config folder, not butterclaw.yaml.",
    workspacePath ? `cd /d ${workspacePath}` : "cd /d C:\\path\\to\\your\\project",
    'butterclaw agent create reviewer --description "Reviews code" --instructions "Find bugs, missing tests, and risky behavior first."',
    'butterclaw agent run reviewer "review this project"',
    'butterclaw --agent reviewer "review this project"',
    "butterclaw agent list",
    "butterclaw agent show reviewer",
    "Use notepad <file> on Windows if you need to edit a file; nano and touch are not default cmd commands."
  ];
  return panel("Agent Commands", rows);
}

function teamHelp(): string {
  return panel("Team Commands", [
    "Teams run several saved agents on the same task.",
    'butterclaw team create review-crew --agents debugger,reviewer --description "Debug and review together"',
    'butterclaw team run review-crew "inspect this project"',
    "butterclaw team list",
    "butterclaw team show review-crew"
  ]);
}

function extractWindowsPath(task: string): string | null {
  const match = task.match(/[A-Za-z]:\\[^\r\n"]+/);
  return match ? match[0].replace(/[>\s.]+$/g, "") : null;
}

function formatCliError(error: unknown): string {
  if (isAbortError(error)) {
    return "Butterclaw stopped.";
  }
  return `Butterclaw failed: ${error instanceof Error ? error.message : String(error)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("Aborted with Ctrl+C"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

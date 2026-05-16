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
import { githubStatus } from "./github.js";
import { GOOGLE_WORKSPACE_SCOPES, googleStatus, loginGoogle, logoutGoogle } from "./google.js";
import { SessionStore } from "./sessions.js";
import { runSetup } from "./setup.js";
import { SkillLoader } from "./skills.js";
import { TeamStore } from "./teams.js";
import { toolPolicySummary } from "./tool-policy.js";
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
  sessionMaxTurns?: number;
  toolProfile?: ButterclawConfig["toolProfile"];
  toolAllow: string[];
  toolDeny: string[];
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
    return handleCommand(() => runAgentCommand(config, args.task.slice(1)));
  }
  if (command === "team" || command === "teams") {
    return handleCommand(() => runTeamCommand(config, args.task.slice(1)));
  }
  if (command === "skill" || command === "skills") {
    return handleCommand(() => runSkillCommand(config, args.task.slice(1)));
  }
  if (command === "session" || command === "sessions") {
    return handleCommand(() => runSessionCommand(config, args.task.slice(1)));
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
    "--session-max-turns": (value) => (args.sessionMaxTurns = Number(value)),
    "--tool-profile": (value) => (args.toolProfile = value as ButterclawConfig["toolProfile"]),
    "--allow-tool": (value) => args.toolAllow.push(...splitCsv(value)),
    "--tool-allow": (value) => args.toolAllow.push(...splitCsv(value)),
    "--deny-tool": (value) => args.toolDeny.push(...splitCsv(value)),
    "--tool-deny": (value) => args.toolDeny.push(...splitCsv(value)),
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
  if (args.sessionMaxTurns !== undefined) config.sessionMaxTurns = args.sessionMaxTurns;
  if (args.toolProfile) config.toolProfile = args.toolProfile;
  if (args.toolAllow.length) config.toolAllow = [...config.toolAllow, ...args.toolAllow];
  if (args.toolDeny.length) config.toolDeny = [...config.toolDeny, ...args.toolDeny];
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
    const agent = new ButterclawAgent(config, {
      ...(agentProfile ? { agentProfile } : {}),
      ...(sessionName ? { sessionName } : {})
    });
    if (await runSlashCommand(config, task, { agent, agentProfile, sessionName })) {
      return 0;
    }
    const result = await agent.run(task);
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

async function repl(config: ButterclawConfig, agentProfile?: AgentProfile, sessionName?: string): Promise<number> {
  console.log("Butterclaw REPL. Type 'exit' or press Ctrl+C to quit.");
  const rl = readline.createInterface({ input, output });
  const agent = new ButterclawAgent(config, {
    ...(agentProfile ? { agentProfile } : {}),
    ...(sessionName ? { sessionName } : {})
  });
  try {
    while (true) {
      const task = (await rl.question("> ")).trim();
      if (!task) continue;
      if (task === "exit" || task === "quit") return 0;
      if (await runSlashCommand(config, task, { agent, agentProfile, sessionName })) continue;
      const result = await agent.run(task);
      console.log(result.answer);
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
        `${button("/backup")} save local agents, teams, skills, sessions, and memory`,
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
  const command = argv[0]?.toLowerCase() ?? "list";
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
  throw new Error("Usage: butterclaw agent list | show <name> | create <name> [--description text] [--instructions text] [--model name] [--provider name] [--force]");
}

export function runTeamCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new TeamStore(config.teamsDir);
  const command = argv[0]?.toLowerCase() ?? "list";
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
  throw new Error("Usage: butterclaw team list | show <name> | create <name> --agents <agent1,agent2> [--description text] [--instructions text] [--force]");
}

export function runSkillCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const loader = new SkillLoader(config.skillsDir, config.maxSkillChars);
  const command = argv[0]?.toLowerCase() ?? "list";
  if (command === "list") {
    const skills = loader.list();
    outputFunc(renderCollection("Skills", skills.map((skill) => `${button("skill")} ${skill}`), "No skills yet."));
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
    outputFunc(successLine(`Created skill ${name} at ${file}`));
    return 0;
  }
  throw new Error("Usage: butterclaw skill list | show <name> | create <name> [--description text] [--body text] [--force]");
}

export function runSessionCommand(config: ButterclawConfig, argv: string[], outputFunc = console.log): number {
  const store = new SessionStore(config.sessionsDir);
  const command = argv[0]?.toLowerCase() ?? "list";
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
  if (command === "clear") {
    const name = argv[1] ?? "";
    const cleared = store.clear(name);
    outputFunc(cleared ? successLine(`Cleared session ${name}`) : `No session found: ${name}`);
    return 0;
  }
  if (command === "prune") {
    const name = argv[1] ?? "";
    const maxTurns = argv[2] ? Number(argv[2]) : config.sessionMaxTurns;
    const removed = store.prune(name, maxTurns);
    outputFunc(successLine(`Pruned ${removed} old turn(s) from ${name}`));
    return 0;
  }
  throw new Error("Usage: butterclaw session list | show <name> | clear <name> | prune <name> [maxTurns]");
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

function cliRepoArgs(config: ButterclawConfig, argv: string[]): Record<string, unknown> {
  const repo = argv.find((arg) => arg.includes("/")) ?? config.githubDefaultRepo;
  return repo ? { repo } : {};
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
    if (key === "force" || key === "no-browser") {
      flags.add(key);
      continue;
    }
    index += 1;
    values[key] = argv[index] ?? "";
  }
  return { positionals, values, flags };
}

function printHelp(): void {
  console.log(renderHelp("butterclaw 0.2.0"));
}

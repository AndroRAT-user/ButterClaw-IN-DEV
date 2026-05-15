import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./util.js";

export type ProviderName = "mock" | "ollama" | "openai-compatible";
export type ShellMode = "deny" | "allow";

export interface ButterclawConfig {
  provider: ProviderName;
  model: string;
  baseUrl: string | null;
  apiKeyEnv: string;
  workspace: string;
  configDir: string;
  maxSteps: number;
  maxContextChars: number;
  maxSkillChars: number;
  memoryItems: number;
  shellMode: ShellMode;
  allowOutsideWorkspace: boolean;
  requestTimeoutSeconds: number;
  shellTimeoutSeconds: number;
  telegramTokenEnv: string;
  telegramBaseUrl: string;
  telegramAllowedChats: string[];
  telegramPollTimeoutSeconds: number;
  telegramIdleSleepSeconds: number;
  telegramMaxReplyChars: number;
  googleClientIdEnv: string;
  googleClientSecretEnv: string;
  googleCalendarId: string;
  googleOAuthPath: string;
  agentsDir: string;
  skillsDir: string;
  memoryPath: string;
  telegramStatePath: string;
}

export function defaultConfigDir(): string {
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, "butterclaw");
  }
  return path.join(os.homedir(), ".config", "butterclaw");
}

export function configPath(): string {
  return path.join(defaultConfigDir(), "config.json");
}

export function defaultConfig(overrides: Partial<ButterclawConfig> = {}): ButterclawConfig {
  const configDir = overrides.configDir ?? defaultConfigDir();
  return normalizeConfig({
    provider: "mock",
    model: "mock-local",
    baseUrl: null,
    apiKeyEnv: "MODEL_PROVIDER_API_KEY",
    workspace: process.cwd(),
    configDir,
    maxSteps: 6,
    maxContextChars: 12_000,
    maxSkillChars: 4_000,
    memoryItems: 5,
    shellMode: "deny",
    allowOutsideWorkspace: false,
    requestTimeoutSeconds: 60,
    shellTimeoutSeconds: 20,
    telegramTokenEnv: "TELEGRAM_BOT_TOKEN",
    telegramBaseUrl: "https://api.telegram.org",
    telegramAllowedChats: [],
    telegramPollTimeoutSeconds: 25,
    telegramIdleSleepSeconds: 1,
    telegramMaxReplyChars: 3900,
    googleClientIdEnv: "GOOGLE_CLIENT_ID",
    googleClientSecretEnv: "GOOGLE_CLIENT_SECRET",
    googleCalendarId: "primary",
    googleOAuthPath: path.join(configDir, "google-oauth.json"),
    agentsDir: path.join(configDir, "agents"),
    skillsDir: path.join(configDir, "skills"),
    memoryPath: path.join(configDir, "memory.jsonl"),
    telegramStatePath: path.join(configDir, "telegram-state.json"),
    ...overrides
  });
}

export function normalizeConfig(config: ButterclawConfig): ButterclawConfig {
  const configDir = path.resolve(config.configDir);
  return {
    ...config,
    workspace: path.resolve(config.workspace),
    configDir,
    telegramAllowedChats: config.telegramAllowedChats.map(String),
    agentsDir: path.resolve(config.agentsDir || path.join(configDir, "agents")),
    skillsDir: path.resolve(config.skillsDir || path.join(configDir, "skills")),
    memoryPath: path.resolve(config.memoryPath || path.join(configDir, "memory.jsonl")),
    googleOAuthPath: path.resolve(config.googleOAuthPath || path.join(configDir, "google-oauth.json")),
    telegramStatePath: path.resolve(config.telegramStatePath || path.join(configDir, "telegram-state.json"))
  };
}

export function loadConfig(customPath?: string): ButterclawConfig {
  const target = customPath ?? configPath();
  if (customPath && !fs.existsSync(target)) {
    return defaultConfig({ configDir: path.dirname(path.resolve(target)) });
  }
  return defaultConfig(readJsonFile<Partial<ButterclawConfig>>(target, {}));
}

export function saveConfig(config: ButterclawConfig, customPath?: string): void {
  const target = customPath ?? configPath();
  writeJsonFile(target, normalizeConfig(config));
}

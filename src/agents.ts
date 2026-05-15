import fs from "node:fs";
import path from "node:path";
import { ButterclawConfig, ProviderName } from "./config.js";
import { ensureDir, readJsonFile, slugName, writeJsonFile } from "./util.js";

export interface AgentProfile {
  name: string;
  description: string;
  instructions: string;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string | null;
  maxSteps?: number;
  skills?: string[];
}

export interface AgentCreateInput {
  name: string;
  description?: string;
  instructions?: string;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string | null;
  maxSteps?: number;
  skills?: string[];
  overwrite?: boolean;
}

export class AgentStore {
  constructor(private readonly agentsDir: string) {
    ensureDir(agentsDir);
  }

  list(): AgentProfile[] {
    if (!fs.existsSync(this.agentsDir)) {
      return [];
    }
    return fs
      .readdirSync(this.agentsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readFile(path.join(this.agentsDir, name)))
      .filter((profile): profile is AgentProfile => profile !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): AgentProfile | null {
    return this.readFile(this.fileFor(name));
  }

  create(input: AgentCreateInput): AgentProfile {
    const name = slugName(input.name, "agent name");
    if (input.provider && !isProviderName(input.provider)) {
      throw new Error("provider must be mock, ollama, or openai-compatible");
    }
    if (input.maxSteps !== undefined && (!Number.isInteger(input.maxSteps) || input.maxSteps < 1)) {
      throw new Error("maxSteps must be a positive whole number");
    }
    const file = this.fileFor(name);
    if (fs.existsSync(file) && !input.overwrite) {
      throw new Error(`Agent already exists: ${name}. Use --force to replace it.`);
    }
    const profile: AgentProfile = {
      name,
      description: input.description?.trim() || `${name} agent`,
      instructions:
        input.instructions?.trim() ||
        `You are ${name}, a focused Butterclaw sub-agent. Work carefully, stay within the workspace, and return concise results.`,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.skills?.length ? { skills: input.skills } : {})
    };
    writeJsonFile(file, profile);
    return profile;
  }

  private fileFor(name: string): string {
    return path.join(this.agentsDir, `${slugName(name, "agent name")}.json`);
  }

  private readFile(file: string): AgentProfile | null {
    const raw = readJsonFile<Partial<AgentProfile> | null>(file, null);
    if (!raw || typeof raw.name !== "string" || typeof raw.instructions !== "string") {
      return null;
    }
    const provider = isProviderName(raw.provider) ? raw.provider : undefined;
    const maxSteps = Number(raw.maxSteps);
    return {
      name: slugName(raw.name, "agent name"),
      description: String(raw.description ?? `${raw.name} agent`),
      instructions: raw.instructions,
      ...(provider ? { provider } : {}),
      ...(typeof raw.model === "string" ? { model: raw.model } : {}),
      ...(typeof raw.baseUrl === "string" || raw.baseUrl === null ? { baseUrl: raw.baseUrl } : {}),
      ...(Number.isInteger(maxSteps) && maxSteps > 0 ? { maxSteps } : {}),
      ...(Array.isArray(raw.skills) ? { skills: raw.skills.map(String) } : {})
    };
  }
}

export function applyAgentProfile(config: ButterclawConfig, profile: AgentProfile): void {
  if (profile.provider) config.provider = profile.provider;
  if (profile.model) config.model = profile.model;
  if (profile.baseUrl !== undefined) config.baseUrl = profile.baseUrl;
  if (profile.maxSteps !== undefined && Number.isInteger(profile.maxSteps)) config.maxSteps = profile.maxSteps;
}

function isProviderName(value: unknown): value is ProviderName {
  return value === "mock" || value === "ollama" || value === "openai-compatible";
}

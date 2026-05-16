import childProcess from "node:child_process";
import fs from "node:fs";
import { ButterclawConfig } from "./config.js";
import { googleStatus } from "./google.js";
import { trimTrailingSlash } from "./util.js";

export interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export async function doctorChecks(config: ButterclawConfig): Promise<DoctorCheck[]> {
  const google = googleStatus(config);
  const checks: DoctorCheck[] = [
    { label: "Node.js", ok: majorNodeVersion() >= 22, detail: process.version },
    { label: "Git", ok: commandExists("git"), detail: commandExists("git") ? "available" : "not found" },
    pathCheck("Workspace", config.workspace, "directory"),
    pathCheck("Config directory", config.configDir, "directory"),
    pathCheck("Agents directory", config.agentsDir, "directory"),
    pathCheck("Teams directory", config.teamsDir, "directory"),
    pathCheck("Sessions directory", config.sessionsDir, "directory"),
    pathCheck("Skills directory", config.skillsDir, "directory"),
    pathCheck("Memory file", config.memoryPath, "file"),
    {
      label: "Shell tool",
      ok: config.shellMode === "deny",
      detail: config.shellMode === "deny" ? "disabled by default" : "enabled"
    },
    providerCheck(config),
    {
      label: "Google OAuth",
      ok: google.startsWith("Google OAuth is connected"),
      detail: google
    }
  ];

  if (config.provider === "ollama") {
    checks.push({
      label: "Ollama",
      ok: await ollamaReachable(config.baseUrl ?? "http://localhost:11434", config.requestTimeoutSeconds),
      detail: config.baseUrl ?? "http://localhost:11434"
    });
  }
  return checks;
}

function pathCheck(label: string, target: string, kind: "file" | "directory"): DoctorCheck {
  const exists = fs.existsSync(target);
  const ok = exists && (kind === "file" ? fs.statSync(target).isFile() : fs.statSync(target).isDirectory());
  return { label, ok, detail: ok ? target : `${kind} missing: ${target}` };
}

function providerCheck(config: ButterclawConfig): DoctorCheck {
  if (config.provider === "mock") {
    return { label: "Provider", ok: true, detail: "mock provider, no API key needed" };
  }
  if (config.provider === "openai-compatible") {
    const hasKey = Boolean(process.env[config.apiKeyEnv]);
    return {
      label: "Provider key",
      ok: hasKey,
      detail: hasKey ? `${config.apiKeyEnv} is set` : `${config.apiKeyEnv} is not set`
    };
  }
  return { label: "Provider", ok: true, detail: `${config.provider} ${config.model}` };
}

async function ollamaReachable(baseUrl: string, timeoutSeconds: number): Promise<boolean> {
  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(Math.min(timeoutSeconds, 5) * 1000)
    });
    return response.ok;
  } catch {
    return false;
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

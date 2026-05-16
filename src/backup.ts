import fs from "node:fs";
import path from "node:path";
import { ButterclawConfig } from "./config.js";
import { ensureParent, writeJsonFile } from "./util.js";

export interface BackupFileEntry {
  path: string;
  content: string;
}

export interface ButterclawBackup {
  kind: "butterclaw-backup";
  version: 1;
  createdAt: string;
  config: ButterclawConfig;
  files: BackupFileEntry[];
  excluded: string[];
}

export function createBackup(config: ButterclawConfig, targetPath?: string): { path: string; files: number; excluded: string[] } {
  const resolvedTarget =
    targetPath && targetPath.trim()
      ? path.resolve(targetPath)
      : path.join(config.configDir, `butterclaw-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const excluded = [
    relativeConfigPath(config, config.googleOAuthPath),
    relativeConfigPath(config, config.telegramStatePath),
    "usage-*.json"
  ].filter((value) => value && value !== ".");
  const backup: ButterclawBackup = {
    kind: "butterclaw-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    config,
    files: collectFiles(config),
    excluded
  };
  ensureParent(resolvedTarget);
  writeJsonFile(resolvedTarget, backup);
  return { path: resolvedTarget, files: backup.files.length, excluded };
}

function collectFiles(config: ButterclawConfig): BackupFileEntry[] {
  const files: BackupFileEntry[] = [];
  collectDir(config.configDir, config.agentsDir, files);
  collectDir(config.configDir, config.teamsDir, files);
  collectDir(config.configDir, config.skillsDir, files);
  collectDir(config.configDir, config.sessionsDir, files);
  collectFile(config.configDir, config.memoryPath, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function collectDir(configDir: string, dir: string, files: BackupFileEntry[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectDir(configDir, full, files);
    } else if (stat.isFile()) {
      collectFile(configDir, full, files);
    }
  }
}

function collectFile(configDir: string, file: string, files: BackupFileEntry[]): void {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return;
  }
  files.push({
    path: path.relative(configDir, file).replace(/\\/g, "/"),
    content: fs.readFileSync(file, "utf8")
  });
}

function relativeConfigPath(config: Pick<ButterclawConfig, "configDir">, file: string): string {
  return path.relative(config.configDir, file).replace(/\\/g, "/");
}

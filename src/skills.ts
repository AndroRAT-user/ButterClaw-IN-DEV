import fs from "node:fs";
import path from "node:path";
import { ensureDir, scoreText, slugName, termsFrom, truncate } from "./util.js";

export interface SkillCreateInput {
  name: string;
  description?: string;
  body?: string;
  overwrite?: boolean;
}

export interface SkillInfo {
  name: string;
  file: string;
  characters: number;
  requiresTools: string[];
  disableModelInvocation: boolean;
  eligible: boolean;
}

export class SkillLoader {
  constructor(
    private readonly skillsDir: string,
    private readonly maxChars: number,
    private readonly enabledTools: string[] = []
  ) {
    ensureDir(skillsDir);
  }

  list(): string[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }
    return fs
      .readdirSync(this.skillsDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => path.basename(name, ".md"))
      .sort((a, b) => a.localeCompare(b));
  }

  read(name: string): string | null {
    const file = this.fileFor(name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  info(name: string): SkillInfo | null {
    const file = this.fileFor(name);
    return fs.existsSync(file) ? this.infoForFile(file) : null;
  }

  listInfo(): SkillInfo[] {
    return this.list()
      .map((name) => this.info(name))
      .filter((info): info is SkillInfo => info !== null);
  }

  search(query: string, limit = 20): SkillInfo[] {
    const terms = termsFrom(query);
    return this.listInfo()
      .map((info) => ({ info, score: scoreText(`${info.name}\n${fs.readFileSync(info.file, "utf8")}`, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.info.name.localeCompare(b.info.name))
      .slice(0, Math.max(1, Math.trunc(limit)))
      .map((entry) => entry.info);
  }

  create(input: SkillCreateInput): string {
    const name = slugName(input.name, "skill name");
    const file = this.fileFor(name);
    if (fs.existsSync(file) && !input.overwrite) {
      throw new Error(`Skill already exists: ${name}. Use --force to replace it.`);
    }
    const description = input.description?.trim() || `Use this skill when ${name} is relevant.`;
    const body = input.body?.trim() || "Add concrete workflow notes, examples, and safety rules here.";
    fs.writeFileSync(file, `# ${name}\n\n${description}\n\n${body}\n`, "utf8");
    return file;
  }

  remove(name: string): boolean {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) {
      return false;
    }
    fs.unlinkSync(file);
    return true;
  }

  rename(oldName: string, newName: string, overwrite = false): boolean {
    const oldFile = this.fileFor(oldName);
    const newFile = this.fileFor(newName);
    if (!fs.existsSync(oldFile)) {
      return false;
    }
    if (fs.existsSync(newFile) && !overwrite) {
      throw new Error(`Skill already exists: ${slugName(newName, "skill name")}. Use --force to replace it.`);
    }
    fs.renameSync(oldFile, newFile);
    return true;
  }

  copy(oldName: string, newName: string, overwrite = false): boolean {
    const oldFile = this.fileFor(oldName);
    const newFile = this.fileFor(newName);
    if (!fs.existsSync(oldFile)) {
      return false;
    }
    if (fs.existsSync(newFile) && !overwrite) {
      throw new Error(`Skill already exists: ${slugName(newName, "skill name")}. Use --force to replace it.`);
    }
    fs.copyFileSync(oldFile, newFile);
    return true;
  }

  validate(name?: string): string[] {
    const infos = name ? [this.info(name)].filter((info): info is SkillInfo => info !== null) : this.listInfo();
    const messages: string[] = [];
    for (const info of infos) {
      const text = fs.readFileSync(info.file, "utf8");
      if (!text.trim()) messages.push(`${info.name}: empty file`);
      if (!/^#\s+/m.test(text)) messages.push(`${info.name}: missing markdown heading`);
      for (const tool of info.requiresTools) {
        if (!/^[a-z0-9_*:-]+$/i.test(tool)) messages.push(`${info.name}: suspicious required tool '${tool}'`);
      }
    }
    return messages;
  }

  relevantTo(query: string, limit = 3): string[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }
    const terms = termsFrom(query);
    const scored: Array<{ score: number; name: string; file: string }> = [];
    for (const name of fs.readdirSync(this.skillsDir)) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const file = path.join(this.skillsDir, name);
      const text = fs.readFileSync(file, "utf8");
      const metadata = parseSkillMetadata(text);
      if (metadata.disableModelInvocation || !metadata.requiresTools.every((tool) => this.enabledTools.includes(tool))) {
        continue;
      }
      const score = scoreText(`${name}\n${text}`, terms);
      if (score > 0) {
        scored.push({ score, name, file });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(({ file, name }) => {
        const text = fs.readFileSync(file, "utf8").trim();
        const metadata = parseSkillMetadata(text);
        const body = truncate(text, this.maxChars);
        const requirements = metadata.requiresTools.length ? `\nRequired tools: ${metadata.requiresTools.join(", ")}` : "";
        return `# Skill: ${path.basename(name, ".md")}${requirements}\n${body}`;
      });
  }

  private fileFor(name: string): string {
    return path.join(this.skillsDir, `${slugName(name, "skill name")}.md`);
  }

  private infoForFile(file: string): SkillInfo {
    const text = fs.readFileSync(file, "utf8");
    const metadata = parseSkillMetadata(text);
    return {
      name: path.basename(file, ".md"),
      file,
      characters: text.length,
      requiresTools: metadata.requiresTools,
      disableModelInvocation: metadata.disableModelInvocation,
      eligible: !metadata.disableModelInvocation && metadata.requiresTools.every((tool) => this.enabledTools.includes(tool))
    };
  }
}

export interface SkillMetadata {
  requiresTools: string[];
  disableModelInvocation: boolean;
}

export function parseSkillMetadata(text: string): SkillMetadata {
  const metadata: SkillMetadata = { requiresTools: [], disableModelInvocation: false };
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return metadata;
  }
  for (const line of match[1].split(/\r?\n/)) {
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (key === "requires-tools" || key === "require-tools" || key === "tools") {
      metadata.requiresTools = parseList(value);
    }
    if (key === "disable-model-invocation") {
      metadata.disableModelInvocation = ["true", "yes", "1"].includes(value.toLowerCase());
    }
  }
  return metadata;
}

export function formatSkillInfo(infos: SkillInfo[]): string {
  if (!infos.length) {
    return "No skills found.";
  }
  return infos
    .map((info) => {
      const reqs = info.requiresTools.length ? info.requiresTools.join(", ") : "none";
      return `${info.name} ${info.eligible ? "eligible" : "gated"} ${info.characters} chars\n  requires: ${reqs}${info.disableModelInvocation ? "\n  model invocation disabled" : ""}`;
    })
    .join("\n\n");
}

function parseList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

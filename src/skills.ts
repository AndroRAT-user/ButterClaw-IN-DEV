import fs from "node:fs";
import path from "node:path";
import { ensureDir, scoreText, slugName, termsFrom, truncate } from "./util.js";

export interface SkillCreateInput {
  name: string;
  description?: string;
  body?: string;
  overwrite?: boolean;
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
}

interface SkillMetadata {
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

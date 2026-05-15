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
    private readonly maxChars: number
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
        const body = truncate(text, this.maxChars);
        return `# Skill: ${path.basename(name, ".md")}\n${body}`;
      });
  }

  private fileFor(name: string): string {
    return path.join(this.skillsDir, `${slugName(name, "skill name")}.md`);
  }
}

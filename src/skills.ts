import fs from "node:fs";
import path from "node:path";
import { scoreText, termsFrom, truncate } from "./util.js";

export class SkillLoader {
  constructor(
    private readonly skillsDir: string,
    private readonly maxChars: number
  ) {}

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
}


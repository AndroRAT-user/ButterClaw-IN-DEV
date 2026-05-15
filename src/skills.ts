import fs from "node:fs";
import path from "node:path";

export class SkillLoader {
  constructor(
    private readonly skillsDir: string,
    private readonly maxChars: number
  ) {}

  relevantTo(query: string, limit = 3): string[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }
    const terms = new Set((query.match(/[a-zA-Z0-9_]{3,}/g) ?? []).map((term) => term.toLowerCase()));
    const scored: Array<{ score: number; name: string; file: string }> = [];
    for (const name of fs.readdirSync(this.skillsDir)) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const file = path.join(this.skillsDir, name);
      const text = fs.readFileSync(file, "utf8");
      const haystack = `${name}\n${text}`.toLowerCase();
      const score = [...terms].filter((term) => haystack.includes(term)).length;
      if (score > 0) {
        scored.push({ score, name, file });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(({ file, name }) => {
        const text = fs.readFileSync(file, "utf8").trim();
        const body = text.length > this.maxChars ? `${text.slice(0, this.maxChars - 3)}...` : text;
        return `# Skill: ${path.basename(name, ".md")}\n${body}`;
      });
  }
}


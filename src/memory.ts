import fs from "node:fs";
import { compact, ensureParent, scoreText, termsFrom } from "./util.js";

interface MemoryItem {
  role: string;
  content: string;
  createdAt: string;
}

export class LocalMemory {
  constructor(private readonly memoryPath: string) {
    ensureParent(memoryPath);
  }

  add(role: string, content: string): void {
    if (!content.trim()) {
      return;
    }
    const item: MemoryItem = { role, content: content.trim(), createdAt: new Date().toISOString() };
    fs.appendFileSync(this.memoryPath, `${JSON.stringify(item)}\n`, "utf8");
  }

  search(query: string, limit: number): string[] {
    if (!fs.existsSync(this.memoryPath)) {
      return [];
    }
    const terms = termsFrom(query);
    const scored: Array<{ score: number; index: number; item: MemoryItem }> = [];
    const lines = fs.readFileSync(this.memoryPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      try {
        const item = JSON.parse(line) as MemoryItem;
        const score = scoreText(item.content, terms);
        if (score > 0) {
          scored.push({ score, index, item });
        }
      } catch {
        // Ignore malformed local memory lines.
      }
    });
    return scored
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, limit)
      .map(({ item }) => `${item.role}: ${compact(item.content)}`);
  }
}

import fs from "node:fs";
import path from "node:path";

interface MemoryItem {
  role: string;
  content: string;
  createdAt: string;
}

export class LocalMemory {
  constructor(private readonly memoryPath: string) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
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
    const terms = new Set((query.match(/[a-zA-Z0-9_]{3,}/g) ?? []).map((term) => term.toLowerCase()));
    const scored: Array<{ score: number; index: number; item: MemoryItem }> = [];
    const lines = fs.readFileSync(this.memoryPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      try {
        const item = JSON.parse(line) as MemoryItem;
        const haystack = item.content.toLowerCase();
        const score = [...terms].filter((term) => haystack.includes(term)).length;
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

function compact(text: string, maxChars = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 3)}...` : cleaned;
}


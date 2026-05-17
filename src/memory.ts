import crypto from "node:crypto";
import fs from "node:fs";
import { compact, ensureParent, scoreText, termsFrom, truncate, writeJsonFile } from "./util.js";

export interface MemoryItem {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface MemoryStats {
  count: number;
  roles: Record<string, number>;
  characters: number;
  firstAt: string | null;
  lastAt: string | null;
}

export class LocalMemory {
  constructor(private readonly memoryPath: string) {
    ensureParent(memoryPath);
  }

  add(role: string, content: string): void {
    if (!content.trim()) {
      return;
    }
    const item: MemoryItem = {
      id: `mem_${crypto.randomUUID().slice(0, 8)}`,
      role,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };
    fs.appendFileSync(this.memoryPath, `${JSON.stringify(item)}\n`, "utf8");
  }

  search(query: string, limit: number): string[] {
    return this.searchItems(query, limit).map(({ item }) => `${item.role}: ${compact(item.content)}`);
  }

  searchItems(query: string, limit: number): Array<{ score: number; item: MemoryItem }> {
    if (!fs.existsSync(this.memoryPath)) {
      return [];
    }
    const terms = termsFrom(query);
    const scored: Array<{ score: number; index: number; item: MemoryItem }> = this.items().map((item, index) => ({
      score: scoreText(`${item.role}\n${item.content}`, terms),
      index,
      item
    }));
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, limit)
      .map(({ score, item }) => ({ score, item }));
  }

  items(limit = 100): MemoryItem[] {
    return readMemoryLines(this.memoryPath)
      .slice(-Math.max(1, Math.trunc(limit)))
      .reverse();
  }

  get(idOrIndex: string): MemoryItem | null {
    const all = readMemoryLines(this.memoryPath);
    const index = Number(idOrIndex);
    if (Number.isInteger(index) && index >= 1 && index <= all.length) {
      return all[index - 1] ?? null;
    }
    return all.find((item) => item.id === idOrIndex) ?? null;
  }

  forget(idOrIndex: string): boolean {
    const all = readMemoryLines(this.memoryPath);
    const index = Number(idOrIndex);
    const next = all.filter((item, itemIndex) => {
      if (Number.isInteger(index) && index >= 1) {
        return itemIndex !== index - 1;
      }
      return item.id !== idOrIndex;
    });
    if (next.length === all.length) {
      return false;
    }
    writeMemoryLines(this.memoryPath, next);
    return true;
  }

  clear(): number {
    const count = readMemoryLines(this.memoryPath).length;
    writeMemoryLines(this.memoryPath, []);
    return count;
  }

  prune(keep: number): number {
    const all = readMemoryLines(this.memoryPath);
    const kept = all.slice(-Math.max(0, Math.trunc(keep)));
    writeMemoryLines(this.memoryPath, kept);
    return all.length - kept.length;
  }

  stats(): MemoryStats {
    const all = readMemoryLines(this.memoryPath);
    const roles: Record<string, number> = {};
    for (const item of all) {
      roles[item.role] = (roles[item.role] ?? 0) + 1;
    }
    return {
      count: all.length,
      roles,
      characters: all.reduce((sum, item) => sum + item.content.length, 0),
      firstAt: all[0]?.createdAt ?? null,
      lastAt: all[all.length - 1]?.createdAt ?? null
    };
  }

  exportJson(targetPath: string): void {
    writeJsonFile(targetPath, { version: 1, memories: readMemoryLines(this.memoryPath) });
  }

  importJson(sourcePath: string): number {
    const text = fs.readFileSync(sourcePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    const source = Array.isArray(parsed) ? parsed : isMemoryExport(parsed) ? parsed.memories : [];
    const items = source.map((value, index) => normalizeMemoryItem(value, index)).filter((item): item is MemoryItem => item !== null);
    if (!items.length) {
      return 0;
    }
    const existing = readMemoryLines(this.memoryPath);
    writeMemoryLines(this.memoryPath, [...existing, ...items]);
    return items.length;
  }
}

export function formatMemoryItems(items: MemoryItem[]): string {
  if (!items.length) {
    return "No memory items.";
  }
  return items.map((item, index) => `${index + 1}. ${item.id} ${item.role} ${item.createdAt}\n  ${compact(item.content, 260)}`).join("\n\n");
}

export function formatMemoryStats(stats: MemoryStats): string {
  const roles = Object.entries(stats.roles)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([role, count]) => `${role}:${count}`)
    .join(", ");
  return [
    `Items: ${stats.count}`,
    `Characters: ${stats.characters}`,
    `Roles: ${roles || "none"}`,
    `First: ${stats.firstAt ?? "n/a"}`,
    `Last: ${stats.lastAt ?? "n/a"}`
  ].join("\n");
}

function readMemoryLines(file: string): MemoryItem[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line, index) => normalizeMemoryLine(line, index))
    .filter((item): item is MemoryItem => item !== null);
}

function writeMemoryLines(file: string, items: MemoryItem[]): void {
  ensureParent(file);
  fs.writeFileSync(file, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
}

function normalizeMemoryLine(line: string, index: number): MemoryItem | null {
  if (!line.trim()) {
    return null;
  }
  try {
    return normalizeMemoryItem(JSON.parse(line) as unknown, index);
  } catch {
    return null;
  }
}

function normalizeMemoryItem(value: unknown, index: number): MemoryItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<MemoryItem>;
  if (typeof raw.role !== "string" || typeof raw.content !== "string") {
    return null;
  }
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `mem_${String(index + 1).padStart(6, "0")}`,
    role: truncate(raw.role, 80),
    content: raw.content,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString()
  };
}

function isMemoryExport(value: unknown): value is { memories: unknown[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { memories?: unknown[] }).memories));
}

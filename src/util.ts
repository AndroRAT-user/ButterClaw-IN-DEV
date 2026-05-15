import fs from "node:fs";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureParent(file: string): void {
  ensureDir(path.dirname(file));
}

export function readJsonFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  ensureParent(file);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function termsFrom(text: string): Set<string> {
  return new Set((text.match(/[a-zA-Z0-9_]{3,}/g) ?? []).map((term) => term.toLowerCase()));
}

export function scoreText(text: string, terms: Set<string>): number {
  const haystack = text.toLowerCase();
  return [...terms].filter((term) => haystack.includes(term)).length;
}

export function truncate(text: string, maxChars: number, marker = "..."): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= marker.length) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - marker.length)}${marker}`;
}

export function compact(text: string, maxChars = 240): string {
  return truncate(text.replace(/\s+/g, " ").trim(), maxChars);
}

export function trimTrailingSlash(text: string): string {
  return text.replace(/\/+$/, "");
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function slugName(value: string, label = "name"): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) {
    throw new Error(`${label} must start with a letter or number and use only letters, numbers, dots, underscores, or dashes.`);
  }
  return slug;
}

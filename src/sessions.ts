import fs from "node:fs";
import path from "node:path";
import { Message } from "./providers.js";
import { compact, ensureDir, scoreText, slugName, termsFrom } from "./util.js";

export type SessionRole = Extract<Message["role"], "user" | "assistant">;

export interface SessionTurn {
  role: SessionRole;
  content: string;
  createdAt: string;
}

export interface SessionSummary {
  name: string;
  turns: number;
  updatedAt: string;
}

export interface SessionStats {
  sessions: number;
  turns: number;
  userTurns: number;
  assistantTurns: number;
  characters: number;
}

export class SessionStore {
  constructor(private readonly sessionsDir: string) {
    ensureDir(sessionsDir);
  }

  list(): SessionSummary[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }
    return fs
      .readdirSync(this.sessionsDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((fileName) => {
        const name = fileName.slice(0, -".jsonl".length);
        const file = path.join(this.sessionsDir, fileName);
        return {
          name,
          turns: this.read(name).length,
          updatedAt: fs.statSync(file).mtime.toISOString()
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  }

  read(name: string): SessionTurn[] {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeParseTurn(line))
      .filter((turn): turn is SessionTurn => turn !== null);
  }

  append(name: string, role: SessionRole, content: string): void {
    const normalized = slugName(name, "session name");
    const turn: SessionTurn = {
      role,
      content,
      createdAt: new Date().toISOString()
    };
    ensureDir(this.sessionsDir);
    fs.appendFileSync(this.fileFor(normalized), `${JSON.stringify(turn)}\n`, "utf8");
  }

  rename(oldName: string, newName: string, overwrite = false): boolean {
    const oldFile = this.fileFor(oldName);
    const newFile = this.fileFor(newName);
    if (!fs.existsSync(oldFile)) {
      return false;
    }
    if (fs.existsSync(newFile) && !overwrite) {
      throw new Error(`Session already exists: ${slugName(newName, "session name")}. Use --force to replace it.`);
    }
    ensureDir(this.sessionsDir);
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
      throw new Error(`Session already exists: ${slugName(newName, "session name")}. Use --force to replace it.`);
    }
    ensureDir(this.sessionsDir);
    fs.copyFileSync(oldFile, newFile);
    return true;
  }

  clear(name: string): boolean {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) {
      return false;
    }
    fs.unlinkSync(file);
    return true;
  }

  clearAll(): number {
    const names = this.list().map((session) => session.name);
    let removed = 0;
    for (const name of names) {
      if (this.clear(name)) removed += 1;
    }
    return removed;
  }

  prune(name: string, maxTurns: number): number {
    const turns = this.read(name);
    const limit = Number.isFinite(maxTurns) ? Math.max(0, Math.trunc(maxTurns)) : turns.length;
    if (turns.length <= limit) {
      return 0;
    }
    const kept = turns.slice(-limit);
    ensureDir(this.sessionsDir);
    fs.writeFileSync(this.fileFor(name), kept.map((turn) => JSON.stringify(turn)).join("\n") + (kept.length ? "\n" : ""), "utf8");
    return turns.length - kept.length;
  }

  pruneAll(maxTurns: number): number {
    return this.list().reduce((total, session) => total + this.prune(session.name, maxTurns), 0);
  }

  search(query: string, limit = 20): Array<{ session: string; turn: SessionTurn; score: number }> {
    const terms = termsFrom(query);
    const results: Array<{ session: string; turn: SessionTurn; score: number; index: number }> = [];
    for (const session of this.list()) {
      this.read(session.name).forEach((turn, index) => {
        const score = scoreText(turn.content, terms);
        if (score > 0) {
          results.push({ session: session.name, turn, score, index });
        }
      });
    }
    return results.sort((a, b) => b.score - a.score || b.turn.createdAt.localeCompare(a.turn.createdAt)).slice(0, Math.max(1, limit));
  }

  stats(name?: string): SessionStats {
    const names = name ? [slugName(name, "session name")] : this.list().map((session) => session.name);
    const turns = names.flatMap((sessionName) => this.read(sessionName));
    return {
      sessions: names.filter((sessionName) => this.read(sessionName).length || fs.existsSync(this.fileFor(sessionName))).length,
      turns: turns.length,
      userTurns: turns.filter((turn) => turn.role === "user").length,
      assistantTurns: turns.filter((turn) => turn.role === "assistant").length,
      characters: turns.reduce((sum, turn) => sum + turn.content.length, 0)
    };
  }

  export(name: string, targetPath: string): void {
    const turns = this.read(name);
    const text = turns.map((turn) => `## ${turn.role} ${turn.createdAt}\n\n${turn.content}`).join("\n\n");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${text}${text ? "\n" : ""}`, "utf8");
  }

  tail(name: string, count: number): string {
    return this.format(name, Math.max(1, Math.trunc(count)));
  }

  format(name: string, maxTurns = 50): string {
    const turns = this.read(name).slice(-maxTurns);
    if (!turns.length) {
      return `No turns in session ${slugName(name, "session name")}.`;
    }
    return turns
      .map((turn, index) => {
        const label = `${index + 1}. ${turn.role} ${turn.createdAt}`;
        return `${label}\n${turn.content}`;
      })
      .join("\n\n");
  }

  private fileFor(name: string): string {
    return path.join(this.sessionsDir, `${slugName(name, "session name")}.jsonl`);
  }
}

export function formatSessionSearch(results: Array<{ session: string; turn: SessionTurn; score: number }>): string {
  if (!results.length) {
    return "No session matches.";
  }
  return results.map((result) => `${result.session} ${result.turn.role} ${result.turn.createdAt}\n  ${compact(result.turn.content, 260)}`).join("\n\n");
}

export function formatSessionStats(stats: SessionStats): string {
  return [
    `Sessions: ${stats.sessions}`,
    `Turns: ${stats.turns}`,
    `User turns: ${stats.userTurns}`,
    `Assistant turns: ${stats.assistantTurns}`,
    `Characters: ${stats.characters}`
  ].join("\n");
}

function safeParseTurn(line: string): SessionTurn | null {
  try {
    const raw = JSON.parse(line) as Partial<SessionTurn>;
    if ((raw.role === "user" || raw.role === "assistant") && typeof raw.content === "string") {
      return {
        role: raw.role,
        content: raw.content,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString()
      };
    }
  } catch {
    return null;
  }
  return null;
}

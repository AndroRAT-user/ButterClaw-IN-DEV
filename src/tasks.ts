import crypto from "node:crypto";
import { compact, readJsonFile, truncate, writeJsonFile } from "./util.js";

export const TASK_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRecord {
  id: string;
  kind: string;
  source: string;
  status: TaskStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runId?: string;
  session?: string;
  output?: string;
  error?: string;
}

export interface TaskStats {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
}

interface TaskFile {
  version: 1;
  tasks: TaskRecord[];
}

export class TaskStore {
  constructor(private readonly file: string) {}

  create(input: { kind: string; source: string; summary: string; runId?: string; session?: string }): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: `task_${crypto.randomUUID().slice(0, 8)}`,
      kind: input.kind,
      source: input.source,
      status: "queued",
      summary: compact(input.summary, 240),
      createdAt: now,
      updatedAt: now,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.session ? { session: input.session } : {})
    };
    const data = this.read();
    data.tasks.push(task);
    this.write(data);
    return task;
  }

  start(id: string): TaskRecord | null {
    return this.update(id, (task, now) => {
      task.status = "running";
      task.startedAt = task.startedAt ?? now;
      task.updatedAt = now;
    });
  }

  finish(id: string, status: Extract<TaskStatus, "succeeded" | "failed" | "cancelled">, detail: { output?: string; error?: string } = {}): TaskRecord | null {
    return this.update(id, (task, now) => {
      task.status = status;
      task.finishedAt = now;
      task.updatedAt = now;
      if (detail.output !== undefined) task.output = truncate(detail.output, 20_000);
      if (detail.error !== undefined) task.error = truncate(detail.error, 4_000);
    });
  }

  cancel(id: string, reason = "cancelled by operator"): TaskRecord | null {
    return this.finish(id, "cancelled", { error: reason });
  }

  get(idOrRunId: string): TaskRecord | null {
    const key = idOrRunId.trim();
    if (!key) return null;
    return this.read().tasks.find((task) => task.id === key || task.runId === key) ?? null;
  }

  list(filter: { status?: TaskStatus; kind?: string; source?: string } = {}, limit = 50): TaskRecord[] {
    return this.read()
      .tasks.filter((task) => !filter.status || task.status === filter.status)
      .filter((task) => !filter.kind || task.kind === filter.kind)
      .filter((task) => !filter.source || task.source === filter.source)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.trunc(limit)));
  }

  clear(filter: { status?: TaskStatus; kind?: string; source?: string } = {}): number {
    const data = this.read();
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((task) => {
      if (filter.status && task.status !== filter.status) return true;
      if (filter.kind && task.kind !== filter.kind) return true;
      if (filter.source && task.source !== filter.source) return true;
      return false;
    });
    this.write(data);
    return before - data.tasks.length;
  }

  prune(keep: number): number {
    const data = this.read();
    const before = data.tasks.length;
    data.tasks = data.tasks.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-Math.max(0, Math.trunc(keep)));
    this.write(data);
    return before - data.tasks.length;
  }

  stats(): TaskStats {
    const tasks = this.read().tasks;
    return {
      total: tasks.length,
      byStatus: countBy(tasks.map((task) => task.status)),
      byKind: countBy(tasks.map((task) => task.kind)),
      bySource: countBy(tasks.map((task) => task.source))
    };
  }

  exportJson(targetPath: string): void {
    writeJsonFile(targetPath, this.read());
  }

  private update(id: string, mutator: (task: TaskRecord, now: string) => void): TaskRecord | null {
    const data = this.read();
    const task = data.tasks.find((candidate) => candidate.id === id);
    if (!task) return null;
    mutator(task, new Date().toISOString());
    this.write(data);
    return task;
  }

  private read(): TaskFile {
    const data = readJsonFile<Partial<TaskFile>>(this.file, {});
    return {
      version: 1,
      tasks: Array.isArray(data.tasks) ? data.tasks.filter(isTaskRecord) : []
    };
  }

  private write(data: TaskFile): void {
    data.tasks = data.tasks.slice(-500);
    writeJsonFile(this.file, data);
  }
}

export function formatTasks(tasks: TaskRecord[]): string {
  if (!tasks.length) {
    return "No tasks recorded.";
  }
  return tasks
    .map((task) => {
      const tail = task.error ? ` error: ${compact(task.error, 160)}` : task.output ? ` output: ${compact(task.output, 160)}` : "";
      return `${task.id} ${task.status} ${task.kind} ${task.updatedAt}\n  ${task.summary}${tail}`;
    })
    .join("\n\n");
}

export function parseTaskStatus(value: unknown): TaskStatus | undefined {
  const text = String(value ?? "").trim();
  return TASK_STATUSES.includes(text as TaskStatus) ? (text as TaskStatus) : undefined;
}

export function formatTaskStats(stats: TaskStats): string {
  return [
    `Total: ${stats.total}`,
    `By status: ${formatCounts(stats.byStatus)}`,
    `By kind: ${formatCounts(stats.byKind)}`,
    `By source: ${formatCounts(stats.bySource)}`
  ].join("\n");
}

function isTaskRecord(value: unknown): value is TaskRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "kind" in value &&
    "source" in value &&
    "status" in value &&
    "summary" in value
  );
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(", ") : "none";
}

import crypto from "node:crypto";
import { compact, readJsonFile, slugName, truncate, writeJsonFile } from "./util.js";

export type ScheduleKind = "at" | "every";
export type ScheduleRunStatus = "ok" | "error" | "skipped";

export interface ScheduleJob {
  id: string;
  name: string;
  enabled: boolean;
  kind: ScheduleKind;
  at?: string;
  everySeconds?: number;
  nextRunAt: string;
  message: string;
  session?: string;
  agent?: string;
  deleteAfterRun: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
  errorCount: number;
}

export interface ScheduleRun {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: string;
  finishedAt: string;
  status: ScheduleRunStatus;
  output: string;
}

export interface ScheduleStats {
  jobs: number;
  enabled: number;
  due: number;
  runs: number;
  errors: number;
}

export interface ScheduleCreateInput {
  name?: string;
  at?: string;
  every?: string;
  message: string;
  session?: string;
  agent?: string;
  deleteAfterRun?: boolean;
  enabled?: boolean;
  now?: Date;
}

interface ScheduleFile {
  version: 1;
  jobs: ScheduleJob[];
  runs: ScheduleRun[];
}

export class ScheduleStore {
  constructor(private readonly file: string) {}

  list(): ScheduleJob[] {
    return this.read().jobs.sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt) || a.name.localeCompare(b.name));
  }

  runs(jobId?: string, limit = 20): ScheduleRun[] {
    return this.read()
      .runs.filter((run) => !jobId || run.jobId === jobId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.max(1, Math.trunc(limit)));
  }

  get(idOrName: string): ScheduleJob | null {
    const key = idOrName.trim().toLowerCase();
    if (!key) {
      return null;
    }
    return this.read().jobs.find((job) => job.id.toLowerCase() === key || job.name.toLowerCase() === key) ?? null;
  }

  add(input: ScheduleCreateInput): ScheduleJob {
    const now = input.now ?? new Date();
    const hasAt = Boolean(input.at?.trim());
    const hasEvery = Boolean(input.every?.trim());
    if (hasAt === hasEvery) {
      throw new Error("Choose exactly one schedule: --at <time> or --every <duration>.");
    }
    const message = input.message.trim();
    if (!message) {
      throw new Error("Scheduled message is required.");
    }

    const name = scheduleName(input.name, message);
    const kind: ScheduleKind = hasEvery ? "every" : "at";
    const everySeconds = hasEvery ? Math.ceil(parseDurationMs(input.every!, "every") / 1000) : undefined;
    const nextRunAt = hasEvery
      ? new Date(now.getTime() + everySeconds! * 1000).toISOString()
      : parseScheduleTime(input.at!, now).toISOString();
    const job: ScheduleJob = {
      id: `sch_${crypto.randomUUID().slice(0, 8)}`,
      name,
      enabled: input.enabled ?? true,
      kind,
      ...(kind === "at" ? { at: nextRunAt } : { everySeconds }),
      nextRunAt,
      message,
      ...(input.session?.trim() ? { session: slugName(input.session, "session name") } : {}),
      ...(input.agent?.trim() ? { agent: slugName(input.agent, "agent name") } : {}),
      deleteAfterRun: input.deleteAfterRun ?? kind === "at",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      runCount: 0,
      errorCount: 0
    };

    const data = this.read();
    data.jobs.push(job);
    this.write(data);
    return job;
  }

  remove(idOrName: string): boolean {
    const data = this.read();
    const before = data.jobs.length;
    const key = idOrName.trim().toLowerCase();
    data.jobs = data.jobs.filter((job) => job.id.toLowerCase() !== key && job.name.toLowerCase() !== key);
    if (data.jobs.length === before) {
      return false;
    }
    this.write(data);
    return true;
  }

  setEnabled(idOrName: string, enabled: boolean): ScheduleJob | null {
    const data = this.read();
    const key = idOrName.trim().toLowerCase();
    const job = data.jobs.find((candidate) => candidate.id.toLowerCase() === key || candidate.name.toLowerCase() === key);
    if (!job) {
      return null;
    }
    job.enabled = enabled;
    job.updatedAt = new Date().toISOString();
    this.write(data);
    return job;
  }

  stats(now = new Date()): ScheduleStats {
    const data = this.read();
    return {
      jobs: data.jobs.length,
      enabled: data.jobs.filter((job) => job.enabled).length,
      due: data.jobs.filter((job) => job.enabled && Date.parse(job.nextRunAt) <= now.getTime()).length,
      runs: data.runs.length,
      errors: data.runs.filter((run) => run.status === "error").length
    };
  }

  exportJson(targetPath: string): void {
    writeJsonFile(targetPath, this.read());
  }

  due(now = new Date()): ScheduleJob[] {
    const nowMs = now.getTime();
    return this.list().filter((job) => job.enabled && Date.parse(job.nextRunAt) <= nowMs);
  }

  recordRun(job: ScheduleJob, status: ScheduleRunStatus, output: string, startedAt: Date, finishedAt = new Date()): ScheduleRun {
    const run: ScheduleRun = {
      id: `run_${crypto.randomUUID().slice(0, 8)}`,
      jobId: job.id,
      jobName: job.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      output: truncate(output, 20_000)
    };
    const data = this.read();
    const index = data.jobs.findIndex((candidate) => candidate.id === job.id);
    if (index >= 0) {
      const current = data.jobs[index];
      current.lastRunAt = run.finishedAt;
      current.runCount += 1;
      current.errorCount = status === "ok" ? 0 : current.errorCount + 1;
      current.updatedAt = run.finishedAt;

      if (current.kind === "every" && current.enabled && current.everySeconds) {
        current.nextRunAt = new Date(finishedAt.getTime() + current.everySeconds * 1000).toISOString();
      } else if (current.kind === "at") {
        if (current.deleteAfterRun && status === "ok") {
          data.jobs.splice(index, 1);
        } else {
          current.enabled = false;
        }
      }
    }
    data.runs.push(run);
    data.runs = data.runs.slice(-200);
    this.write(data);
    return run;
  }

  private read(): ScheduleFile {
    const data = readJsonFile<Partial<ScheduleFile>>(this.file, {});
    return {
      version: 1,
      jobs: Array.isArray(data.jobs) ? data.jobs.filter(isScheduleJob) : [],
      runs: Array.isArray(data.runs) ? data.runs.filter(isScheduleRun) : []
    };
  }

  private write(data: ScheduleFile): void {
    writeJsonFile(this.file, data);
  }
}

export function formatScheduleList(jobs: ScheduleJob[], now = new Date()): string {
  if (!jobs.length) {
    return "No scheduled jobs.";
  }
  return jobs
    .map((job) => {
      const due = job.enabled && Date.parse(job.nextRunAt) <= now.getTime() ? "due" : "next";
      const cadence = job.kind === "every" ? `every ${formatDuration(job.everySeconds ?? 0)}` : "one-shot";
      const target = [job.session ? `session:${job.session}` : "", job.agent ? `agent:${job.agent}` : ""].filter(Boolean).join(", ");
      return [
        `${job.id} ${job.name}`,
        `  ${job.enabled ? "enabled" : "disabled"} ${cadence}; ${due}: ${job.nextRunAt}`,
        target ? `  target: ${target}` : "",
        `  message: ${compact(job.message, 180)}`,
        `  runs: ${job.runCount}; errors: ${job.errorCount}`
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function formatScheduleRuns(runs: ScheduleRun[]): string {
  if (!runs.length) {
    return "No schedule runs recorded.";
  }
  return runs
    .map((run) => `${run.id} ${run.status} ${run.jobName} ${run.startedAt}\n  ${compact(run.output, 240)}`)
    .join("\n\n");
}

export function formatScheduleStats(stats: ScheduleStats): string {
  return [
    `Jobs: ${stats.jobs}`,
    `Enabled: ${stats.enabled}`,
    `Due: ${stats.due}`,
    `Runs: ${stats.runs}`,
    `Errors: ${stats.errors}`
  ].join("\n");
}

export function parseScheduleTime(value: string, now = new Date()): Date {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Schedule time is required.");
  }
  if (trimmed.toLowerCase() === "now") {
    return now;
  }
  if (isDuration(trimmed)) {
    return new Date(now.getTime() + parseDurationMs(trimmed, "at"));
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid schedule time: ${value}. Use ISO time, "now", or relative duration like 20m.`);
  }
  return new Date(parsed);
}

export function parseDurationMs(value: string, label = "duration"): number {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/);
  if (!match) {
    throw new Error(`Invalid ${label}: ${value}. Use 30s, 20m, 2h, or 1d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const factor =
    unit === "ms"
      ? 1
      : unit.startsWith("s")
        ? 1000
        : unit.startsWith("m")
          ? 60_000
          : unit.startsWith("h")
            ? 3_600_000
            : 86_400_000;
  const ms = amount * factor;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return ms;
}

function isDuration(value: string): boolean {
  return /^\d+\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/i.test(value.trim());
}

function scheduleName(inputName: string | undefined, message: string): string {
  if (inputName?.trim()) {
    return slugName(inputName, "schedule name");
  }
  const textHint = compact(message, 48).match(/[a-zA-Z0-9][a-zA-Z0-9._ -]{0,47}/)?.[0] ?? "schedule";
  return slugName(textHint, "schedule name");
}

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function isScheduleJob(value: unknown): value is ScheduleJob {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "kind" in value &&
    "nextRunAt" in value &&
    "message" in value
  );
}

function isScheduleRun(value: unknown): value is ScheduleRun {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "jobId" in value &&
    "startedAt" in value &&
    "finishedAt" in value &&
    "status" in value
  );
}

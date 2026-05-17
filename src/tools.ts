import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerWhatsAppTools } from "./channels/whatsapp.js";
import { ButterclawConfig } from "./config.js";
import { registerGitHubTools } from "./github.js";
import { registerGoogleTools } from "./google.js";
import { formatMemoryItems, formatMemoryStats, LocalMemory } from "./memory.js";
import { formatScheduleList, formatScheduleStats, ScheduleStore } from "./scheduler.js";
import { formatSessionSearch, SessionStore } from "./sessions.js";
import { formatSkillInfo, SkillLoader } from "./skills.js";
import { formatTasks, formatTaskStats, parseTaskStatus, TaskStore } from "./tasks.js";
import { enabledToolNames, isToolEnabled } from "./tool-policy.js";
import { ensureParent, isRecord, truncate } from "./util.js";

export interface ToolResult {
  ok: boolean;
  output: string;
}

type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

export interface ToolSpec {
  name: string;
  description: string;
  args: Record<string, string>;
  handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  register(spec: ToolSpec): void {
    this.tools.set(spec.name, spec);
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const spec = this.tools.get(name);
    if (!spec) {
      return { ok: false, output: `Unknown tool: ${name}` };
    }
    try {
      return await spec.handler(args);
    } catch (error) {
      return { ok: false, output: `${error instanceof Error ? error.name : "Error"}: ${String(error)}` };
    }
  }

  describe(): string {
    return [...this.tools.values()]
      .map((spec) => {
        const argDocs = Object.entries(spec.args)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        return `- ${spec.name}: ${spec.description}. Args: ${argDocs || "none"}`;
      })
      .join("\n");
  }

  names(): string[] {
    return [...this.tools.keys()].sort((a, b) => a.localeCompare(b));
  }
}

class WorkspaceTools {
  private readonly root: string;

  constructor(private readonly config: ButterclawConfig) {
    this.root = path.resolve(config.workspace);
  }

  listDir = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? "."));
    if (!fs.existsSync(resolved)) {
      return { ok: false, output: `Path does not exist: ${resolved}` };
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, output: `Path is not a directory: ${resolved}` };
    }
    const rows = fs
      .readdirSync(resolved)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200)
      .map((name) => {
        const child = path.join(resolved, name);
        const stat = fs.statSync(child);
        return stat.isDirectory() ? `${name}/` : `${name} ${stat.size} bytes`;
      });
    return { ok: true, output: rows.join("\n") || "(empty)" };
  };

  readFile = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    const maxChars = Number(args.maxChars ?? 20_000);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, output: `File does not exist: ${resolved}` };
    }
    let text = fs.readFileSync(resolved, "utf8");
    if (text.length > maxChars) {
      text = truncate(text, maxChars, "\n...[truncated by Butterclaw]...");
    }
    return { ok: true, output: text };
  };

  readFileRange = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    const start = boundedInt(args.start, 1, 1_000_000, 1);
    const end = boundedInt(args.end, start, 1_000_000, start + 80);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, output: `File does not exist: ${resolved}` };
    }
    const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
    const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`);
    return { ok: true, output: selected.join("\n") || "(empty range)" };
  };

  writeFile = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    const content = String(args.content ?? "");
    const mode = String(args.mode ?? "overwrite");
    ensureParent(resolved);
    if (mode === "append") {
      fs.appendFileSync(resolved, content, "utf8");
    } else if (mode === "overwrite") {
      fs.writeFileSync(resolved, content, "utf8");
    } else {
      return { ok: false, output: "mode must be 'overwrite' or 'append'" };
    }
    return { ok: true, output: `Wrote ${content.length} characters to ${resolved}` };
  };

  searchFiles = (args: Record<string, unknown>): ToolResult => {
    const query = String(args.query ?? "").toLowerCase().trim();
    if (!query) {
      return { ok: false, output: "query is required" };
    }
    const root = this.resolve(String(args.path ?? "."));
    const maxMatches = Number(args.maxMatches ?? 50);
    const matches: string[] = [];
    this.walk(root, (file) => {
      if (matches.length >= maxMatches) {
        return;
      }
      const rel = path.relative(this.root, file);
      if (path.basename(file).toLowerCase().includes(query)) {
        matches.push(`${rel}: filename match`);
        return;
      }
      try {
        const text = fs.readFileSync(file, "utf8");
        const lines = text.split(/\r?\n/);
        const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(query));
        if (lineIndex >= 0) {
          matches.push(`${rel}:${lineIndex + 1}: ${lines[lineIndex].trim().slice(0, 200)}`);
        }
      } catch {
        // Ignore binary or unreadable files.
      }
    });
    return { ok: true, output: matches.join("\n") || "No matches" };
  };

  findFiles = (args: Record<string, unknown>): ToolResult => {
    const pattern = String(args.pattern ?? args.query ?? "").toLowerCase().trim();
    if (!pattern) {
      return { ok: false, output: "pattern is required" };
    }
    const root = this.resolve(String(args.path ?? "."));
    const maxMatches = boundedInt(args.maxMatches, 1, 500, 80);
    const matches: string[] = [];
    this.walk(root, (file) => {
      if (matches.length >= maxMatches) return;
      const rel = relativePath(this.root, file);
      if (wildcardMatch(rel.toLowerCase(), pattern)) {
        matches.push(rel);
      }
    });
    return { ok: true, output: matches.join("\n") || "No files matched" };
  };

  fileStat = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    if (!fs.existsSync(resolved)) {
      return { ok: false, output: `Path does not exist: ${resolved}` };
    }
    const stat = fs.statSync(resolved);
    return {
      ok: true,
      output: [
        `Path: ${relativePath(this.root, resolved)}`,
        `Type: ${stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other"}`,
        `Size: ${stat.size}`,
        `Modified: ${stat.mtime.toISOString()}`,
        `Created: ${stat.birthtime.toISOString()}`
      ].join("\n")
    };
  };

  fileHash = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    const algorithm = String(args.algorithm ?? "sha256");
    if (!["sha1", "sha256", "sha512", "md5"].includes(algorithm)) {
      return { ok: false, output: "algorithm must be sha1, sha256, sha512, or md5" };
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, output: `File does not exist: ${resolved}` };
    }
    const hash = crypto.createHash(algorithm).update(fs.readFileSync(resolved)).digest("hex");
    return { ok: true, output: `${algorithm} ${relativePath(this.root, resolved)} ${hash}` };
  };

  workspaceMap = (args: Record<string, unknown>): ToolResult => {
    const root = this.resolve(String(args.path ?? "."));
    if (!fs.existsSync(root)) {
      return { ok: false, output: `Path does not exist: ${root}` };
    }
    if (!fs.statSync(root).isDirectory()) {
      return { ok: false, output: `Path is not a directory: ${root}` };
    }

    const maxFiles = boundedInt(args.maxFiles, 20, 2_000, 300);
    const maxDepth = boundedInt(args.maxDepth, 0, 12, 4);
    const state: WorkspaceMapState = {
      files: 0,
      dirs: 0,
      truncated: false,
      directories: [],
      extensions: new Map(),
      notable: [],
      packageScripts: []
    };
    this.mapWalk(root, 0, maxDepth, maxFiles, state);
    const relRoot = relativePath(this.root, root);
    const extensions = [...state.extensions.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(", ");
    const lines = [
      `Workspace map for ${relRoot}`,
      `Files scanned: ${state.files}${state.truncated ? ` (stopped at maxFiles ${maxFiles})` : ""}`,
      `Directories seen: ${state.dirs}`,
      `Extensions: ${extensions || "none"}`,
      "",
      "Package scripts:",
      state.packageScripts.length ? state.packageScripts.slice(0, 20).join("\n") : "- none found",
      "",
      "Notable files:",
      state.notable.length ? state.notable.slice(0, 40).map((file) => `- ${file}`).join("\n") : "- none found",
      "",
      "Directories:",
      state.directories.length ? state.directories.slice(0, 40).map((dir) => `- ${dir}`).join("\n") : "- none found"
    ];
    return { ok: true, output: lines.join("\n") };
  };

  runShell = (args: Record<string, unknown>): ToolResult => {
    if (this.config.shellMode !== "allow") {
      return { ok: false, output: "Shell tool is disabled. Re-run with --allow-shell to enable it." };
    }
    const command = String(args.command ?? "").trim();
    if (!command) {
      return { ok: false, output: "command is required" };
    }
    const timeout = Math.min(Number(args.timeout ?? this.config.shellTimeoutSeconds), this.config.shellTimeoutSeconds);
    const completed = childProcess.spawnSync(command, {
      cwd: this.root,
      shell: true,
      timeout: timeout * 1000,
      encoding: "utf8"
    });
    let output = `${completed.stdout ?? ""}${completed.stderr ?? ""}`.trim();
    if (!output) {
      output = `exit code ${completed.status ?? 0}`;
    }
    if (output.length > 20_000) {
      output = truncate(output, 20_000, "\n...[truncated by Butterclaw]...");
    }
    return { ok: completed.status === 0, output };
  };

  private resolve(userPath: string): string {
    const candidate = path.resolve(this.root, userPath || ".");
    if (!this.config.allowOutsideWorkspace) {
      const relative = path.relative(this.root, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes workspace: ${userPath}`);
      }
    }
    return candidate;
  }

  private walk(root: string, visitor: (file: string) => void): void {
    if (!fs.existsSync(root)) {
      return;
    }
    for (const entry of fs.readdirSync(root)) {
      const full = path.join(root, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist") {
          continue;
        }
        this.walk(full, visitor);
      } else {
        visitor(full);
      }
    }
  }

  private mapWalk(root: string, depth: number, maxDepth: number, maxFiles: number, state: WorkspaceMapState): void {
    if (!fs.existsSync(root) || state.files >= maxFiles) {
      return;
    }
    for (const entry of fs.readdirSync(root).sort((a, b) => a.localeCompare(b))) {
      if (state.files >= maxFiles) {
        state.truncated = true;
        return;
      }
      const full = path.join(root, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (shouldSkipDir(entry)) {
          continue;
        }
        state.dirs += 1;
        if (depth < maxDepth) {
          state.directories.push(`${relativePath(this.root, full)}/`);
          this.mapWalk(full, depth + 1, maxDepth, maxFiles, state);
        }
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      state.files += 1;
      const rel = relativePath(this.root, full);
      const ext = path.extname(entry).toLowerCase() || "[none]";
      state.extensions.set(ext, (state.extensions.get(ext) ?? 0) + 1);
      if (isNotableFile(entry)) {
        state.notable.push(rel);
      }
      if (entry === "package.json") {
        const scripts = readPackageScripts(full);
        if (scripts.length) {
          state.packageScripts.push(`- ${rel}: ${scripts.join(", ")}`);
        }
      }
    }
  }
}

interface WorkspaceMapState {
  files: number;
  dirs: number;
  truncated: boolean;
  directories: string[];
  extensions: Map<string, number>;
  notable: string[];
  packageScripts: string[];
}

export function buildDefaultRegistry(config: ButterclawConfig): ToolRegistry {
  const workspace = new WorkspaceTools(config);
  const registry = new ToolRegistry();
  const specs: ToolSpec[] = [
    {
      name: "list_dir",
      description: "List files and folders in the workspace",
      args: { path: "relative directory path, default '.'" },
      handler: workspace.listDir
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file from the workspace",
      args: { path: "relative file path", maxChars: "optional character limit" },
      handler: workspace.readFile
    },
    {
      name: "read_file_range",
      description: "Read numbered line ranges from a UTF-8 workspace file",
      args: { path: "relative file path", start: "1-based start line", end: "1-based end line" },
      handler: workspace.readFileRange
    },
    {
      name: "write_file",
      description: "Write or append a UTF-8 text file in the workspace",
      args: { path: "relative file path", content: "text", mode: "overwrite or append" },
      handler: workspace.writeFile
    },
    {
      name: "search_files",
      description: "Search file names and text content in the workspace",
      args: { query: "text to find", path: "relative directory", maxMatches: "optional limit" },
      handler: workspace.searchFiles
    },
    {
      name: "find_files",
      description: "Find workspace files by wildcard pattern",
      args: { pattern: "filename wildcard like *.ts or docs/*", path: "relative directory", maxMatches: "optional limit" },
      handler: workspace.findFiles
    },
    {
      name: "file_stat",
      description: "Show workspace file or directory metadata",
      args: { path: "relative path" },
      handler: workspace.fileStat
    },
    {
      name: "file_hash",
      description: "Hash a workspace file for verification",
      args: { path: "relative file path", algorithm: "sha256, sha1, sha512, or md5" },
      handler: workspace.fileHash
    },
    {
      name: "workspace_map",
      description: "Summarize workspace structure, notable files, extensions, and package scripts",
      args: { path: "relative directory, default '.'", maxFiles: "optional file scan limit", maxDepth: "optional directory depth" },
      handler: workspace.workspaceMap
    },
    {
      name: "run_shell",
      description: "Run a shell command in the workspace when explicitly enabled",
      args: { command: "command string", timeout: "seconds, capped by config" },
      handler: workspace.runShell
    },
    {
      name: "gateway_status",
      description: "Show local gateway endpoint and hook configuration",
      args: {},
      handler: () => ({
        ok: true,
        output: [
          `Gateway: http://${config.gatewayHost}:${config.gatewayPort}`,
          `Hooks: http://${config.gatewayHost}:${config.gatewayPort}${config.gatewayHookPath}`,
          `Token env ${config.gatewayTokenEnv}: ${process.env[config.gatewayTokenEnv] ? "set" : "not set"}`
        ].join("\n")
      })
    },
    {
      name: "memory_list",
      description: "List recent local memory items",
      args: { limit: "optional item limit" },
      handler: (args) => ({
        ok: true,
        output: formatMemoryItems(new LocalMemory(config.memoryPath).items(boundedInt(args.limit, 1, 200, 30)))
      })
    },
    {
      name: "memory_search",
      description: "Search local memory",
      args: { query: "search text", limit: "optional result limit" },
      handler: (args) => ({
        ok: true,
        output: formatMemoryItems(new LocalMemory(config.memoryPath).searchItems(String(args.query ?? ""), boundedInt(args.limit, 1, 100, 20)).map((entry) => entry.item))
      })
    },
    {
      name: "memory_add",
      description: "Save a local memory item",
      args: { role: "role label", content: "memory text" },
      handler: (args) => {
        new LocalMemory(config.memoryPath).add(optionalString(args.role) ?? "user", String(args.content ?? ""));
        return { ok: true, output: "Memory saved." };
      }
    },
    {
      name: "memory_forget",
      description: "Delete one local memory item by id or index",
      args: { id: "memory id or 1-based index" },
      handler: (args) => {
        const id = String(args.id ?? "");
        return new LocalMemory(config.memoryPath).forget(id) ? { ok: true, output: `Forgot memory ${id}` } : { ok: false, output: `No memory found: ${id}` };
      }
    },
    {
      name: "memory_stats",
      description: "Show local memory statistics",
      args: {},
      handler: () => ({ ok: true, output: formatMemoryStats(new LocalMemory(config.memoryPath).stats()) })
    },
    {
      name: "session_list",
      description: "List saved local sessions",
      args: {},
      handler: () => ({
        ok: true,
        output: new SessionStore(config.sessionsDir)
          .list()
          .map((session) => `${session.name}: ${session.turns} turn(s), updated ${session.updatedAt}`)
          .join("\n") || "No sessions."
      })
    },
    {
      name: "session_show",
      description: "Show a saved local session",
      args: { name: "session name", maxTurns: "optional turn limit" },
      handler: (args) => ({
        ok: true,
        output: new SessionStore(config.sessionsDir).format(String(args.name ?? ""), boundedInt(args.maxTurns, 1, 200, 50))
      })
    },
    {
      name: "session_search",
      description: "Search saved local sessions",
      args: { query: "search text", limit: "optional result limit" },
      handler: (args) => ({
        ok: true,
        output: formatSessionSearch(new SessionStore(config.sessionsDir).search(String(args.query ?? ""), boundedInt(args.limit, 1, 100, 20)))
      })
    },
    {
      name: "skill_search",
      description: "Search local skills",
      args: { query: "search text", limit: "optional result limit" },
      handler: (args) => ({
        ok: true,
        output: formatSkillInfo(new SkillLoader(config.skillsDir, config.maxSkillChars, enabledToolNames(config)).search(String(args.query ?? ""), boundedInt(args.limit, 1, 100, 20)))
      })
    },
    {
      name: "skill_info",
      description: "Show skill metadata and eligibility",
      args: { name: "skill name" },
      handler: (args) => {
        const info = new SkillLoader(config.skillsDir, config.maxSkillChars, enabledToolNames(config)).info(String(args.name ?? ""));
        return info ? { ok: true, output: formatSkillInfo([info]) } : { ok: false, output: `No skill found: ${String(args.name ?? "")}` };
      }
    },
    {
      name: "task_list",
      description: "List recent local background task records",
      args: { status: "optional status filter", kind: "optional kind filter", source: "optional source filter", limit: "optional result limit" },
      handler: (args) => {
        const status = parseTaskStatus(args.status);
        if (args.status !== undefined && !status) {
          return { ok: false, output: "Unknown status. Use queued, running, succeeded, failed, or cancelled." };
        }
        return {
          ok: true,
          output: formatTasks(new TaskStore(config.taskPath).list({ status, kind: optionalString(args.kind), source: optionalString(args.source) }, boundedInt(args.limit, 1, 200, 50)))
        };
      }
    },
    {
      name: "task_show",
      description: "Show one local background task by task id or run id",
      args: { id: "task id or run id" },
      handler: (args) => {
        const task = new TaskStore(config.taskPath).get(String(args.id ?? ""));
        return task ? { ok: true, output: JSON.stringify(task, null, 2) } : { ok: false, output: `No task found: ${String(args.id ?? "")}` };
      }
    },
    {
      name: "task_cancel",
      description: "Cancel one local background task record",
      args: { id: "task id", reason: "optional reason" },
      handler: (args) => {
        const task = new TaskStore(config.taskPath).cancel(String(args.id ?? ""), optionalString(args.reason));
        return task ? { ok: true, output: `Cancelled ${task.id}` } : { ok: false, output: `No task found: ${String(args.id ?? "")}` };
      }
    },
    {
      name: "task_stats",
      description: "Show local background task statistics",
      args: {},
      handler: () => ({ ok: true, output: formatTaskStats(new TaskStore(config.taskPath).stats()) })
    }
  ];
  specs.forEach((spec) => registerIfEnabled(registry, spec, config));
  registerGoogleTools(
    {
      register: (spec) => registerIfEnabled(registry, spec, config)
    },
    config
  );
  registerGitHubTools(
    {
      register: (spec) => registerIfEnabled(registry, spec, config)
    },
    config
  );
  registerScheduleTools(
    {
      register: (spec) => registerIfEnabled(registry, spec, config)
    },
    config
  );
  registerWhatsAppTools(
    {
      register: (spec) => registerIfEnabled(registry, spec, config)
    },
    config
  );
  return registry;
}

function registerScheduleTools(adapter: { register: (spec: ToolSpec) => void }, config: ButterclawConfig): void {
  const store = new ScheduleStore(config.schedulePath);
  adapter.register({
    name: "schedule_list",
    description: "List local scheduled reminders and recurring tasks",
    args: {},
    handler: () => ({ ok: true, output: formatScheduleList(store.list()) })
  });
  adapter.register({
    name: "schedule_add",
    description: "Create a local scheduled reminder or recurring task",
    args: {
      name: "optional schedule name",
      at: "one-shot time: ISO timestamp, now, or relative duration like 20m",
      every: "recurring interval like 1h or 1d; use instead of at",
      message: "task message to run later",
      session: "optional named session",
      agent: "optional saved agent profile",
      deleteAfterRun: "optional boolean for one-shot cleanup"
    },
    handler: (args) => {
      const job = store.add({
        name: optionalString(args.name),
        at: optionalString(args.at),
        every: optionalString(args.every),
        message: String(args.message ?? args.task ?? ""),
        session: optionalString(args.session),
        agent: optionalString(args.agent),
        deleteAfterRun: optionalBoolean(args.deleteAfterRun)
      });
      return { ok: true, output: `Scheduled ${job.name} (${job.id}) for ${job.nextRunAt}` };
    }
  });
  adapter.register({
    name: "schedule_remove",
    description: "Remove a local scheduled task by id or name",
    args: { id: "schedule id or name" },
    handler: (args) => {
      const id = String(args.id ?? args.name ?? "").trim();
      if (!id) {
        return { ok: false, output: "id is required" };
      }
      return store.remove(id) ? { ok: true, output: `Removed schedule ${id}` } : { ok: false, output: `No schedule found: ${id}` };
    }
  });
  adapter.register({
    name: "schedule_enable",
    description: "Enable a local scheduled task by id or name",
    args: { id: "schedule id or name" },
    handler: (args) => {
      const id = String(args.id ?? args.name ?? "").trim();
      const job = store.setEnabled(id, true);
      return job ? { ok: true, output: `Enabled schedule ${job.name}` } : { ok: false, output: `No schedule found: ${id}` };
    }
  });
  adapter.register({
    name: "schedule_disable",
    description: "Disable a local scheduled task by id or name",
    args: { id: "schedule id or name" },
    handler: (args) => {
      const id = String(args.id ?? args.name ?? "").trim();
      const job = store.setEnabled(id, false);
      return job ? { ok: true, output: `Disabled schedule ${job.name}` } : { ok: false, output: `No schedule found: ${id}` };
    }
  });
  adapter.register({
    name: "schedule_stats",
    description: "Show local schedule statistics",
    args: {},
    handler: () => ({ ok: true, output: formatScheduleStats(store.stats()) })
  });
}

export function registerIfEnabled(registry: ToolRegistry, spec: ToolSpec, config: ButterclawConfig): void {
  if (isToolEnabled(spec.name, config)) {
    registry.register(spec);
  }
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function relativePath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/") || ".";
}

function shouldSkipDir(name: string): boolean {
  return new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules"]).has(name);
}

function isNotableFile(name: string): boolean {
  return /^(README|CHANGELOG|LICENSE|package|tsconfig|vite\.config|next\.config|Dockerfile|\.env\.example)/i.test(name);
}

function readPackageScripts(file: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (isRecord(parsed) && isRecord(parsed.scripts)) {
      return Object.keys(parsed.scripts).sort((a, b) => a.localeCompare(b));
    }
  } catch {
    return [];
  }
  return [];
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value) || value.includes(pattern.replace(/\*/g, "").replace(/\?/g, ""));
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(text)) {
    return false;
  }
  return undefined;
}


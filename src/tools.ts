import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ButterclawConfig } from "./config.js";

export interface ToolResult {
  ok: boolean;
  output: string;
}

type ToolHandler = (args: Record<string, unknown>) => ToolResult;

interface ToolSpec {
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

  call(name: string, args: Record<string, unknown>): ToolResult {
    const spec = this.tools.get(name);
    if (!spec) {
      return { ok: false, output: `Unknown tool: ${name}` };
    }
    try {
      return spec.handler(args);
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
      text = `${text.slice(0, maxChars - 35)}\n...[truncated by Butterclaw]...`;
    }
    return { ok: true, output: text };
  };

  writeFile = (args: Record<string, unknown>): ToolResult => {
    const resolved = this.resolve(String(args.path ?? ""));
    const content = String(args.content ?? "");
    const mode = String(args.mode ?? "overwrite");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
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
      output = `${output.slice(0, 19_965)}\n...[truncated by Butterclaw]...`;
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
}

export function buildDefaultRegistry(config: ButterclawConfig): ToolRegistry {
  const workspace = new WorkspaceTools(config);
  const registry = new ToolRegistry();
  registry.register({
    name: "list_dir",
    description: "List files and folders in the workspace",
    args: { path: "relative directory path, default '.'" },
    handler: workspace.listDir
  });
  registry.register({
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace",
    args: { path: "relative file path", maxChars: "optional character limit" },
    handler: workspace.readFile
  });
  registry.register({
    name: "write_file",
    description: "Write or append a UTF-8 text file in the workspace",
    args: { path: "relative file path", content: "text", mode: "overwrite or append" },
    handler: workspace.writeFile
  });
  registry.register({
    name: "search_files",
    description: "Search file names and text content in the workspace",
    args: { query: "text to find", path: "relative directory", maxMatches: "optional limit" },
    handler: workspace.searchFiles
  });
  registry.register({
    name: "run_shell",
    description: "Run a shell command in the workspace when explicitly enabled",
    args: { command: "command string", timeout: "seconds, capped by config" },
    handler: workspace.runShell
  });
  return registry;
}


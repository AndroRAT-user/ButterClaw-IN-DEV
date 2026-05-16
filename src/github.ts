import childProcess from "node:child_process";
import { ButterclawConfig } from "./config.js";
import type { ToolResult, ToolSpec } from "./tools.js";
import { isRecord, truncate } from "./util.js";

interface RegistryLike {
  register(spec: ToolSpec): void;
}

export interface GitHubCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface GitHubCommandRunner {
  run(args: string[]): GitHubCommandResult;
}

export class GhCliRunner implements GitHubCommandRunner {
  constructor(private readonly config: ButterclawConfig) {}

  run(args: string[]): GitHubCommandResult {
    const result = childProcess.spawnSync(this.config.githubCliPath, args, {
      cwd: this.config.workspace,
      shell: false,
      encoding: "utf8",
      timeout: this.config.requestTimeoutSeconds * 1000
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error ? { error: result.error.message } : {})
    };
  }
}

export function registerGitHubTools(
  registry: RegistryLike,
  config: ButterclawConfig,
  runner: GitHubCommandRunner = new GhCliRunner(config)
): void {
  const tools = new GitHubTools(config, runner);
  registry.register({
    name: "github_status",
    description: "Check GitHub CLI OAuth status and the active repository",
    args: { repo: "optional owner/repo override" },
    handler: (args) => tools.status(args)
  });
  registry.register({
    name: "github_pr_list",
    description: "List GitHub pull requests through the gh CLI",
    args: { repo: "owner/repo, optional if configured or in a GitHub checkout", state: "open, closed, merged, or all", limit: "optional limit" },
    handler: (args) => tools.prList(args)
  });
  registry.register({
    name: "github_pr_view",
    description: "View one GitHub pull request through the gh CLI",
    args: { repo: "owner/repo, optional if configured or in a GitHub checkout", pr: "PR number or URL" },
    handler: (args) => tools.prView(args)
  });
  registry.register({
    name: "github_issue_list",
    description: "List GitHub issues through the gh CLI",
    args: { repo: "owner/repo, optional if configured or in a GitHub checkout", state: "open, closed, or all", limit: "optional limit" },
    handler: (args) => tools.issueList(args)
  });
  registry.register({
    name: "github_issue_create",
    description: "Create a GitHub issue through the gh CLI",
    args: { repo: "owner/repo, optional if configured or in a GitHub checkout", title: "issue title", body: "issue body" },
    handler: (args) => tools.issueCreate(args)
  });
  registry.register({
    name: "github_run_list",
    description: "List recent GitHub Actions workflow runs through the gh CLI",
    args: { repo: "owner/repo, optional if configured or in a GitHub checkout", limit: "optional limit" },
    handler: (args) => tools.runList(args)
  });
}

export function githubStatus(config: ButterclawConfig, runner: GitHubCommandRunner = new GhCliRunner(config)): string {
  const status = runner.run(["auth", "status", "-h", "github.com"]);
  const repo = resolveRepo(config, {});
  return [
    status.status === 0 ? "GitHub OAuth is connected through gh." : "GitHub OAuth is not connected. Run: gh auth login -h github.com -p https -w",
    `gh path: ${config.githubCliPath}`,
    `Default repo: ${repo ?? "(none detected)"}`,
    status.status === 0 ? truncate(status.stderr || status.stdout, 800) : truncate(status.stderr || status.stdout || status.error || "gh auth status failed", 800)
  ].join("\n");
}

class GitHubTools {
  constructor(
    private readonly config: ButterclawConfig,
    private readonly runner: GitHubCommandRunner
  ) {}

  status(args: Record<string, unknown>): ToolResult {
    const repo = resolveRepo(this.config, args);
    return { ok: true, output: githubStatus({ ...this.config, githubDefaultRepo: repo ?? this.config.githubDefaultRepo }, this.runner) };
  }

  prList(args: Record<string, unknown>): ToolResult {
    const repo = requiredRepo(this.config, args);
    if (!repo.ok) return repo;
    const result = this.runner.run([
      "pr",
      "list",
      "--repo",
      repo.output,
      "--state",
      stateArg(args.state, ["open", "closed", "merged", "all"], "open"),
      "--limit",
      String(limitArg(args.limit, this.config.githubMaxItems)),
      "--json",
      "number,title,state,author,updatedAt,url"
    ]);
    return formatGhJsonResult(result, formatRows);
  }

  prView(args: Record<string, unknown>): ToolResult {
    const repo = requiredRepo(this.config, args);
    if (!repo.ok) return repo;
    const pr = String(args.pr ?? args.number ?? args.url ?? "").trim();
    if (!pr) {
      return { ok: false, output: "pr is required" };
    }
    return formatGhJsonResult(
      this.runner.run([
        "pr",
        "view",
        pr,
        "--repo",
        repo.output,
        "--json",
        "number,title,state,author,body,mergeable,reviewDecision,statusCheckRollup,url"
      ]),
      formatObject
    );
  }

  issueList(args: Record<string, unknown>): ToolResult {
    const repo = requiredRepo(this.config, args);
    if (!repo.ok) return repo;
    return formatGhJsonResult(
      this.runner.run([
        "issue",
        "list",
        "--repo",
        repo.output,
        "--state",
        stateArg(args.state, ["open", "closed", "all"], "open"),
        "--limit",
        String(limitArg(args.limit, this.config.githubMaxItems)),
        "--json",
        "number,title,state,author,labels,updatedAt,url"
      ]),
      formatRows
    );
  }

  issueCreate(args: Record<string, unknown>): ToolResult {
    const repo = requiredRepo(this.config, args);
    if (!repo.ok) return repo;
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { ok: false, output: "title is required" };
    }
    const body = String(args.body ?? "");
    const result = this.runner.run(["issue", "create", "--repo", repo.output, "--title", title, "--body", body || "Created by Butterclaw."]);
    return formatPlainResult(result);
  }

  runList(args: Record<string, unknown>): ToolResult {
    const repo = requiredRepo(this.config, args);
    if (!repo.ok) return repo;
    return formatGhJsonResult(
      this.runner.run([
        "run",
        "list",
        "--repo",
        repo.output,
        "--limit",
        String(limitArg(args.limit, this.config.githubMaxItems)),
        "--json",
        "databaseId,displayTitle,status,conclusion,workflowName,createdAt,url"
      ]),
      formatRows
    );
  }
}

function requiredRepo(config: ButterclawConfig, args: Record<string, unknown>): ToolResult {
  const repo = resolveRepo(config, args);
  if (!repo) {
    return { ok: false, output: "repo is required. Pass repo: owner/name, set githubDefaultRepo, or run in a GitHub checkout." };
  }
  return { ok: true, output: repo };
}

function resolveRepo(config: ButterclawConfig, args: Record<string, unknown>): string | null {
  const explicit = String(args.repo ?? "").trim();
  if (explicit) return stripRepoUrl(explicit);
  if (config.githubDefaultRepo) return stripRepoUrl(config.githubDefaultRepo);
  const result = childProcess.spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: config.workspace,
    shell: false,
    encoding: "utf8",
    timeout: 3000
  });
  return result.status === 0 ? stripRepoUrl(String(result.stdout ?? "").trim()) : null;
}

function stripRepoUrl(value: string): string {
  const trimmed = value.trim().replace(/\.git$/i, "");
  const ssh = trimmed.match(/^git@github\.com:(?<repo>[^/]+\/[^/]+)$/i);
  if (ssh?.groups?.repo) return ssh.groups.repo;
  const https = trimmed.match(/^https:\/\/github\.com\/(?<repo>[^/]+\/[^/]+)$/i);
  if (https?.groups?.repo) return https.groups.repo;
  return trimmed;
}

function limitArg(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function stateArg(value: unknown, allowed: string[], fallback: string): string {
  const text = String(value ?? fallback).trim().toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

function formatPlainResult(result: GitHubCommandResult): ToolResult {
  const output = truncate(`${result.stdout}${result.stderr}`.trim() || result.error || `exit code ${result.status ?? 0}`, 12_000);
  return { ok: result.status === 0, output };
}

function formatGhJsonResult(result: GitHubCommandResult, formatter: (value: unknown) => string): ToolResult {
  if (result.status !== 0) {
    return formatPlainResult(result);
  }
  try {
    return { ok: true, output: formatter(JSON.parse(result.stdout)) };
  } catch {
    return { ok: false, output: `gh returned non-JSON output:\n${truncate(result.stdout || result.stderr, 2000)}` };
  }
}

function formatRows(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "No GitHub items found.";
  }
  return value.map((item) => (isRecord(item) ? formatObjectLine(item) : String(item))).join("\n");
}

function formatObject(value: unknown): string {
  if (!isRecord(value)) {
    return String(value ?? "");
  }
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${formatValue(entry)}`)
    .join("\n");
}

function formatObjectLine(value: Record<string, unknown>): string {
  const number = value.number ?? value.databaseId ?? "";
  const title = value.title ?? value.displayTitle ?? value.workflowName ?? "(untitled)";
  const state = value.state ?? value.status ?? "";
  const conclusion = value.conclusion ? `/${String(value.conclusion)}` : "";
  const author = isRecord(value.author) ? ` @${String(value.author.login ?? value.author.name ?? "")}` : "";
  const url = value.url ? ` ${String(value.url)}` : "";
  return [`#${String(number)}`.trim(), String(title), String(state) + conclusion + author, url.trim()].filter(Boolean).join(" | ");
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatValue).join(", ");
  }
  if (isRecord(value)) {
    if (typeof value.login === "string") return value.login;
    if (typeof value.name === "string") return value.name;
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

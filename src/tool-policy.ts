import { ButterclawConfig, ToolProfile } from "./config.js";

export const KNOWN_TOOL_NAMES = [
  "list_dir",
  "read_file",
  "read_file_range",
  "write_file",
  "search_files",
  "find_files",
  "file_stat",
  "file_hash",
  "workspace_map",
  "run_shell",
  "gateway_status",
  "memory_list",
  "memory_search",
  "memory_add",
  "memory_forget",
  "memory_stats",
  "session_list",
  "session_show",
  "session_search",
  "skill_search",
  "skill_info",
  "task_list",
  "task_show",
  "task_cancel",
  "task_stats",
  "gmail_search",
  "gmail_read",
  "gmail_create_draft",
  "calendar_list_events",
  "calendar_create_event",
  "github_status",
  "github_pr_list",
  "github_pr_view",
  "github_issue_list",
  "github_issue_create",
  "github_run_list",
  "schedule_list",
  "schedule_add",
  "schedule_remove",
  "schedule_enable",
  "schedule_disable",
  "schedule_stats",
  "whatsapp_status",
  "whatsapp_send",
  "delegate_task",
  "delegate_team"
] as const;

type ToolName = (typeof KNOWN_TOOL_NAMES)[number];

const TOOL_GROUPS: Record<string, readonly ToolName[]> = {
  "group:read": ["list_dir", "read_file", "read_file_range", "search_files", "find_files", "file_stat", "file_hash", "workspace_map"],
  "group:write": ["write_file"],
  "group:fs": ["list_dir", "read_file", "read_file_range", "write_file", "search_files", "find_files", "file_stat", "file_hash", "workspace_map"],
  "group:runtime": ["run_shell", "gateway_status", "task_list", "task_show", "task_cancel", "task_stats"],
  "group:memory": ["memory_list", "memory_search", "memory_add", "memory_forget", "memory_stats"],
  "group:sessions": ["session_list", "session_show", "session_search"],
  "group:skills": ["skill_search", "skill_info"],
  "group:google": ["gmail_search", "gmail_read", "gmail_create_draft", "calendar_list_events", "calendar_create_event"],
  "group:github": ["github_status", "github_pr_list", "github_pr_view", "github_issue_list", "github_issue_create", "github_run_list"],
  "group:automation": ["schedule_list", "schedule_add", "schedule_remove", "schedule_enable", "schedule_disable", "schedule_stats"],
  "group:whatsapp": ["whatsapp_status", "whatsapp_send"],
  "group:channels": ["whatsapp_status", "whatsapp_send"],
  "group:agents": ["delegate_task", "delegate_team"],
  "group:all": KNOWN_TOOL_NAMES,
  "group:butterclaw": KNOWN_TOOL_NAMES
};

const PROFILE_TOOLS: Record<ToolProfile, readonly string[]> = {
  minimal: ["group:read"],
  coding: ["group:fs", "group:runtime", "group:github", "group:agents"],
  google: ["group:read", "group:google", "group:github", "group:agents"],
  full: ["group:all"]
};

export function isToolEnabled(name: string, config: ButterclawConfig): boolean {
  const allowRules = normalizeRules(config.toolAllow);
  const denyRules = normalizeRules(config.toolDeny);
  const baseRules = allowRules.length ? allowRules : PROFILE_TOOLS[config.toolProfile ?? "full"];
  return matchesAny(name, baseRules) && !matchesAny(name, denyRules);
}

export function enabledToolNames(config: ButterclawConfig): string[] {
  return KNOWN_TOOL_NAMES.filter((name) => isToolEnabled(name, config));
}

export function toolPolicySummary(config: ButterclawConfig): string {
  const allow = normalizeRules(config.toolAllow);
  const deny = normalizeRules(config.toolDeny);
  return [
    `Profile: ${config.toolProfile ?? "full"}`,
    `Enabled: ${enabledToolNames(config).join(", ") || "none"}`,
    `Allow override: ${allow.length ? allow.join(", ") : "profile defaults"}`,
    `Deny override: ${deny.length ? deny.join(", ") : "none"}`
  ].join("\n");
}

export function knownToolGroups(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(TOOL_GROUPS).map(([group, names]) => [group, [...names]]));
}

function normalizeRules(rules: string[] | undefined): string[] {
  return (rules ?? [])
    .flatMap((rule) => rule.split(","))
    .map((rule) => rule.trim())
    .filter(Boolean);
}

function matchesAny(name: string, rules: readonly string[]): boolean {
  return rules.some((rule) => matchesRule(name, rule));
}

function matchesRule(name: string, rule: string): boolean {
  if (rule === "*" || rule === name) {
    return true;
  }
  const group = TOOL_GROUPS[rule];
  if (group) {
    return group.includes(name as ToolName);
  }
  if (rule.endsWith("*")) {
    return name.startsWith(rule.slice(0, -1));
  }
  return false;
}

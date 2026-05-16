import { AgentProfile, AgentStore, applyAgentProfile } from "./agents.js";
import { ButterclawConfig } from "./config.js";
import { LocalMemory } from "./memory.js";
import { buildProvider, Message, Provider } from "./providers.js";
import { SessionStore } from "./sessions.js";
import { SkillLoader } from "./skills.js";
import { TeamStore } from "./teams.js";
import { isToolEnabled } from "./tool-policy.js";
import { buildDefaultRegistry, ToolRegistry, ToolResult } from "./tools.js";
import { UsageTracker } from "./usage.js";
import { isRecord, truncate } from "./util.js";

export interface AgentRun {
  answer: string;
  steps: number;
  usage: ReturnType<UsageTracker["current"]>;
}

export class ButterclawAgent {
  readonly registry: ToolRegistry;
  readonly usage: UsageTracker;
  private readonly provider: Provider;
  private readonly memory: LocalMemory;
  private readonly skills: SkillLoader;
  private readonly recordMemory: boolean;
  private readonly recordSession: boolean;
  private readonly sessionName?: string;
  private readonly sessionStore?: SessionStore;
  private readonly agentProfile?: AgentProfile;

  constructor(
    private readonly config: ButterclawConfig,
    options: {
      provider?: Provider;
      registry?: ToolRegistry;
      memory?: LocalMemory;
      usage?: UsageTracker;
      enableDelegation?: boolean;
      recordMemory?: boolean;
      recordSession?: boolean;
      sessionName?: string;
      sessionStore?: SessionStore;
      agentProfile?: AgentProfile;
    } = {}
  ) {
    this.provider = options.provider ?? buildProvider(config);
    this.registry = options.registry ?? buildDefaultRegistry(config);
    this.memory = options.memory ?? new LocalMemory(config.memoryPath);
    this.usage = options.usage ?? UsageTracker.fromConfig(config);
    this.skills = new SkillLoader(config.skillsDir, config.maxSkillChars);
    this.recordMemory = options.recordMemory ?? true;
    this.recordSession = options.recordSession ?? Boolean(options.sessionName);
    this.sessionName = options.sessionName;
    this.sessionStore = options.sessionStore ?? (options.sessionName ? new SessionStore(config.sessionsDir) : undefined);
    this.agentProfile = options.agentProfile;
    if (options.enableDelegation !== false) {
      this.registerDelegationTool();
    }
  }

  async run(userInput: string): Promise<AgentRun> {
    let messages = this.buildMessages(userInput);
    let lastDelegationOutput: string | null = null;
    let lastToolOutput: string | null = null;
    for (let step = 1; step <= this.config.maxSteps; step += 1) {
      const response = await this.provider.complete(messages);
      this.usage.record(response);
      const toolCall = parseToolCall(response.content);
      if (!toolCall) {
        if (!response.content.trim() && step < this.config.maxSteps) {
          messages.push({ role: "assistant", content: response.content });
          messages.push({
            role: "user",
            content:
              "Your previous response was empty. Continue with a non-empty answer. If the task needs workspace changes, call a tool; otherwise report what you found."
          });
          messages = trimMessages(messages, this.config.maxContextChars);
          continue;
        }
        const answer = withDelegationReport(response.content, lastDelegationOutput, lastToolOutput);
        this.finishRun(userInput, answer);
        return { answer, steps: step, usage: this.usage.current() };
      }

      const result = await this.registry.call(toolCall.tool, toolCall.args ?? {});
      lastToolOutput = `${toolCall.tool} ${result.ok ? "OK" : "ERROR"}:\n${result.output}`;
      if (toolCall.tool === "delegate_task" || toolCall.tool === "delegate_team") {
        lastDelegationOutput = `${result.ok ? "" : "ERROR: "}${result.output}`;
      }
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `Tool result for ${toolCall.tool}:\n${result.ok ? "OK" : "ERROR"}: ${result.output}\n\nContinue. If this was a delegate_task or delegate_team result, include the agent report in your final answer. If the task is complete, answer in plain text.`
      });
      messages = trimMessages(messages, this.config.maxContextChars);
    }

    const fallback =
      "I reached the configured step limit before finishing. Try raising --max-steps or splitting the task into smaller pieces.";
    this.finishRun(userInput, fallback);
    return { answer: fallback, steps: this.config.maxSteps, usage: this.usage.current() };
  }

  private buildMessages(userInput: string): Message[] {
    const sessionMessages =
      this.sessionName && this.sessionStore
        ? this.sessionStore.read(this.sessionName).map((turn): Message => ({ role: turn.role, content: turn.content }))
        : [];
    return trimMessages(
      [
        {
          role: "system",
          content: buildSystemPrompt(
            this.registry,
            this.memory.search(userInput, this.config.memoryItems),
            this.skills.relevantTo(userInput),
            this.agentProfile
          )
        },
        ...sessionMessages,
        { role: "user", content: userInput }
      ],
      this.config.maxContextChars
    );
  }

  private registerDelegationTool(): void {
    if (isToolEnabled("delegate_task", this.config)) {
      this.registry.register({
        name: "delegate_task",
        description: "Ask a focused sub-agent to work on a bounded task and report back",
        args: {
          task: "focused task for the sub-agent",
          agent: "optional named agent profile to use",
          role: "optional short role name, default worker",
          maxSteps: "optional worker step limit, capped below the main agent limit",
          maxOutputChars: "optional output limit"
        },
        handler: (args) => this.delegateTask(args)
      });
    }
    if (isToolEnabled("delegate_team", this.config)) {
      this.registry.register({
        name: "delegate_team",
        description: "Ask a saved team of named agents to work on one bounded task and combine their reports",
        args: {
          team: "saved team name",
          task: "focused task for the team",
          maxSteps: "optional worker step limit for each team member",
          maxOutputChars: "optional combined output limit"
        },
        handler: (args) => this.delegateTeam(args)
      });
    }
  }

  private async delegateTask(args: Record<string, unknown>): Promise<ToolResult> {
    const task = String(args.task ?? args.prompt ?? "").trim();
    if (!task) {
      return { ok: false, output: "task is required" };
    }

    const role = truncate(String(args.role ?? "worker").trim() || "worker", 80);
    const store = new AgentStore(this.config.agentsDir);
    const explicitProfileName = String(args.agent ?? "").trim();
    const inferredProfile = explicitProfileName ? null : store.get(role);
    const profileName = explicitProfileName || inferredProfile?.name || "";
    const profile = explicitProfileName ? store.get(explicitProfileName) : inferredProfile;
    if (profileName && !profile) {
      return { ok: false, output: `Unknown agent: ${profileName}` };
    }
    const maxSteps = boundedInt(args.maxSteps, 1, Math.max(1, this.config.maxSteps - 1), Math.min(3, this.config.maxSteps));
    const maxOutputChars = boundedInt(args.maxOutputChars, 500, 20_000, 8_000);
    const workerConfig = { ...this.config };
    if (profile) {
      applyAgentProfile(workerConfig, profile);
    }
    workerConfig.maxSteps = maxSteps;
    const useProfileProvider = Boolean(profile?.provider || profile?.model || profile?.baseUrl !== undefined);
    const worker = new ButterclawAgent(workerConfig, {
      ...(useProfileProvider ? {} : { provider: this.provider }),
      registry: buildDefaultRegistry(workerConfig),
      memory: this.memory,
      usage: this.usage,
      enableDelegation: false,
      recordMemory: false,
      ...(profile ? { agentProfile: profile } : {})
    });

    const workerName = profile?.name ?? role;
    const result = await worker.run(`You are a focused ${workerName} sub-agent. Complete this task and report only useful results:\n${task}`);
    return {
      ok: true,
      output: truncate(`Sub-agent ${workerName} finished in ${result.steps} step(s):\n${result.answer}`, maxOutputChars)
    };
  }

  private async delegateTeam(args: Record<string, unknown>): Promise<ToolResult> {
    const teamName = String(args.team ?? args.name ?? "").trim();
    const task = String(args.task ?? args.prompt ?? "").trim();
    if (!teamName) {
      return { ok: false, output: "team is required" };
    }
    if (!task) {
      return { ok: false, output: "task is required" };
    }
    const team = new TeamStore(this.config.teamsDir).get(teamName);
    if (!team) {
      return { ok: false, output: `Unknown team: ${teamName}` };
    }

    const maxSteps = boundedInt(args.maxSteps, 1, Math.max(1, this.config.maxSteps - 1), Math.min(3, this.config.maxSteps));
    const maxOutputChars = boundedInt(args.maxOutputChars, 1_000, 40_000, 16_000);
    const teamTask = [
      `Team mission: ${task}`,
      team.instructions ? `Team instructions:\n${team.instructions}` : "",
      "Work from your saved agent profile and return concise, useful results."
    ]
      .filter(Boolean)
      .join("\n\n");

    const reports: Array<{ agent: string; result: ToolResult }> = [];
    for (const agent of team.agents) {
      reports.push({
        agent,
        result: await this.delegateTask({
          agent,
          task: teamTask,
          maxSteps,
          maxOutputChars: Math.min(8_000, maxOutputChars)
        })
      });
    }
    const ok = reports.every((report) => report.result.ok);
    const body = reports.map((report) => `## ${report.agent}\n${report.result.ok ? report.result.output : `ERROR: ${report.result.output}`}`).join("\n\n");
    return {
      ok,
      output: truncate(`Team ${team.name} finished ${ok ? "successfully" : "with errors"}:\n\n${body}`, maxOutputChars)
    };
  }

  private finishRun(userInput: string, answer: string): void {
    this.remember(userInput, answer);
    if (this.recordSession && this.sessionName && this.sessionStore) {
      this.sessionStore.append(this.sessionName, "user", userInput);
      this.sessionStore.append(this.sessionName, "assistant", answer);
      this.sessionStore.prune(this.sessionName, this.config.sessionMaxTurns);
    }
  }

  private remember(userInput: string, answer: string): void {
    if (this.recordMemory) {
      this.memory.add("user", userInput);
      this.memory.add("assistant", answer);
    }
  }
}

export function buildSystemPrompt(
  registry: ToolRegistry,
  memoryItems: string[],
  skills: string[],
  agentProfile?: AgentProfile
): string {
  const memoryBlock = memoryItems.map((item) => `- ${item}`).join("\n") || "- No relevant memory yet.";
  const skillsBlock = skills.join("\n\n") || "No relevant skills loaded.";
  const agentBlock = agentProfile
    ? `Name: ${agentProfile.name}\nDescription: ${agentProfile.description}\nInstructions:\n${agentProfile.instructions}`
    : "Default Butterclaw agent.";
  const toolDocs = registry.describe();
  const delegationNotes = [
    toolDocs.includes("- delegate_task:") ? "Use delegate_task for one focused sub-agent." : "",
    toolDocs.includes("- delegate_team:")
      ? "Use delegate_team when several saved agents should attack the same task from different specialties."
      : ""
  ].filter(Boolean);
  const delegationHint = delegationNotes.length ? `\n${delegationNotes.join(" ")}\n` : "";
  return `You are Butterclaw, a lightweight local-first agent.

Use short, direct reasoning. Prefer small, reversible steps. Avoid unnecessary work when a focused action solves the task.

Butterclaw facts:
- Saved agents are JSON profiles managed with "butterclaw agent create", "butterclaw agent run", and "--agent <name>".
- There is no butterclaw.yaml agent config and no @agent prompt syntax in this CLI.
- When asked to inspect or review a project, use workspace_map or read/list tools before reporting.
- When asked to build, create, save, or update a file, use write_file when that tool is available.
- Always return a non-empty final report.

Active agent:
${agentBlock}

Available tools:
${toolDocs}

To use a tool, respond with one JSON object and nothing else:
{"tool":"tool_name","args":{"key":"value"}}
${delegationHint}

For normal answers, respond in plain text. Do not wrap final answers in JSON.

Relevant memory:
${memoryBlock}

Relevant skills:
${skillsBlock}
`;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

interface ToolCall {
  tool: string;
  args?: Record<string, unknown>;
}

export function parseToolCall(content: string): ToolCall | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    text = fenced[1].trim();
  } else if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    text = text.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(text) as { tool?: unknown; name?: unknown; args?: unknown };
    const tool = typeof parsed.tool === "string" ? parsed.tool : typeof parsed.name === "string" ? parsed.name : null;
    return tool ? { tool, args: isRecord(parsed.args) ? parsed.args : {} } : null;
  } catch {
    return null;
  }
}

export function trimMessages(messages: Message[], maxChars: number): Message[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= maxChars) {
    return messages;
  }
  const [system, ...rest] = messages;
  const trimmed: Message[] = [system];
  let running = system.content.length;
  for (const message of rest.reverse()) {
    if (running + message.content.length > maxChars) {
      continue;
    }
    trimmed.splice(1, 0, message);
    running += message.content.length;
  }
  return trimmed;
}

function withDelegationReport(answer: string, delegationOutput: string | null, lastToolOutput: string | null): string {
  const trimmedAnswer = answer.trim();
  if (!delegationOutput) {
    return nonEmptyAnswer(trimmedAnswer, lastToolOutput);
  }
  if (!trimmedAnswer) {
    return delegationOutput;
  }
  const firstReportLine = delegationOutput.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (firstReportLine && trimmedAnswer.includes(firstReportLine)) {
    return trimmedAnswer;
  }
  if (/\b(Sub-agent|Team)\b/.test(trimmedAnswer)) {
    return trimmedAnswer;
  }
  return `${trimmedAnswer}\n\nAgent report:\n${delegationOutput}`;
}

function nonEmptyAnswer(answer: string, lastToolOutput: string | null): string {
  if (answer) {
    return answer;
  }
  if (lastToolOutput) {
    return `The model returned an empty answer after running a tool. Last tool result:\n${lastToolOutput}`;
  }
  return "The model provider returned an empty answer. Try again, use --provider mock to test the runtime, or raise --request-timeout-seconds for slow providers.";
}

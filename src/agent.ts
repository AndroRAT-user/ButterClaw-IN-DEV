import { AgentProfile, AgentStore, applyAgentProfile } from "./agents.js";
import { ButterclawConfig } from "./config.js";
import { LocalMemory } from "./memory.js";
import { buildProvider, Message, Provider } from "./providers.js";
import { SkillLoader } from "./skills.js";
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
      agentProfile?: AgentProfile;
    } = {}
  ) {
    this.provider = options.provider ?? buildProvider(config);
    this.registry = options.registry ?? buildDefaultRegistry(config);
    this.memory = options.memory ?? new LocalMemory(config.memoryPath);
    this.usage = options.usage ?? UsageTracker.fromConfig(config);
    this.skills = new SkillLoader(config.skillsDir, config.maxSkillChars);
    this.recordMemory = options.recordMemory ?? true;
    this.agentProfile = options.agentProfile;
    if (options.enableDelegation !== false) {
      this.registerDelegationTool();
    }
  }

  async run(userInput: string): Promise<AgentRun> {
    let messages = this.buildMessages(userInput);
    for (let step = 1; step <= this.config.maxSteps; step += 1) {
      const response = await this.provider.complete(messages);
      this.usage.record(response);
      const toolCall = parseToolCall(response.content);
      if (!toolCall) {
        this.remember(userInput, response.content);
        return { answer: response.content, steps: step, usage: this.usage.current() };
      }

      const result = await this.registry.call(toolCall.tool, toolCall.args ?? {});
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `Tool result for ${toolCall.tool}:\n${result.ok ? "OK" : "ERROR"}: ${result.output}\n\nContinue. If the task is complete, answer in plain text.`
      });
      messages = trimMessages(messages, this.config.maxContextChars);
    }

    const fallback =
      "I reached the configured step limit before finishing. Try raising --max-steps or splitting the task into smaller pieces.";
    this.remember(userInput, fallback);
    return { answer: fallback, steps: this.config.maxSteps, usage: this.usage.current() };
  }

  private buildMessages(userInput: string): Message[] {
    return [
      {
        role: "system",
        content: buildSystemPrompt(
          this.registry,
          this.memory.search(userInput, this.config.memoryItems),
          this.skills.relevantTo(userInput),
          this.agentProfile
        )
      },
      { role: "user", content: userInput }
    ];
  }

  private registerDelegationTool(): void {
    this.registry.register({
      name: "delegate_task",
      description: "Ask a focused sub-agent to work on a bounded task and report back",
      args: {
        task: "focused task for the sub-agent",
        agent: "optional named agent profile to use",
        role: "optional short role name, default worker",
        maxSteps: "optional worker step limit, capped below the main agent limit"
      },
      handler: (args) => this.delegateTask(args)
    });
  }

  private async delegateTask(args: Record<string, unknown>): Promise<ToolResult> {
    const task = String(args.task ?? args.prompt ?? "").trim();
    if (!task) {
      return { ok: false, output: "task is required" };
    }

    const role = truncate(String(args.role ?? "worker").trim() || "worker", 80);
    const profileName = String(args.agent ?? "").trim();
    const profile = profileName ? new AgentStore(this.config.agentsDir).get(profileName) : null;
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
    const worker = new ButterclawAgent(workerConfig, {
      provider: this.provider,
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

  private remember(userInput: string, answer: string): void {
    if (!this.recordMemory) {
      return;
    }
    this.memory.add("user", userInput);
    this.memory.add("assistant", answer);
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
  const delegationHint = toolDocs.includes("- delegate_task:")
    ? "\nUse delegate_task when a focused sub-agent can inspect, research, or carry out a small part of the task independently.\n"
    : "";
  return `You are Butterclaw, a lightweight local-first agent.

Use short, direct reasoning. Prefer small, reversible steps. Avoid unnecessary work when a focused action solves the task.

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


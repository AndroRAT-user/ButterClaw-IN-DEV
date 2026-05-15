import { ButterclawConfig } from "./config.js";
import { LocalMemory } from "./memory.js";
import { buildProvider, Message, Provider } from "./providers.js";
import { SkillLoader } from "./skills.js";
import { buildDefaultRegistry, ToolRegistry } from "./tools.js";
import { UsageTracker } from "./usage.js";
import { isRecord } from "./util.js";

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

  constructor(
    private readonly config: ButterclawConfig,
    options: {
      provider?: Provider;
      registry?: ToolRegistry;
      memory?: LocalMemory;
      usage?: UsageTracker;
    } = {}
  ) {
    this.provider = options.provider ?? buildProvider(config);
    this.registry = options.registry ?? buildDefaultRegistry(config);
    this.memory = options.memory ?? new LocalMemory(config.memoryPath);
    this.usage = options.usage ?? UsageTracker.fromConfig(config);
    this.skills = new SkillLoader(config.skillsDir, config.maxSkillChars);
  }

  async run(userInput: string): Promise<AgentRun> {
    let messages = this.buildMessages(userInput);
    for (let step = 1; step <= this.config.maxSteps; step += 1) {
      const response = await this.provider.complete(messages);
      this.usage.record(response);
      const toolCall = parseToolCall(response.content);
      if (!toolCall) {
        this.memory.add("user", userInput);
        this.memory.add("assistant", response.content);
        return { answer: response.content, steps: step, usage: this.usage.current() };
      }

      const result = this.registry.call(toolCall.tool, toolCall.args ?? {});
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `Tool result for ${toolCall.tool}:\n${result.ok ? "OK" : "ERROR"}: ${result.output}\n\nContinue. If the task is complete, answer in plain text.`
      });
      messages = trimMessages(messages, this.config.maxContextChars);
    }

    const fallback =
      "I reached the configured step limit before finishing. Try raising --max-steps or splitting the task into smaller pieces.";
    this.memory.add("user", userInput);
    this.memory.add("assistant", fallback);
    return { answer: fallback, steps: this.config.maxSteps, usage: this.usage.current() };
  }

  private buildMessages(userInput: string): Message[] {
    return [
      {
        role: "system",
        content: buildSystemPrompt(
          this.registry,
          this.memory.search(userInput, this.config.memoryItems),
          this.skills.relevantTo(userInput)
        )
      },
      { role: "user", content: userInput }
    ];
  }
}

export function buildSystemPrompt(registry: ToolRegistry, memoryItems: string[], skills: string[]): string {
  const memoryBlock = memoryItems.map((item) => `- ${item}`).join("\n") || "- No relevant memory yet.";
  const skillsBlock = skills.join("\n\n") || "No relevant skills loaded.";
  return `You are Butterclaw, a lightweight local-first agent.

Use short, direct reasoning. Prefer small, reversible steps. Avoid unnecessary work when a focused action solves the task.

Available tools:
${registry.describe()}

To use a tool, respond with one JSON object and nothing else:
{"tool":"tool_name","args":{"key":"value"}}

For normal answers, respond in plain text. Do not wrap final answers in JSON.

Relevant memory:
${memoryBlock}

Relevant skills:
${skillsBlock}
`;
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


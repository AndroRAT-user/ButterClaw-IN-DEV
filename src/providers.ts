import { ButterclawConfig } from "./config.js";
import { trimTrailingSlash } from "./util.js";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  raw?: unknown;
}

export interface Provider {
  complete(messages: Message[]): Promise<ProviderResponse>;
}

export class ProviderError extends Error {}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildProvider(config: ButterclawConfig): Provider {
  const candidates = buildProviderCandidates(config);
  if (candidates.length > 1) {
    return new FallbackProvider(candidates);
  }
  return candidates[0].provider;
}

export function buildProviderCandidates(config: ButterclawConfig): Array<{ label: string; provider: Provider }> {
  return [config, ...config.modelFallbacks.map((fallback) => fallbackConfig(config, fallback))].map((candidate) => ({
    label: `${candidate.provider}/${candidate.model}`,
    provider: buildSingleProvider(candidate)
  }));
}

function buildSingleProvider(config: ButterclawConfig): Provider {
  switch (config.provider) {
    case "mock":
      return new MockProvider(config.model);
    case "ollama":
      return new OllamaProvider(config.model, config.baseUrl ?? "http://localhost:11434", config.requestTimeoutSeconds);
    case "openai-compatible":
      return new OpenAICompatibleProvider(
        config.model,
        config.baseUrl ?? "https://openrouter.ai/api/v1",
        process.env[config.apiKeyEnv] ?? "",
        config.requestTimeoutSeconds
      );
    default:
      throw new ProviderError(`Unknown provider: ${config.provider}`);
  }
}

class FallbackProvider implements Provider {
  constructor(private readonly candidates: Array<{ label: string; provider: Provider }>) {}

  async complete(messages: Message[]): Promise<ProviderResponse> {
    const errors: string[] = [];
    for (const [index, candidate] of this.candidates.entries()) {
      try {
        const response = await candidate.provider.complete(messages);
        return index === 0
          ? response
          : {
              ...response,
              raw: { ...(typeof response.raw === "object" && response.raw ? response.raw : {}), fallbackUsed: candidate.label, fallbackErrors: errors }
            };
      } catch (error) {
        errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new ProviderError(`All model candidates failed:\n${errors.join("\n")}`);
  }
}

function fallbackConfig(base: ButterclawConfig, spec: string): ButterclawConfig {
  const [prefix, ...rest] = spec.split("/");
  const maybeProvider = prefix as ButterclawConfig["provider"];
  if (["mock", "ollama", "openai-compatible"].includes(maybeProvider) && rest.length) {
    return { ...base, provider: maybeProvider, model: rest.join("/") };
  }
  return { ...base, model: spec };
}

export class MockProvider implements Provider {
  constructor(private readonly model = "mock-local") {}

  async complete(messages: Message[]): Promise<ProviderResponse> {
    if (this.model.includes("fail")) {
      throw new ProviderError(`Mock provider forced failure for ${this.model}`);
    }
    const lastMessage = messages[messages.length - 1]?.content ?? "";
    const last = lastMessage.toLowerCase();
    const systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
    const canDelegate = systemPrompt.includes("- delegate_task:");
    if (last.includes("tool result for")) {
      return { content: mockToolResultAnswer(lastMessage) };
    }
    const requestedAgent = last.match(/\bask\s+([a-z0-9_.-]+)\b/);
    if (canDelegate && requestedAgent && last.includes("list")) {
      return {
        content: JSON.stringify({
          tool: "delegate_task",
          args: {
            role: requestedAgent[1],
            task: "list the files in this workspace"
          }
        })
      };
    }
    if (canDelegate && (last.includes("delegate") || last.includes("sub-agent") || last.includes("sub agent")) && last.includes("list")) {
      return { content: '{"tool":"delegate_task","args":{"role":"scout","task":"list the files in this workspace"}}' };
    }
    if (last.includes("list") && (last.includes("file") || last.includes("workspace"))) {
      return { content: '{"tool":"list_dir","args":{"path":"."}}' };
    }
    if (last.includes("read") && last.includes("readme")) {
      return { content: '{"tool":"read_file","args":{"path":"README.md"}}' };
    }
    return {
      content:
        "Butterclaw mock provider is running. Switch to --provider ollama or --provider openai-compatible for model-backed reasoning."
    };
  }
}

export class OpenAICompatibleProvider implements Provider {
  constructor(
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutSeconds: number
  ) {}

  async complete(messages: Message[]): Promise<ProviderResponse> {
    if (!this.apiKey) {
      throw new ProviderError("Missing provider API key. Set the environment variable named in apiKeyEnv.");
    }
    const raw = await postJson(
      `${trimTrailingSlash(this.baseUrl)}/chat/completions`,
      { model: this.model, messages, temperature: 0.2 },
      this.timeoutSeconds,
      {
        Authorization: `Bearer ${this.apiKey}`,
        ...optionalHeader("HTTP-Referer", process.env.BUTTERCLAW_SITE_URL),
        ...optionalHeader("X-Title", process.env.BUTTERCLAW_APP_NAME ?? "Butterclaw")
      }
    );
    const content = String(raw?.choices?.[0]?.message?.content ?? "");
    const usage = raw?.usage ?? {};
    return {
      content,
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      raw
    };
  }
}

export class OllamaProvider implements Provider {
  constructor(
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutSeconds: number
  ) {}

  async complete(messages: Message[]): Promise<ProviderResponse> {
    const raw = await postJson(
      `${trimTrailingSlash(this.baseUrl)}/api/chat`,
      { model: this.model, messages, stream: false, options: { temperature: 0.2 } },
      this.timeoutSeconds,
      {}
    );
    return { content: String(raw?.message?.content ?? ""), raw };
  }
}

function mockToolResultAnswer(message: string): string {
  const result = message.match(/^Tool result for [^\n:]+:\r?\n(?:OK|ERROR): ([\s\S]*?)\r?\n\r?\nContinue\./i);
  const output = result?.[1]?.trim();
  const intro = "I checked the workspace and finished the requested step.";
  return output ? `${intro}\n\n${output}` : intro;
}

function optionalHeader(name: string, value: string | undefined): Record<string, string> {
  return value ? { [name]: value } : {};
}

async function postJson(
  url: string,
  payload: unknown,
  timeoutSeconds: number,
  headers: Record<string, string>
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutSeconds * 1000)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ProviderError(
        `Provider request timed out after ${timeoutSeconds}s. Try --request-timeout-seconds 180, a smaller task, or a faster model.`
      );
    }
    throw new ProviderError(`Provider request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderError(`Provider HTTP ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`Provider returned non-JSON response: ${text.slice(0, 500)}`);
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

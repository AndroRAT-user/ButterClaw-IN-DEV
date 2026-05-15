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
  switch (config.provider) {
    case "mock":
      return new MockProvider();
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

export class MockProvider implements Provider {
  async complete(messages: Message[]): Promise<ProviderResponse> {
    const last = messages[messages.length - 1]?.content.toLowerCase() ?? "";
    if (last.includes("tool result for")) {
      return { content: "I checked the workspace and finished the requested step." };
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

function optionalHeader(name: string, value: string | undefined): Record<string, string> {
  return value ? { [name]: value } : {};
}

async function postJson(
  url: string,
  payload: unknown,
  timeoutSeconds: number,
  headers: Record<string, string>
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutSeconds * 1000)
  });
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

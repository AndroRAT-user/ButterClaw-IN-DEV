import path from "node:path";
import { ButterclawConfig } from "./config.js";
import { estimateTokens, Message, ProviderResponse } from "./providers.js";
import { ensureParent, readJsonFile, writeJsonFile } from "./util.js";

export interface UsageSnapshot {
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export class UsageTracker {
  constructor(private readonly usagePath: string) {
    ensureParent(this.usagePath);
  }

  static fromConfig(config: ButterclawConfig): UsageTracker {
    const today = new Date().toISOString().slice(0, 10);
    return new UsageTracker(path.join(config.configDir, `usage-${today}.json`));
  }

  estimateMessages(messages: Message[]): number {
    return estimateTokens(messages.map((message) => message.content).join("\n"));
  }

  record(response: ProviderResponse): UsageSnapshot {
    const current = this.current();
    const next = {
      requests: current.requests + 1,
      promptTokens: current.promptTokens + (response.promptTokens ?? 0),
      completionTokens: current.completionTokens + (response.completionTokens ?? estimateTokens(response.content))
    };
    writeJsonFile(this.usagePath, next);
    return next;
  }

  current(): UsageSnapshot {
    return { requests: 0, promptTokens: 0, completionTokens: 0, ...readJsonFile<Partial<UsageSnapshot>>(this.usagePath, {}) };
  }
}

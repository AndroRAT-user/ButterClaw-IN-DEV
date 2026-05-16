import { ChannelDmPolicy, ChannelGroupPolicy } from "../config.js";

export type ChannelChatType = "direct" | "group";

export interface ChannelAccessInput {
  chatType: ChannelChatType;
  from: string;
  conversationId?: string;
  text?: string;
  mentioned?: boolean;
  dmPolicy: ChannelDmPolicy;
  groupPolicy: ChannelGroupPolicy;
  allowFrom: string[];
  groupAllowFrom: string[];
  requireMentionInGroups?: boolean;
  mentionPatterns?: string[];
}

export interface ChannelAccessDecision {
  ok: boolean;
  reason: string;
}

export function decideChannelAccess(input: ChannelAccessInput): ChannelAccessDecision {
  const from = normalizePeer(input.from);
  const conversationId = normalizePeer(input.conversationId ?? input.from);
  if (!from) {
    return { ok: false, reason: "missing sender" };
  }

  if (input.chatType === "direct") {
    return decideDirectAccess(input.dmPolicy, from, normalizeList(input.allowFrom));
  }

  const groupDecision = decideGroupAccess(input.groupPolicy, conversationId, from, normalizeList(input.groupAllowFrom), normalizeList(input.allowFrom));
  if (!groupDecision.ok) {
    return groupDecision;
  }
  if (input.requireMentionInGroups !== false && !messageMentionsAgent(input.text ?? "", input.mentioned, input.mentionPatterns ?? [])) {
    return { ok: false, reason: "group message did not mention Butterclaw" };
  }
  return { ok: true, reason: "allowed group" };
}

export function chunkChannelText(text: string, maxChars: number, mode: "length" | "newline" = "length"): string[] {
  const limit = Math.max(100, Math.trunc(maxChars));
  const value = text || "(empty response)";
  if (mode === "newline") {
    return value
      .split(/\r?\n/)
      .flatMap((line) => splitByLength(line || " ", limit))
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return splitByLength(value, limit);
}

export function channelSessionName(channel: string, chatType: ChannelChatType, peer: string): string {
  return `${channel}-${chatType}-${normalizePeer(peer).replace(/[^a-zA-Z0-9_.-]+/g, "-") || "unknown"}`.toLowerCase();
}

export function normalizePeer(value: string): string {
  return String(value ?? "").trim();
}

function decideDirectAccess(policy: ChannelDmPolicy, from: string, allowFrom: string[]): ChannelAccessDecision {
  if (policy === "disabled") {
    return { ok: false, reason: "direct messages disabled" };
  }
  if (allowFrom.includes(from) || allowFrom.includes("*")) {
    return { ok: true, reason: "allowed direct" };
  }
  if (policy === "open") {
    return allowFrom.includes("*")
      ? { ok: true, reason: "open direct" }
      : { ok: false, reason: 'dmPolicy "open" requires allowFrom to include "*"' };
  }
  if (policy === "allowlist") {
    return { ok: false, reason: "sender not in direct allowlist" };
  }
  return { ok: false, reason: "pairing required for unknown sender" };
}

function decideGroupAccess(
  policy: ChannelGroupPolicy,
  conversationId: string,
  from: string,
  groupAllowFrom: string[],
  directAllowFrom: string[]
): ChannelAccessDecision {
  if (policy === "disabled") {
    return { ok: false, reason: "group messages disabled" };
  }
  const allowed =
    groupAllowFrom.includes("*") ||
    groupAllowFrom.includes(conversationId) ||
    groupAllowFrom.includes(from) ||
    directAllowFrom.includes("*") ||
    directAllowFrom.includes(from);
  if (policy === "allowlist" && !allowed) {
    return { ok: false, reason: "group sender not in allowlist" };
  }
  return { ok: true, reason: policy === "open" ? "open group" : "allowlisted group" };
}

function messageMentionsAgent(text: string, mentioned: boolean | undefined, patterns: string[]): boolean {
  if (mentioned) {
    return true;
  }
  const value = text.toLowerCase();
  return normalizeList(patterns).some((pattern) => {
    const needle = pattern.toLowerCase();
    return needle && value.includes(needle);
  });
}

function normalizeList(values: string[]): string[] {
  return values.map(normalizePeer).filter(Boolean);
}

function splitByLength(text: string, limit: number): string[] {
  let remaining = text;
  const chunks: string[] = [];
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit / 2) {
      splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining.trim());
  }
  return chunks.length ? chunks : ["(empty response)"];
}

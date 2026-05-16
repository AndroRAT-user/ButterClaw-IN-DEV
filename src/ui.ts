const colorEnabled = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);

type Tone = "accent" | "success" | "warning" | "muted" | "button";

const tones: Record<Tone, string> = {
  accent: "1;36",
  success: "1;32",
  warning: "1;33",
  muted: "2",
  button: "1;30;46"
};

export function paint(tone: Tone, text: string): string {
  return colorEnabled ? `\x1b[${tones[tone]}m${text}\x1b[0m` : text;
}

export function button(label: string): string {
  return paint("button", `[ ${label} ]`);
}

export function successLine(text: string): string {
  return `${paint("success", "[ OK ]")} ${text}`;
}

export function warningLine(text: string): string {
  return `${paint("warning", "[WARN]")} ${text}`;
}

export function statusPill(ok: boolean): string {
  return ok ? paint("success", "[ OK ]") : paint("warning", "[WARN]");
}

export function panel(title: string, lines: string[]): string {
  const content = lines.length ? lines : [""];
  const maxWidth = Math.max(34, Math.min(120, (process.stdout.columns || 100) - 2));
  const width = Math.min(maxWidth, Math.max(34, title.length + 4, ...content.map((line) => visibleLength(line) + 2)));
  const top = `+${"-".repeat(width)}+`;
  const titleLine = `| ${paint("accent", title).padEnd(width + (paint("accent", title).length - title.length) - 1)}|`;
  const body = content.map((line) => {
    const fitted = fitVisible(line, width - 1);
    return `| ${fitted}${" ".repeat(Math.max(0, width - visibleLength(fitted) - 1))}|`;
  });
  return [top, titleLine, top, ...body, top].join("\n");
}

export function commandRow(commands: string[]): string {
  return commands.map((command) => button(command)).join("  ");
}

export function labelValue(label: string, value: string): string {
  return `${paint("muted", label.padEnd(16))} ${value}`;
}

export function renderCollection(title: string, rows: string[], empty: string): string {
  if (!rows.length) {
    return panel(title, [paint("muted", empty)]);
  }
  return panel(title, rows);
}

export function renderHelp(version: string): string {
  return panel("Butterclaw CLI", [
    `${paint("accent", version)}  lightweight local-first agent runtime`,
    "",
    commandRow(["setup", "doctor", "backup", "agent"]),
    commandRow(["team", "skill", "session", "google"]),
    commandRow(["github", "whatsapp"]),
    "",
    "Usage:",
    "  butterclaw [options] [task...]",
    "",
    "Options:",
    "  --setup                         Run first-time setup",
    "  --init-config                   Write a starter config",
    "  --show-tools                    Print available tools",
    "  --version                       Print version",
    "  --agent <name>                  Run as a saved agent profile",
    "  --session <name>                Resume and save a named session",
    "  --provider <mock|ollama|openai-compatible>",
    "  --model <model>",
    "  --base-url <url>",
    "  --api-key-env <name>",
    "  --workspace <path>",
    "  --max-steps <number>",
    "  --max-context-chars <number>",
    "  --request-timeout-seconds <number>",
    "  --session-max-turns <number>",
    "  --tool-profile <minimal|coding|google|full>",
    "  --allow-tool <name|group>",
    "  --deny-tool <name|group>",
    "  --allow-shell",
    "  --allow-outside-workspace",
    "  --telegram-poll",
    "  --telegram-once",
    "  --telegram-token-env <name>",
    "  --telegram-base-url <url>",
    "  --telegram-allowed-chat <id>",
    "  --telegram-timeout <seconds>",
    "  --telegram-idle-sleep <seconds>",
    "  --google-client-id-env <name>",
    "  --google-client-secret-env <name>",
    "  --google-calendar-id <id>",
    "  --github-default-repo <owner/repo>",
    "  --github-cli-path <path>",
    "  --whatsapp-mode <bridge|cloud>",
    "  --whatsapp-allowed-chat <id>",
    "  --whatsapp-group-allowed-chat <id>",
    "  --whatsapp-dm-policy <pairing|allowlist|open|disabled>",
    "  --whatsapp-group-policy <allowlist|open|disabled>",
    "  --whatsapp-default-to <id>",
    "  --whatsapp-webhook",
    "  --whatsapp-webhook-port <number>",
    "",
    "Commands:",
    "  butterclaw agent list",
    "  butterclaw agent create <name> --description <text> --instructions <text>",
    "  butterclaw agent run <name> <task...>",
    "  butterclaw team list",
    "  butterclaw team create <name> --agents <agent1,agent2>",
    "  butterclaw team run <name> <task...>",
    "  butterclaw skill list",
    "  butterclaw skill create <name> --description <text> --body <text>",
    "  butterclaw session list",
    "  butterclaw session show <name>",
    "  butterclaw session prune <name> [maxTurns]",
    "  butterclaw doctor",
    "  butterclaw backup create [path]",
    "  butterclaw google login",
    "  butterclaw google status",
    "  butterclaw google logout",
    "  butterclaw github status",
    "  butterclaw github prs [owner/repo]",
    "  butterclaw whatsapp status",
    "  butterclaw whatsapp send <to> <text...>",
    "  butterclaw whatsapp webhook",
    "",
    "Local slash commands:",
    "  /status  /tools  /tool-policy  /new  /doctor  /backup  /github  /whatsapp"
  ]);
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function fitVisible(text: string, maxVisible: number): string {
  if (visibleLength(text) <= maxVisible) {
    return text;
  }
  const marker = "...";
  const limit = Math.max(0, maxVisible - marker.length);
  let visible = 0;
  let output = "";
  for (let index = 0; index < text.length && visible < limit; index += 1) {
    if (text[index] === "\x1b") {
      const end = text.indexOf("m", index);
      if (end >= 0) {
        output += text.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    output += text[index];
    visible += 1;
  }
  return `${output}${marker}`;
}

/**
 * Pure shell-command classifier for common run-owned work hazards.
 *
 * This module deliberately has no Pi runtime dependencies so the policy can
 * be exercised with ordinary unit tests before tool-call guard integration.
 */

export type SentinelAction = "allow" | "warn" | "block";

export type SentinelReasonCode =
  | "background_operator"
  | "detached_process"
  | "watch_or_poll_loop"
  | "ci_watch_without_deliverable"
  | "service_handoff_candidate"
  | "registered_service_handoff"
  | "safe_foreground";

export interface ShellCommandDecision {
  action: SentinelAction;
  reasonCode: SentinelReasonCode;
  message: string;
  evidence: string[];
}

interface CommandInfo {
  executable: string;
  args: string[];
}

const MESSAGES: Record<SentinelReasonCode, string> = {
  background_operator:
    "This backgrounds work. Run it in the foreground and collect its result before ending the run.",
  detached_process:
    "This detaches work from the run. Keep it in the foreground and wait for its result before ending the run.",
  watch_or_poll_loop:
    "This starts a watch or polling loop. Prefer one bounded foreground check and collect its result.",
  ci_watch_without_deliverable:
    "This starts a CI watcher. Use one bounded foreground check only when its result is required; do not leave a watcher running.",
  service_handoff_candidate:
    "This looks like a local server. Keep it foreground unless a persistent service was requested and its handoff is recorded.",
  registered_service_handoff:
    "This service has an explicit handoff.",
  safe_foreground: "No run-owned background or polling hazard was detected.",
};

/** Replace quoted literals and shell comments while retaining token spacing. */
function maskQuotedContent(command: string): string {
  const chars = command.split("");
  let quote: "'" | '"' | null = null;
  let inComment = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = command[index];

    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
      } else {
        chars[index] = " ";
        continue;
      }
    }

    if (quote !== null) {
      chars[index] = " ";
      if (char === quote && (quote === "'" || !isEscaped(command, index))) {
        quote = null;
      }
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(command[index - 1]))) {
      chars[index] = " ";
      inComment = true;
      continue;
    }

    if (char === "'" || char === '"') {
      chars[index] = " ";
      quote = char;
    }
  }

  return chars.join("");
}

function isEscaped(command: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && command[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function splitCommandSegments(command: string): string[] {
  return command.split(/(?:&&|\|\||[;&|\r\n])+/).filter((part) => part.trim() !== "");
}

function commandInfo(segment: string): CommandInfo | undefined {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
      index += 1;
      continue;
    }

    const wrapper = token.toLowerCase();
    if (["sudo", "command", "exec", "time", "nice"].includes(wrapper)) {
      index += 1;
      continue;
    }
    if (wrapper === "env") {
      index += 1;
      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
        index += 1;
      }
      continue;
    }
    break;
  }

  if (index >= tokens.length) return undefined;

  const executable = tokens[index]
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(?:exe|cmd|bat)$/i, "")
    .toLowerCase();

  return { executable, args: tokens.slice(index + 1) };
}

function hasBackgroundOperator(command: string): boolean {
  for (let index = 0; index < command.length; index += 1) {
    if (command[index] !== "&" || isEscaped(command, index)) continue;

    const previous = command[index - 1] ?? "";
    const next = command[index + 1] ?? "";
    if (previous === "&" || next === "&" || previous === ">" || next === ">") continue;

    const segmentStart = Math.max(
      command.lastIndexOf(";", index - 1),
      command.lastIndexOf("|", index - 1),
      command.lastIndexOf("\n", index - 1),
      command.lastIndexOf("\r", index - 1),
    );
    const beforeOperator = command.slice(segmentStart + 1, index).trim();

    // A leading PowerShell `& command` is the call operator, not backgrounding.
    if (beforeOperator.length === 0 || beforeOperator.endsWith(">")) continue;
    return true;
  }

  return false;
}

function detachedProcessEvidence(command: string): string | undefined {
  for (const segment of splitCommandSegments(command)) {
    const info = commandInfo(segment);
    if (!info) continue;

    if (info.executable === "nohup") return "nohup";
    if (info.executable === "disown") return "disown";
    if (["setsid", "daemonize", "start-job"].includes(info.executable)) {
      return info.executable;
    }
    if (info.executable === "start-process" && !info.args.some((arg) => /^-wait$/i.test(arg))) {
      return "Start-Process";
    }
    if (info.executable === "start" && info.args.some((arg) => /^\/b$/i.test(arg))) {
      return "start /b";
    }
    if (info.executable === "cmd" && /\bstart\s+\/b\b/i.test(segment)) {
      return "start /b";
    }
  }

  return undefined;
}

function hasCiWatcher(command: string): boolean {
  for (const segment of splitCommandSegments(command)) {
    const info = commandInfo(segment);
    if (!info || info.executable !== "gh") continue;

    const args = info.args.map((arg) => arg.toLowerCase());
    const checksWatcher = args.some(
      (arg) => arg === "--watch" || arg === "--watch=true" || arg === "-w",
    );
    if (args.some((arg, index) => arg === "pr" && args[index + 1] === "checks") && checksWatcher) {
      return true;
    }
    if (args.some((arg, index) => arg === "run" && args[index + 1] === "watch")) {
      return true;
    }
  }

  return false;
}

function hasSleepLoop(command: string): boolean {
  const shellLoop =
    /\b(?:while|until|for)\b[\s\S]{0,500}\bdo\b[\s\S]{0,500}\b(?:sleep|start-sleep)\b[\s\S]{0,500}\bdone\b/i;
  const powershellLoop =
    /\b(?:while|for|foreach)\s*\([^)]*\)\s*\{[\s\S]{0,500}\b(?:sleep|start-sleep)\b[\s\S]{0,500}\}/i;

  return shellLoop.test(command) || powershellLoop.test(command);
}

function devScriptEvidence(info: CommandInfo): string | undefined {
  if (["npm", "pnpm", "yarn", "bun"].includes(info.executable)) {
    if (info.args[0]?.toLowerCase() === "dev") return `${info.executable} dev`;
    const runIndex = info.args.findIndex((arg) => arg.toLowerCase() === "run");
    if (runIndex >= 0 && info.args[runIndex + 1]?.toLowerCase() === "dev") {
      return `${info.executable} run dev`;
    }
  }
  return undefined;
}

function serviceCandidateEvidence(command: string): string | undefined {
  for (const segment of splitCommandSegments(command)) {
    const info = commandInfo(segment);
    if (!info) continue;

    const scriptEvidence = devScriptEvidence(info);
    if (scriptEvidence) return scriptEvidence;
    if (info.executable === "vite") return "vite";
    if (info.executable === "next" && info.args[0]?.toLowerCase() === "dev") return "next dev";
    if (
      /^python(?:\d+(?:\.\d+)*)?$/.test(info.executable) &&
      info.args[0]?.toLowerCase() === "-m" &&
      info.args[1]?.toLowerCase() === "http.server"
    ) {
      return "python -m http.server";
    }
    if (["http-server", "uvicorn"].includes(info.executable)) return info.executable;
    if (info.executable === "flask" && info.args[0]?.toLowerCase() === "run") {
      return "flask run";
    }
    if (info.executable === "astro" && info.args[0]?.toLowerCase() === "dev") {
      return "astro dev";
    }
    if (info.executable === "webpack" && info.args[0]?.toLowerCase() === "serve") {
      return "webpack serve";
    }
    if (info.executable === "php" && info.args[0]?.toLowerCase() === "-s") {
      return "php -S";
    }

    if (info.executable === "npx") {
      const args = info.args.map((arg) => arg.toLowerCase());
      if (args[0] === "vite") return "npx vite";
      if (args[0] === "next" && args[1] === "dev") return "npx next dev";
      if (args[0] === "http-server") return "npx http-server";
    }
  }

  return undefined;
}

function shellCommandSegments(command: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const finishToken = () => {
    if (tokenStarted) tokens.push(token);
    token = "";
    tokenStarted = false;
  };
  const finishSegment = () => {
    finishToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (escaped) {
      token += char;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (quote === '"' && char === "\\" && /["\\$`]/.test(command[index + 1] ?? "")) {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      else {
        token += char;
        tokenStarted = true;
      }
      continue;
    }

    if (char === "\\" && /[\s;&|\r\n'"#\\]/.test(command[index + 1] ?? "")) {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(command[index - 1]))) {
      finishSegment();
      while (index < command.length && command[index] !== "\n" && command[index] !== "\r") index += 1;
      continue;
    }

    if (/[;&|\r\n]/.test(char)) {
      finishSegment();
      if ((char === "&" || char === "|") && command[index + 1] === char) index += 1;
    } else if (/\s/.test(char)) {
      finishToken();
    } else {
      token += char;
      tokenStarted = true;
    }
  }

  if (escaped) token += "\\";
  finishSegment();
  return segments;
}

function nestedShellPayload(tokens: string[]): string | undefined {
  let index = 0;

  while (index < tokens.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
      index += 1;
      continue;
    }
    const wrapper = tokens[index].toLowerCase();
    if (["sudo", "command", "exec", "time", "nice"].includes(wrapper)) {
      index += 1;
      continue;
    }
    if (wrapper === "env") {
      index += 1;
      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
        index += 1;
      }
      continue;
    }
    break;
  }

  if (index >= tokens.length) return undefined;

  const executable = tokens[index]
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(?:exe|cmd|bat)$/i, "")
    .toLowerCase();
  const args = tokens.slice(index + 1);
  let commandFlag = -1;

  if (["bash", "sh", "dash", "zsh", "ksh"].includes(executable)) {
    commandFlag = args.findIndex((arg) =>
      arg === "-c" || arg === "--command" || /^-[^-]*c[^-]*$/.test(arg),
    );
  } else if (["powershell", "pwsh"].includes(executable)) {
    commandFlag = args.findIndex((arg) => /^[-/]command$/i.test(arg) || /^[-/]c$/i.test(arg));
  } else if (executable === "cmd") {
    commandFlag = args.findIndex((arg) => /^\/c$/i.test(arg));
  }

  if (commandFlag < 0) return undefined;
  const commandArgs = args.slice(commandFlag + 1);
  const payload = ["cmd", "powershell", "pwsh"].includes(executable)
    ? commandArgs.join(" ")
    : commandArgs[0];
  return payload?.trim() ? payload : undefined;
}

function decision(
  action: SentinelAction,
  reasonCode: SentinelReasonCode,
  evidence: string[] = [],
): ShellCommandDecision {
  return { action, reasonCode, message: MESSAGES[reasonCode], evidence };
}

function classifyShellCommandDirect(command: string): ShellCommandDecision {
  const searchableCommand = maskQuotedContent(command);

  if (hasBackgroundOperator(searchableCommand)) {
    return decision("block", "background_operator", ["&"]);
  }

  const detachedEvidence = detachedProcessEvidence(searchableCommand);
  if (detachedEvidence) {
    return decision("block", "detached_process", [detachedEvidence]);
  }

  if (hasCiWatcher(searchableCommand)) {
    const evidence = /\bgh\s+run\s+watch\b/i.test(searchableCommand)
      ? "gh run watch"
      : "gh pr checks --watch";
    return decision("block", "ci_watch_without_deliverable", [evidence]);
  }

  if (
    splitCommandSegments(searchableCommand).some((segment) => commandInfo(segment)?.executable === "watch") ||
    hasSleepLoop(searchableCommand)
  ) {
    const evidence = hasSleepLoop(searchableCommand) ? "loop + sleep" : "watch";
    return decision("block", "watch_or_poll_loop", [evidence]);
  }

  const serviceEvidence = serviceCandidateEvidence(searchableCommand);
  if (serviceEvidence) {
    return decision("warn", "service_handoff_candidate", [serviceEvidence]);
  }

  return decision("allow", "safe_foreground");
}

function classifyShellCommandAtDepth(command: string, depth: number): ShellCommandDecision {
  let result = classifyShellCommandDirect(command);
  if (depth >= 8) return result;

  for (const tokens of shellCommandSegments(command)) {
    const payload = nestedShellPayload(tokens);
    if (!payload) continue;

    const nestedResult = classifyShellCommandAtDepth(payload, depth + 1);
    const nestedSeverity = nestedResult.action === "block" ? 2 : nestedResult.action === "warn" ? 1 : 0;
    const currentSeverity = result.action === "block" ? 2 : result.action === "warn" ? 1 : 0;
    if (nestedSeverity > currentSeverity) result = nestedResult;
  }

  return result;
}

/** Classify a command string without launching or otherwise inspecting it. */
export function classifyShellCommand(command: string): ShellCommandDecision {
  return classifyShellCommandAtDepth(command, 0);
}

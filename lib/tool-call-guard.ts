/**
 * Pi tool_call adapter for shell command classification.
 */

import {
  isToolCallEventType,
  type ExtensionContext,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { classifyShellCommand } from "./classifier.ts";
import type { RunSentinelLedger } from "./ledger.ts";

function shellCommandFromEvent(event: ToolCallEvent): string | undefined {
  const shellEvent = isToolCallEventType("bash", event)
    ? event
    : isToolCallEventType("powershell", event)
      ? event
      : undefined;
  if (!shellEvent || typeof shellEvent.input !== "object" || shellEvent.input === null) {
    return undefined;
  }

  const command: unknown = shellEvent.input.command;
  return typeof command === "string" ? command : undefined;
}

/** Create the pre-execution guard handler for Pi's built-in shell tools. */
export function createToolCallGuard(
  ledger: RunSentinelLedger,
  now: () => Date = () => new Date(),
): (event: ToolCallEvent, ctx: ExtensionContext) => ToolCallEventResult | undefined {
  return (event, ctx) => {
    if (ledger.guardMode === "off") return undefined;

    const command = shellCommandFromEvent(event);
    if (command === undefined) return undefined;

    const result = classifyShellCommand(command);
    const at = now().toISOString();
    const evidence = [...result.evidence];
    const decisionLabel = result.action === "block" && ledger.guardMode === "monitor"
      ? "would block"
      : result.action;
    ledger.recentDecisions.push({
      id: `guard-${ledger.recentDecisions.length + 1}`,
      at,
      summary: `${decisionLabel}: ${result.reasonCode}${evidence.length > 0 ? ` (${evidence.join(", ")})` : ""}`,
      action: result.action,
      reasonCode: result.reasonCode,
      evidence,
    });

    if (result.action === "block" && ledger.guardMode === "enforce") {
      return { block: true, reason: result.message };
    }

    if (result.action === "warn" && ctx.hasUI) {
      ctx.ui.notify(`Run Sentinel warning: ${result.message}`, "warning");
    }

    return undefined;
  };
}

/**
 * pi-run-sentinel Pi extension
 *
 * Registers `/run-sentinel:status` and classifies built-in shell tool calls
 * before Pi executes them.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createLedger } from "../lib/ledger.ts";
import { RUN_OWNED_WORK_SAFETY_PROMPT } from "../lib/prompt.ts";
import { registerServiceHandoff } from "../lib/service-handoff.ts";
import { formatStatus, formatStatusWidget, snapshotStatus } from "../lib/status.ts";
import { createToolCallGuard } from "../lib/tool-call-guard.ts";
import type { RunSentinelLedger } from "../lib/ledger.ts";

/**
 * Register Run Sentinel commands with the Pi extension API.
 */
export default function (
  pi: ExtensionAPI,
  ledger: RunSentinelLedger = createLedger(),
) {
  const guard = createToolCallGuard(ledger);
  const updateStatusWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("run-sentinel-status", formatStatusWidget(snapshotStatus(ledger)), {
      placement: "belowEditor",
    });
  };

  pi.on("tool_call", (event, ctx) => {
    const decisionCount = ledger.recentDecisions.length;
    const result = guard(event, ctx);
    if (ledger.recentDecisions.length !== decisionCount) updateStatusWidget(ctx);
    return result;
  });
  pi.on("before_agent_start", (event, ctx) => {
    updateStatusWidget(ctx);
    return {
      systemPrompt: `${event.systemPrompt}\n\n${RUN_OWNED_WORK_SAFETY_PROMPT}`,
    };
  });

  pi.registerTool({
    name: "run_sentinel_register_service",
    label: "Register service handoff",
    description:
      "Record a user-requested persistent service handoff. This does not start or supervise a process; service survival is best-effort and is not guaranteed. Do not use for tests, builds, CI polling, or watchers.",
    promptSnippet: "Record a handoff for a user-requested persistent service",
    promptGuidelines: [
      "Register only services the user explicitly asked to keep running after this turn.",
      "Do not register tests, builds, CI polling, watchers, or other run-owned work as services.",
      "Service survival is best-effort and is not guaranteed.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "A short name for the service." }),
      command: Type.String({ description: "The command running the service." }),
      logPath: Type.String({ description: "Path to the durable service log." }),
      stopInstruction: Type.String({ description: "Concrete instruction to stop the service." }),
      readinessEvidence: Type.String({ description: "How readiness was verified." }),
      survival: Type.Literal("best_effort", {
        description: "Required acknowledgment: survival is best-effort and is not guaranteed.",
      }),
      pid: Type.Optional(Type.Number({ minimum: 1, multipleOf: 1, description: "Optional process ID." })),
      url: Type.Optional(Type.String({ description: "Optional absolute HTTP(S) service URL." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const service = registerServiceHandoff(ledger, params);
      updateStatusWidget(ctx);
      return {
        content: [{
          type: "text",
          text: `Registered ${service.name}. Log: ${service.logPath}. Stop: ${service.stopInstruction}. Survival is best-effort; the process is not guaranteed to stay running.`,
        }],
        details: service,
      };
    },
  });

  pi.registerCommand("run-sentinel:status", {
    description: "Show Run Sentinel guard mode, recent block/warn counts, and service handoffs",
    handler: async (_args, ctx) => {
      const statusText = formatStatus(snapshotStatus(ledger));
      updateStatusWidget(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(statusText, "info");
        return;
      }

      console.log(statusText);
    },
  });
}

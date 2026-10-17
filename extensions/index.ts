/**
 * pi-run-sentinel Pi extension
 *
 * Registers `/run-sentinel:status` and classifies built-in shell tool calls
 * before Pi executes them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLedger } from "../lib/ledger.ts";
import { formatStatus, snapshotStatus } from "../lib/status.ts";
import { createToolCallGuard } from "../lib/tool-call-guard.ts";

const ledger = createLedger();

/**
 * Register Run Sentinel commands with the Pi extension API.
 */
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", createToolCallGuard(ledger));

  pi.registerCommand("run-sentinel:status", {
    description: "Show Run Sentinel guard mode and recent decisions",
    handler: async (_args, ctx) => {
      const statusText = formatStatus(snapshotStatus(ledger));

      if (ctx.hasUI) {
        ctx.ui.notify(statusText, "info");
        return;
      }

      console.log(statusText);
    },
  });
}

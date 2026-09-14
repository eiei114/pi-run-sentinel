/**
 * pi-run-sentinel Pi extension
 *
 * Registers `/run-sentinel:status` so Pi users can inspect the in-memory ledger
 * before classifier and guard integration land in later slices.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLedger, formatStatus, snapshotStatus } from "../lib/ledger.ts";

const ledger = createLedger();

/**
 * Register Run Sentinel commands with the Pi extension API.
 */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("run-sentinel:status", {
    description: "Show Run Sentinel guard mode and ledger counts",
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

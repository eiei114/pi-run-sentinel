/**
 * Status projection and presentation for `/run-sentinel:status`.
 *
 * This module keeps read-only status reporting separate from ledger mutation.
 */

import type { GuardMode, RunSentinelLedger } from "./ledger.ts";

export interface RunSentinelStatusSnapshot {
  policyName: string;
  guardMode: GuardMode;
  recentDecisionsCount: number;
  registeredServicesCount: number;
}

/**
 * Summarize ledger state for `/run-sentinel:status`.
 */
export function snapshotStatus(ledger: RunSentinelLedger): RunSentinelStatusSnapshot {
  return {
    policyName: ledger.policyName,
    guardMode: ledger.guardMode,
    recentDecisionsCount: ledger.recentDecisions.length,
    registeredServicesCount: ledger.registeredServices.length,
  };
}

/**
 * Render a human-readable status block from a ledger snapshot.
 */
export function formatStatus(snapshot: RunSentinelStatusSnapshot): string {
  return [
    "Run Sentinel status",
    `  policy: ${snapshot.policyName}`,
    `  guard mode: ${snapshot.guardMode}`,
    `  recent decisions: ${snapshot.recentDecisionsCount}`,
    `  registered services: ${snapshot.registeredServicesCount}`,
  ].join("\n");
}

/**
 * Run Sentinel in-memory ledger.
 *
 * Pure data structures and helpers — no Pi runtime APIs.
 */

export type GuardMode = "off" | "monitor" | "enforce";

export interface SentinelDecision {
  id: string;
  at: string;
  summary: string;
}

export interface RegisteredService {
  name: string;
  registeredAt: string;
}

export interface RunSentinelLedger {
  policyName: string;
  guardMode: GuardMode;
  recentDecisions: SentinelDecision[];
  registeredServices: RegisteredService[];
}

export interface RunSentinelStatusSnapshot {
  policyName: string;
  guardMode: GuardMode;
  recentDecisionsCount: number;
  registeredServicesCount: number;
}

const DEFAULT_POLICY_NAME = "default";
const DEFAULT_GUARD_MODE: GuardMode = "monitor";

/**
 * Create a fresh in-memory ledger for the walking skeleton.
 */
export function createLedger(
  overrides: Partial<Pick<RunSentinelLedger, "policyName" | "guardMode">> = {},
): RunSentinelLedger {
  return {
    policyName: overrides.policyName ?? DEFAULT_POLICY_NAME,
    guardMode: overrides.guardMode ?? DEFAULT_GUARD_MODE,
    recentDecisions: [],
    registeredServices: [],
  };
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

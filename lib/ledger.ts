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

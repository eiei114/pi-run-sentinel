/**
 * Run Sentinel in-memory ledger.
 *
 * Pure data structures and helpers — no Pi runtime APIs.
 */

import type { SentinelAction, SentinelReasonCode } from "./classifier.ts";

export type GuardMode = "off" | "monitor" | "enforce";

export interface SentinelDecision {
  id: string;
  at: string;
  summary: string;
  action?: SentinelAction;
  reasonCode?: SentinelReasonCode;
  evidence?: string[];
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
const DEFAULT_GUARD_MODE: GuardMode = "enforce";

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

// Preserve existing imports while status reporting lives in its own module.
export { formatStatus, snapshotStatus } from "./status.ts";
export type { RunSentinelStatusSnapshot } from "./status.ts";

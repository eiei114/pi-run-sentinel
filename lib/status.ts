/**
 * Status projection and presentation for `/run-sentinel:status`.
 *
 * This module keeps read-only status reporting separate from ledger mutation.
 */

import type { GuardMode, RegisteredService, RunSentinelLedger, SentinelDecision } from "./ledger.ts";

export interface RunSentinelStatusSnapshot {
  policyName: string;
  guardMode: GuardMode;
  recentDecisionsCount: number;
  recentDecisions: Pick<SentinelDecision, "at" | "summary">[];
  registeredServicesCount: number;
  registeredServices?: RegisteredService[];
}

/**
 * Summarize ledger state for `/run-sentinel:status`.
 */
export function snapshotStatus(ledger: RunSentinelLedger): RunSentinelStatusSnapshot {
  return {
    policyName: ledger.policyName,
    guardMode: ledger.guardMode,
    recentDecisionsCount: ledger.recentDecisions.length,
    recentDecisions: ledger.recentDecisions.slice(-5).map(({ at, summary }) => ({ at, summary })),
    registeredServicesCount: ledger.registeredServices.length,
    registeredServices: ledger.registeredServices.map((service) => ({ ...service })),
  };
}

/**
 * Render a human-readable status block from a ledger snapshot.
 */
export function formatStatus(snapshot: RunSentinelStatusSnapshot): string {
  const registeredServiceHandoffs = snapshot.registeredServices ?? [];
  const recentDecisions = snapshot.recentDecisions.length > 0
    ? snapshot.recentDecisions.map(({ at, summary }) => `    - ${at}: ${summary}`)
    : ["    none"];
  const registeredServices = registeredServiceHandoffs.length > 0
    ? registeredServiceHandoffs.flatMap((service) => [
      `    - ${service.name}`,
      `      command: ${service.command}`,
      ...(service.pid === undefined ? [] : [`      pid: ${service.pid}`]),
      ...(service.url === undefined ? [] : [`      url: ${service.url}`]),
      `      log path: ${service.logPath}`,
      `      stop: ${service.stopInstruction}`,
      `      readiness: ${service.readinessEvidence}`,
      "      survival: best-effort; not guaranteed",
    ])
    : ["    none"];

  return [
    "Run Sentinel status",
    `  policy: ${snapshot.policyName}`,
    `  guard mode: ${snapshot.guardMode}`,
    `  recent decisions: ${snapshot.recentDecisionsCount}`,
    "  last decisions:",
    ...recentDecisions,
    `  registered services: ${snapshot.registeredServicesCount}`,
    "  service handoffs:",
    ...registeredServices,
  ].join("\n");
}

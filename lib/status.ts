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
  recentBlocksCount: number;
  recentWouldBlockCount?: number;
  recentWarningsCount: number;
  recentDecisions: Pick<SentinelDecision, "at" | "summary">[];
  registeredServicesCount: number;
  registeredServices?: RegisteredService[];
}

/**
 * Summarize ledger state for `/run-sentinel:status`.
 */
export function snapshotStatus(ledger: RunSentinelLedger): RunSentinelStatusSnapshot {
  const blockDecisionsCount = ledger.recentDecisions.filter(({ action }) => action === "block").length;

  return {
    policyName: ledger.policyName,
    guardMode: ledger.guardMode,
    recentDecisionsCount: ledger.recentDecisions.length,
    recentBlocksCount: ledger.guardMode === "enforce" ? blockDecisionsCount : 0,
    recentWouldBlockCount: ledger.guardMode === "monitor" ? blockDecisionsCount : 0,
    recentWarningsCount: ledger.recentDecisions.filter(({ action }) => action === "warn").length,
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
    `  recent blocks: ${snapshot.recentBlocksCount}`,
    `  recent would-block decisions: ${snapshot.recentWouldBlockCount ?? 0}`,
    `  recent warnings: ${snapshot.recentWarningsCount}`,
    "  last decisions:",
    ...recentDecisions,
    `  registered services: ${snapshot.registeredServicesCount}`,
    "  service handoffs:",
    ...registeredServices,
  ].join("\n");
}

/** Render a compact widget with decision counts and service names only. */
export function formatStatusWidget(snapshot: RunSentinelStatusSnapshot): string[] {
  const recentWouldBlockCount = snapshot.recentWouldBlockCount ?? 0;
  const hazards = [
    ...(snapshot.recentBlocksCount > 0 ? [`${snapshot.recentBlocksCount} blocked`] : []),
    ...(recentWouldBlockCount > 0 ? [`${recentWouldBlockCount} would block`] : []),
    ...(snapshot.recentWarningsCount > 0 ? [`${snapshot.recentWarningsCount} warned`] : []),
  ];
  const serviceNames = (snapshot.registeredServices ?? []).map(({ name }) => name);

  return [
    `Run Sentinel hazards: ${hazards.length > 0 ? hazards.join(" · ") : "none"}`,
    `Registered services: ${serviceNames.length > 0 ? serviceNames.join(", ") : "none"}`,
  ];
}

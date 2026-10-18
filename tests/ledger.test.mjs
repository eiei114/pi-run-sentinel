import assert from "node:assert/strict";
import test from "node:test";

const ledgerApi = await import("../lib/ledger.ts");
const { createLedger } = ledgerApi;
const { formatStatus, formatStatusWidget, snapshotStatus } = await import("../lib/status.ts");

test("createLedger returns default enforcement state", () => {
  const ledger = createLedger();

  assert.equal(ledger.policyName, "default");
  assert.equal(ledger.guardMode, "enforce");
  assert.deepEqual(ledger.recentDecisions, []);
  assert.deepEqual(ledger.registeredServices, []);
});

test("snapshotStatus exposes guard mode and counts", () => {
  const ledger = createLedger({
    policyName: "strict",
    guardMode: "enforce",
  });
  ledger.recentDecisions.push({
    id: "d1",
    at: "2026-09-15T00:00:00.000Z",
    summary: "allowed shell probe",
  });
  ledger.registeredServices.push({
    name: "classifier",
    command: "npm run dev",
    logPath: "./logs/dev.log",
    stopInstruction: "kill 1234",
    readinessEvidence: "HTTP 200 from http://localhost:3000/health",
    survival: "best_effort",
    registeredAt: "2026-09-15T00:00:00.000Z",
  });

  assert.deepEqual(snapshotStatus(ledger), {
    policyName: "strict",
    guardMode: "enforce",
    recentDecisionsCount: 1,
    recentBlocksCount: 0,
    recentWouldBlockCount: 0,
    recentWarningsCount: 0,
    recentDecisions: [{ at: "2026-09-15T00:00:00.000Z", summary: "allowed shell probe" }],
    registeredServicesCount: 1,
    registeredServices: [{
      name: "classifier",
      command: "npm run dev",
      logPath: "./logs/dev.log",
      stopInstruction: "kill 1234",
      readinessEvidence: "HTTP 200 from http://localhost:3000/health",
      survival: "best_effort",
      registeredAt: "2026-09-15T00:00:00.000Z",
    }],
  });
});

test("snapshotStatus reports monitor-mode block decisions as would-block", () => {
  const ledger = createLedger({ guardMode: "monitor" });
  ledger.recentDecisions.push({
    id: "d1",
    at: "2026-09-15T00:00:00.000Z",
    summary: "would block: background_operator",
    action: "block",
  });

  const snapshot = snapshotStatus(ledger);
  assert.equal(snapshot.recentBlocksCount, 0);
  assert.equal(snapshot.recentWouldBlockCount, 1);
  assert.match(formatStatus(snapshot), /recent would-block decisions: 1/);
  assert.deepEqual(formatStatusWidget(snapshot), [
    "Run Sentinel hazards: 1 would block",
    "Registered services: none",
  ]);
});

test("ledger keeps its existing status exports as compatibility re-exports", () => {
  assert.equal(ledgerApi.formatStatus, formatStatus);
  assert.equal(ledgerApi.snapshotStatus, snapshotStatus);
});

test("snapshotStatus remains independent of later ledger mutations", () => {
  const ledger = createLedger();
  const snapshot = snapshotStatus(ledger);

  ledger.recentDecisions.push({
    id: "d1",
    at: "2026-09-15T00:00:00.000Z",
    summary: "allowed shell probe",
  });

  assert.equal(snapshot.recentDecisionsCount, 0);
  assert.equal(snapshotStatus(ledger).recentDecisionsCount, 1);
});

test("formatStatus renders guard mode and counts", () => {
  const text = formatStatus({
    policyName: "default",
    guardMode: "monitor",
    recentDecisionsCount: 0,
    recentBlocksCount: 0,
    recentWarningsCount: 0,
    recentDecisions: [],
    registeredServicesCount: 0,
    registeredServices: [],
  });

  assert.match(text, /guard mode: monitor/);
  assert.match(text, /recent decisions: 0/);
  assert.match(text, /recent blocks: 0/);
  assert.match(text, /recent warnings: 0/);
  assert.match(text, /last decisions:\n    none/);
  assert.match(text, /registered services: 0/);
  assert.match(text, /service handoffs:\n    none/);
});

test("formatStatusWidget contains only hazard counts and registered service names", () => {
  const lines = formatStatusWidget({
    policyName: "default",
    guardMode: "enforce",
    recentDecisionsCount: 3,
    recentBlocksCount: 2,
    recentWouldBlockCount: 0,
    recentWarningsCount: 1,
    recentDecisions: [],
    registeredServicesCount: 1,
    registeredServices: [{
      name: "docs server",
      command: "npm run dev",
      logPath: "./logs/dev.log",
      stopInstruction: "stop the docs server",
      readinessEvidence: "GET /health returned HTTP 200",
      survival: "best_effort",
      registeredAt: "2026-09-15T00:00:00.000Z",
    }],
  });

  assert.deepEqual(lines, [
    "Run Sentinel hazards: 2 blocked · 1 warned",
    "Registered services: docs server",
  ]);
  assert.doesNotMatch(lines.join("\n"), /npm run dev|\.\/logs\/dev\.log|stop the docs server/);
});

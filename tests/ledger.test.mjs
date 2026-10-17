import assert from "node:assert/strict";
import test from "node:test";

const ledgerApi = await import("../lib/ledger.ts");
const { createLedger } = ledgerApi;
const { formatStatus, snapshotStatus } = await import("../lib/status.ts");

test("createLedger returns default walking-skeleton state", () => {
  const ledger = createLedger();

  assert.equal(ledger.policyName, "default");
  assert.equal(ledger.guardMode, "monitor");
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
    registeredAt: "2026-09-15T00:00:00.000Z",
  });

  assert.deepEqual(snapshotStatus(ledger), {
    policyName: "strict",
    guardMode: "enforce",
    recentDecisionsCount: 1,
    recentDecisions: [{ at: "2026-09-15T00:00:00.000Z", summary: "allowed shell probe" }],
    registeredServicesCount: 1,
  });
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
    recentDecisions: [],
    registeredServicesCount: 0,
  });

  assert.match(text, /guard mode: monitor/);
  assert.match(text, /recent decisions: 0/);
  assert.match(text, /last decisions:\n    none/);
  assert.match(text, /registered services: 0/);
});

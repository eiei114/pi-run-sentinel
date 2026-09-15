import assert from "node:assert/strict";
import test from "node:test";

const { createLedger, formatStatus, snapshotStatus } = await import("../lib/ledger.ts");

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
    registeredServicesCount: 1,
  });
});

test("formatStatus renders guard mode and counts", () => {
  const text = formatStatus({
    policyName: "default",
    guardMode: "monitor",
    recentDecisionsCount: 0,
    registeredServicesCount: 0,
  });

  assert.match(text, /guard mode: monitor/);
  assert.match(text, /recent decisions: 0/);
  assert.match(text, /registered services: 0/);
});

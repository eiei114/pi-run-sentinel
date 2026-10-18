import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ExtensionRunner,
  SessionManager,
  discoverAndLoadExtensions,
} from "@earendil-works/pi-coding-agent";
import { createLedger } from "../lib/ledger.ts";
import { registerServiceHandoff } from "../lib/service-handoff.ts";

const extensionPath = fileURLToPath(new URL("../extensions", import.meta.url));
const validInput = {
  name: "docs server",
  command: "npm run dev",
  pid: 1234,
  url: "http://localhost:3000/",
  logPath: "./logs/dev.log",
  stopInstruction: "kill 1234",
  readinessEvidence: "GET /health returned HTTP 200",
  survival: "best_effort",
};

function loadPiExtension(cwd, agentDir) {
  return discoverAndLoadExtensions([extensionPath], cwd, agentDir).then((loaded) => {
    assert.deepEqual(loaded.errors, []);
    return new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      SessionManager.inMemory(cwd),
      {},
    );
  });
}

test("registerServiceHandoff validates and records a complete service handoff", () => {
  const ledger = createLedger();
  const registeredAt = new Date("2026-10-18T00:00:00.000Z");
  const service = registerServiceHandoff(ledger, {
    ...validInput,
    name: "  docs server  ",
    logPath: "  ./logs/dev.log  ",
  }, () => registeredAt);

  assert.deepEqual(service, {
    name: "docs server",
    command: "npm run dev",
    pid: 1234,
    url: "http://localhost:3000/",
    logPath: "./logs/dev.log",
    stopInstruction: "kill 1234",
    readinessEvidence: "GET /health returned HTTP 200",
    survival: "best_effort",
    registeredAt: registeredAt.toISOString(),
  });
  assert.deepEqual(ledger.registeredServices, [service]);
});

test("registerServiceHandoff rejects a missing log path with actionable guidance", () => {
  const ledger = createLedger();
  const { logPath: _omitted, ...input } = validInput;

  assert.throws(
    () => registerServiceHandoff(ledger, input),
    /log path \(logPath\) is required and must be non-empty text.*Provide it/i,
  );
  assert.deepEqual(ledger.registeredServices, []);
});

test("registerServiceHandoff rejects a missing stop instruction", () => {
  const { stopInstruction: _omitted, ...input } = validInput;

  assert.throws(
    () => registerServiceHandoff(createLedger(), input),
    /stop instruction \(stopInstruction\) is required and must be non-empty text/i,
  );
});

test("registerServiceHandoff rejects missing readiness evidence", () => {
  const { readinessEvidence: _omitted, ...input } = validInput;

  assert.throws(
    () => registerServiceHandoff(createLedger(), input),
    /readiness evidence \(readinessEvidence\) is required and must be non-empty text/i,
  );
});

test("Pi service tool records a handoff, reports validation errors, and status exposes cleanup details", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-run-sentinel-service-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);

  let runner;
  let reloadedRunner;
  try {
    runner = await loadPiExtension(cwd, agentDir);
    const notifications = [];
    runner.setUIContext({
      notify(message, type) {
        notifications.push({ message, type });
      },
      setWidget() {},
    }, "rpc");

    const serviceTool = runner.getAllRegisteredTools().find(
      ({ definition }) => definition.name === "run_sentinel_register_service",
    );
    assert.ok(serviceTool, "Pi should register the service handoff tool");
    for (const field of ["name", "command", "logPath", "stopInstruction", "readinessEvidence", "survival"]) {
      assert.ok(serviceTool.definition.parameters.required.includes(field), `${field} must be required`);
    }
    assert.ok(!serviceTool.definition.parameters.required.includes("pid"), "pid is optional");
    assert.ok(!serviceTool.definition.parameters.required.includes("url"), "url is optional");

    const result = await serviceTool.definition.execute(
      "service-registration-1",
      validInput,
      undefined,
      undefined,
      runner.createContext(),
    );
    assert.match(result.content[0].text, /best-effort.*not guaranteed/i);
    assert.equal(result.details.name, "docs server");

    await assert.rejects(
      serviceTool.definition.execute(
        "service-registration-error",
        { ...validInput, logPath: " " },
        undefined,
        undefined,
        runner.createContext(),
      ),
      /log path \(logPath\) is required/i,
    );

    await runner.getCommand("run-sentinel:status").handler("", runner.createCommandContext());
    const status = notifications.at(-1).message;
    assert.match(status, /registered services: 1/);
    assert.match(status, /docs server/);
    assert.match(status, /log path: \.\/logs\/dev\.log/);
    assert.match(status, /stop: kill 1234/);
    assert.match(status, /readiness: GET \/health returned HTTP 200/);
    assert.match(status, /survival: best-effort; not guaranteed/);

    runner.invalidate("service handoff test reload");
    reloadedRunner = await loadPiExtension(cwd, agentDir);
    assert.ok(reloadedRunner.getAllRegisteredTools().some(
      ({ definition }) => definition.name === "run_sentinel_register_service",
    ));
    await reloadedRunner.getCommand("run-sentinel:status").handler(
      "",
      reloadedRunner.createCommandContext(),
    );
    assert.match(notifications.at(-1).message, /registered services:/);
  } finally {
    runner?.invalidate("service handoff test cleanup");
    reloadedRunner?.invalidate("service handoff test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

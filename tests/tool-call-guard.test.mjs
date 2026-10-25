import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  ExtensionRunner,
  SessionManager,
  discoverAndLoadExtensions,
} from "@earendil-works/pi-coding-agent";
import { createLedger } from "../lib/ledger.ts";
import { createToolCallGuard } from "../lib/tool-call-guard.ts";

const extensionPath = fileURLToPath(new URL("../extensions", import.meta.url));

async function loadPiExtension(cwd, agentDir, guardMode) {
  let extensionPaths = [extensionPath];
  if (guardMode) {
    const configuredExtensionPath = join(agentDir, `${guardMode}-extension`);
    await mkdir(configuredExtensionPath);
    const extensionModulePath = pathToFileURL(join(extensionPath, "index.ts")).href;
    const ledgerModulePath = pathToFileURL(fileURLToPath(new URL("../lib/ledger.ts", import.meta.url))).href;
    await writeFile(join(configuredExtensionPath, "index.ts"), [
      `import registerRunSentinelExtension from ${JSON.stringify(extensionModulePath)};`,
      `import { createLedger } from ${JSON.stringify(ledgerModulePath)};`,
      `export default (pi) => registerRunSentinelExtension(pi, createLedger({ guardMode: ${JSON.stringify(guardMode)} }));`,
      "",
    ].join("\n"));
    extensionPaths = [configuredExtensionPath];
  }

  const loaded = await discoverAndLoadExtensions(extensionPaths, cwd, agentDir);
  assert.deepEqual(loaded.errors, []);

  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    cwd,
    SessionManager.inMemory(cwd),
    {},
  );
  return runner;
}

test("Pi tool_call guard blocks before execution, records decisions, and reloads cleanly", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-run-sentinel-guard-"));
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

    assert.equal(runner.hasHandlers("tool_call"), true);
    assert.ok(runner.getCommand("run-sentinel:status"));

    const executed = [];
    let nextToolCallId = 1;
    const dispatch = async (toolName, input) => {
      const event = {
        type: "tool_call",
        toolCallId: `test-${nextToolCallId++}`,
        toolName,
        input,
      };
      const guard = await runner.emitToolCall(event);
      if (guard?.block) return { blocked: true, reason: guard.reason };
      executed.push({ toolName, input });
      return { blocked: false };
    };

    const blocked = await dispatch("bash", { command: "npm test &" });
    assert.equal(blocked.blocked, true);
    assert.match(blocked.reason, /foreground/i);
    assert.equal(executed.length, 0, "blocked commands must not reach execution");

    const blockedWatcher = await dispatch("bash", { command: "gh run watch 123" });
    assert.equal(blockedWatcher.blocked, true);
    assert.match(blockedWatcher.reason, /bounded foreground check/i);
    assert.equal(executed.length, 0, "blocked watchers must not reach execution");

    const warned = await dispatch("powershell", { command: "npm run dev" });
    assert.equal(warned.blocked, false);
    assert.equal(executed.length, 1, "warn decisions remain executable");
    assert.equal(notifications.at(-1).type, "warning");
    assert.match(notifications.at(-1).message, /run_sentinel_register_service/);
    assert.match(notifications.at(-1).message, /best-effort/i);

    const allowed = await dispatch("bash", { command: "gh pr checks 123" });
    assert.equal(allowed.blocked, false);
    assert.equal(executed.length, 2);

    const nonShell = await dispatch("read", { path: "README.md" });
    assert.equal(nonShell.blocked, false);
    const malformed = await dispatch("bash", { command: 42 });
    assert.equal(malformed.blocked, false);

    await runner.getCommand("run-sentinel:status").handler("", runner.createCommandContext());
    const statusText = notifications.at(-1).message;
    assert.match(statusText, /guard mode: enforce/);
    assert.match(statusText, /recent decisions: 4/);
    assert.match(statusText, /block: background_operator/);
    assert.match(statusText, /warn: service_handoff_candidate/);
    assert.match(statusText, /allow: safe_foreground/);

    runner.invalidate("functional test reload");
    assert.throws(() => runner.createContext().hasUI, /functional test reload/);

    reloadedRunner = await loadPiExtension(cwd, agentDir);
    assert.equal(reloadedRunner.hasHandlers("tool_call"), true);
    const reloadedBlock = await reloadedRunner.emitToolCall({
      type: "tool_call",
      toolCallId: "reload-block",
      toolName: "bash",
      input: { command: "nohup npm test" },
    });
    assert.equal(reloadedBlock?.block, true);
  } finally {
    runner?.invalidate("functional test cleanup");
    reloadedRunner?.invalidate("functional test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

test("guard modes off, monitor, and enforce control blocking", () => {
  const event = {
    type: "tool_call",
    toolCallId: "mode-block",
    toolName: "bash",
    input: { command: "npm test &" },
  };

  for (const guardMode of ["off", "monitor", "enforce"]) {
    const ledger = createLedger({ guardMode });
    const guard = createToolCallGuard(ledger);
    const result = guard(event, { hasUI: false });

    assert.equal(result?.block ?? false, guardMode === "enforce", `${guardMode} blocking`);
    assert.equal(
      ledger.recentDecisions.length,
      guardMode === "off" ? 0 : 1,
      `${guardMode} decision recording`,
    );
    if (guardMode !== "off") {
      assert.equal(ledger.recentDecisions[0].action, "block");
      assert.match(
        ledger.recentDecisions[0].summary,
        guardMode === "monitor" ? /^would block:/ : /^block:/,
      );
    }
  }
});

test("ExtensionRunner reports monitor decisions as would-block while enforce blocks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-run-sentinel-guard-mode-"));
  const runners = [];

  try {
    for (const guardMode of ["monitor", "enforce"]) {
      const cwd = join(root, guardMode, "project");
      const agentDir = join(root, guardMode, "agent");
      await mkdir(cwd, { recursive: true });
      await mkdir(agentDir, { recursive: true });

      const runner = await loadPiExtension(cwd, agentDir, guardMode);
      runners.push(runner);
      const notifications = [];
      const widgets = [];
      runner.setUIContext({
        notify(message, type) {
          notifications.push({ message, type });
        },
        setWidget(key, lines, options) {
          widgets.push({ key, lines, options });
        },
      }, "rpc");

      const event = {
        type: "tool_call",
        toolCallId: `${guardMode}-block`,
        toolName: "bash",
        input: { command: "npm test &" },
      };
      const executed = [];
      const result = await runner.emitToolCall(event);
      if (!result?.block) executed.push(event);

      const enforced = guardMode === "enforce";
      assert.equal(result?.block ?? false, enforced, `${guardMode} block result`);
      assert.equal(executed.length, enforced ? 0 : 1, `${guardMode} execution`);
      assert.deepEqual(widgets.at(-1).lines, [
        `Run Sentinel hazards: 1 ${enforced ? "blocked" : "would block"}`,
        "Registered services: none",
      ]);

      const statusCommand = runner.getCommand("run-sentinel:status");
      assert.ok(statusCommand);
      await statusCommand.handler("", runner.createCommandContext());
      const statusText = notifications.at(-1).message;
      assert.match(statusText, new RegExp(`recent blocks: ${enforced ? 1 : 0}`));
      assert.match(statusText, new RegExp(`recent would-block decisions: ${enforced ? 0 : 1}`));
      assert.match(statusText, enforced ? /block: background_operator/ : /would block: background_operator/);
    }
  } finally {
    for (const runner of runners) runner.invalidate("functional test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

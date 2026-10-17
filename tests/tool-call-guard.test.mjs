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

const extensionPath = fileURLToPath(new URL("../extensions", import.meta.url));

async function loadPiExtension(cwd, agentDir) {
  const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
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
    assert.deepEqual(notifications.at(-1), {
      message: "Run Sentinel warning: This looks like a local server. Keep it foreground unless a persistent service was requested and its handoff is recorded.",
      type: "warning",
    });

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

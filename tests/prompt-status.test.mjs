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

  return new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    cwd,
    SessionManager.inMemory(cwd),
    {},
  );
}

test("startup prompt and status summarize run safety without exposing raw commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-run-sentinel-prompt-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);

  let runner;
  let reloadedRunner;
  try {
    runner = await loadPiExtension(cwd, agentDir);
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

    const injected = await runner.emitBeforeAgentStart("task", undefined, "Base system prompt", {});
    assert.ok(injected.systemPrompt.startsWith("Base system prompt\n\n"));
    assert.match(injected.systemPrompt, /never background-and-yield/i);
    assert.match(injected.systemPrompt, /watch\/poll/i);
    assert.match(injected.systemPrompt, /user explicitly asked to keep/i);
    assert.match(injected.systemPrompt, /best-effort/i);
    assert.doesNotMatch(injected.systemPrompt, /Multica runtime brief/i);
    assert.deepEqual(widgets.at(-1), {
      key: "run-sentinel-status",
      lines: ["Run Sentinel hazards: none", "Registered services: none"],
      options: { placement: "belowEditor" },
    });

    const dispatch = (toolName, command) => runner.emitToolCall({
      type: "tool_call",
      toolCallId: `${toolName}-${command}`,
      toolName,
      input: { command },
    });
    assert.equal((await dispatch("bash", "npm test &"))?.block, true);
    assert.equal((await dispatch("bash", "gh run watch 123"))?.block, true);
    assert.equal((await dispatch("powershell", "npm run dev"))?.block ?? false, false);
    await dispatch("bash", "echo safe");

    const serviceTool = runner.getAllRegisteredTools().find(
      ({ definition }) => definition.name === "run_sentinel_register_service",
    );
    assert.ok(serviceTool);
    await serviceTool.definition.execute("service-1", {
      name: "docs server",
      command: "npm run dev",
      logPath: "./logs/dev.log",
      stopInstruction: "stop the docs server",
      readinessEvidence: "GET /health returned HTTP 200",
      survival: "best_effort",
    }, undefined, undefined, runner.createContext());

    await runner.getCommand("run-sentinel:status").handler("", runner.createCommandContext());
    const status = notifications.at(-1).message;
    assert.match(status, /guard mode: enforce/);
    assert.match(status, /recent decisions: 4/);
    assert.match(status, /recent blocks: 2/);
    assert.match(status, /recent warnings: 1/);
    assert.match(status, /registered services: 1/);
    assert.match(status, /docs server/);
    assert.match(status, /log path: \.\/logs\/dev\.log/);
    assert.match(status, /stop: stop the docs server/);
    assert.doesNotMatch(status, /npm test/);
    assert.deepEqual(widgets.at(-1).lines, [
      "Run Sentinel hazards: 2 blocked · 1 warned",
      "Registered services: docs server",
    ]);
    assert.doesNotMatch(widgets.at(-1).lines.join("\n"), /npm test|npm run dev|gh run watch/);

    runner.invalidate("prompt/status test reload");
    reloadedRunner = await loadPiExtension(cwd, agentDir);
    const afterReload = await reloadedRunner.emitBeforeAgentStart("task", undefined, "Base", {});
    assert.match(afterReload.systemPrompt, /Run Sentinel safety reminder/);
    assert.equal((await reloadedRunner.emitToolCall({
      type: "tool_call",
      toolCallId: "reload-block",
      toolName: "bash",
      input: { command: "npm test &" },
    }))?.block, true);
  } finally {
    runner?.invalidate("prompt/status test cleanup");
    reloadedRunner?.invalidate("prompt/status test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

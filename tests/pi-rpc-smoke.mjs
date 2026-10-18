import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliPath = fileURLToPath(new URL(
  "../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  import.meta.url,
));
const extensionPath = fileURLToPath(new URL("../extensions", import.meta.url));
const probeTimeoutMs = 15_000;
const cleanupGraceMs = 1_000;

export function startRpcProcess(cwd, agentDir, spawnProcess = spawn) {
  const child = spawnProcess(process.execPath, [
    cliPath,
    "--mode", "rpc",
    "--no-session",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--extension", extensionPath,
  ], {
    cwd,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const records = [];
  const waiters = new Set();
  let stdoutBuffer = "";
  let stderr = "";
  let processError;
  let exit;
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const publish = (record) => {
    records.push(record);
    for (const waiter of waiters) {
      if (!waiter.predicate(record)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
  };

  const rejectPendingWaiters = (error) => {
    processError ??= error;
    for (const waiter of waiters) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(processError);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        publish(JSON.parse(line));
      } catch (error) {
        rejectPendingWaiters(new Error(`Pi emitted invalid RPC JSON: ${line}`, { cause: error }));
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", (error) => {
    rejectPendingWaiters(error);
  });
  child.once("close", (code, signal) => {
    exit = { code, signal };
    resolveExit(exit);
    for (const waiter of waiters) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Pi exited before the expected RPC record (${code}/${signal}). ${stderr}`));
    }
  });

  const deadline = Date.now() + probeTimeoutMs;
  const waitFor = (predicate, label) => {
    if (processError) return Promise.reject(processError);
    const existing = records.find(predicate);
    if (existing) return Promise.resolve(existing);
    if (exit) return Promise.reject(new Error(`Pi exited before ${label} (${exit.code}/${exit.signal}). ${stderr}`));

    return new Promise((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reject(new Error(`Pi RPC deadline exceeded while waiting for ${label}. ${stderr}`));
        return;
      }
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Pi RPC deadline exceeded while waiting for ${label}. ${stderr}`));
        }, remaining),
      };
      waiters.add(waiter);
    });
  };

  const request = async (id, command) => {
    const responsePromise = waitFor(
      (record) => record.type === "response" && record.id === id,
      `${command.type} response`,
    );
    child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    const response = await responsePromise;
    assert.equal(response.success, true, `${command.type} RPC response: ${response.error ?? "unknown error"}`);
    return response;
  };

  const closeCleanly = async () => {
    child.stdin.end();
    let timer;
    const shutdownDeadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Pi did not shut down within ${cleanupGraceMs}ms after stdin EOF`)),
        cleanupGraceMs,
      );
    });
    let result;
    try {
      result = await Promise.race([exitPromise, shutdownDeadline]);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(result.code, 0, `Pi shutdown failed (${result.code}/${result.signal}). ${stderr}`);
    return result;
  };

  const stopAfterFailure = async () => {
    if (!exit) child.kill();
    if (!exit) {
      let timer;
      try {
        await Promise.race([
          exitPromise,
          new Promise((resolve) => {
            timer = setTimeout(resolve, cleanupGraceMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!exit) throw new Error(`Unable to stop owned Pi process ${child.pid} within ${cleanupGraceMs}ms`);
  };

  return { child, closeCleanly, exitPromise, records, request, stopAfterFailure, waitFor };
}

async function verifyProcess(cwd, agentDir, label) {
  const rpc = startRpcProcess(cwd, agentDir);
  try {
    const commandsResponse = await rpc.request(`${label}-commands`, { type: "get_commands" });
    assert.ok(
      commandsResponse.data.commands.some(
        (command) => command.source === "extension" && command.name === "run-sentinel:status",
      ),
      `${label}: actual Pi process must register /run-sentinel:status`,
    );

    const featureResponse = rpc.waitFor(
      (record) => record.type === "extension_ui_request"
        && record.method === "notify"
        && record.message?.includes("Run Sentinel status"),
      `${label} status feature response`,
    );
    await rpc.request(`${label}-status`, { type: "prompt", message: "/run-sentinel:status" });
    const status = await featureResponse;
    assert.match(status.message, /guard mode: enforce/);
    assert.match(status.message, /recent blocks: 0/);
    assert.match(status.message, /recent warnings: 0/);
    assert.match(status.message, /registered services: 0/);
    await rpc.closeCleanly();
    return { extensionRegistered: true, featureResponse: true, cleanShutdown: true };
  } catch (error) {
    await rpc.stopAfterFailure();
    throw error;
  }
}

function verifyErrorPath() {
  const testPath = fileURLToPath(new URL("./service-handoff.test.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--test", testPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: probeTimeoutMs,
  });
  assert.equal(result.error, undefined, `service handoff error-path test could not run: ${result.error?.message}`);
  assert.equal(result.status, 0, `service handoff error-path test failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Pi service tool records a handoff, reports validation errors/);
  return "handled_error";
}

function verifyHostShell() {
  if (process.platform !== "win32") return "not_applicable";
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$PSVersionTable.PSEdition",
  ], { encoding: "utf8", timeout: probeTimeoutMs });
  assert.equal(result.error, undefined, `native PowerShell could not run: ${result.error?.message}`);
  assert.equal(result.status, 0, `native PowerShell failed: ${result.stderr}`);
  assert.match(result.stdout.trim(), /^(Desktop|Core)$/);
  return "native_shell_boundary";
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "pi-run-sentinel-rpc-smoke-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);

  try {
    const first = await verifyProcess(cwd, agentDir, "initial");
    const reloaded = await verifyProcess(cwd, agentDir, "reloaded");
    const errorPath = verifyErrorPath();
    const hostShell = verifyHostShell();
    console.log(JSON.stringify({
      extension_load: first.extensionRegistered ? "extension_registered" : "failed",
      happy_path: first.featureResponse ? "feature_response" : "failed",
      error_path: errorPath,
      reload_cleanup: {
        reloaded_extension_registered: reloaded.extensionRegistered,
        reloaded_feature_response: reloaded.featureResponse,
        clean_shutdown: first.cleanShutdown && reloaded.cleanShutdown,
      },
      host_shell: hostShell,
    }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

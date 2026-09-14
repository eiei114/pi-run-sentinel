import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const registerExtension = (await import("../extensions/index.ts")).default;

test("package declares pi extension", () => {
  assert.deepEqual(packageJson.pi.extensions, ["./extensions"]);
});

test("package is discoverable as a Pi package", () => {
  assert.ok(packageJson.keywords.includes("pi-package"));
});

test("package uses public publish config", () => {
  assert.equal(packageJson.publishConfig.access, "public");
});

test("ci workflow runs tests on push and pull_request", () => {
  assert.match(ciWorkflow, /on:\s*[\s\S]*push:/);
  assert.match(ciWorkflow, /pull_request:/);
  assert.match(ciWorkflow, /npm run ci/);
});

test("extension module loads and registers run-sentinel:status command", () => {
  assert.equal(typeof registerExtension, "function");

  const commands = [];
  registerExtension({
    on() {},
    registerCommand(name, spec) {
      commands.push({ name, ...spec });
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "run-sentinel:status");
  assert.match(commands[0].description, /guard mode/i);
  assert.equal(typeof commands[0].handler, "function");
});

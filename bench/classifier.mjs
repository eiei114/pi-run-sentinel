import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { classifyShellCommand as current } from "../lib/classifier.ts";

const baselinePath = process.argv[2];
const baseline = baselinePath
  ? (await import(pathToFileURL(baselinePath).href)).classifyShellCommand
  : undefined;
const iterations = Number(process.env.BENCH_ITERATIONS ?? 20_000);
const samples = 9;
const cases = [
  ["single-segment", "npm run ci"],
  ["multi-segment", "git status; npm test && npm run typecheck"],
  ["quoted-argument", 'echo "safe & literal"'],
  ["nested-shell", 'env -i bash -c "npm test && npm run typecheck"'],
];

function measure(classifier, command) {
  let checksum = 0;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    checksum += classifier(command).action.length;
  }
  return { elapsedMs: performance.now() - startedAt, checksum };
}

function median(values) {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

console.log(`Node ${process.version}; ${iterations} iterations x ${samples} samples per case`);
for (const [name, command] of cases) {
  if (baseline) assert.deepEqual(current(command), baseline(command), `${name} result changed`);
  for (let index = 0; index < 30_000; index += 1) {
    current(command);
    baseline?.(command);
  }

  const currentTimes = [];
  const baselineTimes = [];
  for (let sample = 0; sample < samples; sample += 1) {
    global.gc?.();
    if (!baseline) {
      currentTimes.push(measure(current, command).elapsedMs);
      continue;
    }

    const results = sample % 2 === 0
      ? [measure(baseline, command), measure(current, command)]
      : [measure(current, command), measure(baseline, command)];
    const baselineResult = results[sample % 2 === 0 ? 0 : 1];
    const currentResult = results[sample % 2 === 0 ? 1 : 0];
    assert.equal(currentResult.checksum, baselineResult.checksum);
    currentTimes.push(currentResult.elapsedMs);
    baselineTimes.push(baselineResult.elapsedMs);
  }

  const currentNs = (median(currentTimes) * 1_000_000) / iterations;
  if (!baseline) {
    console.log(`${name}: ${currentNs.toFixed(1)} ns/op`);
    continue;
  }

  const baselineNs = (median(baselineTimes) * 1_000_000) / iterations;
  const improvement = ((baselineNs - currentNs) / baselineNs) * 100;
  console.log(`${name}: baseline=${baselineNs.toFixed(1)} ns/op current=${currentNs.toFixed(1)} ns/op (${improvement.toFixed(1)}%)`);
}

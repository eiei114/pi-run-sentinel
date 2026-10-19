import assert from "node:assert/strict";
import test from "node:test";

const { classifyShellCommand } = await import("../lib/classifier.ts");

function assertDecision(command, action, reasonCode, evidence) {
  const result = classifyShellCommand(command);

  assert.equal(result.action, action);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  assert.deepEqual(result.evidence, evidence);
  return result;
}

test("blocks shell background operators without treating foreground operators as hazards", () => {
  assertDecision("npm test &", "block", "background_operator", ["&"]);
  assertDecision("npm test && npm run typecheck", "allow", "safe_foreground", []);
  assertDecision('echo "a & b"', "allow", "safe_foreground", []);
  assertDecision("npm test 2>&1", "allow", "safe_foreground", []);
});

test("blocks common detached process forms", () => {
  assertDecision("nohup npm test", "block", "detached_process", ["nohup"]);
  assertDecision("disown -a", "block", "detached_process", ["disown"]);
  assertDecision("Start-Process node", "block", "detached_process", ["Start-Process"]);
  assertDecision("Start-Process node -Wait", "allow", "safe_foreground", []);
});

test("blocks hazards inside nested shell command payloads", () => {
  assertDecision('bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision("sh -c 'nohup node server.js'", "block", "detached_process", ["nohup"]);
  assertDecision('cmd /c "start /b node app.js"', "block", "detached_process", ["start /b"]);
  assertDecision("cmd /c start /b node app.js", "block", "detached_process", ["start /b"]);
  assertDecision(
    'pwsh -Command "while ($true) { Start-Sleep -Seconds 5 }"',
    "block",
    "watch_or_poll_loop",
    ["loop + sleep"],
  );
  assertDecision(
    "pwsh -Command while ($true) { Start-Sleep -Seconds 5 }",
    "block",
    "watch_or_poll_loop",
    ["loop + sleep"],
  );
  assertDecision('bash -c "npm test"', "allow", "safe_foreground", []);
});

test("finds nested shell hazards behind wrapper options", () => {
  assertDecision('sudo -u ci bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision('env -i bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision('nice -n 10 bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision('timeout 10 bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision('timeout -k 2s 10 bash -c "npm test &"', "block", "background_operator", ["&"]);
  assertDecision('timeout 10 bash -c "npm test"', "allow", "safe_foreground", []);
});

test("uses cmd.exe command-separator semantics for nested payloads", () => {
  assertDecision('cmd /c "npm test & echo done"', "allow", "safe_foreground", []);
  assertDecision('cmd /c "npm test && echo done"', "allow", "safe_foreground", []);
  assertDecision(
    'cmd /c "npm test & start /b node app.js"',
    "block",
    "detached_process",
    ["start /b"],
  );
});

test("blocks CI watchers and generic watch commands", () => {
  assertDecision(
    "gh pr checks 123 --watch",
    "block",
    "ci_watch_without_deliverable",
    ["gh pr checks --watch"],
  );
  assertDecision("gh run watch 123", "block", "ci_watch_without_deliverable", ["gh run watch"]);
  assertDecision("watch -n 1 git status", "block", "watch_or_poll_loop", ["watch"]);
});

test("checks later command segments for hazards and service candidates", () => {
  assertDecision("npm test && nohup node server.js", "block", "detached_process", ["nohup"]);
  assertDecision("npm test; gh run watch 123", "block", "ci_watch_without_deliverable", ["gh run watch"]);
  assertDecision("npm test && npm run dev", "warn", "service_handoff_candidate", ["npm run dev"]);
});

test("blocks bash and PowerShell loops that sleep", () => {
  assertDecision(
    "while true; do gh pr checks; sleep 5; done",
    "block",
    "watch_or_poll_loop",
    ["loop + sleep"],
  );
  assertDecision(
    "for attempt in 1 2 3; do npm test; sleep 1; done",
    "block",
    "watch_or_poll_loop",
    ["loop + sleep"],
  );
  assertDecision(
    "while ($true) { Start-Sleep -Seconds 5 }",
    "block",
    "watch_or_poll_loop",
    ["loop + sleep"],
  );
  assertDecision("sleep 1; npm test", "allow", "safe_foreground", []);
});

test("warns for ambiguous local server commands", () => {
  assertDecision("npm run dev", "warn", "service_handoff_candidate", ["npm run dev"]);
  assertDecision("vite --host 127.0.0.1", "warn", "service_handoff_candidate", ["vite"]);
  assertDecision("next dev", "warn", "service_handoff_candidate", ["next dev"]);
  assertDecision(
    "python -m http.server 8000",
    "warn",
    "service_handoff_candidate",
    ["python -m http.server"],
  );
  assertDecision('echo "npm run dev"', "allow", "safe_foreground", []);
});

test("allows one-shot status snapshots and ordinary foreground commands", () => {
  assertDecision("gh pr checks 123", "allow", "safe_foreground", []);
  assertDecision("npm run typecheck", "allow", "safe_foreground", []);
  assertDecision("echo ok # nohup node server.js", "allow", "safe_foreground", []);
});

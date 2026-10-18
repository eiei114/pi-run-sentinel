# pi-run-sentinel

[![CI](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Run-owned work safety guard for Pi — classifier-backed interception of risky shell tool calls.

## What this is

`pi-run-sentinel` registers `/run-sentinel:status` and classifies Pi's built-in `bash` and `powershell` tool calls before execution. In enforce mode, high-confidence detached-work and watch/poll hazards are blocked; in monitor mode, they are allowed and reported as would-block decisions. Ambiguous local server commands are allowed with a warning. Decisions are kept in an in-memory ledger for the current extension runtime.

## Features

- `/run-sentinel:status` shows guard mode, recent decision count and the latest decisions
- `run_sentinel_register_service` records a typed handoff for a persistent service the user explicitly requested, including its log path, stop instruction and readiness evidence
- In enforce mode, high-confidence shell hazards are blocked before their tool executes, with a correction explaining a safe alternative; monitor mode reports would-block decisions and allows execution
- Local server candidates remain allowed and produce a visible warning pointing to the service registration tool when Pi UI notifications are available
- Pure classifier and ledger modules are testable without launching shell commands
- Default guard mode `enforce` with policy `default`

## Persistent service handoffs

Use `run_sentinel_register_service` only when the user explicitly asked for a local service to remain available after this turn. Supply its name, command, durable log path, concrete stop instruction, readiness evidence, and the required `best_effort` survival acknowledgment; PID and URL are optional. The `/run-sentinel:status` output shows the registered details so the next person can find the logs and stop the service.

This is a handoff record only: Run Sentinel does not start, supervise, or guarantee the service process. Survival is best-effort and is not guaranteed. Tests, builds, CI checks, CI polling, watchers, and other run-owned work cannot be reclassified as persistent services; run them in the foreground and collect their results before ending the run.

The guard only intercepts pre-execution shell tool calls. It does not enforce pending work at final-response or session-end time, and does not supervise processes after a tool returns.

## Startup reminder and status

Before each agent turn, Run Sentinel appends a compact reminder to Pi's system prompt: finish run-owned work before ending the turn, avoid background-and-yield and watch/poll loops, and allow only user-requested persistent services to outlive the turn with readiness, log, and stop details. Service survival remains best-effort; tests, builds, and CI are not services.

`/run-sentinel:status` reports guard mode, decision counts, enforced-block/would-block counts, warning counts, and registered service handoffs. In monitor mode, block decisions are labeled as would-block rather than enforced blocks. In TUI/RPC modes, a small widget shows only blocked/would-block/warning counts and registered service names, never command logs. Guard decision history uses summaries rather than raw shell command text. Pi's `session_shutdown` event is for teardown, not a cancellable final-response check, so Run Sentinel does not enforce cleanup at turn end or guarantee service survival.

## Install

This package is not published. Load it locally for dogfooding:

```bash
cd /path/to/pi-run-sentinel
npm install
pi -e .
```

From a Pi vault checkout of this repo:

```bash
pi install path:/path/to/pi-run-sentinel
```

Or point Pi at the repo root while developing:

```bash
pi -e /path/to/pi-run-sentinel
```

Then run:

```text
/run-sentinel:status
```

Expected output includes `guard mode: enforce`, `recent decisions: 0`, `last decisions:`, and `registered services: 0`.

## Development

```bash
npm install
npm run ci
```

## License

MIT

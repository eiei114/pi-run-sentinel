# pi-run-sentinel

[![CI](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Run-owned work safety guard for Pi — classifier-backed interception of risky shell tool calls.

## What this is

`pi-run-sentinel` registers `/run-sentinel:status` and classifies Pi's built-in `bash` and `powershell` tool calls before execution. High-confidence detached-work and watch/poll hazards are blocked; ambiguous local server commands are allowed with a warning. Decisions are kept in an in-memory ledger for the current extension runtime.

## Features

- `/run-sentinel:status` shows guard mode, recent decision count and the latest decisions
- High-confidence shell hazards are blocked before their tool executes, with a correction explaining a safe alternative
- Local server candidates remain allowed and produce a visible warning when Pi UI notifications are available
- Pure classifier and ledger modules are testable without launching shell commands
- Default guard mode `enforce` with policy `default`

The guard only intercepts pre-execution shell tool calls. It does not enforce pending work at final-response or session-end time, and does not supervise processes after a tool returns.

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

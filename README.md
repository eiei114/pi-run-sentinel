# pi-run-sentinel

[![CI](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-run-sentinel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Run-owned work safety guard for Pi — walking skeleton with an in-memory status ledger.

## What this is

`pi-run-sentinel` is the first loadable slice of Run Sentinel. It registers `/run-sentinel:status` and keeps an in-memory ledger with policy name, guard mode, recent decisions, and registered services. Classifier and blocking integration arrive in later slices.

## Features (slice 01)

- `/run-sentinel:status` shows guard mode, recent decision count, and registered service count
- Pure `lib/ledger.ts` module testable without Pi runtime APIs
- Default guard mode `monitor` with policy `default`

## Install

Published npm install is not available in this walking-skeleton slice. Load the package locally for dogfood:

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

Expected output includes `guard mode: monitor`, `recent decisions: 0`, and `registered services: 0`.

## Development

```bash
npm install
npm run ci
```

## License

MIT

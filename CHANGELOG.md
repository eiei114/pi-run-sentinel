# Changelog

## 0.4.0 - Unreleased

### Added

- Compact run-owned work safety reminder injected before each agent turn
- Block and warning counts in `/run-sentinel:status` and a compact widget listing counts and registered service names
## 0.3.1 - Unreleased

### Performance

- Skip quoted-content masking allocations for shell commands without quotes or comments.

### Fixed

- Report monitor-mode block decisions as would-block instead of counting them as enforced blocks

## 0.3.0 - Unreleased

### Added

- Typed `run_sentinel_register_service` handoffs with validated readiness, log, stop, optional PID/URL, and best-effort survival details displayed by `/run-sentinel:status`

## 0.2.0 - Unreleased

### Added

- Pre-execution guard for Pi bash and PowerShell tool calls, including visible service warnings and decision history in `/run-sentinel:status`
- Set the default guard mode to `enforce` for the active pre-execution blocks

## 0.1.0 - Unreleased

### Fixed

- Detect hazards hidden in nested shell command payloads.

### Added

- Walking skeleton extension with `/run-sentinel:status`
- In-memory ledger module (`lib/ledger.ts`) with policy, guard mode, decisions, and services
- Pure shell-command classifier with deterministic hazard decisions

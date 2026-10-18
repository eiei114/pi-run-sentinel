/** Compact reminder injected into the system prompt before each agent turn. */
export const RUN_OWNED_WORK_SAFETY_PROMPT = [
  "Run Sentinel safety reminder:",
  "- Finish run-owned work and collect its result before ending this turn; never background-and-yield.",
  "- Avoid watch/poll loops; use bounded foreground checks and clean up work you start.",
  "- Only a persistent service the user explicitly asked to keep may outlive this turn; verify readiness and register its durable log, stop instruction, and available PID/URL with run_sentinel_register_service. State that survival is best-effort; tests, builds, and CI are never services.",
].join("\n");

/** Validation and registration for the explicitly requested service exception. */

import type { RegisteredService, RunSentinelLedger } from "./ledger.ts";

type ServiceInput = Record<string, unknown>;

function asRecord(input: unknown): ServiceInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Cannot register service handoff: provide the service details as an object.");
  }
  return input as ServiceInput;
}

function requiredText(input: ServiceInput, field: string, label: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Cannot register service handoff: ${label} (${field}) is required and must be non-empty text. Provide it before registering the service.`,
    );
  }
  return value.trim();
}

function optionalPid(input: ServiceInput): number | undefined {
  const pid = input.pid;
  if (pid === undefined) return undefined;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("Cannot register service handoff: pid must be a positive integer when provided.");
  }
  return pid;
}

function optionalUrl(input: ServiceInput): string | undefined {
  const value = input.url;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Cannot register service handoff: url must be a non-empty absolute HTTP(S) URL when provided.");
  }

  const url = value.trim();
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.host.length === 0) {
      throw new Error("unsupported URL");
    }
  } catch {
    throw new Error("Cannot register service handoff: url must be an absolute HTTP(S) URL when provided.");
  }
  return url;
}

/** Validate and record a service handoff. This records metadata only; it starts or supervises no process. */
export function registerServiceHandoff(
  ledger: RunSentinelLedger,
  input: unknown,
  now: () => Date = () => new Date(),
): RegisteredService {
  const values = asRecord(input);
  const name = requiredText(values, "name", "service name");
  const command = requiredText(values, "command", "command");
  const logPath = requiredText(values, "logPath", "log path");
  const stopInstruction = requiredText(values, "stopInstruction", "stop instruction");
  const readinessEvidence = requiredText(values, "readinessEvidence", "readiness evidence");

  if (values.survival !== "best_effort") {
    throw new Error(
      'Cannot register service handoff: survival must be "best_effort". The service is not guaranteed to remain running.',
    );
  }

  const pid = optionalPid(values);
  const url = optionalUrl(values);
  const service: RegisteredService = {
    name,
    command,
    ...(pid === undefined ? {} : { pid }),
    ...(url === undefined ? {} : { url }),
    logPath,
    stopInstruction,
    readinessEvidence,
    survival: "best_effort",
    registeredAt: now().toISOString(),
  };

  ledger.registeredServices.push(service);
  return service;
}

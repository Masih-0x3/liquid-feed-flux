import {
  fetchRuntimeControls,
  type RuntimeControlsQueryClient,
} from "./runtimeControls.ts";

export type ExternalPostingBlockReason =
  | "invalid_environment"
  | "controls_unavailable"
  | "environment_mismatch"
  | "preview_environment"
  | "environment_breaker"
  | "database_control";

export type ExternalPostingGuardResult =
  | { allowed: true; code: "external_posting_allowed" }
  | {
    allowed: false;
    code: "external_posting_blocked";
    reason: ExternalPostingBlockReason;
  };

export type ExternalPostingGuardOptions = {
  environment?: unknown;
  allowExternalPosting?: unknown;
};

export class ExternalPostingBlockedError extends Error {
  readonly code = "external_posting_blocked";
  readonly reason: ExternalPostingBlockReason;

  constructor(reason: ExternalPostingBlockReason) {
    super("external posting is blocked");
    this.name = "ExternalPostingBlockedError";
    this.reason = reason;
  }
}

function readEnvironment(options: ExternalPostingGuardOptions): unknown {
  if (Object.prototype.hasOwnProperty.call(options, "environment")) return options.environment;
  try {
    return Deno.env.get("XOT_ENVIRONMENT");
  } catch (_error) {
    return undefined;
  }
}

function readPostingBreaker(options: ExternalPostingGuardOptions): unknown {
  if (Object.prototype.hasOwnProperty.call(options, "allowExternalPosting")) return options.allowExternalPosting;
  try {
    return Deno.env.get("ALLOW_EXTERNAL_POSTING");
  } catch (_error) {
    return undefined;
  }
}

export async function checkExternalPosting(
  client: RuntimeControlsQueryClient,
  options: ExternalPostingGuardOptions = {},
): Promise<ExternalPostingGuardResult> {
  const environment = readEnvironment(options);
  if (environment !== "preview" && environment !== "production") {
    return { allowed: false, code: "external_posting_blocked", reason: "invalid_environment" };
  }

  let controls;
  try {
    controls = await fetchRuntimeControls(client);
  } catch (_error) {
    return { allowed: false, code: "external_posting_blocked", reason: "controls_unavailable" };
  }

  if (controls.environment !== environment) {
    return { allowed: false, code: "external_posting_blocked", reason: "environment_mismatch" };
  }
  if (environment === "preview") {
    return { allowed: false, code: "external_posting_blocked", reason: "preview_environment" };
  }
  if (readPostingBreaker(options) !== "true") {
    return { allowed: false, code: "external_posting_blocked", reason: "environment_breaker" };
  }
  if (controls.posting_mode !== "enabled") {
    return { allowed: false, code: "external_posting_blocked", reason: "database_control" };
  }
  return { allowed: true, code: "external_posting_allowed" };
}

/** Call directly before a provider write. This function never receives payload data. */
export async function requireExternalPosting(
  client: RuntimeControlsQueryClient,
  options: ExternalPostingGuardOptions = {},
): Promise<void> {
  const result = await checkExternalPosting(client, options);
  if (result.code === "external_posting_blocked") {
    throw new ExternalPostingBlockedError(result.reason);
  }
}

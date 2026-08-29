import {
  fetchRuntimeControls,
  type RuntimeControlsQueryClient,
} from "./runtimeControls.ts";

export type ExternalPostingBlockReason =
  | "invalid_environment"
  | "environment_missing_or_invalid"
  | "controls_unavailable"
  | "environment_mismatch"
  | "preview_environment"
  | "environment_breaker"
  | "database_control";

export type ExternalPostingGuardResult =
  | { allowed: true; code: "external_posting_allowed" }
  | { allowed: false; code: "external_posting_blocked"; reason: ExternalPostingBlockReason };

export type ExternalPostingDecision = {
  allowed: boolean;
  reason: ExternalPostingBlockReason | "allowed";
};

export type ExternalPostingGuardOptions = {
  environment?: unknown;
  allowExternalPosting?: unknown;
};

export type ExternalPostingClient = {
  from(table: string): {
    select(columns: string): {
      limit?(value: number): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
    } & PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
  };
};

export class ExternalPostingBlockedError extends Error {
  readonly code: "external_posting_blocked";
  readonly reason: ExternalPostingBlockReason;

  constructor(reason: ExternalPostingBlockReason) {
    super(`external posting is blocked:${reason}`);
    this.name = "ExternalPostingBlockedError";
    this.code = "external_posting_blocked";
    this.reason = reason;
  }
}

function envValue(name: string): string | undefined {
  try {
    return Deno.env.get(name) ?? undefined;
  } catch (_error) {
    return undefined;
  }
}

function normalizeEnvironment(value: unknown): "preview" | "production" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "preview" || normalized === "production" ? normalized : null;
}

function normalizeBreaker(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function readEnvironment(options: ExternalPostingGuardOptions): unknown {
  return Object.prototype.hasOwnProperty.call(options, "environment")
    ? options.environment
    : envValue("XOT_ENVIRONMENT");
}

function readPostingBreaker(options: ExternalPostingGuardOptions): unknown {
  return Object.prototype.hasOwnProperty.call(options, "allowExternalPosting")
    ? options.allowExternalPosting
    : envValue("ALLOW_EXTERNAL_POSTING");
}

/** Strict V2 guard. A malformed or unavailable singleton blocks delivery. */
export async function checkExternalPosting(
  client: RuntimeControlsQueryClient,
  options: ExternalPostingGuardOptions = {},
): Promise<ExternalPostingGuardResult> {
  const environment = normalizeEnvironment(readEnvironment(options));
  if (!environment) return { allowed: false, code: "external_posting_blocked", reason: "invalid_environment" };
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
  if (!normalizeBreaker(readPostingBreaker(options))) {
    return { allowed: false, code: "external_posting_blocked", reason: "environment_breaker" };
  }
  if (controls.posting_mode !== "enabled") {
    return { allowed: false, code: "external_posting_blocked", reason: "database_control" };
  }
  return { allowed: true, code: "external_posting_allowed" };
}

/** Compatibility evaluator for continuity callers; it still fails closed.
 *
 * This intentionally reads only the legacy control columns. It is safe for
 * read-only compatibility decisions, but must not be used as a provider-write
 * fallback because it cannot validate the strict runtime-control contract.
 */
export async function evaluateExternalPosting(
  client: ExternalPostingClient,
  options: { environment?: string; allowExternalPosting?: string } = {},
): Promise<ExternalPostingDecision> {
  const environment = normalizeEnvironment(options.environment ?? envValue("XOT_ENVIRONMENT"));
  if (!environment) return { allowed: false, reason: "environment_missing_or_invalid" };
  try {
    let query = client.from("runtime_controls").select("environment, posting_mode");
    if (typeof query.limit === "function") query = query.limit(2) as typeof query;
    const { data, error } = await query;
    const rows = Array.isArray(data) ? data : [];
    if (error || rows.length !== 1) return { allowed: false, reason: "controls_unavailable" };
    const row = rows[0] as Record<string, unknown>;
    if ((row.environment !== "preview" && row.environment !== "production") ||
      (row.posting_mode !== "blocked" && row.posting_mode !== "enabled")) {
      return { allowed: false, reason: "controls_unavailable" };
    }
    if (row.environment !== environment) return { allowed: false, reason: "environment_mismatch" };
    if (environment === "preview") return { allowed: false, reason: "preview_environment" };
    if (!normalizeBreaker(options.allowExternalPosting ?? envValue("ALLOW_EXTERNAL_POSTING"))) {
      return { allowed: false, reason: "environment_breaker" };
    }
    if (row.posting_mode !== "enabled") return { allowed: false, reason: "database_control" };
    return { allowed: true, reason: "allowed" };
  } catch (_error) {
    return { allowed: false, reason: "controls_unavailable" };
  }
}

/** Call immediately before any provider write. */
export async function requireExternalPosting(
  client: RuntimeControlsQueryClient | ExternalPostingClient,
  options: ExternalPostingGuardOptions = {},
): Promise<void> {
  const strict = await checkExternalPosting(client as RuntimeControlsQueryClient, options);
  if (!('reason' in strict)) return;
  throw new ExternalPostingBlockedError(strict.reason);
}

const ADMIN_EXTERNAL_POSTING_ACTIONS = new Set([
  "post_thread",
  "retry_step",
  "manual_video_intake_post",
  "retry_x_post",
  "send_test_tweet",
]);

/** Processing/translation retries remain available; delivery retries do not. */
export function adminActionRequiresExternalPosting(action: unknown, step: unknown): boolean {
  if (typeof action !== "string" || !ADMIN_EXTERNAL_POSTING_ACTIONS.has(action)) return false;
  return action !== "retry_step" || step === "deliver";
}

export function externalPostingBlockedResponse(
  reason: ExternalPostingBlockReason | "allowed",
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ ok: false, code: "external_posting_blocked", reason }), {
    status: 503,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

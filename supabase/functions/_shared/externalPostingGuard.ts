export type ExternalPostingControls = {
  environment: "production" | "preview";
  posting_mode: "blocked" | "enabled";
};

export type ExternalPostingDecision = {
  allowed: boolean;
  reason:
    | "allowed"
    | "environment_missing_or_invalid"
    | "controls_unavailable"
    | "environment_mismatch"
    | "preview_environment"
    | "environment_breaker"
    | "database_control";
};

type RuntimeControlsQuery =
  & PromiseLike<{
    data?: unknown;
    error?: { message?: string } | null;
  }>
  & {
    limit(value: number): RuntimeControlsQuery;
  };

export type ExternalPostingClient = {
  from(table: string): {
    select(columns: string): RuntimeControlsQuery;
  };
};

export class ExternalPostingBlockedError extends Error {
  readonly code = "external_posting_blocked";
  readonly reason: ExternalPostingDecision["reason"];

  constructor(reason: ExternalPostingDecision["reason"]) {
    super(`external_posting_blocked:${reason}`);
    this.name = "ExternalPostingBlockedError";
    this.reason = reason;
  }
}

function normalizeControls(value: unknown): ExternalPostingControls | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.environment !== "production" && row.environment !== "preview") {
    return null;
  }
  if (row.posting_mode !== "blocked" && row.posting_mode !== "enabled") {
    return null;
  }
  return {
    environment: row.environment,
    posting_mode: row.posting_mode,
  };
}

export async function evaluateExternalPosting(
  client: ExternalPostingClient,
  options: {
    environment?: string;
    allowExternalPosting?: string;
  } = {},
): Promise<ExternalPostingDecision> {
  const environment =
    (options.environment ?? Deno.env.get("XOT_ENVIRONMENT") ?? "")
      .trim()
      .toLowerCase();
  if (environment !== "production" && environment !== "preview") {
    return { allowed: false, reason: "environment_missing_or_invalid" };
  }

  const { data, error } = await client
    .from("runtime_controls")
    .select("environment, posting_mode")
    .limit(2);
  const rows = Array.isArray(data) ? data : [];
  if (error || rows.length !== 1) {
    return { allowed: false, reason: "controls_unavailable" };
  }
  const controls = normalizeControls(rows[0]);
  if (!controls) return { allowed: false, reason: "controls_unavailable" };
  if (controls.environment !== environment) {
    return { allowed: false, reason: "environment_mismatch" };
  }
  if (environment === "preview") {
    return { allowed: false, reason: "preview_environment" };
  }
  const environmentBreaker = (options.allowExternalPosting ??
    Deno.env.get("ALLOW_EXTERNAL_POSTING") ?? "")
    .trim()
    .toLowerCase();
  if (environmentBreaker !== "true" && environmentBreaker !== "1") {
    return { allowed: false, reason: "environment_breaker" };
  }
  if (controls.posting_mode !== "enabled") {
    return { allowed: false, reason: "database_control" };
  }
  return { allowed: true, reason: "allowed" };
}

export async function requireExternalPosting(
  client: ExternalPostingClient,
  options: {
    environment?: string;
    allowExternalPosting?: string;
  } = {},
): Promise<void> {
  const decision = await evaluateExternalPosting(client, options);
  if (!decision.allowed) throw new ExternalPostingBlockedError(decision.reason);
}

export function externalPostingBlockedResponse(
  reason: ExternalPostingDecision["reason"],
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      code: "external_posting_blocked",
      reason,
    }),
    {
      status: 503,
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

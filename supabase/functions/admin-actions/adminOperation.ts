import type { SupabaseAdminClient } from "./types.ts";

export type AdminOperationStatus = "committed" | "failed" | "still_running" | "unknown";

export type AdminOperationResult = {
  operation_id: string;
  operation_status: AdminOperationStatus;
};

type TableQueryBuilder = {
  select(columns: string): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  maybeSingle(): PromiseLike<{ data?: unknown; error?: unknown }>;
};

const ADMIN_OPERATION_TWEET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ADMIN_OPERATION_ID_PATTERN = /^(?:reprocess|hydrate:manual_monitoring):[A-Za-z0-9_-]{1,128}$/;

function jobsTable(supabase: SupabaseAdminClient): TableQueryBuilder {
  return supabase.from("jobs") as TableQueryBuilder;
}

export function canonicalAdminOperationId(action: string, tweetId: string): string | null {
  if (!ADMIN_OPERATION_TWEET_ID_PATTERN.test(tweetId)) return null;
  if (action === "reprocess") return `reprocess:${tweetId}`;
  if (action === "hydrate_post") return `hydrate:manual_monitoring:${tweetId}`;
  return null;
}

export function validateAdminOperationIdentity(
  action: string,
  tweetId: string,
  operationId: unknown,
): operationId is string {
  return typeof operationId === "string" &&
    canonicalAdminOperationId(action, tweetId) === operationId;
}

export function isSupportedAdminOperationId(operationId: unknown): operationId is string {
  return typeof operationId === "string" &&
    ADMIN_OPERATION_ID_PATTERN.test(operationId);
}

function mapJobStatus(status: unknown): AdminOperationStatus {
  if (status === "completed") return "committed";
  if (status === "failed" || status === "canceled" || status === "cancelled") return "failed";
  if (status === "pending" || status === "running") return "still_running";
  return "unknown";
}

export async function getAdminOperationStatus(
  supabase: SupabaseAdminClient,
  operationId: string,
): Promise<AdminOperationResult> {
  if (!isSupportedAdminOperationId(operationId)) {
    throw new Error("admin_operation_invalid_identity");
  }
  const { data, error } = await jobsTable(supabase)
    .select("status")
    .eq("idempotency_key", operationId)
    .maybeSingle();
  if (error) throw new Error("admin_operation_status_read_failed");
  const row = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  return {
    operation_id: operationId,
    operation_status: row ? mapJobStatus(row.status) : "unknown",
  };
}

export async function addAdminOperationEnvelope(
  supabase: SupabaseAdminClient,
  operationId: string | undefined,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (operationId === undefined) return body;
  return { ...body, ...await getAdminOperationStatus(supabase, operationId) };
}

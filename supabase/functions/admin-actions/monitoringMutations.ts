import { tweetReferenceVariants } from "./readHelpers.ts";
import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";
import { requireDeliveryCutover } from "../_shared/deliveryCutover.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  neq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  filter(column: string, operator: string, value: unknown): TableQueryBuilder;
  ilike(column: string, pattern: string): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type IgnoreMonitoringItemResult = {
  ok: boolean;
  tweet_id: string;
  ignored: boolean;
  closed?: {
    x_deliveries: number;
    deliveries: number;
    jobs: number;
  };
  error?: string;
  partial_update?: boolean;
};

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

export type UpdateLatestPostEnrichmentFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  patch: Record<string, unknown>,
) => Promise<void>;

export type MonitoringMutationDeps = {
  updateLatestPostEnrichment: UpdateLatestPostEnrichmentFn;
  recordFeedback: RecordFeedbackFn;
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function validateRowsWithIds(
  data: unknown,
  invalidResponse: string,
  invalidRow: string,
): string | null {
  if (!Array.isArray(data)) return invalidResponse;
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return invalidRow;
    }
    const id = (row as Record<string, unknown>).id;
    if (typeof id !== "string" || id.trim().length === 0) return invalidRow;
  }
  return null;
}

export function normalizeMonitoringIgnoreReason(
  body: Record<string, unknown>,
): string {
  return typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim().slice(0, 240)
    : "manual_ignore";
}

export async function closeJobsForIgnoredTweet(
  supabase: SupabaseAdminClient,
  tweetId: string,
  reason: string,
  now: string,
): Promise<
  { count: number; rows: Array<Record<string, unknown>>; error?: string }
> {
  const values = tweetReferenceVariants(tweetId);
  const numericValues = values.filter((value) => /^\d{5,}$/.test(value));
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  const patch = {
    status: "completed",
    completed_at: now,
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    result_meta: { admin_ignored: true, reason },
  };

  const collect = (data: unknown) => {
    for (const row of data as Array<Record<string, unknown>>) {
      const id = String(row.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
  };

  const closeByPayloadField = async (field: string, value: string) => {
    const { data, error } = await table(supabase, "jobs")
      .update(patch)
      .filter(`payload->>${field}`, "eq", value)
      .in("status", ["pending", "running", "failed"])
      .select("id, type");
    if (error) return "monitoring_ignore_jobs_update_failed";
    const shapeError = validateRowsWithIds(
      data,
      "monitoring_ignore_jobs_invalid_response",
      "monitoring_ignore_jobs_invalid_row",
    );
    if (shapeError) return shapeError;
    collect(data);
    return null;
  };

  for (const value of values) {
    for (
      const field of [
        "tweet_id",
        "target_tweet_id",
        "post_id",
        "url",
        "src_url",
      ]
    ) {
      const error = await closeByPayloadField(field, value);
      if (error) return { count: rows.length, rows, error };
    }
  }

  const idempotencyValues = [
    ...new Set([...numericValues, tweetId].filter((item) => item.length >= 8)),
  ];
  for (const value of idempotencyValues) {
    const escaped = value.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const { data, error } = await table(supabase, "jobs")
      .update(patch)
      .ilike("idempotency_key", `%${escaped}%`)
      .in("status", ["pending", "running", "failed"])
      .select("id, type");
    if (error) {
      return {
        count: rows.length,
        rows,
        error: "monitoring_ignore_jobs_update_failed",
      };
    }
    const shapeError = validateRowsWithIds(
      data,
      "monitoring_ignore_jobs_invalid_response",
      "monitoring_ignore_jobs_invalid_row",
    );
    if (shapeError) return { count: rows.length, rows, error: shapeError };
    collect(data);
  }

  return { count: rows.length, rows };
}

export async function ignoreMonitoringItemInternal(
  supabase: SupabaseAdminClient,
  tweetIdRaw: unknown,
  reason: string,
  deps: MonitoringMutationDeps,
): Promise<IgnoreMonitoringItemResult> {
  const tweetId = typeof tweetIdRaw === "string" ? tweetIdRaw.trim() : "";
  if (!tweetId) {
    return {
      ok: false,
      tweet_id: String(tweetIdRaw ?? ""),
      ignored: false,
      error: "tweet_id is required",
    };
  }

  const { data: post, error: postError } = await table(supabase, "posts")
    .select("tweet_id, dedupe_status")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (postError) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "monitoring_ignore_post_read_failed",
    };
  }
  if (!post || typeof post !== "object" || Array.isArray(post)) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: `Post not found: ${tweetId}`,
    };
  }

  try {
    // This action closes delivery rows and jobs. It must never mutate the
    // historical cohort or proceed while the immutable cutoff is unavailable.
    await requireDeliveryCutover(supabase, tweetId);
  } catch {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "delivery_cutover_blocked",
    };
  }

  const now = new Date().toISOString();
  const postPatch: Record<string, unknown> = {
    delivery_decision: "skip",
    decision_reason: `admin_ignored:${reason}`,
    feedback_locked: true,
    score_review_status: "rejected",
    enrich_status: "skipped",
  };
  if ((post as Record<string, unknown>).dedupe_status === "pending") {
    postPatch.dedupe_status = "unique";
    postPatch.dedupe_checked_at = now;
    postPatch.dedupe_reason = `admin_ignored:${reason}`;
  }

  const { error: postErr } = await table(supabase, "posts").update(postPatch)
    .eq("tweet_id", tweetId);
  if (postErr) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "monitoring_ignore_post_update_failed",
    };
  }

  const { data: xRows, error: xErr } = await table(supabase, "x_deliveries")
    .update({
      status: "skipped",
      skip_reason: `admin_ignored:${reason}`,
      last_error: null,
      updated_at: now,
    })
    .eq("post_id", tweetId)
    .in("status", ["pending", "failed"])
    .select("id");
  if (xErr) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "monitoring_ignore_x_deliveries_update_failed",
    };
  }
  const xShapeError = validateRowsWithIds(
    xRows,
    "monitoring_ignore_x_deliveries_invalid_response",
    "monitoring_ignore_x_deliveries_invalid_row",
  );
  if (xShapeError) {
    return { ok: false, tweet_id: tweetId, ignored: false, error: xShapeError };
  }

  const { data: deliveryRows, error: deliveryErr } = await table(
    supabase,
    "deliveries",
  )
    .update({
      status: "skipped",
      last_error: null,
      last_attempt_at: now,
    })
    .eq("subject_type", "post")
    .eq("subject_id", tweetId)
    .neq("status", "posted")
    .select("id");
  if (deliveryErr) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "monitoring_ignore_deliveries_update_failed",
    };
  }
  const deliveryShapeError = validateRowsWithIds(
    deliveryRows,
    "monitoring_ignore_deliveries_invalid_response",
    "monitoring_ignore_deliveries_invalid_row",
  );
  if (deliveryShapeError) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: deliveryShapeError,
    };
  }

  const jobClose = await closeJobsForIgnoredTweet(
    supabase,
    tweetId,
    reason,
    now,
  );
  if (jobClose.error) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: jobClose.error,
    };
  }

  await deps.updateLatestPostEnrichment(supabase, tweetId, {
    status: "skipped",
    feedback_label: "admin_ignored",
    feedback_note: reason,
    feedback_at: now,
  });
  try {
    await deps.recordFeedback(supabase, tweetId, "admin_ignore", 0, { reason });
  } catch (error) {
    return {
      ok: false,
      tweet_id: tweetId,
      ignored: false,
      error: "monitoring_ignore_feedback_write_failed",
      partial_update: true,
    };
  }
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "admin_ignore",
    "completed",
    {
      reason,
      x_rows_closed: Array.isArray(xRows) ? xRows.length : 0,
      delivery_rows_closed: Array.isArray(deliveryRows)
        ? deliveryRows.length
        : 0,
      jobs_closed: jobClose.count,
    },
  );

  return {
    ok: true,
    tweet_id: tweetId,
    ignored: true,
    closed: {
      x_deliveries: Array.isArray(xRows) ? xRows.length : 0,
      deliveries: Array.isArray(deliveryRows) ? deliveryRows.length : 0,
      jobs: jobClose.count,
    },
  };
}

export async function ignoreMonitoringItems(
  supabase: SupabaseAdminClient,
  tweetIds: string[],
  reason: string,
  deps: MonitoringMutationDeps,
) {
  const uniqueTweetIds = [
    ...new Set(
      tweetIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(
        Boolean,
      ),
    ),
  ];
  if (!uniqueTweetIds.length) {
    return { ok: false, error: "tweet_ids array is required" };
  }

  const results: IgnoreMonitoringItemResult[] = [];
  let totalX = 0;
  let totalDeliveries = 0;
  let totalJobs = 0;

  for (const tweetId of uniqueTweetIds) {
    const result = await ignoreMonitoringItemInternal(
      supabase,
      tweetId,
      reason,
      deps,
    );
    results.push(result);
    if (result.ok && result.closed) {
      totalX += result.closed.x_deliveries;
      totalDeliveries += result.closed.deliveries;
      totalJobs += result.closed.jobs;
    }
  }

  const successful = results.filter((result) => result.ok);
  const missing = uniqueTweetIds.filter((id) =>
    !results.find((result) => result.tweet_id === id)?.ok
  );
  return {
    ok: successful.length > 0,
    requested: uniqueTweetIds.length,
    found: successful.length,
    ignored: successful.length,
    missing,
    closed: {
      x_deliveries: totalX,
      deliveries: totalDeliveries,
      jobs: totalJobs,
    },
    results,
  };
}

export async function ignoreMonitoringItem(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: MonitoringMutationDeps,
) {
  const reason = normalizeMonitoringIgnoreReason(body);
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (!tweetId) return { ok: false, error: "tweet_id is required" };
  return await ignoreMonitoringItemInternal(supabase, tweetId, reason, deps);
}

export async function bulkIgnoreMonitoringItemsAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: MonitoringMutationDeps,
): Promise<AdminActionResponse> {
  const { tweet_ids, reason } = body;
  if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
    return { body: { error: "tweet_ids array is required" }, status: 400 };
  }
  const normalizedReason = normalizeMonitoringIgnoreReason({ reason });
  return {
    body: await ignoreMonitoringItems(
      supabase,
      tweet_ids as string[],
      normalizedReason,
      deps,
    ),
  };
}

export async function ignoreMonitoringItemAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: MonitoringMutationDeps,
): Promise<AdminActionResponse> {
  return {
    body: await ignoreMonitoringItem(supabase, body, deps),
  };
}

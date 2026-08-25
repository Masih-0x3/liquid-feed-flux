import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";
import {
  DeliveryCutoverBlockedError,
  requireDeliveryCutover,
} from "../_shared/deliveryCutover.ts";

type MutationResult = {
  data?: Array<Record<string, unknown>> | null;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<MutationResult> & {
  update(value: Record<string, unknown>): TableQueryBuilder;
  insert(value: Record<string, unknown>): PromiseLike<{ error?: unknown }>;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<{ error?: unknown }>;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  select(columns: string): PromiseLike<MutationResult>;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

const REPROCESS_JOB_PRIORITY = 20;

export async function editTranslationAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  recordFeedback: RecordFeedbackFn,
): Promise<AdminActionResponse> {
  const { tweet_id, text_translated } = body;
  if (!tweet_id || text_translated === undefined) {
    return {
      body: { error: "tweet_id and text_translated are required" },
      status: 400,
    };
  }
  const { error } = await table(supabase, "posts")
    .update({ text_translated })
    .eq("tweet_id", tweet_id);
  if (error) throw error;
  await recordFeedback(supabase, tweet_id as string, "edit_translation", 0)
    .catch(() => {});
  return { body: { success: true, message: "Translation updated" } };
}

export async function retryStepAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  recordFeedback: RecordFeedbackFn,
): Promise<AdminActionResponse> {
  const { tweet_id, step } = body;
  if (!tweet_id || !step) {
    return { body: { error: "tweet_id and step are required" }, status: 400 };
  }
  if (step === "deliver") {
    try {
      await requireDeliveryCutover(supabase, String(tweet_id));
    } catch (error) {
      if (!(error instanceof DeliveryCutoverBlockedError)) throw error;
      return {
        body: {
          ok: false,
          code: "delivery_cutover_blocked",
          error: error.message,
        },
        status: 409,
      };
    }
  }
  const { error } = await supabase.rpc("retry_step", { tweet_id, step });
  if (error) throw error;
  if (step === "deliver") {
    await recordFeedback(supabase, tweet_id as string, "force_deliver", 2)
      .catch(() => {});
    await table(supabase, "posts").update({ feedback_locked: true }).eq(
      "tweet_id",
      tweet_id,
    );
  }
  return { body: { success: true, message: `${step} retry queued` } };
}

export async function reprocessAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  recordFeedback: RecordFeedbackFn,
): Promise<AdminActionResponse> {
  const { tweet_id } = body;
  if (!tweet_id) {
    return { body: { error: "tweet_id is required" }, status: 400 };
  }
  const idempotencyKey = `reprocess:${tweet_id}`;
  const { error } = await table(supabase, "jobs")
    .upsert({
      type: "reprocess",
      payload: { tweet_id },
      status: "pending",
      priority: REPROCESS_JOB_PRIORITY,
      idempotency_key: idempotencyKey,
      next_run_at: new Date().toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw error;
  await recordFeedback(supabase, tweet_id as string, "reprocess", 0).catch(
    () => {},
  );
  return { body: { success: true, message: "Reprocess job queued" } };
}

export async function cancelPendingJobsAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const { types, include_running } = body as {
    types?: string[];
    include_running?: boolean;
  };
  const statuses = include_running === false
    ? ["pending"]
    : ["pending", "running"];
  let query = table(supabase, "jobs").in("status", statuses);
  if (Array.isArray(types) && types.length > 0) {
    query = query.in("type", types);
  }
  const { data: rows, error } = await query.select(
    "id,type,status,created_at,payload",
  );
  if (error) throw error;

  let cutoverAt: string | null = null;
  const hasDeliver = (rows || []).some((row) => row.type === "deliver");
  if (hasDeliver) {
    const result = await supabase.rpc("get_delivery_cutover");
    if (!result.error && typeof result.data === "string") {
      cutoverAt = result.data;
    }
  }

  const canceledRows: Array<Record<string, unknown>> = [];
  let skippedHistorical = 0;
  const eligibleDeliverRows: Array<Record<string, unknown>> = [];
  const nonDeliverRows: Array<Record<string, unknown>> = [];
  for (const row of rows || []) {
    if (row.type === "deliver") {
      const payload = row.payload && typeof row.payload === "object"
        ? row.payload as Record<string, unknown>
        : {};
      const tweetId = typeof payload.tweet_id === "string"
        ? payload.tweet_id
        : "";
      const jobCreatedAt = typeof row.created_at === "string"
        ? row.created_at
        : "";
      const jobIsPostCutover = Boolean(
        cutoverAt && jobCreatedAt &&
          new Date(jobCreatedAt).getTime() > new Date(cutoverAt).getTime(),
      );
      if (!jobIsPostCutover || !tweetId) {
        skippedHistorical++;
        continue;
      }
      try {
        await requireDeliveryCutover(supabase, tweetId);
      } catch (_error) {
        skippedHistorical++;
        continue;
      }
      eligibleDeliverRows.push(row);
      continue;
    }
    nonDeliverRows.push(row);
  }

  let cancellationError: string | null = null;
  const cancelRows = async (rowsToCancel: Array<Record<string, unknown>>) => {
    if (rowsToCancel.length === 0) return;
    const { error: updateError } = await table(supabase, "jobs")
      .update({
        status: "failed",
        last_error: "Manually canceled by admin",
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
      })
      .in("id", rowsToCancel.map((row) => row.id))
      .in("status", statuses)
      .select("id,type");
    if (updateError) {
      cancellationError = cancellationError ?? (updateError instanceof Error
        ? updateError.message
        : String(updateError));
      return;
    }
    canceledRows.push(...rowsToCancel);
  };

  // Keep processing/media/translation cancellation bulk and mutable. Deliver
  // rows are filtered and guarded first, then canceled as one separate batch.
  await cancelRows(nonDeliverRows);
  await cancelRows(eligibleDeliverRows);

  const byType: Record<string, number> = {};
  canceledRows.forEach((row) => {
    const type = String(row.type ?? "unknown");
    byType[type] = (byType[type] || 0) + 1;
  });
  return {
    body: {
      success: cancellationError === null,
      canceled: canceledRows.length,
      skipped_historical: skippedHistorical,
      by_type: byType,
      message: `Canceled ${canceledRows.length} job(s)`,
      ...(cancellationError ? { error: cancellationError } : {}),
    },
    ...(cancellationError ? { status: 500 } : {}),
  };
}

export async function bulkReprocessAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const { tweet_ids } = body;
  if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
    return { body: { error: "tweet_ids array is required" }, status: 400 };
  }
  const tweetIds = [
    ...new Set(
      tweet_ids.map((tid: unknown) => typeof tid === "string" ? tid.trim() : "")
        .filter(Boolean),
    ),
  ] as string[];
  const jobs = tweetIds.map((tid: string) => ({
    type: "reprocess",
    payload: { tweet_id: tid },
    status: "pending",
    priority: REPROCESS_JOB_PRIORITY,
    idempotency_key: `reprocess:${tid}`,
    next_run_at: new Date().toISOString(),
  }));
  const { error } = await table(supabase, "jobs").upsert(jobs, {
    onConflict: "idempotency_key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return {
    body: {
      success: true,
      requested: tweet_ids.length,
      queued: tweetIds.length,
      message: `${tweetIds.length} reprocess job(s) queued`,
    },
  };
}

export async function postThreadAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const { thread_id } = body;
  if (!thread_id) {
    return { body: { error: "thread_id is required" }, status: 400 };
  }
  // A thread has no single post-T lineage. Keep this manual posting path
  // fail-closed until it is redesigned around real post tweet IDs.
  return {
    body: {
      ok: false,
      code: "delivery_cutover_blocked",
      error: "Thread delivery requires a real post-T tweet_id lineage",
    },
    status: 409,
  };
}

export async function getHealthAdminAction(
  supabase: SupabaseAdminClient,
): Promise<AdminActionResponse> {
  const { data, error } = await supabase.rpc("get_system_health");
  if (error) throw error;
  return { body: { success: true, health: data } };
}

export async function reconcileStuckJobsAdminAction(
  supabase: SupabaseAdminClient,
): Promise<AdminActionResponse> {
  const { data, error } = await supabase.rpc("reconcile_stuck_jobs");
  if (error) throw error;
  await table(supabase, "pipeline_events").insert({
    subject_type: "system",
    subject_id: "queue",
    step: "reconcile",
    status: "completed",
    meta: { source: "admin_dashboard", result: data },
    ended_at: new Date().toISOString(),
  });
  return { body: { success: true, result: data } };
}

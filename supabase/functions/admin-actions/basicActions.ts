import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";
import { addAdminOperationEnvelope } from "./adminOperation.ts";

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
  ): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  select(columns: string): TableQueryBuilder;
  maybeSingle(): PromiseLike<MutationResult>;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

const REPROCESS_JOB_PRIORITY = 20;
const MAX_BULK_REPROCESS_TWEET_IDS = 100;
const REPROCESS_MEDIA_PRESERVED_MESSAGE =
  "Existing media will be preserved until staged media refresh is available.";
const THREAD_DELIVERY_UNAVAILABLE = "thread_delivery_unavailable";

function normalizeReprocessTweetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tweetId = value.trim();
  return tweetId.length > 0 && tweetId.length <= 128 ? tweetId : null;
}

function normalizeSingleReprocessTweetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

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
  try {
    await recordFeedback(supabase, tweet_id as string, "edit_translation", 0);
  } catch (feedbackError) {
    return {
      body: {
        success: false,
        error: "edit_translation_feedback_write_failed",
        partial_update: true,
      },
      status: 503,
    };
  }
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
  const { error } = await supabase.rpc("retry_step", { tweet_id, step });
  if (error) throw error;
  if (step === "deliver") {
    try {
      await recordFeedback(supabase, tweet_id as string, "force_deliver", 2);
    } catch (feedbackError) {
      return {
        body: {
          success: false,
          error: "retry_feedback_write_failed",
          partial_update: true,
        },
        status: 503,
      };
    }
    const { error: feedbackLockError } = await table(supabase, "posts").update({ feedback_locked: true }).eq(
      "tweet_id",
      tweet_id,
    );
    if (feedbackLockError) throw feedbackLockError;
  }
  return { body: { success: true, message: `${step} retry queued` } };
}

export async function reprocessAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  recordFeedback: RecordFeedbackFn,
): Promise<AdminActionResponse> {
  const { tweet_id } = body;
  const tweetId = normalizeReprocessTweetId(tweet_id);
  if (!tweetId || !/^[A-Za-z0-9_-]{1,128}$/.test(tweetId)) {
    return { body: { error: "tweet_id is required" }, status: 400 };
  }
  const idempotencyKey = `reprocess:${tweetId}`;
  const { data: insertedJob, error } = await table(supabase, "jobs")
    .upsert({
      type: "reprocess",
      payload: { tweet_id: tweetId },
      status: "pending",
      priority: REPROCESS_JOB_PRIORITY,
      idempotency_key: idempotencyKey,
      next_run_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const inserted = insertedJob !== null && typeof insertedJob === "object" && !Array.isArray(insertedJob) && typeof (insertedJob as Record<string, unknown>).id === "string";
  if (insertedJob !== null && !inserted) throw new Error("reprocess_enqueue_invalid_response");
  if (inserted) try {
    await recordFeedback(supabase, tweetId, "reprocess", 0);
  } catch (feedbackError) {
    return {
      body: await addAdminOperationEnvelope(supabase, typeof body.operation_id === "string" ? body.operation_id : undefined, {
        success: false,
          error: "reprocess_feedback_write_failed",
        partial_update: true,
      }),
      status: 503,
    };
  }
  return {
    body: await addAdminOperationEnvelope(supabase, typeof body.operation_id === "string" ? body.operation_id : undefined, {
      success: true,
      message: `Reprocess job queued. ${REPROCESS_MEDIA_PRESERVED_MESSAGE}`,
    }),
  };
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
  let query = table(supabase, "jobs")
    .update({
      status: "failed",
      last_error: "Manually canceled by admin",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
    })
    .in("status", statuses);
  if (Array.isArray(types) && types.length > 0) {
    query = query.in("type", types);
  }
  const { data, error } = await query.select("id, type");
  if (error) throw error;
  if (!Array.isArray(data)) {
    return {
      body: { success: false, error: "cancel_pending_jobs_invalid_response" },
      status: 503,
    };
  }
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.id !== "string" || row.id.trim().length === 0 ||
      typeof row.type !== "string" || row.type.trim().length === 0) {
      return {
        body: { success: false, error: "cancel_pending_jobs_invalid_row" },
        status: 503,
      };
    }
  }
  const canceled = data.length;
  const byType: Record<string, number> = {};
  data.forEach((row) => {
    const type = row.type as string;
    byType[type] = (byType[type] || 0) + 1;
  });
  return {
    body: {
      success: true,
      canceled,
      by_type: byType,
      message: `Canceled ${canceled} job(s)`,
    },
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
  if (tweet_ids.length > MAX_BULK_REPROCESS_TWEET_IDS) {
    return {
      body: {
        error: `tweet_ids may contain at most ${MAX_BULK_REPROCESS_TWEET_IDS} items`,
      },
      status: 400,
    };
  }
  const tweetIds = [
    ...new Set(
      tweet_ids.map(normalizeReprocessTweetId).filter(
        (tweetId): tweetId is string => tweetId !== null,
      ),
    ),
  ];
  if (tweetIds.length === 0) {
    return { body: { error: "tweet_ids must contain valid ids" }, status: 400 };
  }
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
      message: `${tweetIds.length} reprocess job(s) queued. ${REPROCESS_MEDIA_PRESERVED_MESSAGE}`,
    },
  };
}

export async function postThreadAdminAction(
  _supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
  if (!threadId) {
    return { body: { error: "thread_id is required" }, status: 400 };
  }
  return {
    body: {
      success: false,
      error: THREAD_DELIVERY_UNAVAILABLE,
      code: THREAD_DELIVERY_UNAVAILABLE,
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
  const { error: eventError } = await table(supabase, "pipeline_events").insert({
    subject_type: "system",
    subject_id: "queue",
    step: "reconcile",
    status: "completed",
    meta: { source: "admin_dashboard", result: data },
    ended_at: new Date().toISOString(),
  });
  if (eventError) throw eventError;
  return { body: { success: true, result: data } };
}

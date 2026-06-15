import {
  isRecordValue,
  jobTimingMeta,
  normalizeStep,
  parseRetryAfterFromMessage,
} from "./workerUtils.ts";
import { isProviderQuotaExhaustedError } from "../_shared/providerErrors.ts";

export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

const MAX_ATTEMPTS: Record<string, number> = {
  translate: 5,
  deliver: 8,
  download_media: 3,
  moderate: 3,
  reprocess: 3,
  hydrate_tweet: 3,
  resolve_media: 4,
  enrich: 3,
};

// deno-lint-ignore no-explicit-any
export async function handleJobFailure(
  supabase: any,
  job: Record<string, unknown>,
  errorOrMessage?: Error | string,
): Promise<void> {
  const jobType = job.type as string;
  const maxAttempts = MAX_ATTEMPTS[jobType] ?? 5;
  const attempts = (job.attempts as number) ?? 0;
  let errorMsg: string;
  if (typeof errorOrMessage === "string") {
    errorMsg = errorOrMessage.trim() || "Unknown job failure";
  } else if (errorOrMessage instanceof Error) {
    errorMsg = (errorOrMessage.message && errorOrMessage.message.trim())
      ? errorOrMessage.message.trim()
      : (errorOrMessage.name || "Error");
  } else if (errorOrMessage != null) {
    errorMsg = String(errorOrMessage);
  } else {
    errorMsg = "Unknown job failure (no error passed)";
  }
  const nonRetryableReason = errorOrMessage instanceof NonRetryableJobError
    ? "explicit_non_retryable"
    : isProviderQuotaExhaustedError(errorMsg)
    ? "provider_quota_exhausted"
    : null;
  const nonRetryable = nonRetryableReason !== null;

  if (nonRetryable || attempts >= maxAttempts) {
    // Dead-letter the job
    try {
      await supabase.from("dead_letter_jobs").insert({
        original_job_id: job.id as string,
        type: jobType,
        payload: job.payload,
        attempts,
        last_error: errorMsg,
        result_meta: job.result_meta ?? null,
        source: nonRetryable ? "worker_non_retryable" : "worker",
      });
    } catch (_e) {
      console.error(JSON.stringify({
        function: "worker",
        action: "dead_letter_failed",
        job_id: job.id,
      }));
    }

    await supabase.from("jobs").update({
      status: "failed",
      last_error: errorMsg,
      result_meta: {
        ...(isRecordValue(job.result_meta)
          ? job.result_meta as Record<string, unknown>
          : {}),
        ...jobTimingMeta(job, "failed", {
          error: errorMsg,
          non_retryable: nonRetryable,
          non_retryable_reason: nonRetryableReason,
        }),
      },
    }).eq("id", job.id);
    console.log(JSON.stringify({
      function: "worker",
      action: nonRetryable ? "job_failed_non_retryable" : "job_dead_lettered",
      job_id: job.id,
      attempts,
    }));
  } else {
    // Telegram-aware backoff
    let retryAfterSeconds: number | null = null;
    if (
      errorOrMessage && typeof errorOrMessage === "object" &&
      "retryAfterSeconds" in errorOrMessage
    ) {
      retryAfterSeconds = Math.max(
        1,
        Math.floor(
          (errorOrMessage as { retryAfterSeconds: number }).retryAfterSeconds,
        ),
      );
    } else {
      retryAfterSeconds = parseRetryAfterFromMessage(errorMsg);
    }

    let nextRunAt: Date;
    if (retryAfterSeconds != null) {
      const jitter = Math.floor(retryAfterSeconds * (Math.random() * 0.2));
      nextRunAt = new Date(Date.now() + (retryAfterSeconds + jitter) * 1000);
    } else {
      // Exponential backoff: 30s, 60s, 120s, 240s, 480s, ...
      const baseDelaySec = 30;
      const delaySec = baseDelaySec * Math.pow(2, attempts);
      const jitterSec = Math.floor(delaySec * Math.random() * 0.2);
      nextRunAt = new Date(Date.now() + (delaySec + jitterSec) * 1000);
    }

    await supabase.from("jobs").update({
      status: "pending",
      last_error: errorMsg,
      next_run_at: nextRunAt.toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      result_meta: {
        ...(isRecordValue(job.result_meta)
          ? job.result_meta as Record<string, unknown>
          : {}),
        ...jobTimingMeta(job, "failed", {
          error: errorMsg,
          retry_after_seconds: retryAfterSeconds,
        }),
        rescheduled_for: nextRunAt.toISOString(),
      },
    }).eq("id", job.id);
  }
}

// deno-lint-ignore no-explicit-any
export async function mergeJobResultMeta(
  supabase: any,
  job: Record<string, unknown>,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!job.id) return;
  try {
    const { data } = await supabase
      .from("jobs")
      .select("result_meta")
      .eq("id", job.id)
      .maybeSingle();
    const current = isRecordValue(data?.result_meta)
      ? data.result_meta as Record<string, unknown>
      : isRecordValue(job.result_meta)
      ? job.result_meta as Record<string, unknown>
      : {};
    await supabase
      .from("jobs")
      .update({ result_meta: { ...current, ...meta } })
      .eq("id", job.id);
  } catch (_e) {
    // best-effort
  }
}

// deno-lint-ignore no-explicit-any
export async function recordPipelineEvent(
  supabase: any,
  job: Record<string, unknown>,
  state: "queued" | "running" | "completed" | "failed",
  error?: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const payload = job.payload as Record<string, unknown> | null;
    const subjectType = (payload?.subject_type as string) ?? "post";
    const subjectId = (payload?.tweet_id as string) ??
      (payload?.subject_id as string) ?? null;
    if (!subjectId) return;
    const step = normalizeStep(job.type as string);
    const now = new Date().toISOString();
    const startedAt = state === "queued"
      ? null
      : state === "running"
      ? now
      : (typeof job.locked_at === "string"
        ? job.locked_at
        : typeof job.started_at === "string"
        ? job.started_at
        : null);
    const endedAt = state === "running" || state === "queued" ? null : now;
    await insertPipelineEvent(
      supabase,
      subjectType,
      subjectId,
      step,
      state,
      startedAt,
      endedAt,
      error,
      jobTimingMeta(job, state, { ...meta, ...(error ? { error } : {}) }),
    );
  } catch (_e) {
    // best-effort
  }
}

export async function insertPipelineEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  subjectType: string,
  subjectId: string,
  step: string,
  status: string,
  startedAt?: string | null,
  endedAt?: string | null,
  error?: string | null,
  meta?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await supabase.from("pipeline_events").insert({
      subject_type: subjectType,
      subject_id: subjectId,
      step,
      status,
      started_at: startedAt ?? null,
      ended_at: endedAt ?? null,
      error: error ?? null,
      meta: meta ?? null,
    });
  } catch (_e) {
    // best-effort
  }
}

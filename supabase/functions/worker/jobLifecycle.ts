import {
  isRecordValue,
  jobTimingMeta,
  normalizeStep,
  parseRetryAfterFromMessage,
} from "./workerUtils.ts";
import { isProviderQuotaExhaustedError } from "../_shared/providerErrors.ts";
import {
  CLAIM_GENERATION_PATCH_KEY,
  CLAIM_TOKEN_PATCH_KEY,
  CLAIM_STATE_PATCH_KEY,
  assertClaimEnvelope,
  embedClaimEnvelope,
  withProviderBoundary,
  type ProviderBoundaryOutcome,
} from "../_shared/durableClaimFence.ts";

export {
  CLAIM_GENERATION_PATCH_KEY,
  CLAIM_TOKEN_PATCH_KEY,
  CLAIM_STATE_PATCH_KEY,
} from "../_shared/durableClaimFence.ts";

/**
 * Wrap a checked-write patch with the durable claim envelope taken from the job row.
 * The reserved keys let updateJobOrThrow apply token/generation/state as EQUALITY
 * fences (never update values), so every terminal write is fenced by the fresh
 * claim identity. Salvage jobs whose claim was lost are excluded via a zero-row
 * rejection upstream.
 */
export function claimEnvelopedPatch(
  job: Record<string, unknown>,
  patch: Record<string, unknown>,
  claimState: string | null = null,
): Record<string, unknown> {
  const enveloped = embedClaimEnvelope(patch, job);
  const expectedState = claimState ??
    (typeof job.claim_state === "string" ? job.claim_state : null);
  if (expectedState) {
    enveloped[CLAIM_STATE_PATCH_KEY] = expectedState;
  }
  return enveloped;
}

const LIFECYCLE_ERROR_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,12}(?::[a-z0-9]+(?:[_-][a-z0-9]+)*)*$/;

type LifecycleResult = {
  data?: unknown;
  error?: unknown;
};

type LifecycleTerminal = PromiseLike<LifecycleResult>;

/**
 * Supabase's `from()` builder is not thenable. Only the filter builder returned
 * after `select`/`update`/`insert` is a terminal promise, so keeping those stages
 * separate avoids requiring PromiseLike on the real PostgrestQueryBuilder.
 */
type LifecycleFilter = LifecycleTerminal & {
  select(columns: string): LifecycleTerminal;
  eq(column: string, value: unknown): LifecycleFilter;
  maybeSingle(): PromiseLike<LifecycleResult>;
};

type LifecycleQuery = {
  update(values: Record<string, unknown>): LifecycleFilter;
  insert(values: Record<string, unknown>): LifecycleTerminal;
  select(columns: string): LifecycleFilter;
};

type LifecycleClient = {
  from(table: string): LifecycleQuery;
};

function rawLifecycleErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "").trim();
  }
  return "";
}

function safeLifecycleErrorCode(error: unknown, fallback: string): string {
  const message = rawLifecycleErrorMessage(error);
  return message.length >= 3 && message.length <= 128 &&
      LIFECYCLE_ERROR_CODE.test(message)
    ? message
    : fallback;
}

export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

export class JobStateWriteError extends Error {
  operation: string;

  constructor(operation: string, reason: string) {
    super(
      `job_state_write_failed:${operation}:${safeLifecycleErrorCode(reason, "database_error")}`,
    );
    this.name = "JobStateWriteError";
    this.operation = operation;
  }
}

/**
 * A lifecycle state transition is authoritative work, not best-effort
 * telemetry. Surface database failures to the caller so it cannot report a
 * completion, defer, or terminal failure that was never persisted.
 */
export async function updateJobOrThrow(
  supabase: LifecycleClient,
  jobId: unknown,
  patch: Record<string, unknown>,
  operation: string,
  ownerId: unknown,
): Promise<void> {
  const id = typeof jobId === "string" ? jobId.trim() : "";
  if (!id) {
    throw new JobStateWriteError(operation, "missing_job_id");
  }
  const owner = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!owner) {
    throw new JobStateWriteError(operation, "missing_owner_fence");
  }
  // A claimed write must carry the durable claim envelope. It arrives under
  // reserved patch keys (see embedClaimEnvelope/claimEnvelopedPatch) and is
  // applied as token + generation EQUALITY fences -- never as update values -- so
  // a stale worker whose lease expired or was reclaimed holds the OLD token and
  // OLD generation and can only ever be rejected with a zero-row update. This is
  // the fail-closed guarantee: reclaimed work never surfaces as success.
  const values: Record<string, unknown> = { ...patch };
  const claimToken = typeof values[CLAIM_TOKEN_PATCH_KEY] === "string"
    ? values[CLAIM_TOKEN_PATCH_KEY] as string
    : "";
  const claimGenerationRaw = values[CLAIM_GENERATION_PATCH_KEY];
  const claimGeneration = typeof claimGenerationRaw === "number"
    && Number.isInteger(claimGenerationRaw)
    && claimGenerationRaw > 0
    ? claimGenerationRaw
    : NaN;
  const expectedClaimState = typeof values[CLAIM_STATE_PATCH_KEY] === "string"
    ? values[CLAIM_STATE_PATCH_KEY] as string
    : "";
  try {
    assertClaimEnvelope(
      {
        id,
        locked_by: owner,
        claim_token: claimToken,
        claim_generation: claimGeneration,
        claim_state: expectedClaimState,
      },
      operation,
      (message) => {
        const prefix = `job_state_write_failed:${operation}:`;
        const reason = message.startsWith(prefix) ? message.slice(prefix.length) : message;
        throw new JobStateWriteError(operation, reason);
      },
    );
  } catch (error) {
    if (error instanceof JobStateWriteError) throw error;
    throw new JobStateWriteError(operation, "missing_claim_fence");
  }
  delete values[CLAIM_TOKEN_PATCH_KEY];
  delete values[CLAIM_GENERATION_PATCH_KEY];
  delete values[CLAIM_STATE_PATCH_KEY];
  let updateQuery = supabase.from("jobs").update(values).eq("id", id);
  updateQuery = updateQuery.eq("locked_by", owner);
  updateQuery = updateQuery.eq("claim_token", claimToken);
  updateQuery = updateQuery.eq("claim_generation", claimGeneration);
  updateQuery = updateQuery.eq("claim_state", expectedClaimState);
  const { data: updatedRows, error } = await updateQuery.select("id");
  if (error) {
    throw new JobStateWriteError(operation, "database_error");
  }
  if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
    throw new JobStateWriteError(operation, "affected_rows_unknown");
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

type ProviderRpcResult = {
  data?: unknown;
  error?: unknown;
};

type ProviderRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<ProviderRpcResult>;
};

/**
 * Durable provider-start boundary for a queue job (SF1 / AIR-005).
 *
 * Persists `provider_started_at` + `claim_state='posting'` via
 * `mark_job_provider_started` BEFORE the worker invokes a provider. A DB marker
 * failure or rejected (stale/zero-row) marker must abort the job with ZERO provider
 * calls. This is the same ordering guarantee the shared `withProviderBoundary`
 * helper enforces for the X path, applied to every side-effect-capable queue job.
 */
export async function markJobProviderStarted(
  supabase: ProviderRpcClient,
  job: Record<string, unknown>,
): Promise<boolean> {
  const token = typeof job.claim_token === "string" ? job.claim_token.trim() : "";
  if (!token) return false;
  const rawGen = job.claim_generation;
  const generation = typeof rawGen === "number" && Number.isInteger(rawGen) && rawGen > 0
    ? rawGen
    : typeof rawGen === "string" && /^\d+$/.test(rawGen.trim())
    ? Number(rawGen.trim())
    : NaN;
  if (!Number.isInteger(generation) || generation <= 0) return false;
  const { data, error } = await supabase.rpc("mark_job_provider_started", {
    p_job_id: job.id,
    p_claim_token: token,
    p_claim_generation: generation,
  });
  if (error) throw new JobStateWriteError("provider_start", "database_error");
  if (data === true) job.claim_state = "posting";
  return data === true;
}

/**
 * Run a single side-effect-capable queue-job handler inside the durable
 * provider-start boundary. The handler (provider) is invoked ONLY after the marker
 * is durably persisted; otherwise the returned outcome is a non-success marker
 * failure and the provider never runs.
 */
export async function runJobWithProviderBoundary<T>(
  supabase: ProviderRpcClient,
  job: Record<string, unknown>,
  provider: () => Promise<T>,
  complete: (result: T) => Promise<boolean>,
): Promise<ProviderBoundaryOutcome<T>> {
  return withProviderBoundary({
    markStarted: () => markJobProviderStarted(supabase, job),
    provider,
    complete,
  });
}

export async function handleJobFailure(
  supabase: LifecycleClient,
  job: Record<string, unknown>,
  errorOrMessage?: Error | string,
  runtimeMeta: Record<string, unknown> = {},
): Promise<void> {
  const jobType = job.type as string;
  const maxAttempts = MAX_ATTEMPTS[jobType] ?? 5;
  const attempts = (job.attempts as number) ?? 0;
  let rawErrorMsg: string;
  if (typeof errorOrMessage === "string") {
    rawErrorMsg = errorOrMessage.trim() || "Unknown job failure";
  } else if (errorOrMessage instanceof Error) {
    rawErrorMsg = (errorOrMessage.message && errorOrMessage.message.trim())
      ? errorOrMessage.message.trim()
      : (errorOrMessage.name || "Error");
  } else if (errorOrMessage != null) {
    rawErrorMsg = String(errorOrMessage);
  } else {
    rawErrorMsg = "Unknown job failure (no error passed)";
  }
  const nonRetryableReason = errorOrMessage instanceof NonRetryableJobError
    ? "explicit_non_retryable"
    : isProviderQuotaExhaustedError(rawErrorMsg)
    ? "provider_quota_exhausted"
    : null;
  const nonRetryable = nonRetryableReason !== null;
  const errorMsg = safeLifecycleErrorCode(
    rawErrorMsg,
    nonRetryableReason ?? "job_failed",
  );
  const reconciliationRequired = rawErrorMsg.startsWith(
    "completion_persistence_unknown:",
  );

  if (nonRetryable || attempts >= maxAttempts) {
    // Dead-letter the job
    const { error: deadLetterError } = await supabase.from("dead_letter_jobs")
      .insert({
        original_job_id: job.id as string,
        type: jobType,
        payload: job.payload,
        attempts,
        last_error: errorMsg,
        result_meta: job.result_meta ?? null,
        source: nonRetryable ? "worker_non_retryable" : "worker",
      });
    if (deadLetterError) {
      console.error(JSON.stringify({
        function: "worker",
        action: "dead_letter_failed",
        job_id: job.id,
      }));
      throw new Error("dead_letter_write_failed");
    }

    await updateJobOrThrow(supabase, job.id, claimEnvelopedPatch(job, {
      status: "failed",
      last_error: errorMsg,
      claim_state: "failed",
      result_meta: {
        ...(isRecordValue(job.result_meta)
          ? job.result_meta as Record<string, unknown>
          : {}),
        ...jobTimingMeta(job, "failed", {
          ...runtimeMeta,
          error: errorMsg,
          non_retryable: nonRetryable,
          non_retryable_reason: nonRetryableReason,
          reconciliation_required: reconciliationRequired,
        }),
      },
    }), "failure_terminal", job.locked_by);
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

    await updateJobOrThrow(supabase, job.id, claimEnvelopedPatch(job, {
      status: "pending",
      last_error: errorMsg,
      next_run_at: nextRunAt.toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      claim_state: "idle",
      result_meta: {
        ...(isRecordValue(job.result_meta)
          ? job.result_meta as Record<string, unknown>
          : {}),
        ...jobTimingMeta(job, "failed", {
          ...runtimeMeta,
          error: errorMsg,
          retry_after_seconds: retryAfterSeconds,
        }),
        rescheduled_for: nextRunAt.toISOString(),
      },
    }), "failure_retry", job.locked_by);
  }
}

export async function mergeJobResultMeta(
  supabase: LifecycleClient,
  job: Record<string, unknown>,
  meta: Record<string, unknown>,
): Promise<void> {
  const jobId = typeof job.id === "string" ? job.id.trim() : "";
  const owner = typeof job.locked_by === "string" ? job.locked_by.trim() : "";
  if (!jobId || !owner) return;
  const { data, error } = await supabase
    .from("jobs")
    .select("result_meta")
    .eq("id", jobId)
    .eq("locked_by", owner)
    .maybeSingle();
  if (error) {
    throw new JobStateWriteError("result_meta_read", "database_error");
  }
  const storedRow = isRecordValue(data) ? data : null;
  const current = isRecordValue(storedRow?.result_meta)
    ? storedRow.result_meta as Record<string, unknown>
    : isRecordValue(job.result_meta)
    ? job.result_meta as Record<string, unknown>
    : {};
  await updateJobOrThrow(
    supabase,
    jobId,
    claimEnvelopedPatch(job, { result_meta: { ...current, ...meta } }),
    "result_meta",
    owner,
  );
}

export async function recordPipelineEvent(
  supabase: LifecycleClient,
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
    console.warn(JSON.stringify({
      function: "worker",
      action: "pipeline_event_insert_failed",
      error: "worker_pipeline_event_insert_failed",
    }));
  }
}

export async function insertPipelineEvent(
  supabase: LifecycleClient,
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
    const safeError = error == null
      ? null
      : safeLifecycleErrorCode(error, "pipeline_failed");
    const safeMeta = meta && typeof meta === "object" && !Array.isArray(meta)
      ? { ...meta }
      : null;
    if (safeMeta && safeMeta.error != null) {
      safeMeta.error = safeLifecycleErrorCode(safeMeta.error, "pipeline_failed");
    }
    const { error: pipelineEventError } = await supabase.from("pipeline_events").insert({
      subject_type: subjectType,
      subject_id: subjectId,
      step,
      status,
      started_at: startedAt ?? null,
      ended_at: endedAt ?? null,
      error: safeError,
      meta: safeMeta,
    });
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: "worker",
        action: "pipeline_event_insert_failed",
        error: "worker_pipeline_event_insert_failed",
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: "worker",
      action: "pipeline_event_insert_failed",
      error: "worker_pipeline_event_insert_failed",
    }));
  }
}

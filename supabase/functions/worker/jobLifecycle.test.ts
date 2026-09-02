import { assert, assertEquals } from "jsr:@std/assert";
import {
  handleJobFailure,
  insertPipelineEvent,
  JobStateWriteError,
  mergeJobResultMeta,
  NonRetryableJobError,
  recordPipelineEvent,
  updateJobOrThrow,
} from "./jobLifecycle.ts";

type FakeCall = {
  table: string;
  action: string;
  columns?: string;
  payload?: unknown;
  filters?: Array<{ column: string; value: unknown }>;
};

type LifecycleClientForTest = Parameters<typeof updateJobOrThrow>[0];

type FakeSupabase = LifecycleClientForTest & {
  calls: FakeCall[];
};

const TEST_CLAIM = {
  claim_token: "claim-token-test",
  claim_generation: 1,
  claim_state: "preparing",
};

function claimedJob(job: Record<string, unknown>): Record<string, unknown> {
  return { ...TEST_CLAIM, ...job };
}

function createFakeSupabase(options: {
  selectData?: Record<string, Record<string, unknown> | null>;
  insertFailures?: string[];
  updateFailures?: string[];
  updateNoRows?: string[];
} = {}): FakeSupabase {
  const calls: FakeCall[] = [];
  const insertFailures = new Set(options.insertFailures ?? []);
  const updateFailures = new Set(options.updateFailures ?? []);
  const updateNoRows = new Set(options.updateNoRows ?? []);
  return {
    calls,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      let pending: FakeCall | null = null;
      const builder = {
        select(columns: string) {
          if (pending?.action === "update") {
            calls.push({ ...pending, columns, filters: [...filters] });
            return Promise.resolve({
              data: updateNoRows.has(table) ? [] : [{ id: "updated" }],
              error: updateFailures.has(table)
                ? { message: `${table}_update_failed` }
                : null,
            });
          }
          pending = { table, action: "select", columns, filters };
          return builder;
        },
        update(payload: unknown) {
          pending = { table, action: "update", payload, filters };
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        maybeSingle() {
          calls.push({ table, action: "maybeSingle", filters: [...filters] });
          return Promise.resolve({
            data: options.selectData?.[table] ?? null,
            error: null,
          });
        },
        insert(payload: unknown) {
          calls.push({ table, action: "insert", payload });
          if (insertFailures.has(table)) {
            throw new Error(`${table}_insert_failed`);
          }
          return Promise.resolve({ error: null });
        },
      };
      return builder as unknown as ReturnType<FakeSupabase["from"]>;
    },
  };
}

function findCall(
  calls: FakeCall[],
  table: string,
  action: string,
): FakeCall {
  const call = calls.find((entry) =>
    entry.table === table && entry.action === action
  );
  assert(call, `missing ${table}.${action} call`);
  return call;
}

async function withFrozenTime<T>(
  nowMs: number,
  randomValue: number,
  fn: () => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => nowMs;
  Math.random = () => randomValue;
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
}

async function withMutedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

Deno.test("handleJobFailure dead-letters exhausted jobs and preserves result metadata", async () => {
  const supabase = createFakeSupabase();

  await withMutedConsole(async () => {
    await handleJobFailure(supabase, claimedJob({
      id: "job1",
      locked_by: "worker-test",
      type: "translate",
      attempts: 5,
      payload: { tweet_id: "tweet1" },
      result_meta: { existing: true },
      created_at: "2026-01-01T00:00:00.000Z",
      locked_at: "2026-01-01T00:00:10.000Z",
    }), new Error("translation failed"));
  });

  const deadLetter = findCall(supabase.calls, "dead_letter_jobs", "insert")
    .payload as Record<string, unknown>;
  assertEquals(deadLetter.original_job_id, "job1");
  assertEquals(deadLetter.type, "translate");
  assertEquals(deadLetter.last_error, "job_failed");
  assertEquals(deadLetter.source, "worker");

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(update.last_error, "job_failed");
  assertEquals(resultMeta.existing, true);
  assertEquals(resultMeta.error, "job_failed");
  assertEquals(resultMeta.non_retryable, false);
});

Deno.test("updateJobOrThrow surfaces a lifecycle database result error", async () => {
  const supabase = createFakeSupabase({ updateFailures: ["jobs"] });
  let thrown: unknown;

  try {
    await updateJobOrThrow(
      supabase,
      "job-write-error",
      {
        status: "completed",
        __claim_token: "claim-token-test",
        __claim_generation: 1,
        __claim_state: "preparing",
      },
      "complete",
      "worker-test",
    );
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof JobStateWriteError);
  assertEquals((thrown as Error).message, "job_state_write_failed:complete:database_error");
});

Deno.test("updateJobOrThrow rejects a zero-row lifecycle update", async () => {
  const supabase = createFakeSupabase({ updateNoRows: ["jobs"] });
  let thrown: unknown;

  try {
    await updateJobOrThrow(
      supabase,
      "job-zero-row",
      {
        status: "completed",
        __claim_token: "claim-token-test",
        __claim_generation: 1,
        __claim_state: "preparing",
      },
      "complete",
      "worker-test",
    );
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof JobStateWriteError);
  assertEquals((thrown as Error).message, "job_state_write_failed:complete:affected_rows_unknown");
});

Deno.test("updateJobOrThrow gates the checked write on the embedded claim token and generation", async () => {
  const supabase = createFakeSupabase();
  await updateJobOrThrow(
    supabase,
    "job-claim-fence",
    {
      status: "completed",
      __claim_token: "claim-token-abc",
      __claim_generation: 7,
      __claim_state: "preparing",
    },
    "complete",
    "worker-test",
  );
  const update = findCall(supabase.calls, "jobs", "update");
  const filters = update.filters as Array<{ column: string; value: unknown }>;
  const fence = new Map(filters.map((item) => [item.column, item.value]));
  assertEquals(fence.get("locked_by"), "worker-test");
  assertEquals(fence.get("claim_token"), "claim-token-abc");
  assertEquals(fence.get("claim_generation"), 7);
  assertEquals(fence.get("claim_state"), "preparing");
  const payload = update.payload as Record<string, unknown>;
  assertEquals(payload.__claim_token, undefined);
  assertEquals(payload.__claim_generation, undefined);
  assertEquals(payload.status, "completed");
});

Deno.test("updateJobOrThrow rejects missing or invalid claim generation instead of weakening the fence", async () => {
  const supabase = createFakeSupabase();
  let thrown: unknown;
  try {
    await updateJobOrThrow(
      supabase,
      "job-claim-gen-invalid",
      {
        status: "completed",
        __claim_token: "claim-token-abc",
        __claim_generation: "not-a-number",
        __claim_state: "preparing",
      },
      "complete",
      "worker-test",
    );
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof JobStateWriteError);
  assertEquals((thrown as Error).message, "job_state_write_failed:complete:missing_claim_fence");
  assertEquals(supabase.calls.length, 0);
});

Deno.test("updateJobOrThrow rejects a missing expected active claim state", async () => {
  const supabase = createFakeSupabase();
  let thrown: unknown;
  try {
    await updateJobOrThrow(
      supabase,
      "job-claim-state-missing",
      {
        status: "completed",
        __claim_token: "claim-token-abc",
        __claim_generation: 2,
      },
      "complete",
      "worker-test",
    );
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof JobStateWriteError);
  assertEquals((thrown as Error).message, "job_state_write_failed:complete:missing_claim_state");
  assertEquals(supabase.calls.length, 0);
});

Deno.test("updateJobOrThrow rejects a stale terminal claim state before touching the database", async () => {
  const supabase = createFakeSupabase();
  let thrown: unknown;
  try {
    await updateJobOrThrow(
      supabase,
      "job-stale-state",
      {
        status: "failed",
        __claim_token: "claim-token-abc",
        __claim_generation: 2,
        __claim_state: "posted",
      },
      "failure_terminal",
      "worker-test",
    );
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof JobStateWriteError);
  assertEquals((thrown as Error).message, "job_state_write_failed:failure_terminal:invalid_claim_state:posted");
  assertEquals(supabase.calls.length, 0);
});

Deno.test("handleJobFailure persists reconciliation-required metadata after completion state uncertainty", async () => {
  const supabase = createFakeSupabase();

  await withMutedConsole(async () => {
    await handleJobFailure(supabase, claimedJob({
      id: "job-completion-unknown",
      locked_by: "worker-test",
      type: "deliver",
      attempts: 0,
      payload: { tweet_id: "tweet-completion-unknown" },
    }), new NonRetryableJobError(
      "completion_persistence_unknown:job_state_write_failed:complete:jobs_update_failed",
    ));
  });

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(resultMeta.reconciliation_required, true);
  assertEquals(resultMeta.non_retryable, true);
});

Deno.test("handleJobFailure leaves the job state untouched when terminal dead-letter persistence fails", async () => {
  const supabase = createFakeSupabase({ insertFailures: ["dead_letter_jobs"] });
  let thrown: unknown;

  await withMutedConsole(async () => {
    try {
      await handleJobFailure(supabase, claimedJob({
        id: "job-dead-letter-error",
        locked_by: "worker-test",
        type: "translate",
        attempts: 5,
        payload: { tweet_id: "tweet-dead-letter-error" },
      }), new Error("translation failed"));
    } catch (error) {
      thrown = error;
    }
  });

  assert(thrown instanceof Error);
  assertEquals((thrown as Error).message, "dead_letter_jobs_insert_failed");
  assertEquals(
    supabase.calls.some((call) => call.table === "jobs" && call.action === "update"),
    false,
  );
});

Deno.test("handleJobFailure dead-letters non-retryable failures immediately", async () => {
  const supabase = createFakeSupabase();

  await withMutedConsole(async () => {
    await handleJobFailure(supabase, claimedJob({
      id: "job2",
      locked_by: "worker-test",
      type: "deliver",
      attempts: 0,
      payload: { tweet_id: "tweet2" },
    }), new NonRetryableJobError("video too large"));
  });

  const deadLetter = findCall(supabase.calls, "dead_letter_jobs", "insert")
    .payload as Record<string, unknown>;
  assertEquals(deadLetter.source, "worker_non_retryable");
  assertEquals(deadLetter.last_error, "explicit_non_retryable");

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(resultMeta.non_retryable, true);
  assertEquals(resultMeta.non_retryable_reason, "explicit_non_retryable");
});

Deno.test("handleJobFailure dead-letters OpenAI quota exhaustion immediately", async () => {
  const supabase = createFakeSupabase();

  await withMutedConsole(async () => {
    await handleJobFailure(
      supabase,
      claimedJob({
      id: "job-quota",
      locked_by: "worker-test",
        type: "translate",
        attempts: 0,
        payload: { tweet_id: "tweet-quota" },
      }),
      new Error(
        'OpenAI translation error: 429 {"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}',
      ),
    );
  });

  const deadLetter = findCall(supabase.calls, "dead_letter_jobs", "insert")
    .payload as Record<string, unknown>;
  assertEquals(deadLetter.source, "worker_non_retryable");
  assertEquals(
    deadLetter.last_error,
    "provider_quota_exhausted",
  );

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(resultMeta.non_retryable, true);
  assertEquals(resultMeta.non_retryable_reason, "provider_quota_exhausted");
});

Deno.test("handleJobFailure reschedules retryable jobs with Telegram retry-after", async () => {
  class RetryAfterError extends Error {
    retryAfterSeconds = 10;
  }
  const supabase = createFakeSupabase();
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

  await withFrozenTime(nowMs, 0, async () => {
    await handleJobFailure(supabase, claimedJob({
      id: "job3",
      locked_by: "worker-test",
      type: "deliver",
      attempts: 1,
      priority: 20,
      payload: { tweet_id: "tweet3" },
      result_meta: { keep: "yes" },
      created_at: "2025-12-31T23:59:00.000Z",
      locked_at: "2025-12-31T23:59:30.000Z",
    }), new RetryAfterError("Too Many Requests"));
  });

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "pending");
  assertEquals(update.last_error, "job_failed");
  assertEquals(update.next_run_at, "2026-01-01T00:00:10.000Z");
  assertEquals(update.locked_at, null);
  assertEquals(update.locked_by, null);
  assertEquals(update.lease_expires_at, null);
  assertEquals(resultMeta.keep, "yes");
  assertEquals(resultMeta.retry_after_seconds, 10);
  assertEquals(resultMeta.rescheduled_for, "2026-01-01T00:00:10.000Z");
});

Deno.test("mergeJobResultMeta prefers current stored result metadata", async () => {
  const supabase = createFakeSupabase({
    selectData: { jobs: { result_meta: { current: true } } },
  });

  await mergeJobResultMeta(
    supabase,
    claimedJob({ id: "job4", locked_by: "worker-test", result_meta: { stale: true } }),
    { added: "value" },
  );

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  assertEquals(update.result_meta, { current: true, added: "value" });
});

Deno.test("mergeJobResultMeta surfaces a result metadata write error", async () => {
  const supabase = createFakeSupabase({ updateFailures: ["jobs"] });
  let thrown: unknown;

  try {
    await mergeJobResultMeta(
      supabase,
      claimedJob({ id: "job-result-meta-error", locked_by: "worker-test" }),
      { added: "value" },
    );
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof JobStateWriteError);
  assertEquals(
    (thrown as Error).message,
    "job_state_write_failed:result_meta:database_error",
  );
});

Deno.test("recordPipelineEvent inserts normalized step and timing metadata", async () => {
  const supabase = createFakeSupabase();

  await recordPipelineEvent(
    supabase,
    {
      id: "job5",
      locked_by: "worker-test",
      type: "download_media",
      attempts: 2,
      priority: 30,
      payload: { tweet_id: "tweet5" },
      created_at: "2026-01-01T00:00:00.000Z",
      locked_at: "2026-01-01T00:00:10.000Z",
    },
    "failed",
    "download failed",
    { source: "test" },
  );

  const insert = findCall(supabase.calls, "pipeline_events", "insert")
    .payload as Record<string, unknown>;
  const meta = insert.meta as Record<string, unknown>;
  assertEquals(insert.subject_type, "post");
  assertEquals(insert.subject_id, "tweet5");
  assertEquals(insert.step, "media");
  assertEquals(insert.status, "failed");
  assertEquals(insert.started_at, "2026-01-01T00:00:10.000Z");
  assertEquals(insert.error, "pipeline_failed");
  assertEquals(meta.job_id, "job5");
  assertEquals(meta.job_type, "download_media");
  assertEquals(meta.source, "test");
  assertEquals(meta.error, "pipeline_failed");
});

Deno.test("insertPipelineEvent swallows best-effort insert failures", async () => {
  const supabase = createFakeSupabase({ insertFailures: ["pipeline_events"] });

  await insertPipelineEvent(
    supabase,
    "post",
    "tweet6",
    "deliver",
    "queued",
    null,
    null,
    null,
    { source: "test" },
  );

  assertEquals(supabase.calls.length, 1);
});

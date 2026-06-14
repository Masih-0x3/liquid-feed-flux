import { assert, assertEquals } from "jsr:@std/assert";
import {
  handleJobFailure,
  insertPipelineEvent,
  mergeJobResultMeta,
  NonRetryableJobError,
  recordPipelineEvent,
} from "./jobLifecycle.ts";

type FakeCall = {
  table: string;
  action: string;
  columns?: string;
  payload?: unknown;
  filters?: Array<{ column: string; value: unknown }>;
};

type FakeSupabase = {
  calls: FakeCall[];
  from: (table: string) => unknown;
};

function createFakeSupabase(options: {
  selectData?: Record<string, Record<string, unknown> | null>;
  insertFailures?: string[];
} = {}): FakeSupabase {
  const calls: FakeCall[] = [];
  const insertFailures = new Set(options.insertFailures ?? []);
  return {
    calls,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      let pending: FakeCall | null = null;
      const builder = {
        select(columns: string) {
          pending = { table, action: "select", columns, filters };
          return builder;
        },
        update(payload: unknown) {
          pending = { table, action: "update", payload, filters };
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          if (pending?.action === "update") {
            calls.push({ ...pending, filters: [...filters] });
            return Promise.resolve({ error: null });
          }
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
      return builder;
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
    await handleJobFailure(supabase, {
      id: "job1",
      type: "translate",
      attempts: 5,
      payload: { tweet_id: "tweet1" },
      result_meta: { existing: true },
      created_at: "2026-01-01T00:00:00.000Z",
      locked_at: "2026-01-01T00:00:10.000Z",
    }, new Error("translation failed"));
  });

  const deadLetter = findCall(supabase.calls, "dead_letter_jobs", "insert")
    .payload as Record<string, unknown>;
  assertEquals(deadLetter.original_job_id, "job1");
  assertEquals(deadLetter.type, "translate");
  assertEquals(deadLetter.last_error, "translation failed");
  assertEquals(deadLetter.source, "worker");

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(update.last_error, "translation failed");
  assertEquals(resultMeta.existing, true);
  assertEquals(resultMeta.error, "translation failed");
  assertEquals(resultMeta.non_retryable, false);
});

Deno.test("handleJobFailure dead-letters non-retryable failures immediately", async () => {
  const supabase = createFakeSupabase();

  await withMutedConsole(async () => {
    await handleJobFailure(supabase, {
      id: "job2",
      type: "deliver",
      attempts: 0,
      payload: { tweet_id: "tweet2" },
    }, new NonRetryableJobError("video too large"));
  });

  const deadLetter = findCall(supabase.calls, "dead_letter_jobs", "insert")
    .payload as Record<string, unknown>;
  assertEquals(deadLetter.source, "worker_non_retryable");
  assertEquals(deadLetter.last_error, "video too large");

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "failed");
  assertEquals(resultMeta.non_retryable, true);
});

Deno.test("handleJobFailure reschedules retryable jobs with Telegram retry-after", async () => {
  class RetryAfterError extends Error {
    retryAfterSeconds = 10;
  }
  const supabase = createFakeSupabase();
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

  await withFrozenTime(nowMs, 0, async () => {
    await handleJobFailure(supabase, {
      id: "job3",
      type: "deliver",
      attempts: 1,
      priority: 20,
      payload: { tweet_id: "tweet3" },
      result_meta: { keep: "yes" },
      created_at: "2025-12-31T23:59:00.000Z",
      locked_at: "2025-12-31T23:59:30.000Z",
    }, new RetryAfterError("Too Many Requests"));
  });

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  const resultMeta = update.result_meta as Record<string, unknown>;
  assertEquals(update.status, "pending");
  assertEquals(update.last_error, "Too Many Requests");
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
    { id: "job4", result_meta: { stale: true } },
    { added: "value" },
  );

  const update = findCall(supabase.calls, "jobs", "update").payload as Record<
    string,
    unknown
  >;
  assertEquals(update.result_meta, { current: true, added: "value" });
});

Deno.test("recordPipelineEvent inserts normalized step and timing metadata", async () => {
  const supabase = createFakeSupabase();

  await recordPipelineEvent(
    supabase,
    {
      id: "job5",
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
  assertEquals(insert.error, "download failed");
  assertEquals(meta.job_id, "job5");
  assertEquals(meta.job_type, "download_media");
  assertEquals(meta.source, "test");
  assertEquals(meta.error, "download failed");
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

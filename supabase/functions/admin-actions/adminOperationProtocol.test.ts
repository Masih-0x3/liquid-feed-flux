import { assertEquals } from "jsr:@std/assert";
import { reprocessAdminAction } from "./basicActions.ts";
import { hydratePostAdminAction } from "./xPostingActions.ts";
import type { RecordFeedbackFn, SupabaseAdminClient } from "./types.ts";

type Job = Record<string, unknown>;

function fakeSupabase() {
  const jobs: Job[] = [];
  const sideEffects = { feedback: 0, pipeline: 0 };
  const client: SupabaseAdminClient = {
    from(tableName: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const builder = {
        then<TResult1 = { data?: unknown; error?: unknown }, TResult2 = never>(
          onfulfilled?: ((value: { data?: unknown; error?: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
          _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          const rows = tableName === "jobs"
            ? jobs.filter((job) => filters.every(({ column, value }) => {
              if (column === "type") return job.type === value;
              if (column === "idempotency_key") return job.idempotency_key === value;
              if (column === "status") return Array.isArray(value) && value.includes(job.status);
              if (column === "payload->>tweet_id") {
                return (job.payload as Record<string, unknown> | undefined)?.tweet_id === value;
              }
              return true;
            }))
            : [];
          return Promise.resolve({ data: rows, error: null }).then(
            onfulfilled ?? ((value) => value as TResult1),
          );
        },
        maybeSingle() {
          const row = jobs.find((job) => filters.every(({ column, value }) => {
            if (column === "idempotency_key") return job.idempotency_key === value;
            return true;
          })) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push({ column, value }); return builder; },
        in(column: string, value: unknown[]) { filters.push({ column, value }); return builder; },
        filter(column: string, _operator: string, value: unknown) { filters.push({ column, value }); return builder; },
        limit() { return builder; },
        upsert(value: Job, _options?: Record<string, unknown>) {
          const key = value.idempotency_key;
          const existing = jobs.some((job) => job.idempotency_key === key);
          if (!existing) jobs.push({ ...value, id: `job-${jobs.length + 1}` });
          const inserted = existing ? null : jobs[jobs.length - 1];
          return {
            select() { return this; },
            maybeSingle() { return Promise.resolve({ data: inserted, error: null }); },
          };
        },
      };
      return builder;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); },
  };
  return { client, jobs, sideEffects };
}

function feedbackFor(sideEffects: { feedback: number }): RecordFeedbackFn {
  return async () => { sideEffects.feedback += 1; };
}

function pipelineFor(sideEffects: { pipeline: number }) {
  return async () => { sideEffects.pipeline += 1; };
}

Deno.test("duplicate reprocess deliveries persist one canonical job row", async () => {
  const { client, jobs, sideEffects } = fakeSupabase();
  const body = { tweet_id: "t1", operation_id: "reprocess:t1" };
  const feedback = feedbackFor(sideEffects);
  const first = await reprocessAdminAction(client, body, feedback);
  await reprocessAdminAction(client, body, feedback);
  assertEquals(first.body, {
    success: true,
    message: "Reprocess job queued. Existing media will be preserved until staged media refresh is available.",
    operation_id: "reprocess:t1",
    operation_status: "still_running",
  });
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].type, "reprocess");
  assertEquals(jobs[0].status, "pending");
  assertEquals(jobs[0].idempotency_key, "reprocess:t1");
  assertEquals(sideEffects.feedback, 1);
});

Deno.test("duplicate hydrate deliveries persist one canonical job row", async () => {
  const { client, jobs, sideEffects } = fakeSupabase();
  const body = { tweet_id: "t1", operation_id: "hydrate:manual_monitoring:t1" };
  const deps = { insertAdminPipelineEvent: pipelineFor(sideEffects) };
  const first = await hydratePostAdminAction(client, body, deps);
  await hydratePostAdminAction(client, body, deps);
  assertEquals((first.body as Record<string, unknown>).operation_id, "hydrate:manual_monitoring:t1");
  assertEquals((first.body as Record<string, unknown>).operation_status, "still_running");
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].idempotency_key, "hydrate:manual_monitoring:t1");
  assertEquals(sideEffects.pipeline, 1);
});

Deno.test("completed duplicate hydrate delivery does not emit a second pipeline event", async () => {
  const { client, jobs, sideEffects } = fakeSupabase();
  jobs.push({
    id: "job-existing",
    type: "hydrate_tweet",
    payload: { tweet_id: "t1" },
    status: "completed",
    idempotency_key: "hydrate:manual_monitoring:t1",
  });
  const deps = { insertAdminPipelineEvent: pipelineFor(sideEffects) };
  const result = await hydratePostAdminAction(client, {
    tweet_id: "t1",
    operation_id: "hydrate:manual_monitoring:t1",
  }, deps);
  assertEquals((result.body as Record<string, unknown>).operation_status, "committed");
  assertEquals((result.body as Record<string, unknown>).queued, false);
  assertEquals(sideEffects.pipeline, 0);
  assertEquals(jobs.length, 1);
});

Deno.test("manual hydration is source-scoped and does not suppress another source", async () => {
  const { client, jobs, sideEffects } = fakeSupabase();
  jobs.push({
    id: "job-background",
    type: "hydrate_tweet",
    payload: { tweet_id: "t1", source: "background" },
    status: "pending",
    idempotency_key: "hydrate:background:t1",
  });
  const result = await hydratePostAdminAction(client, {
    tweet_id: "t1",
    operation_id: "hydrate:manual_monitoring:t1",
  }, { insertAdminPipelineEvent: pipelineFor(sideEffects) });
  assertEquals((result.body as Record<string, unknown>).queued, true);
  assertEquals(jobs.length, 2);
  assertEquals(jobs.map((job) => job.idempotency_key), [
    "hydrate:background:t1",
    "hydrate:manual_monitoring:t1",
  ]);
  assertEquals(sideEffects.pipeline, 1);
});

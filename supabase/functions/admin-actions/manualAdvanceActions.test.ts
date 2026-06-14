import { assertEquals } from "jsr:@std/assert";
import { queueManualAdvance } from "./manualAdvanceActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  op: string;
  table?: string;
  column?: string;
  value?: unknown;
  columns?: string;
  args?: unknown;
};

type FakeConfig = {
  post?: Record<string, unknown> | null;
  enrichmentConfig?: Record<string, unknown>;
  pendingDeliveries?: Array<Record<string, unknown>>;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "posts") return { data: config.post ?? null };
        if (tableName === "settings") {
          return { data: { value: config.enrichmentConfig ?? {} } };
        }
        if (tableName === "deliveries") {
          return { data: config.pendingDeliveries ?? [] };
        }
        return {};
      };
      const builder = {
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
            | null,
          _onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve(resolve()).then(
            onfulfilled ?? ((value) => value as TResult1),
          );
        },
        select(columns: string) {
          calls.push({ op: "select", table: tableName, columns });
          return builder;
        },
        insert(value: Record<string, unknown>) {
          calls.push({ op: "insert", table: tableName, value });
          return Promise.resolve({});
        },
        upsert(value: Record<string, unknown>, args?: Record<string, unknown>) {
          calls.push({ op: "upsert", table: tableName, value, args });
          return Promise.resolve({});
        },
        eq(column: string, value: unknown) {
          const call = { op: "eq", table: tableName, column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        limit(value: number) {
          calls.push({ op: "limit", table: tableName, value });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(resolve());
        },
      };
      return builder;
    },
    rpc() {
      return Promise.resolve({});
    },
  };
  return client;
}

Deno.test("queue manual advance stops when post is missing", async () => {
  const supabase = fakeSupabase({ post: null });

  const result = await queueManualAdvance(supabase, "t1");

  assertEquals(result, { queued: "none", reason: "post_not_found" });
});

Deno.test("queue manual advance stops when translation is missing", async () => {
  const supabase = fakeSupabase({
    post: { tweet_id: "t1", text_translated: null, translated_at: null },
  });

  const result = await queueManualAdvance(supabase, "t1");

  assertEquals(result, { queued: "none", reason: "translation_missing" });
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "upsert" && call.table === "jobs"
    ),
    false,
  );
});

Deno.test("queue manual advance hydrates truncated untranslated source first", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_translated: "translated",
      is_truncated: true,
      hydrated_at: null,
    },
  });
  const hydrationCalls: Array<Record<string, unknown>> = [];

  const result = await queueManualAdvance(supabase, "t1", {
    insertAdminPipelineEvent: async () => {},
    queueHydrationJob: async (_supabase, tweetId, source) => {
      hydrationCalls.push({ tweetId, source });
      return { queued: false, reason: "hydrate_job_already_pending" };
    },
  });

  assertEquals(result, {
    queued: "hydrate",
    reason: "hydrate_job_already_pending",
  });
  assertEquals(hydrationCalls, [{ tweetId: "t1", source: "manual_score" }]);
});

Deno.test("queue manual advance queues blocking enrichment before delivery", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_translated: "translated",
      is_truncated: false,
      enrich_status: "pending",
    },
    enrichmentConfig: {
      enabled: true,
      pipeline_mode: "required_for_x",
    },
  });
  const events: Array<Record<string, unknown>> = [];

  const result = await queueManualAdvance(supabase, "t1", {
    now: () => new Date("2026-01-06T00:00:00.000Z"),
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
    ) => {
      events.push({ tweetId, step, status, meta });
    },
  });

  assertEquals(result, { queued: "enrich" });
  assertEquals(
    supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs")
      ?.value,
    {
      type: "enrich",
      payload: { tweet_id: "t1", source: "manual_score" },
      status: "pending",
      priority: 18,
      idempotency_key: "enrich:t1",
      next_run_at: "2026-01-06T00:00:00.000Z",
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    },
  );
  assertEquals(events, [{
    tweetId: "t1",
    step: "enrich",
    status: "queued",
    meta: { source: "manual_score" },
  }]);
});

Deno.test("queue manual advance queues delivery and creates missing pending delivery", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      translated_at: "2026-01-01T00:00:00.000Z",
      is_truncated: false,
      enrich_status: "skipped",
    },
    enrichmentConfig: {
      enabled: true,
      pipeline_mode: "required_for_x",
    },
    pendingDeliveries: [],
  });
  const events: Array<Record<string, unknown>> = [];

  const result = await queueManualAdvance(supabase, "t1", {
    now: () => new Date("2026-01-06T00:00:00.000Z"),
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
    ) => {
      events.push({ tweetId, step, status, meta });
    },
  });

  assertEquals(result, { queued: "deliver" });
  assertEquals(
    supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs")
      ?.value,
    {
      type: "deliver",
      payload: { tweet_id: "t1", source: "manual_score" },
      status: "pending",
      priority: 20,
      idempotency_key: "deliver:t1",
      next_run_at: "2026-01-06T00:00:00.000Z",
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    },
  );
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "insert" && call.table === "deliveries"
    )?.value,
    {
      subject_type: "post",
      subject_id: "t1",
      status: "pending",
      attempts: 0,
    },
  );
  assertEquals(events, [{
    tweetId: "t1",
    step: "deliver",
    status: "queued",
    meta: { source: "manual_score" },
  }]);
});

import { assertEquals } from "jsr:@std/assert";
import {
  bulkIgnoreMonitoringItemsAdminAction,
  closeJobsForIgnoredTweet,
  ignoreMonitoringItem,
  type MonitoringMutationDeps,
  normalizeMonitoringIgnoreReason,
} from "./monitoringMutations.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
  op: string;
  column?: string;
  operator?: string;
  value?: unknown;
  values?: unknown[];
  columns?: string;
  pattern?: string;
};

type FakeConfig = {
  posts?: Record<string, Record<string, unknown>>;
  xRows?: Array<Record<string, unknown>>;
  deliveryRows?: Array<Record<string, unknown>>;
  jobRows?: Array<Record<string, unknown>>;
  cutoverError?: boolean;
};

function fakeDeps() {
  const calls = {
    enrichments: [] as Array<Record<string, unknown>>,
    feedback: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
  };
  const deps: MonitoringMutationDeps = {
    updateLatestPostEnrichment: async (_supabase, tweetId, patch) => {
      calls.enrichments.push({ tweetId, patch });
    },
    recordFeedback: async (
      _supabase,
      tweetId,
      feedbackAction,
      polarity,
      meta,
    ) => {
      calls.feedback.push({ tweetId, feedbackAction, polarity, meta });
    },
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
    ) => {
      calls.events.push({ tweetId, step, status, meta });
    },
  };
  return { deps, calls };
}

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const posts = config.posts ?? {};
  const xRows = config.xRows ?? [];
  const deliveryRows = config.deliveryRows ?? [];
  const jobRows = config.jobRows ?? [];

  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const state = {
        filters: [] as FakeCall[],
        updateValue: undefined as Record<string, unknown> | undefined,
        columns: "",
      };
      const resolve = () => {
        if (tableName === "x_deliveries") return { data: xRows };
        if (tableName === "deliveries") return { data: deliveryRows };
        if (tableName === "jobs") return { data: jobRows };
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
          state.columns = columns;
          calls.push({ table: tableName, op: "select", columns });
          return builder;
        },
        update(value: Record<string, unknown>) {
          state.updateValue = value;
          calls.push({ table: tableName, op: "update", value });
          return builder;
        },
        eq(column: string, value: unknown) {
          const call = { table: tableName, op: "eq", column, value };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        neq(column: string, value: unknown) {
          const call = { table: tableName, op: "neq", column, value };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        in(column: string, values: unknown[]) {
          const call = { table: tableName, op: "in", column, values };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        filter(column: string, operator: string, value: unknown) {
          const call = {
            table: tableName,
            op: "filter",
            column,
            operator,
            value,
          };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        ilike(column: string, pattern: string) {
          const call = { table: tableName, op: "ilike", column, pattern };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        maybeSingle() {
          const tweetId = state.filters.find((call) =>
            call.column === "tweet_id"
          )?.value;
          return Promise.resolve({
            data: typeof tweetId === "string" ? posts[tweetId] ?? null : null,
          });
        },
      };
      return builder;
    },
    rpc() {
      return Promise.resolve(
        config.cutoverError
          ? { error: { message: "delivery_cutover_blocked" } }
          : {},
      );
    },
  };
  return client;
}

Deno.test("normalizes monitoring ignore reasons", () => {
  assertEquals(
    normalizeMonitoringIgnoreReason({ reason: "  low value  " }),
    "low value",
  );
  assertEquals(
    normalizeMonitoringIgnoreReason({ reason: "" }),
    "manual_ignore",
  );
  assertEquals(normalizeMonitoringIgnoreReason({}), "manual_ignore");
  assertEquals(
    normalizeMonitoringIgnoreReason({ reason: "x".repeat(260) }).length,
    240,
  );
});

Deno.test("ignore monitoring item validates tweet id before querying", async () => {
  const supabase = fakeSupabase();
  const { deps } = fakeDeps();

  const result = await ignoreMonitoringItem(supabase, { tweet_id: " " }, deps);

  assertEquals(result, { ok: false, error: "tweet_id is required" });
  assertEquals(supabase.calls, []);
});

Deno.test("ignore monitoring item reports missing posts without side effects", async () => {
  const supabase = fakeSupabase();
  const { deps, calls } = fakeDeps();

  const result = await ignoreMonitoringItem(
    supabase,
    { tweet_id: "missing" },
    deps,
  );

  assertEquals(result, {
    ok: false,
    tweet_id: "missing",
    ignored: false,
    error: "Post not found: missing",
  });
  assertEquals(supabase.calls.filter((call) => call.op === "update").length, 0);
  assertEquals(calls, { enrichments: [], feedback: [], events: [] });
});

Deno.test("ignore monitoring item skips a pending dedupe post and closes related rows", async () => {
  const supabase = fakeSupabase({
    posts: { t1: { tweet_id: "t1", dedupe_status: "pending" } },
    xRows: [{ id: "x1" }, { id: "x2" }],
    deliveryRows: [{ id: "d1" }],
    jobRows: [{ id: "j1", type: "deliver" }],
  });
  const { deps, calls } = fakeDeps();

  const result = await ignoreMonitoringItem(supabase, {
    tweet_id: " t1 ",
    reason: " noisy ",
  }, deps);

  assertEquals(result, {
    ok: true,
    tweet_id: "t1",
    ignored: true,
    closed: { x_deliveries: 2, deliveries: 1, jobs: 1 },
  });
  const postUpdate = supabase.calls.find((call) =>
    call.table === "posts" && call.op === "update"
  )?.value as Record<string, unknown>;
  assertEquals(postUpdate.delivery_decision, "skip");
  assertEquals(postUpdate.decision_reason, "admin_ignored:noisy");
  assertEquals(postUpdate.score_review_status, "rejected");
  assertEquals(postUpdate.enrich_status, "skipped");
  assertEquals(postUpdate.dedupe_status, "unique");
  assertEquals(postUpdate.dedupe_reason, "admin_ignored:noisy");

  const xUpdate = supabase.calls.find((call) =>
    call.table === "x_deliveries" && call.op === "update"
  )?.value as Record<string, unknown>;
  assertEquals(xUpdate, {
    status: "skipped",
    skip_reason: "admin_ignored:noisy",
    last_error: null,
    updated_at: xUpdate.updated_at,
  });
  const enrichmentPatch = calls.enrichments[0].patch as Record<string, unknown>;
  assertEquals(enrichmentPatch, {
    status: "skipped",
    feedback_label: "admin_ignored",
    feedback_note: "noisy",
    feedback_at: enrichmentPatch.feedback_at,
  });
  assertEquals(calls.feedback, [{
    tweetId: "t1",
    feedbackAction: "admin_ignore",
    polarity: 0,
    meta: { reason: "noisy" },
  }]);
  assertEquals(calls.events[0].step, "admin_ignore");
  assertEquals(calls.events[0].meta, {
    reason: "noisy",
    x_rows_closed: 2,
    delivery_rows_closed: 1,
    jobs_closed: 1,
  });
});

Deno.test("ignore monitoring item blocks historical cleanup before mutation", async () => {
  const supabase = fakeSupabase({
    cutoverError: true,
    posts: { t1: { tweet_id: "t1", dedupe_status: "pending" } },
    xRows: [{ id: "x1" }],
    deliveryRows: [{ id: "d1" }],
    jobRows: [{ id: "j1", type: "deliver" }],
  });
  const { deps, calls } = fakeDeps();

  const result = await ignoreMonitoringItem(supabase, {
    tweet_id: "t1",
    reason: "historical",
  }, deps);

  assertEquals(result, {
    ok: false,
    tweet_id: "t1",
    ignored: false,
    error: "delivery_cutover_blocked",
  });
  assertEquals(supabase.calls.filter((call) => call.op === "update"), []);
  assertEquals(calls, { enrichments: [], feedback: [], events: [] });
});

Deno.test("bulk ignore trims, de-duplicates, and summarizes missing ids", async () => {
  const supabase = fakeSupabase({
    posts: {
      a: { tweet_id: "a", dedupe_status: "unique" },
      b: { tweet_id: "b", dedupe_status: "unique" },
    },
    xRows: [{ id: "x" }],
    deliveryRows: [{ id: "d" }],
    jobRows: [{ id: "j", type: "deliver" }],
  });
  const { deps } = fakeDeps();

  const result = await bulkIgnoreMonitoringItemsAdminAction(supabase, {
    tweet_ids: [" a ", "a", "", "missing", " b "],
    reason: "duplicate noise",
  }, deps);

  assertEquals(result.status, undefined);
  assertEquals(result.body, {
    ok: true,
    requested: 3,
    found: 2,
    ignored: 2,
    missing: ["missing"],
    closed: { x_deliveries: 2, deliveries: 2, jobs: 2 },
    results: [
      {
        ok: true,
        tweet_id: "a",
        ignored: true,
        closed: { x_deliveries: 1, deliveries: 1, jobs: 1 },
      },
      {
        ok: false,
        tweet_id: "missing",
        ignored: false,
        error: "Post not found: missing",
      },
      {
        ok: true,
        tweet_id: "b",
        ignored: true,
        closed: { x_deliveries: 1, deliveries: 1, jobs: 1 },
      },
    ],
  });
});

Deno.test("bulk ignore preserves the invalid payload 400 contract", async () => {
  const { deps } = fakeDeps();

  const result = await bulkIgnoreMonitoringItemsAdminAction(fakeSupabase(), {
    tweet_ids: [],
  }, deps);

  assertEquals(result, {
    body: { error: "tweet_ids array is required" },
    status: 400,
  });
});

Deno.test("close jobs escapes idempotency key search and de-duplicates rows", async () => {
  const supabase = fakeSupabase({ jobRows: [{ id: "job1", type: "deliver" }] });

  const result = await closeJobsForIgnoredTweet(
    supabase,
    "12345678_90%",
    "manual",
    "2026-01-01T00:00:00.000Z",
  );

  assertEquals(result.count, 1);
  assertEquals(
    supabase.calls.find((call) => call.op === "ilike"),
    {
      table: "jobs",
      op: "ilike",
      column: "idempotency_key",
      pattern: "%12345678\\_90\\%%",
    },
  );
});

import { assertEquals } from "jsr:@std/assert";
import {
  auditDuplicateCandidatesAdminAction,
  backfillDedupeAdminAction,
  backfillSignaturesAdminAction,
  loadDuplicateGateConfig,
  markDedupePending,
  runDedupeAdminAction,
} from "./dedupeActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
  name?: string;
  op: string;
  column?: string;
  operator?: string;
  value?: unknown;
  values?: unknown[];
  columns?: string;
  args?: unknown;
};

type FakeConfig = {
  settings?: Record<string, unknown>;
  post?: Record<string, unknown> | null;
  posts?: Array<Record<string, unknown>>;
  rpcData?: unknown;
  rpcError?: unknown;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "posts") {
          if (filters.some((call) => call.column === "tweet_id")) {
            return { data: config.post ?? null };
          }
          return { data: config.posts ?? [] };
        }
        if (tableName === "settings") {
          return { data: { value: config.settings ?? {} } };
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
          calls.push({ table: tableName, op: "select", columns });
          return builder;
        },
        update(value: Record<string, unknown>) {
          calls.push({ table: tableName, op: "update", value });
          return builder;
        },
        upsert(
          value: Record<string, unknown> | Array<Record<string, unknown>>,
          args?: Record<string, unknown>,
        ) {
          calls.push({ table: tableName, op: "upsert", value, args });
          return Promise.resolve({});
        },
        eq(column: string, value: unknown) {
          const call = { table: tableName, op: "eq", column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        gte(column: string, value: unknown) {
          const call = { table: tableName, op: "gte", column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        is(column: string, value: unknown) {
          const call = { table: tableName, op: "is", column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          const call = { table: tableName, op: "not", column, operator, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        order(column: string, args?: Record<string, unknown>) {
          calls.push({ table: tableName, op: "order", column, args });
          return builder;
        },
        limit(value: number) {
          calls.push({ table: tableName, op: "limit", value });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(resolve());
        },
      };
      return builder;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", name, args });
      if (config.rpcError) return Promise.resolve({ error: config.rpcError });
      return Promise.resolve({ data: config.rpcData ?? [] });
    },
  };
  return client;
}

Deno.test("load duplicate gate config normalizes story memory settings", async () => {
  const supabase = fakeSupabase({
    settings: { enabled: true, window_hours: 12, similarity_threshold: 0.8 },
  });

  const config = await loadDuplicateGateConfig(supabase);

  assertEquals(config.enabled, true);
  assertEquals(config.window_hours, 48);
  assertEquals(config.similarity_threshold, 0.8);
});

Deno.test("mark dedupe pending writes the expected post patch", async () => {
  const supabase = fakeSupabase();

  await markDedupePending(supabase, "t1", "running:admin");

  assertEquals(
    supabase.calls.find((call) =>
      call.op === "update" && call.table === "posts"
    )?.value,
    {
      dedupe_status: "pending",
      dedupe_method: null,
      dedupe_confidence: null,
      dedupe_reason: "running:admin",
      dedupe_checked_at: null,
    },
  );
  assertEquals(
    supabase.calls.find((call) => call.op === "eq" && call.table === "posts"),
    {
      table: "posts",
      op: "eq",
      column: "tweet_id",
      value: "t1",
    },
  );
});

Deno.test("run dedupe validates tweet id before querying", async () => {
  const supabase = fakeSupabase();

  const result = await runDedupeAdminAction(supabase, { tweet_id: " " });

  assertEquals(result, { ok: false, error: "tweet_id is required" });
  assertEquals(supabase.calls, []);
});

Deno.test("run dedupe marks pending and queues translation when requested", async () => {
  const supabase = fakeSupabase({
    settings: { enabled: true },
    post: {
      tweet_id: "t1",
      text_original: "A substantial post about the same story.",
    },
  });
  const gateCalls: Array<Record<string, unknown>> = [];

  const result = await runDedupeAdminAction(supabase, {
    tweet_id: " t1 ",
    enqueue_next: true,
    force: true,
  }, {
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    runDuplicateGate: async (_supabase, post, config, options) => {
      gateCalls.push({ post, config, options });
      return {
        ok: true,
        status: "unique",
        method: "none",
        confidence: null,
        dup_of_tweet_id: null,
        story_cluster_id: null,
        similarity: null,
        reason: "unique",
        new_facts: [],
        should_enqueue_translate: true,
        candidates: [],
      };
    },
  });

  assertEquals(result.ok, true);
  assertEquals(result.tweet_id, "t1");
  assertEquals(result.config_enabled, true);
  assertEquals(gateCalls[0].options, {
    dryRun: false,
    force: true,
    source: "admin_actions.run_dedupe",
  });
  assertEquals(
    supabase.calls.filter((call) =>
      call.op === "update" && call.table === "posts"
    ).length,
    1,
  );
  assertEquals(
    supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs")
      ?.value,
    {
      type: "translate",
      payload: { tweet_id: "t1" },
      status: "pending",
      priority: 10,
      idempotency_key: "translate:dedupe-admin:t1",
      next_run_at: "2026-01-01T00:00:00.000Z",
    },
  );
});

Deno.test("backfill dedupe dry-run filters unchecked posts and does not queue jobs", async () => {
  const supabase = fakeSupabase({
    posts: [{ tweet_id: "a" }, { tweet_id: "b" }],
  });

  const result = await backfillDedupeAdminAction(supabase, {
    hours: 4,
    max: 10,
    dry_run: true,
  }, {
    now: () => new Date("2026-01-02T00:00:00.000Z"),
  });

  assertEquals(result, {
    ok: true,
    dry_run: true,
    force: false,
    hours: 4,
    max: 10,
    scanned: 2,
    queued: 2,
  });
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "is" && call.column === "dedupe_checked_at"
    ),
    true,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "upsert" && call.table === "jobs"
    ),
    false,
  );
});

Deno.test("backfill dedupe queues jobs and marks posts pending", async () => {
  const supabase = fakeSupabase({
    posts: [{ tweet_id: "a" }, { tweet_id: "b" }],
  });

  const result = await backfillDedupeAdminAction(supabase, {
    max: 9999,
    force: true,
  }, {
    now: () => new Date("2026-01-02T00:00:00.000Z"),
  });

  assertEquals(result.max, 2000);
  assertEquals(result.queued, 2);
  assertEquals(
    supabase.calls
      .filter((call) => call.op === "upsert" && call.table === "jobs")
      .map((call) => (call.value as Record<string, unknown>).idempotency_key),
    ["dedupe:backfill:a:1767312000000", "dedupe:backfill:b:1767312000000"],
  );
  assertEquals(
    supabase.calls.filter((call) =>
      call.op === "update" && call.table === "posts"
    ).length,
    2,
  );
});

Deno.test("audit duplicate candidates clamps inputs and summarizes proposed statuses", async () => {
  const supabase = fakeSupabase({
    rpcData: [
      { proposed_status: "duplicate" },
      { proposed_status: "duplicate" },
      { proposed_status: "coverage_gap" },
      {},
    ],
  });

  const result = await auditDuplicateCandidatesAdminAction(supabase, {
    window_hours: 999,
    candidate_min_similarity: 0.1,
    limit: 99999,
  });

  assertEquals(supabase.calls.find((call) => call.op === "rpc"), {
    op: "rpc",
    name: "audit_duplicate_candidates",
    args: {
      window_hours: 48,
      candidate_min_similarity: 0.5,
      match_limit: 5000,
    },
  });
  assertEquals(result.proposed, { duplicate: 2, coverage_gap: 1, unknown: 1 });
  assertEquals(result.count, 4);
});

Deno.test("backfill signatures keeps the legacy alias contract", async () => {
  const supabase = fakeSupabase({ posts: [] });

  const result = await backfillSignaturesAdminAction(supabase, {
    dry_run: true,
  });

  assertEquals(result.alias, "backfill_dedupe");
  assertEquals(result.ok, true);
});

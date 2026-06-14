import { assertEquals } from "jsr:@std/assert";
import { insertAdminPipelineEvent, recordFeedback } from "./sideEffects.ts";
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
  biasRow?: Record<string, unknown> | null;
  insertFailureTables?: string[];
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "posts") return { data: config.post ?? null };
        if (tableName === "settings") return { data: config.biasRow ?? null };
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
        insert(value: Record<string, unknown>) {
          calls.push({ op: "insert", table: tableName, value });
          if (config.insertFailureTables?.includes(tableName)) {
            return Promise.reject(new Error(`${tableName} failed`));
          }
          return Promise.resolve({});
        },
        select(columns: string) {
          calls.push({ op: "select", table: tableName, columns });
          return builder;
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

Deno.test("record feedback inserts neutral feedback without learning bias", async () => {
  const supabase = fakeSupabase();

  await recordFeedback(supabase, "t1", "translate_only", 0);

  assertEquals(supabase.calls, [
    {
      op: "insert",
      table: "feedback_events",
      value: {
        tweet_id: "t1",
        related_tweet_id: null,
        action: "translate_only",
        polarity: 0,
        meta: {},
        source: "admin_action",
      },
    },
  ]);
});

Deno.test("record feedback updates learned author and tag biases", async () => {
  const supabase = fakeSupabase({
    post: {
      author_handle: "SourceA",
      importance_tags: ["Iran", "Diplomacy"],
    },
    biasRow: {
      value: {
        author_bias: { sourcea: 2.8 },
        tag_bias: { iran: -0.2 },
        keyword_bias: {},
      },
    },
  });

  await recordFeedback(
    supabase,
    "t1",
    "manual_score",
    2,
    { score: 18 },
    null,
    { now: () => new Date("2026-01-04T00:00:00.000Z") },
  );

  assertEquals(
    supabase.calls.find((call) =>
      call.op === "upsert" && call.table === "settings"
    ),
    {
      op: "upsert",
      table: "settings",
      value: {
        key: "learned_biases",
        value: {
          author_bias: { sourcea: 3 },
          tag_bias: { iran: 0, diplomacy: 0.2 },
          keyword_bias: {},
        },
        updated_at: "2026-01-04T00:00:00.000Z",
      },
      args: { onConflict: "key" },
    },
  );
});

Deno.test("insert admin pipeline event writes completed event metadata", async () => {
  const supabase = fakeSupabase();

  await insertAdminPipelineEvent(
    supabase,
    "t1",
    "deliver",
    "completed",
    { source: "manual_score" },
    null,
    { now: () => new Date("2026-01-05T00:00:00.000Z") },
  );

  assertEquals(supabase.calls[0], {
    op: "insert",
    table: "pipeline_events",
    value: {
      subject_type: "post",
      subject_id: "t1",
      step: "deliver",
      status: "completed",
      started_at: "2026-01-05T00:00:00.000Z",
      ended_at: "2026-01-05T00:00:00.000Z",
      error: null,
      meta: { source: "manual_score" },
    },
  });
});

Deno.test("insert admin pipeline event swallows insert failures", async () => {
  const supabase = fakeSupabase({ insertFailureTables: ["pipeline_events"] });

  await insertAdminPipelineEvent(supabase, "t1", "deliver", "queued");

  assertEquals(supabase.calls[0].table, "pipeline_events");
});

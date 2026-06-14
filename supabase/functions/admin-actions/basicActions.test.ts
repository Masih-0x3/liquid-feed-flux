import { assertEquals } from "jsr:@std/assert";
import {
  bulkReprocessAdminAction,
  cancelPendingJobsAdminAction,
  editTranslationAdminAction,
  reconcileStuckJobsAdminAction,
  retryStepAdminAction,
} from "./basicActions.ts";
import type { RecordFeedbackFn, SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  op: string;
  table?: string;
  name?: string;
  args?: unknown;
  value?: unknown;
  column?: string;
  values?: unknown[];
  columns?: string;
};

function fakeSupabase(selectRows: Array<Record<string, unknown>> = [], rpcData: unknown = { ok: true }) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const builder = {
        then<TResult1 = { error?: unknown }, TResult2 = never>(
          onfulfilled?: ((value: { error?: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
          _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve({}).then(onfulfilled ?? ((value) => value as TResult1));
        },
        update(value: Record<string, unknown>) {
          calls.push({ op: "update", table: tableName, value });
          return builder;
        },
        insert(value: Record<string, unknown>) {
          calls.push({ op: "insert", table: tableName, value });
          return Promise.resolve({});
        },
        upsert(value: Record<string, unknown> | Array<Record<string, unknown>>, options?: Record<string, unknown>) {
          calls.push({ op: "upsert", table: tableName, value, args: options });
          return Promise.resolve({});
        },
        eq(column: string, value: unknown) {
          calls.push({ op: "eq", table: tableName, column, value });
          return builder;
        },
        in(column: string, values: unknown[]) {
          calls.push({ op: "in", table: tableName, column, values });
          return builder;
        },
        select(columns: string) {
          calls.push({ op: "select", table: tableName, columns });
          return Promise.resolve({ data: selectRows });
        },
      };
      return builder;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", name, args });
      return Promise.resolve({ data: rpcData });
    },
  };
  return client;
}

Deno.test("edit translation validates required fields before updating posts", async () => {
  const feedback: RecordFeedbackFn = async () => {};
  const result = await editTranslationAdminAction(fakeSupabase(), { tweet_id: "1" }, feedback);
  assertEquals(result, { body: { error: "tweet_id and text_translated are required" }, status: 400 });
});

Deno.test("retry deliver records force feedback and locks the post", async () => {
  const supabase = fakeSupabase();
  const feedbackCalls: Array<Record<string, unknown>> = [];
  const feedback: RecordFeedbackFn = async (_supabase, tweetId, feedbackAction, polarity) => {
    feedbackCalls.push({ tweetId, feedbackAction, polarity });
  };

  const result = await retryStepAdminAction(supabase, { tweet_id: "t1", step: "deliver" }, feedback);

  assertEquals(result.body, { success: true, message: "deliver retry queued" });
  assertEquals(supabase.calls.filter((call) => call.op === "rpc"), [
    { op: "rpc", name: "retry_step", args: { tweet_id: "t1", step: "deliver" } },
  ]);
  assertEquals(feedbackCalls, [{ tweetId: "t1", feedbackAction: "force_deliver", polarity: 2 }]);
  assertEquals(supabase.calls.some((call) => call.op === "update" && call.table === "posts"), true);
});

Deno.test("bulk reprocess trims and de-duplicates tweet ids", async () => {
  const supabase = fakeSupabase();
  const result = await bulkReprocessAdminAction(supabase, { tweet_ids: [" a ", "a", "", 7, "b"] });
  const upsert = supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs");

  assertEquals(result.body, {
    success: true,
    requested: 5,
    queued: 2,
    message: "2 reprocess job(s) queued",
  });
  assertEquals((upsert?.value as Array<Record<string, unknown>>).map((job) => job.idempotency_key), ["reprocess:a", "reprocess:b"]);
});

Deno.test("cancel pending jobs summarizes canceled rows by type", async () => {
  const supabase = fakeSupabase([{ type: "translate" }, { type: "translate" }, { type: "deliver" }]);
  const result = await cancelPendingJobsAdminAction(supabase, { include_running: false, types: ["translate"] });

  assertEquals(result.body, {
    success: true,
    canceled: 3,
    by_type: { translate: 2, deliver: 1 },
    message: "Canceled 3 job(s)",
  });
  assertEquals(supabase.calls.filter((call) => call.op === "in"), [
    { op: "in", table: "jobs", column: "status", values: ["pending"] },
    { op: "in", table: "jobs", column: "type", values: ["translate"] },
  ]);
});

Deno.test("reconcile stuck jobs records an admin pipeline event", async () => {
  const supabase = fakeSupabase([], { reconciled: 2 });
  const result = await reconcileStuckJobsAdminAction(supabase);
  const insert = supabase.calls.find((call) => call.op === "insert" && call.table === "pipeline_events");

  assertEquals(result.body, { success: true, result: { reconciled: 2 } });
  assertEquals((insert?.value as Record<string, unknown>).meta, {
    source: "admin_dashboard",
    result: { reconciled: 2 },
  });
});

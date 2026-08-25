import { assertEquals } from "jsr:@std/assert";
import {
  dryRunOldMediaCleanupAdminAction,
  getPostPipelineStatusAdminAction,
  rescoreRecentAdminAction,
  resetLearnedBiasesAdminAction,
  runFollowersSnapshotAdminAction,
  summarizeStaleXPendingAdminAction,
} from "./maintenanceActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  op: string;
  table?: string;
  name?: string;
  column?: string;
  value?: unknown;
  values?: unknown[];
  columns?: string;
  args?: unknown;
};

type FakeConfig = {
  xDeliveries?: Array<Record<string, unknown>>;
  posts?: Array<Record<string, unknown>>;
  xApiControls?: Record<string, unknown>;
  rpcData?: unknown;
  invokeData?: unknown;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & {
    calls: FakeCall[];
    functions: {
      invoke(
        name: string,
        options?: Record<string, unknown>,
      ): Promise<{ data?: unknown; error?: unknown }>;
    };
  } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "x_deliveries") {
          return { data: config.xDeliveries ?? [] };
        }
        if (tableName === "posts") {
          return { data: config.posts ?? [] };
        }
        if (tableName === "settings") {
          return {
            data: {
              value: config.xApiControls ?? { my_x_enabled: false },
            },
          };
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
        update(value: Record<string, unknown>) {
          calls.push({ op: "update", table: tableName, value });
          return builder;
        },
        upsert(
          value: Record<string, unknown> | Array<Record<string, unknown>>,
          args?: Record<string, unknown>,
        ) {
          calls.push({ op: "upsert", table: tableName, value, args });
          return Promise.resolve({});
        },
        eq(column: string, value: unknown) {
          const call = { op: "eq", table: tableName, column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        gte(column: string, value: unknown) {
          const call = { op: "gte", table: tableName, column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        lt(column: string, value: unknown) {
          const call = { op: "lt", table: tableName, column, value };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        in(column: string, values: unknown[]) {
          const call = { op: "in", table: tableName, column, values };
          filters.push(call);
          calls.push(call);
          return builder;
        },
        order(column: string, args?: Record<string, unknown>) {
          calls.push({ op: "order", table: tableName, column, args });
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
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", name, args });
      return Promise.resolve({ data: config.rpcData ?? [] });
    },
    functions: {
      invoke(name: string, options?: Record<string, unknown>) {
        calls.push({ op: "invoke", name, args: options });
        return Promise.resolve({ data: config.invokeData ?? { ok: true } });
      },
    },
  };
  return client;
}

Deno.test("dry run old media cleanup invokes media processor with clamped days", async () => {
  const supabase = fakeSupabase({ invokeData: { deleted: 0 } });

  const result = await dryRunOldMediaCleanupAdminAction(
    supabase,
    { days_old: 999 },
    { readEnv: (key) => key === "SUPABASE_SERVICE_ROLE_KEY" ? "service" : "" },
  );

  assertEquals(result.body, {
    success: true,
    dry_run: true,
    result: { deleted: 0 },
  });
  assertEquals(supabase.calls.find((call) => call.op === "invoke"), {
    op: "invoke",
    name: "media-processor",
    args: {
      body: { action: "cleanup_old_media", days_old: 365, dry_run: true },
      headers: { Authorization: "Bearer service" },
    },
  });
});

Deno.test("summarize stale x pending blocks historical cleanup", async () => {
  const supabase = fakeSupabase({
    xDeliveries: [{ id: "x1" }, { id: "x2" }],
  });

  const result = await summarizeStaleXPendingAdminAction(
    supabase,
    { older_than_hours: 0, close: true },
    { now: () => new Date("2026-01-02T00:00:00.000Z") },
  );

  assertEquals(result.body, {
    ok: false,
    code: "delivery_cutover_blocked",
    error: "Historical X delivery cleanup is disabled during the immutable cutover",
  });
  assertEquals(supabase.calls, []);
});

Deno.test("rescore recent queues only missing score axes by default", async () => {
  const supabase = fakeSupabase({
    posts: [
      { tweet_id: "t1", score_axes: null },
      { tweet_id: "t2", score_axes: { iran_relevance: 5 } },
      { tweet_id: "t3" },
    ],
  });

  const result = await rescoreRecentAdminAction(
    supabase,
    {},
    { now: () => new Date("2026-01-03T00:00:00.000Z") },
  );

  assertEquals(result.body, {
    ok: true,
    scanned: 3,
    matched: 2,
    queued: 2,
    hours: 48,
  });
  assertEquals(
    supabase.calls.find((call) => call.op === "gte" && call.table === "posts")
      ?.value,
    "2026-01-01T00:00:00.000Z",
  );
  assertEquals(
    supabase.calls
      .filter((call) => call.op === "upsert" && call.table === "jobs")
      .map((call) => (call.value as Record<string, unknown>).idempotency_key),
    [
      "translate:rescore:t1:1767398400000",
      "translate:rescore:t3:1767398400000",
    ],
  );
});

Deno.test("get post pipeline status validates and trims tweet ids", async () => {
  const tweetIds = Array.from({ length: 105 }, (_, index) => ` t${index} `);
  const supabase = fakeSupabase({ rpcData: [{ tweet_id: "t0" }] });

  const missing = await getPostPipelineStatusAdminAction(supabase, {});
  const ok = await getPostPipelineStatusAdminAction(supabase, {
    tweet_ids: ["", 1, ...tweetIds],
  });

  assertEquals(missing.status, 400);
  assertEquals(ok.body, { success: true, statuses: [{ tweet_id: "t0" }] });
  const rpc = supabase.calls.find((call) => call.op === "rpc");
  assertEquals((rpc?.args as Record<string, string[]>).tweet_ids.length, 100);
  assertEquals((rpc?.args as Record<string, string[]>).tweet_ids[0], "t0");
});

Deno.test("followers snapshot respects My X disable gate and posts enabled requests", async () => {
  const disabled = fakeSupabase();
  const disabledResult = await runFollowersSnapshotAdminAction(disabled, {});
  const requests: Array<Record<string, unknown>> = [];
  const enabled = fakeSupabase({
    xApiControls: { my_x_enabled: true },
  });

  const ok = await runFollowersSnapshotAdminAction(
    enabled,
    { force: true, dry_run: true, include_following: false },
    {
      readEnv: (key) =>
        key === "SUPABASE_URL"
          ? "https://example.supabase.co"
          : key === "SUPABASE_SERVICE_ROLE_KEY"
          ? "service"
          : "",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), body: init?.body });
        return new Response(JSON.stringify({ processed: 1 }), { status: 200 });
      }) as typeof fetch,
    },
  );

  assertEquals(disabledResult.body, {
    ok: true,
    disabled: true,
    reason: "my_x_disabled",
  });
  assertEquals(ok.body, { ok: true, processed: 1 });
  assertEquals(requests, [{
    url: "https://example.supabase.co/functions/v1/x-followers-snapshot",
    body: JSON.stringify({
      trigger: "manual",
      force: true,
      dry_run: true,
      include_following: false,
    }),
  }]);
});

Deno.test("reset learned biases persists empty bias maps", async () => {
  const supabase = fakeSupabase();

  const result = await resetLearnedBiasesAdminAction(supabase, {
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  assertEquals(result.body, {
    success: true,
    message: "Learned biases reset",
  });
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "upsert" && call.table === "settings"
    )?.value,
    {
      key: "learned_biases",
      value: { author_bias: {}, tag_bias: {}, keyword_bias: {} },
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  );
});

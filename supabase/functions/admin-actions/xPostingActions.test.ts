import { assert, assertEquals } from "jsr:@std/assert";
import {
  getXPostingDiagnostics,
  hydratePostAdminAction,
  looksTruncatedForHydration,
  rehydrateRecentTruncatedAdminAction,
  resolveXMediaAdminAction,
  runXPostAdminAction,
  type RunXPostDeps,
  upgradeImageUrl,
} from "./xPostingActions.ts";
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
  options?: Record<string, unknown>;
  args?: unknown;
};

type FakeConfig = {
  settings?: Record<string, unknown>;
  postsByTweet?: Record<string, Record<string, unknown> | null>;
  posts?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  media?: Array<Record<string, unknown>>;
  xDeliveries?: Array<Record<string, unknown>>;
  xDeliveryCounts?: {
    posts1h?: number;
    posts24h?: number;
    posts30d?: number;
    media24h?: number;
  };
  rpcData?: unknown;
  rpcError?: { message: string };
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const settings = {
    content_filter: { default_threshold: 14 },
    scoring_policy: { enabled: false },
    editorial_profiles: { profiles: [] },
    active_profile_id: { id: "" },
    x_posting_config: { enabled: true, min_score: 14 },
    x_rate_limits: {},
    enrichment_config: { enabled: false },
    x_api_controls: {},
    ...(config.settings ?? {}),
  };
  const postsByTweet = config.postsByTweet ?? {};
  const posts = config.posts ?? [];
  const jobs = config.jobs ?? [];
  const media = config.media ?? [];
  const xDeliveries = config.xDeliveries ?? [];

  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const state = {
        filters: [] as FakeCall[],
        selectOptions: undefined as Record<string, unknown> | undefined,
        single: false,
      };
      const resolve = () => {
        if (tableName === "settings") {
          const eqKey = state.filters.find((call) =>
            call.op === "eq" && call.column === "key"
          )?.value;
          if (typeof eqKey === "string") {
            return { data: { value: settings[eqKey] } };
          }
          const inKeys = state.filters.find((call) =>
            call.op === "in" && call.column === "key"
          )?.values;
          const keys = Array.isArray(inKeys)
            ? inKeys as string[]
            : Object.keys(settings);
          return { data: keys.map((key) => ({ key, value: settings[key] })) };
        }
        if (tableName === "posts") {
          const tweetId = state.filters.find((call) =>
            call.op === "eq" && call.column === "tweet_id"
          )?.value;
          if (typeof tweetId === "string") {
            const row = postsByTweet[tweetId] ?? null;
            return { data: state.single ? row : row ? [row] : [] };
          }
          return { data: posts };
        }
        if (tableName === "jobs") {
          const tweetFilter = state.filters.find((call) =>
            call.op === "filter" && call.column === "payload->>tweet_id"
          )?.value;
          const typeFilter = state.filters.find((call) =>
            call.op === "eq" && call.column === "type"
          )?.value;
          return {
            data: jobs.filter((job) => {
              const payload = job.payload && typeof job.payload === "object"
                ? job.payload as Record<string, unknown>
                : {};
              return (typeof tweetFilter !== "string" ||
                payload.tweet_id === tweetFilter) &&
                (typeof typeFilter !== "string" || job.type === typeFilter);
            }),
          };
        }
        if (tableName === "media") return { data: media };
        if (tableName === "x_deliveries") {
          if (state.selectOptions?.head === true) {
            const hasMediaFilter = state.filters.some((call) =>
              call.op === "gt" && call.column === "media_count"
            );
            const gteValues = state.filters.filter((call) =>
              call.op === "gte" && call.column === "created_at"
            );
            const count = hasMediaFilter
              ? config.xDeliveryCounts?.media24h ?? 0
              : gteValues.length >= 3
              ? config.xDeliveryCounts?.posts30d ?? 0
              : gteValues.length >= 2
              ? config.xDeliveryCounts?.posts24h ?? 0
              : config.xDeliveryCounts?.posts1h ?? 0;
            return { data: [], count };
          }
          return { data: state.single ? xDeliveries[0] ?? null : xDeliveries };
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
        select(columns: string, options?: Record<string, unknown>) {
          state.selectOptions = options;
          calls.push({ table: tableName, op: "select", columns, options });
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
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        gt(column: string, value: unknown) {
          const call = { table: tableName, op: "gt", column, value };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        gte(column: string, value: unknown) {
          const call = { table: tableName, op: "gte", column, value };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        is(column: string, value: unknown) {
          const call = { table: tableName, op: "is", column, value };
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
        order(column: string, args?: Record<string, unknown>) {
          calls.push({ table: tableName, op: "order", column, args });
          return builder;
        },
        limit(value: number) {
          calls.push({ table: tableName, op: "limit", value });
          return builder;
        },
        maybeSingle() {
          state.single = true;
          return Promise.resolve(resolve());
        },
      };
      return builder;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", name, args });
      return Promise.resolve({
        data: config.rpcData ?? [],
        error: config.rpcError ?? null,
      });
    },
  };
  return client;
}

function fakeDeps(fetchBody: Record<string, unknown> = { results: [] }) {
  const calls = {
    feedback: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    rescore: [] as string[],
    fetches: [] as Array<Record<string, unknown>>,
  };
  const deps: RunXPostDeps = {
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
    ) => {
      calls.events.push({ tweetId, step, status, meta });
    },
    recordFeedback: async (_supabase, tweetId, feedbackAction, polarity) => {
      calls.feedback.push({ tweetId, feedbackAction, polarity });
    },
    runRescore: async (_supabase, tweetId) => {
      calls.rescore.push(tweetId);
      return { ok: true, score: 15, decision: "deliver" };
    },
    readEnv: (key) =>
      key === "SUPABASE_URL"
        ? "https://project.supabase.co"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-role"
        : undefined,
    fetchImpl: async (input, init) => {
      calls.fetches.push({ input: String(input), init });
      return new Response(JSON.stringify(fetchBody), { status: 200 });
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  return { deps, calls };
}

Deno.test("upgrades twimg images to original quality", () => {
  assertEquals(
    upgradeImageUrl("https://pbs.twimg.com/media/x.jpg?format=jpg&name=small"),
    "https://pbs.twimg.com/media/x.jpg?format=jpg&name=orig",
  );
  assertEquals(upgradeImageUrl("not a url"), "not a url");
});

Deno.test("resolve media uses fxtwitter videos and validates input", async () => {
  const invalid = await resolveXMediaAdminAction({
    username: "bad/name",
    tweet_id: "123",
  });
  assertEquals(invalid.status, 400);

  const result = await resolveXMediaAdminAction({
    username: "masih",
    tweet_id: "123456",
  }, {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tweet: {
            author: { name: "Name", screen_name: "masih", avatar_url: "a" },
            media: {
              videos: [{
                type: "video",
                width: 1280,
                height: 720,
                thumbnail_url: "thumb",
                variants: [
                  {
                    url: "low.mp4",
                    bitrate: 256000,
                    content_type: "video/mp4",
                  },
                  {
                    url: "high.mp4",
                    bitrate: 1500000,
                    content_type: "video/mp4",
                  },
                ],
              }],
            },
          },
        }),
        { status: 200 },
      ),
  });

  assertEquals(result.status, undefined);
  const body = result.body as {
    tweet: { media: Array<Record<string, unknown>> };
  };
  assertEquals(body.tweet.media[0].url, "high.mp4");
  assertEquals(body.tweet.media[0].qualityLabel, "720p @ 1.5Mbps");
});

Deno.test("hydrate post validates tweet id and skips existing hydrate job", async () => {
  const supabase = fakeSupabase({
    jobs: [{ type: "hydrate_tweet", payload: { tweet_id: "t1" } }],
  });
  const { deps, calls } = fakeDeps();

  const missing = await hydratePostAdminAction(
    supabase,
    { tweet_id: " " },
    deps,
  );
  assertEquals(missing.status, 400);

  const result = await hydratePostAdminAction(
    supabase,
    { tweet_id: "t1" },
    deps,
  );

  assertEquals(result.body, {
    ok: true,
    queued: false,
    reason: "hydrate_job_already_pending",
  });
  assertEquals(calls.events, []);
});

Deno.test("retry x post is blocked when posting is disabled", async () => {
  const supabase = fakeSupabase({
    settings: { x_posting_config: { enabled: false } },
  });
  const { deps, calls } = fakeDeps();

  const result = await runXPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    "retry_x_post",
    deps,
  );

  assertEquals(result.status, 200);
  assertEquals((result.body as Record<string, unknown>).skipped, true);
  assertEquals(calls.fetches.length, 0);
});

Deno.test("retry x post blocks missing or historical lineage before rescore or fetch", async () => {
  const missingSupabase = fakeSupabase();
  const { deps: missingDeps, calls: missingCalls } = fakeDeps();
  const missing = await runXPostAdminAction(
    missingSupabase,
    { tweet_id: "" },
    "retry_x_post",
    missingDeps,
  );
  assertEquals((missing.body as Record<string, unknown>).code, "delivery_cutover_blocked");
  assertEquals(missingCalls.rescore, []);
  assertEquals(missingCalls.fetches, []);

  const historicalSupabase = fakeSupabase({
    rpcError: { message: "delivery_cutover_blocked:historical" },
    postsByTweet: {
      old: { text_translated: "translated", is_truncated: false },
    },
  });
  const { deps: historicalDeps, calls: historicalCalls } = fakeDeps();
  const historical = await runXPostAdminAction(
    historicalSupabase,
    { tweet_id: "old" },
    "retry_x_post",
    historicalDeps,
  );
  assertEquals((historical.body as Record<string, unknown>).code, "delivery_cutover_blocked");
  assertEquals(historicalCalls.rescore, []);
  assertEquals(historicalCalls.fetches, []);
});

Deno.test("retry x post duplicate gate skips before rescore or fetch", async () => {
  const supabase = fakeSupabase({
    postsByTweet: {
      t1: {
        text_translated: "translated",
        importance_score: 15,
        final_score: 15,
        dedupe_status: "duplicate",
        dup_of_tweet_id: "canon",
      },
    },
  });
  const { deps, calls } = fakeDeps();

  const result = await runXPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    "retry_x_post",
    deps,
  );

  assertEquals(
    (result.body as Record<string, unknown>).reason,
    "duplicate_gate",
  );
  assertEquals(
    (result.body as Record<string, unknown>).dup_of_tweet_id,
    "canon",
  );
  assertEquals(calls.rescore, []);
  assertEquals(calls.fetches, []);
});

Deno.test("retry x post rescues missing score then queues hydration for truncated posts", async () => {
  const supabase = fakeSupabase({
    postsByTweet: {
      t1: {
        text_translated: "",
        importance_score: null,
        final_score: null,
        is_truncated: true,
        hydrated_at: null,
      },
    },
  });
  const { deps, calls } = fakeDeps();

  const result = await runXPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    "retry_x_post",
    deps,
  );

  assertEquals(
    (result.body as Record<string, unknown>).status,
    "waiting_hydration",
  );
  assertEquals((result.body as Record<string, unknown>).queued, "hydrate");
  assertEquals(calls.rescore, ["t1"]);
  assertEquals(calls.fetches, []);
  assertEquals(
    supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs")
      ?.value,
    {
      type: "hydrate_tweet",
      payload: { tweet_id: "t1", source: "force_x" },
      status: "pending",
      priority: 15,
      idempotency_key: "hydrate:force_x:t1",
      next_run_at: "2026-01-01T00:00:00.000Z",
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    },
  );
});

Deno.test("posted retry records force feedback and locks the post", async () => {
  const supabase = fakeSupabase({
    postsByTweet: {
      t1: {
        text_translated: "translated",
        importance_score: 16,
        final_score: 16,
        is_truncated: false,
        hydrated_at: null,
      },
    },
  });
  const { deps, calls } = fakeDeps({
    results: [{ status: "posted", x_tweet_id: "x1" }],
  });

  const result = await runXPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    "retry_x_post",
    deps,
  );

  assertEquals((result.body as Record<string, unknown>).status, "posted");
  assertEquals((result.body as Record<string, unknown>).x_tweet_id, "x1");
  const fetchInit = calls.fetches[0].init as RequestInit;
  assertEquals(
    JSON.parse(String(fetchInit.body)),
    {
      dry_run: false,
      force_retry: true,
      dispatch_source: "admin_retry",
      tweet_id: "t1",
    },
  );
  assertEquals(calls.feedback, [{
    tweetId: "t1",
    feedbackAction: "force_x",
    polarity: 1,
  }]);
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "update" && call.table === "posts"
    )
      ?.value,
    { feedback_locked: true },
  );
});

Deno.test("rehydrate recent truncated defaults to dry run and gates by deliver score", async () => {
  const longOpen = `${"word ".repeat(60)}and`;
  const supabase = fakeSupabase({
    settings: {
      content_filter: { default_threshold: 14 },
      x_api_controls: { backfill_max_hydrate_jobs_per_run: 10 },
    },
    posts: [
      {
        tweet_id: "t1",
        text_original: longOpen,
        delivery_decision: "deliver",
        final_score: 16,
      },
      {
        tweet_id: "t2",
        text_original: longOpen,
        delivery_decision: "skip",
        final_score: 20,
      },
    ],
  });

  assert(looksTruncatedForHydration(longOpen));
  const result = await rehydrateRecentTruncatedAdminAction(supabase, {
    hours: 24,
  }, { now: () => new Date("2026-01-01T00:00:00.000Z") });

  assertEquals(result.body, {
    ok: true,
    dry_run: true,
    scanned: 2,
    matched: 1,
    excluded_by_gate: 1,
    queued: 1,
    skipped_existing: 0,
    max: 10,
    hours: 24,
    force: false,
    errors: [],
  });
  assertEquals(
    supabase.calls.filter((call) =>
      call.op === "upsert" && call.table === "jobs"
    ),
    [],
  );
});

Deno.test("posting diagnostics reports blockers without mutating", async () => {
  const supabase = fakeSupabase({
    settings: {
      x_posting_config: { enabled: false, min_score: 14 },
      content_filter: { default_threshold: 14 },
    },
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        text_translated: "",
        created_at: "2025-12-31T23:00:00.000Z",
        has_media: false,
        delivery_decision: "skip",
        final_score: 10,
      },
    },
  });

  const result = await getXPostingDiagnostics(supabase, {
    tweet_id: "t1",
  }, { now: () => new Date("2026-01-01T00:00:00.000Z") });

  const item = (result as {
    diagnostics: { items: Array<{ blockers: Array<{ code: string }> }> };
  }).diagnostics.items[0];
  assertEquals(
    item.blockers.map((blocker) => blocker.code).slice(0, 4),
    [
      "x_disabled",
      "outside_x_auto_freshness_window",
      "missing_translation",
      "score_below_x_min",
    ],
  );
  assertEquals(
    supabase.calls.filter((call) =>
      call.op === "update" || call.op === "upsert"
    ),
    [],
  );
});

Deno.test("posting diagnostics gates on x gate score rather than learned final score", async () => {
  const supabase = fakeSupabase({
    settings: {
      x_posting_config: {
        enabled: true,
        min_score: 17,
        max_candidate_age_minutes: 120,
      },
      content_filter: { default_threshold: 14 },
    },
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        text_translated: "translated",
        created_at: "2026-01-01T00:00:00.000Z",
        has_media: false,
        delivery_decision: "deliver",
        final_score: 16.9,
        base_score: 18.9,
        learned_score: 16.9,
        learned_delta: -2,
        x_gate_score: 18.9,
      },
    },
  });

  const result = await getXPostingDiagnostics(supabase, {
    tweet_id: "t1",
  }, { now: () => new Date("2026-01-01T01:00:00.000Z") });

  const item = (result as {
    diagnostics: {
      items: Array<{
        eligible: boolean;
        blockers: Array<{ code: string }>;
        score: number;
        x_gate_score: number;
        final_score: number;
      }>;
    };
  }).diagnostics.items[0];
  assertEquals(item.eligible, true);
  assertEquals(item.blockers, []);
  assertEquals(item.score, 18.9);
  assertEquals(item.x_gate_score, 18.9);
  assertEquals(item.final_score, 16.9);
});

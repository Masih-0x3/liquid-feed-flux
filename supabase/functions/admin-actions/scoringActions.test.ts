import { assertEquals } from "jsr:@std/assert";
import type { ScoringPolicyResult } from "../_shared/scoringPolicy.ts";
import {
  backfillScoreV2,
  normalizeScoringFeedbackReasonTag,
  recordScoreFeedback,
  runScoringEval,
  scorePostV2,
  type ScoringActionDeps,
  scoringPolicyPostUpdate,
  setManualScore,
} from "./scoringActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
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
  postsByTweet?: Record<string, Record<string, unknown>>;
  posts?: Array<Record<string, unknown>>;
  examples?: Array<Record<string, unknown>>;
};

function scoringResult(
  overrides: Partial<ScoringPolicyResult> = {},
): ScoringPolicyResult {
  return {
    ok: true,
    version: "audience-fit-v2",
    profile_id: "iran-first",
    profile_name: "Iran-first",
    audience_class: "direct_focus",
    audience_confidence: 0.9,
    audience_reason: "direct Iran relevance",
    global_exception_class: null,
    axes: { focus_relevance: 16 },
    raw_priority_score: 16,
    uncapped_score: 16,
    final_score: 16,
    threshold: 14,
    cap: 20,
    delivery_decision: "deliver",
    decision_reason: "score>=threshold",
    tags: ["iran"],
    review_status: "none",
    adjudicated: false,
    usage: {},
    ...overrides,
  };
}

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const settings = {
    content_filter: { default_threshold: 14 },
    scoring_policy: { enabled: true, mode: "active" },
    translation_prompt: { scoring: { model: "test-model" } },
    ...(config.settings ?? {}),
  };
  const postsByTweet = config.postsByTweet ?? {};
  const posts = config.posts ?? [];
  const examples = config.examples ?? [];

  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      let inserted = false;
      let insertTable = "";
      const resolve = () => {
        if (tableName === "settings") {
          const keyFilter = filters.find((call) =>
            call.column === "key" && call.op === "eq"
          );
          if (keyFilter && typeof keyFilter.value === "string") {
            return { data: { value: settings[keyFilter.value] } };
          }
          const keyIn = filters.find((call) =>
            call.column === "key" && call.op === "in"
          );
          const keys = Array.isArray(keyIn?.values)
            ? (keyIn.values as string[]).filter((key) =>
              Object.prototype.hasOwnProperty.call(settings, key)
            )
            : Object.keys(settings);
          return { data: keys.map((key) => ({ key, value: settings[key] })) };
        }
        if (tableName === "posts") {
          const tweetId = filters.find((call) =>
            call.column === "tweet_id" && call.op === "eq"
          )?.value;
          if (typeof tweetId === "string") {
            return { data: postsByTweet[tweetId] ?? null };
          }
          return { data: posts };
        }
        if (tableName === "scoring_examples") {
          if (inserted && insertTable === "scoring_examples") {
            return { data: { id: "example-1" } };
          }
          return { data: examples };
        }
        if (tableName === "scoring_evaluations") {
          return { data: { id: "eval-1" } };
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
        insert(value: Record<string, unknown>) {
          inserted = true;
          insertTable = tableName;
          calls.push({ table: tableName, op: "insert", value });
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
        in(column: string, values: unknown[]) {
          const call = { table: tableName, op: "in", column, values };
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
        single() {
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

function fakeDeps(result: ScoringPolicyResult = scoringResult()) {
  const calls = {
    feedback: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    translations: [] as string[],
    advances: [] as string[],
    policyRuns: [] as Array<Record<string, unknown>>,
  };
  const deps: ScoringActionDeps = {
    recordFeedback: async (
      _supabase,
      tweetId,
      feedbackAction,
      polarity,
      meta,
      relatedTweetId,
    ) => {
      calls.feedback.push({
        tweetId,
        feedbackAction,
        polarity,
        meta,
        relatedTweetId,
      });
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
    runTranslationOnly: async (_supabase, tweetId) => {
      calls.translations.push(tweetId);
      return { ok: true, translated: "translated" };
    },
    queueManualAdvance: async (_supabase, tweetId) => {
      calls.advances.push(tweetId);
      return { queued: "deliver" };
    },
    runScoringPolicy: async (input, _policy, _model, options) => {
      calls.policyRuns.push({ input, options });
      return result;
    },
    getOpenAiApiKey: () => "test-key",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  return { deps, calls };
}

Deno.test("scoring feedback reason tags are normalized to the supported set", () => {
  assertEquals(
    normalizeScoringFeedbackReasonTag({ reason_tag: " Leader Statement " }),
    "leader_statement",
  );
  assertEquals(
    normalizeScoringFeedbackReasonTag({ reason_tag: "not supported" }),
    "",
  );
});

Deno.test("manual score validates required fields before querying", async () => {
  const supabase = fakeSupabase();
  const { deps } = fakeDeps();

  const result = await setManualScore(supabase, {
    tweet_id: "",
    score: 14,
    reason_tag: "other",
  }, deps);

  assertEquals(result, { ok: false, error: "tweet_id is required" });
  assertEquals(supabase.calls, []);
});

Deno.test("manual score below threshold updates review fields without advancing", async () => {
  const supabase = fakeSupabase({
    settings: {
      scoring_policy: { enabled: false },
      content_filter: { default_threshold: 14 },
    },
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        final_score: 15,
        importance_score: 15,
        score_breakdown: { ai: 15 },
        text_translated: "translated",
        translated_at: "2026-01-01T00:00:00.000Z",
      },
    },
  });
  const { deps, calls } = fakeDeps();

  const result = await setManualScore(supabase, {
    tweet_id: " t1 ",
    score: 10,
    reason_tag: "other",
    reason: "too narrow",
  }, deps);

  assertEquals(result.decision, "skip");
  assertEquals(result.advance, null);
  const update = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(update.final_score, 10);
  assertEquals(update.base_score, 10);
  assertEquals(update.learned_score, 10);
  assertEquals(update.learned_delta, 0);
  assertEquals(update.x_gate_score, 10);
  assertEquals(update.delivery_decision, "skip");
  assertEquals(update.decision_reason, "manual_score_skip:10<14");
  assertEquals(update.feedback_locked, true);
  assertEquals(calls.feedback[0].feedbackAction, "manual_score");
  assertEquals(calls.feedback[0].polarity, -2);
  assertEquals(calls.events[0].step, "score");
});

Deno.test("manual score duplicate override clears dedupe and advances", async () => {
  const supabase = fakeSupabase({
    settings: {
      scoring_policy: { enabled: false },
      content_filter: { default_threshold: 14 },
    },
    postsByTweet: {
      b: {
        tweet_id: "b",
        final_score: 10,
        importance_score: 10,
        dup_of_tweet_id: "a",
        text_translated: "translated",
        translated_at: "2026-01-01T00:00:00.000Z",
      },
    },
  });
  const { deps, calls } = fakeDeps();

  const result = await setManualScore(supabase, {
    tweet_id: "b",
    score: 18,
    reason_tag: "wrong_class",
    override_duplicate: true,
  }, deps);

  assertEquals(result.decision, "deliver");
  assertEquals(calls.advances, ["b"]);
  const update = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(update.dedupe_status, "unique");
  assertEquals(update.dedupe_reason, "manual_score_override");
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "upsert" && call.table === "story_pair_blocklist"
    )?.value,
    { tweet_a: "a", tweet_b: "b", reason: "manual_score_override" },
  );
  assertEquals(calls.feedback.map((call) => call.feedbackAction), [
    "not_duplicate",
    "manual_score",
  ]);
});

Deno.test("score feedback rejects should_skip and promotes a scoring example", async () => {
  const supabase = fakeSupabase({
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        text_original: "Original text",
        author_handle: "source",
        final_score: 11,
      },
    },
  });
  const { deps, calls } = fakeDeps();

  const result = await recordScoreFeedback(supabase, {
    tweet_id: "t1",
    feedback: "should_skip",
    reason_tag: "should_skip",
  }, deps);

  assertEquals(result.ok, true);
  const reviewUpdate = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(reviewUpdate.score_review_status, "rejected");
  assertEquals(reviewUpdate.delivery_decision, "skip");
  assertEquals(calls.feedback[0].feedbackAction, "should_skip_audience");
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "insert" && call.table === "scoring_examples"
    )?.value,
    {
      tweet_id: "t1",
      source: "score_feedback",
      profile_id: "iran-first",
      text_original: "Original text",
      author_handle: "source",
      expected_audience_class: "direct_focus",
      expected_decision: "skip",
      expected_score: 11,
      expected_global_exception_class: undefined,
      note: "should_skip: should_skip",
      created_by: null,
    },
  );
});

Deno.test("scorePostV2 applies active policy result and records an event", async () => {
  const supabase = fakeSupabase({
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        text_original: "Original text",
        author_handle: "source",
        url: "https://x.com/status/1",
        tweeted_at: "2026-01-01T00:00:00.000Z",
        accounts: { display_name: "Feed" },
      },
    },
  });
  const { deps, calls } = fakeDeps(
    scoringResult({ final_score: 17, raw_priority_score: 17 }),
  );

  const result = await scorePostV2(supabase, { tweet_id: "t1" }, deps);

  assertEquals(result.ok, true);
  assertEquals(calls.policyRuns.length, 1);
  const update = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(update.final_score, 17);
  assertEquals(update.base_score, 17);
  assertEquals(update.learned_score, 17);
  assertEquals(update.learned_delta, 0);
  assertEquals(update.x_gate_score, 17);
  assertEquals(update.delivery_decision, "deliver");
  assertEquals(calls.events[0].step, "score");
});

Deno.test("scoring policy shadow update does not overwrite production score fields", () => {
  const update = scoringPolicyPostUpdate(
    scoringResult({ final_score: 19, delivery_decision: "deliver" }),
    false,
  );

  assertEquals(update.scoring_version, "audience-fit-v2");
  assertEquals(update.score_review_status, "shadow");
  assertEquals(update.final_score, undefined);
  assertEquals(update.importance_score, undefined);
  assertEquals(update.base_score, undefined);
  assertEquals(update.learned_score, undefined);
  assertEquals(update.x_gate_score, undefined);
  assertEquals(update.delivery_decision, undefined);
  assertEquals(update.decision_reason, undefined);
});

Deno.test("scorePostV2 keeps apply requests shadow when policy mode is shadow", async () => {
  const supabase = fakeSupabase({
    settings: {
      scoring_policy: { enabled: true, mode: "shadow" },
    },
    postsByTweet: {
      t1: {
        tweet_id: "t1",
        text_original: "Original text",
        author_handle: "source",
        url: "https://x.com/status/1",
        tweeted_at: "2026-01-01T00:00:00.000Z",
        accounts: { display_name: "Feed" },
      },
    },
  });
  const { deps } = fakeDeps(
    scoringResult({ final_score: 19, raw_priority_score: 19 }),
  );

  const result = await scorePostV2(
    supabase,
    { tweet_id: "t1", apply: true },
    deps,
  );

  assertEquals(result.ok, true);
  assertEquals(result.active, false);
  const update = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(update.score_review_status, "shadow");
  assertEquals(update.final_score, undefined);
  assertEquals(update.importance_score, undefined);
  assertEquals(update.delivery_decision, undefined);
});

Deno.test("backfillScoreV2 dry-run defaults to no queue and clamps max", async () => {
  const supabase = fakeSupabase({
    posts: [{ tweet_id: "a" }, { tweet_id: "b" }],
  });

  const result = await backfillScoreV2(supabase, { max: 9999 }, {
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  assertEquals(result, {
    ok: true,
    dry_run: true,
    matched: 2,
    queued: 0,
    hours: 48,
    max: 500,
  });
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "upsert" && call.table === "jobs"
    ),
    false,
  );
});

Deno.test("runScoringEval records summary counts and inserted evaluation id", async () => {
  const supabase = fakeSupabase({
    examples: [
      {
        id: "a",
        text_original: "A",
        expected_audience_class: "direct_focus",
        expected_decision: "deliver",
      },
      {
        id: "b",
        text_original: "B",
        expected_audience_class: "direct_focus",
        expected_decision: "skip",
      },
    ],
  });
  const { deps } = fakeDeps(scoringResult({ delivery_decision: "deliver" }));

  const result = await runScoringEval(supabase, { limit: 2 }, deps);

  assertEquals(result.ok, true);
  assertEquals(result.evaluation_id, "eval-1");
  assertEquals(result.summary, {
    profile_id: "iran-first",
    accuracy: 50,
    correct: 1,
    false_positive_count: 1,
    false_negative_count: 0,
    ambiguous_count: 0,
  });
});

import { assertEquals } from "jsr:@std/assert";
import type { NormalizedOpenAIResponse } from "../_shared/openai.ts";
import {
  previewTranslationAdminAction,
  rescorePostAdminAction,
  runRescore,
  type RunRescoreResult,
  runTranslationOnly,
  translatePostAdminAction,
} from "./translationRescoreActions.ts";
import type { RecordFeedbackFn, SupabaseAdminClient } from "./types.ts";

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
  post?: Record<string, unknown> | null;
  settings?: Array<Record<string, unknown>>;
  biasRow?: Record<string, unknown> | null;
  signatureRow?: Record<string, unknown> | null;
  preScore?: number | null;
  rpcData?: unknown;
  budgetRows?: Array<Record<string, unknown>>;
  workflowRows?: Array<Record<string, unknown>>;
  aiCallRows?: Array<Record<string, unknown>>;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      let selected = "";
      const resolve = () => {
        if (tableName === "posts") {
          if (selected === "final_score") {
            return {
              data: config.preScore === undefined
                ? null
                : { final_score: config.preScore },
            };
          }
          return { data: config.post ?? null };
        }
        if (tableName === "settings") {
          const key = filters.find((call) =>
            call.op === "eq" && call.column === "key"
          )?.value;
          if (key === "learned_biases") {
            return { data: config.biasRow ?? null };
          }
          return { data: config.settings ?? [] };
        }
        if (tableName === "story_signatures") {
          return { data: config.signatureRow ?? null };
        }
        if (tableName === "budget_ledger") {
          return { data: config.budgetRows ?? [] };
        }
        if (tableName === "workflow_runs") {
          return { data: config.workflowRows ?? [] };
        }
        if (tableName === "ai_call_ledger") {
          return { data: config.aiCallRows ?? [] };
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
          selected = columns;
          calls.push({ op: "select", table: tableName, columns });
          return builder;
        },
        update(value: Record<string, unknown>) {
          calls.push({ op: "update", table: tableName, value });
          return builder;
        },
        insert(
          value: Record<string, unknown> | Array<Record<string, unknown>>,
        ) {
          calls.push({ op: "insert", table: tableName, value });
          return builder;
        },
        upsert(
          value: Record<string, unknown> | Array<Record<string, unknown>>,
          args?: Record<string, unknown>,
        ) {
          calls.push({ op: "upsert", table: tableName, value, args });
          return builder;
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
        single() {
          return Promise.resolve(resolve());
        },
      };
      return builder;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", name, args });
      return Promise.resolve({ data: config.rpcData ?? 0 });
    },
  };
  return client;
}

function openAiResponse(
  patch: Partial<NormalizedOpenAIResponse>,
): NormalizedOpenAIResponse {
  return {
    ok: true,
    status: 200,
    rawText: "{}",
    raw: { usage: { total_tokens: 7 } },
    content: "Translated text",
    toolCall: null,
    webSearchResults: [],
    outputItems: [],
    usage: { total_tokens: 7 },
    endpoint: "chat.completions",
    ...patch,
  };
}

function feedbackRecorder() {
  const calls: Array<Record<string, unknown>> = [];
  const recordFeedback: RecordFeedbackFn = async (
    _supabase,
    tweetId,
    feedbackAction,
    polarity,
    meta,
    relatedTweetId,
  ) => {
    calls.push({
      tweetId,
      feedbackAction,
      polarity,
      meta,
      relatedTweetId,
    });
  };
  return { calls, recordFeedback };
}

Deno.test("preview translation rejects invalid text without OpenAI", async () => {
  let openAiCalls = 0;
  const deps = {
    getOpenAiApiKey: () => "key",
    callOpenAI: (async () => {
      openAiCalls += 1;
      return openAiResponse({});
    }) as never,
  };

  const blank = await previewTranslationAdminAction({ text: " " }, deps);
  const long = await previewTranslationAdminAction(
    { text: "x".repeat(8001) },
    deps,
  );

  assertEquals(blank.status, 400);
  assertEquals(long.status, 400);
  assertEquals(openAiCalls, 0);
});

Deno.test("translation-only preview uses request settings and returns the existing shape", async () => {
  const requests: Array<Record<string, unknown>> = [];

  const result = await previewTranslationAdminAction(
    {
      text: "hello",
      translation_settings: {
        model: "gpt-4o-mini",
        system_prompt: "Translate now",
        temperature: 0.4,
        max_completion_tokens: 123,
      },
      content_filter: { enabled: false },
    },
    {
      getOpenAiApiKey: () => "key",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      callOpenAI: (async (request: Record<string, unknown>) => {
        requests.push(request);
        return openAiResponse({
          content: "سلام.",
          endpoint: "responses",
          raw: { usage: { total_tokens: 5 } },
        });
      }) as never,
    },
  );

  assertEquals(requests[0].model, "gpt-4o-mini");
  assertEquals(requests[0].maxOutputTokens, 123);
  assertEquals(requests[0].temperature, 0.4);
  assertEquals(result.body, {
    ok: true,
    result: {
      translated_text: "سلام.",
      importance_score: null,
      importance_tags: null,
      reasoning: null,
      model: "gpt-4o-mini",
      endpoint: "responses",
      usage: { total_tokens: 5 },
      duration_ms: 0,
      used_filter: false,
    },
  });
});

Deno.test("preview translation writes local observability ledgers without prompt or output text metadata", async () => {
  const supabase = fakeSupabase();

  const result = await previewTranslationAdminAction(
    {
      text: "hello source text",
      translation_settings: { model: "gpt-4o-mini" },
      content_filter: { enabled: false },
    },
    {
      supabase,
      getOpenAiApiKey: () => "key",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      callOpenAI: (async () =>
        openAiResponse({
          content: "سلام خروجی",
          raw: { usage: { total_tokens: 11 } },
          usage: { total_tokens: 11 },
        })) as never,
    },
  );

  assertEquals((result.body as { ok?: boolean }).ok, true);

  const workflowUpsert = supabase.calls.find((call) =>
    call.op === "upsert" && call.table === "workflow_runs"
  );
  assertEquals(Boolean(workflowUpsert), true);
  assertEquals(
    (workflowUpsert!.value as Record<string, unknown>).workflow_name,
    "translation-preview",
  );

  const workflowFinish = supabase.calls.find((call) =>
    call.op === "update" && call.table === "workflow_runs" &&
    (call.value as Record<string, unknown>).status === "completed"
  );
  assertEquals(Boolean(workflowFinish), true);

  const aiLedgerInsert = supabase.calls.find((call) =>
    call.op === "insert" && call.table === "ai_call_ledger"
  );
  assertEquals(Boolean(aiLedgerInsert), true);
  const aiLedgerRow = aiLedgerInsert!.value as Record<string, unknown>;
  assertEquals(aiLedgerRow.trace_name, "translation-preview");
  assertEquals(aiLedgerRow.operation_name, "translate");
  assertEquals(aiLedgerRow.agent_name, "translator");
  assertEquals(aiLedgerRow.total_tokens, 11);
  assertEquals(aiLedgerRow.foglamp_exported, false);
  assertEquals(aiLedgerRow.foglamp_skip_reason, "injected_call_openai");

  const metadataText = JSON.stringify(aiLedgerRow.metadata);
  assertEquals(metadataText.includes("hello source text"), false);
  assertEquals(metadataText.includes("سلام خروجی"), false);

  const budgetInsert = supabase.calls.find((call) =>
    call.op === "insert" && call.table === "budget_ledger"
  );
  assertEquals(Boolean(budgetInsert), true);
});

Deno.test("filter-enabled preview parses classify_importance tool calls", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const result = await previewTranslationAdminAction(
    {
      text: "important",
      author_handle: "source",
      translation_settings: { model: "gpt-4o-mini" },
      content_filter: {
        enabled: true,
        priority_topics: ["Iran"],
        low_priority_topics: ["sports"],
      },
    },
    {
      getOpenAiApiKey: () => "key",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      callOpenAI: (async (request: Record<string, unknown>) => {
        requests.push(request);
        return openAiResponse({
          content: "",
          toolCall: {
            name: "classify_importance",
            arguments: JSON.stringify({
              translated_text: "ترجمه.",
              importance_score: 18,
              tags: ["iran"],
              reasoning: "direct",
            }),
          },
        });
      }) as never,
    },
  );

  assertEquals(requests[0].temperature, 0.2);
  const payload = result.body as { result: Record<string, unknown> };
  assertEquals(payload.result.translated_text, "ترجمه.");
  assertEquals(payload.result.importance_score, 18);
  assertEquals(payload.result.importance_tags, ["iran"]);
  assertEquals(payload.result.reasoning, "direct");
  assertEquals(payload.result.used_filter, true);
});

Deno.test("preview repairs readability before returning translated text", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    openAiResponse({
      content:
        "The Michael Knowles Show درباره گفت‌وگوهای آمریکا و ایران صحبت کرد",
    }),
    openAiResponse({
      content:
        "برنامه «مایکل نولز شو» به ادامه گفت‌وگوهای فنی آمریکا و ایران پرداخت.",
    }),
  ];

  const result = await previewTranslationAdminAction(
    {
      text: "The Michael Knowles Show discussed the talks.",
      translation_settings: { model: "gpt-4o-mini" },
      content_filter: { enabled: false },
    },
    {
      getOpenAiApiKey: () => "key",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      callOpenAI: (async (request: Record<string, unknown>) => {
        requests.push(request);
        return responses.shift()!;
      }) as never,
    },
  );

  const payload = result.body as { result: Record<string, unknown> };
  assertEquals(requests.length, 2);
  assertEquals(
    payload.result.translated_text,
    "برنامه «مایکل نولز شو» به ادامه گفت‌وگوهای فنی آمریکا و ایران پرداخت.",
  );
  assertEquals(
    (payload.result.readability as Record<string, unknown>).repair_status,
    "accepted",
  );
});

Deno.test("translate post validates mode and delegates to runTranslationOnly", async () => {
  const supabase = fakeSupabase();
  const delegated: string[] = [];

  const missing = await translatePostAdminAction(supabase, {}, {
    runTranslationOnly: async () => ({ ok: true }),
  });
  const badMode = await translatePostAdminAction(
    supabase,
    { tweet_id: "t1", mode: "full" },
    { runTranslationOnly: async () => ({ ok: true }) },
  );
  const ok = await translatePostAdminAction(
    supabase,
    { tweet_id: " t1 " },
    {
      runTranslationOnly: async (_client, tweetId) => {
        delegated.push(tweetId);
        return { ok: true, translated: "done", model: "m" };
      },
    },
  );

  assertEquals(missing.status, 400);
  assertEquals(badMode.status, 400);
  assertEquals(delegated, ["t1"]);
  assertEquals(ok.body, {
    ok: true,
    translated: "done",
    model: "m",
    tweet_id: "t1",
    mode: "translation_only",
  });
});

Deno.test("runTranslationOnly updates post, records event, and records feedback", async () => {
  const supabase = fakeSupabase({
    post: { tweet_id: "t1", text_original: "hello" },
    settings: [{ key: "translation_prompt", value: { model: "test-model" } }],
  });
  const events: Array<Record<string, unknown>> = [];
  const feedback = feedbackRecorder();

  const result = await runTranslationOnly(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    callOpenAI: (async () =>
      openAiResponse({
        content: " ترجمه. ",
        raw: { usage: { total_tokens: 9 } },
      })) as never,
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
      error,
    ) => {
      events.push({ tweetId, step, status, meta, error });
    },
    recordFeedback: feedback.recordFeedback,
  });

  assertEquals(result, {
    ok: true,
    translated: "ترجمه.",
    model: "test-model",
  });
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "update" && call.table === "posts"
    )
      ?.value,
    {
      text_translated: "ترجمه.",
      translated_at: "2026-01-01T00:00:00.000Z",
      translation_model: "test-model",
      translation_tokens: 9,
    },
  );
  assertEquals(events[0], {
    tweetId: "t1",
    step: "translate",
    status: "completed",
    meta: { mode: "translation_only", model: "test-model" },
    error: undefined,
  });
  assertEquals(feedback.calls[0].feedbackAction, "translate_only");
});

Deno.test("runTranslationOnly repairs feed readability before persisting", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_original:
        "J.D. Vance said on The Michael Knowles Show that technical talks continue.",
    },
    settings: [{
      key: "translation_prompt",
      value: { model: "test-model", max_completion_tokens: 2400 },
    }],
  });
  const requests: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const responses = [
    openAiResponse({
      content:
        "The Michael Knowles Show در برنامه‌ای که جی‌دی ونس در آن گفت مذاکرات فنی بین آمریکا و ایران ادامه دارد",
    }),
    openAiResponse({
      content:
        "جی‌دی ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران همچنان ادامه دارد.",
    }),
  ];
  const feedback = feedbackRecorder();

  const result = await runTranslationOnly(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    callOpenAI: (async (request: Record<string, unknown>) => {
      requests.push(request);
      return responses.shift()!;
    }) as never,
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
      error,
    ) => {
      events.push({ tweetId, step, status, meta, error });
    },
    recordFeedback: feedback.recordFeedback,
  });

  assertEquals(requests.length, 2);
  assertEquals(result.ok, true);
  assertEquals(
    result.translated,
    "جی‌دی ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران همچنان ادامه دارد.",
  );
  assertEquals(result.readability?.repair_status, "accepted");
  const postUpdate = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(
    postUpdate.text_translated,
    "جی‌دی ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران همچنان ادامه دارد.",
  );
  assertEquals(
    (events[0].meta as Record<string, unknown>).readability &&
      ((events[0].meta as Record<string, unknown>).readability as Record<
        string,
        unknown
      >).repair_status,
    "accepted",
  );
});

Deno.test("runTranslationOnly records failed event when OpenAI fails", async () => {
  const supabase = fakeSupabase({
    post: { tweet_id: "t1", text_original: "hello" },
  });
  const events: Array<Record<string, unknown>> = [];

  const result = await runTranslationOnly(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    callOpenAI: (async () =>
      openAiResponse({
        ok: false,
        status: 429,
        rawText: "rate limited",
      })) as never,
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
      error,
    ) => {
      events.push({ tweetId, step, status, meta, error });
    },
    recordFeedback: async () => {},
  });

  assertEquals(result.ok, false);
  assertEquals(result.error, "openai_http_429");
  assertEquals(events[0].status, "failed");
  assertEquals(events[0].error, "openai_http_429");
});

Deno.test("rescore post v2 branch forces scorePostV2 and preserves legacy response", async () => {
  const supabase = fakeSupabase();
  const calls: Array<Record<string, unknown>> = [];

  const result = await rescorePostAdminAction(
    supabase,
    { tweet_id: " t1 ", scoring_policy_v2: true },
    {
      insertAdminPipelineEvent: async () => {},
      recordFeedback: async () => {},
      loadScoringPolicyConfig: async () => ({ enabled: false }) as never,
      loadScoringModelOptions: async () => ({ model: "policy-model" }) as never,
      scorePostV2: (async (_client, body) => {
        calls.push(body);
        return {
          ok: true,
          result: {
            raw_priority_score: 17,
            final_score: 16,
            tags: ["tag"],
            audience_reason: "reason",
            delivery_decision: "deliver",
            decision_reason: "pass",
            threshold: 12,
            audience_class: "direct_focus",
            audience_confidence: 0.9,
          },
        };
      }) as never,
    },
  );

  assertEquals(calls[0], {
    tweet_id: "t1",
    scoring_policy_v2: true,
    force: true,
  });
  assertEquals(result.body, {
    ok: true,
    tweet_id: "t1",
    score: 17,
    final_score: 16,
    base_score: 16,
    learned_score: 16,
    learned_delta: 0,
    x_gate_score: 16,
    tags: ["tag"],
    reasoning: "reason",
    decision: "deliver",
    decision_reason: "pass",
    threshold: 12,
    model: "policy-model",
    audience_class: "direct_focus",
    audience_confidence: 0.9,
    error: undefined,
  });
});

Deno.test("rescore post legacy branch records score-dispute feedback for significant changes", async () => {
  const supabase = fakeSupabase({ preScore: 10 });
  const feedback = feedbackRecorder();
  const rescoreResult: RunRescoreResult = {
    ok: true,
    score: 15,
    final_score: 12,
    base_score: undefined,
    learned_score: undefined,
    learned_delta: undefined,
    x_gate_score: undefined,
    tags: ["x"],
    reasoning: "r",
    decision: "deliver",
    decision_reason: "score_pass",
    threshold: 12,
    model: "legacy-model",
  };

  const result = await rescorePostAdminAction(
    supabase,
    { tweet_id: "t1" },
    {
      insertAdminPipelineEvent: async () => {},
      recordFeedback: feedback.recordFeedback,
      loadScoringPolicyConfig: async () => ({ enabled: false }) as never,
      runRescore: async () => rescoreResult,
    },
  );

  assertEquals(feedback.calls[0], {
    tweetId: "t1",
    feedbackAction: "dispute_low",
    polarity: 1,
    meta: { old_score: 10, new_score: 12 },
    relatedTweetId: undefined,
  });
  assertEquals(result.body, {
    ok: true,
    tweet_id: "t1",
    score: 15,
    final_score: 12,
    tags: ["x"],
    reasoning: "r",
    decision: "deliver",
    decision_reason: "score_pass",
    threshold: 12,
    model: "legacy-model",
  });
});

Deno.test("runRescore updates post with parsed tool score", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_original: "hello",
      author_handle: "source",
      tweeted_at: "2026-01-01T00:00:00.000Z",
      has_media: false,
      url: "https://x.com/post",
    },
    settings: [
      { key: "translation_prompt", value: { model: "legacy-model" } },
      {
        key: "content_filter",
        value: { enabled: true, default_threshold: 12 },
      },
    ],
  });

  const result = await runRescore(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    callOpenAI: (async () =>
      openAiResponse({
        toolCall: {
          name: "classify_importance",
          arguments: JSON.stringify({
            translated_text: "ترجمه.",
            importance_score: 16,
            axes: {
              iran_relevance: 10,
              severity: 8,
              novelty: 7,
              credibility: 8,
              actionability: 6,
              noise: 1,
            },
            tags: ["iran"],
            reasoning: "direct",
          }),
        },
      })) as never,
  });

  assertEquals(result.ok, true);
  assertEquals(result.score, 16);
  assertEquals(result.translated, "ترجمه.");
  const postUpdate = supabase.calls.find((call) =>
    call.op === "update" && call.table === "posts"
  )?.value as Record<string, unknown>;
  assertEquals(postUpdate.importance_score, 16);
  assertEquals(postUpdate.text_translated, "ترجمه.");
  assertEquals(postUpdate.translation_model, "legacy-model");
});

Deno.test("runRescore falls back to the default effective threshold when content_filter.default_threshold is missing", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_original: "hello",
      author_handle: "source",
      tweeted_at: "2026-01-01T00:00:00.000Z",
      has_media: false,
      url: "https://x.com/post",
    },
    settings: [
      { key: "translation_prompt", value: { model: "legacy-model" } },
      { key: "content_filter", value: { enabled: true } },
    ],
  });

  const result = await runRescore(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    callOpenAI: (async () =>
      openAiResponse({
        toolCall: {
          name: "classify_importance",
          arguments: JSON.stringify({
            importance_score: 13,
            tags: [],
            reasoning: "direct",
          }),
        },
      })) as never,
  });

  assertEquals(result.ok, true);
  assertEquals(result.score, 13);
  assertEquals(result.threshold, 14);
  assertEquals(result.decision, "skip");
  assertEquals(result.decision_reason, "below_threshold:13<14");
});

Deno.test("runRescore falls back to the default effective threshold when content_filter.default_threshold is non-numeric", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_original: "hello",
      author_handle: "source",
      tweeted_at: "2026-01-01T00:00:00.000Z",
      has_media: false,
      url: "https://x.com/post",
    },
    settings: [
      { key: "translation_prompt", value: { model: "legacy-model" } },
      {
        key: "content_filter",
        value: { enabled: true, default_threshold: "not-a-number" },
      },
    ],
  });

  const result = await runRescore(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    callOpenAI: (async () =>
      openAiResponse({
        toolCall: {
          name: "classify_importance",
          arguments: JSON.stringify({
            importance_score: 13,
            tags: [],
            reasoning: "direct",
          }),
        },
      })) as never,
  });

  assertEquals(result.ok, true);
  assertEquals(result.score, 13);
  assertEquals(result.threshold, 14);
  assertEquals(result.decision, "skip");
  assertEquals(result.decision_reason, "below_threshold:13<14");
});

Deno.test("runRescore preserves an explicit content_filter.default_threshold of 12", async () => {
  const supabase = fakeSupabase({
    post: {
      tweet_id: "t1",
      text_original: "hello",
      author_handle: "source",
      tweeted_at: "2026-01-01T00:00:00.000Z",
      has_media: false,
      url: "https://x.com/post",
    },
    settings: [
      { key: "translation_prompt", value: { model: "legacy-model" } },
      {
        key: "content_filter",
        value: { enabled: true, default_threshold: 12 },
      },
    ],
  });

  const result = await runRescore(supabase, "t1", {
    getOpenAiApiKey: () => "key",
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    callOpenAI: (async () =>
      openAiResponse({
        toolCall: {
          name: "classify_importance",
          arguments: JSON.stringify({
            importance_score: 13,
            tags: [],
            reasoning: "direct",
          }),
        },
      })) as never,
  });

  assertEquals(result.ok, true);
  assertEquals(result.score, 13);
  assertEquals(result.threshold, 12);
  assertEquals(result.decision, "deliver");
  assertEquals(result.decision_reason, "score_pass:13>=12");
});

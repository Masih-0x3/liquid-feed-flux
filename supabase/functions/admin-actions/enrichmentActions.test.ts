import { assertEquals } from "jsr:@std/assert";
import {
  approveEnrichmentAdminAction,
  type EnrichmentActionDeps,
  enrichPostAdminAction,
  generateVoiceProfileAdminAction,
  recordEnrichmentFeedbackAdminAction,
  selectEnrichmentVariantAdminAction,
} from "./enrichmentActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
  op: string;
  column?: string;
  value?: unknown;
  values?: unknown[];
  columns?: string;
  args?: unknown;
};

type FakeConfig = {
  posts?: Record<string, Record<string, unknown> | null>;
  enrichment?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const posts = config.posts ?? {};
  const settings = {
    enrichment_config: { model: "test-model" },
    voice_samples: { samples: ["sample"], updated_at: null },
    ...(config.settings ?? {}),
  };
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "posts") {
          const tweetId = filters.find((call) =>
            call.op === "eq" && call.column === "tweet_id"
          )?.value;
          return {
            data: typeof tweetId === "string" ? posts[tweetId] ?? null : null,
          };
        }
        if (tableName === "post_enrichments") {
          return { data: config.enrichment ?? { id: "enrich-1" } };
        }
        if (tableName === "settings") {
          const keys = filters.find((call) =>
            call.op === "in" && call.column === "key"
          )?.values;
          return {
            data: Array.isArray(keys)
              ? keys.map((key) => ({ key, value: settings[String(key)] }))
              : [],
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
        in(column: string, values: unknown[]) {
          const call = { table: tableName, op: "in", column, values };
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
    rpc() {
      return Promise.resolve({});
    },
  };
  return client;
}

function deps(overrides: Partial<EnrichmentActionDeps> = {}) {
  const calls = {
    events: [] as Array<Record<string, unknown>>,
    translations: [] as string[],
    worker: 0,
    generator: [] as Array<Record<string, unknown>>,
  };
  const actionDeps: EnrichmentActionDeps = {
    insertAdminPipelineEvent: async (
      _supabase,
      tweetId,
      step,
      status,
      meta,
      error,
    ) => {
      calls.events.push({ tweetId, step, status, meta, error });
    },
    runTranslationOnly: async (_supabase, tweetId) => {
      calls.translations.push(tweetId);
      return { ok: true, translated: "translated", model: "test-model" };
    },
    dispatchWorkerForManualEnrich: async () => {
      calls.worker += 1;
      return { ok: true, status: 200, processed: 1, message: "processed" };
    },
    readEnv: (key) => key === "OPENAI_API_KEY" ? "openai-key" : "",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    generatePersonalVoiceProfile: (async (input: Record<string, unknown>) => {
      calls.generator.push(input);
      return {
        profile: { version: "test-profile" },
        usage: { total_tokens: 12 },
      };
    }) as never,
    ...overrides,
  };
  return { deps: actionDeps, calls };
}

Deno.test("approve enrichment updates post, latest enrichment, and event", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps();

  const result = await approveEnrichmentAdminAction(
    supabase,
    { tweet_id: "t1" },
    actionDeps,
  );

  assertEquals(result.body, {
    ok: true,
    message: "Enrichment approved for X text on t1",
  });
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "update" && call.table === "posts"
    )
      ?.value,
    { enrich_status: "approved" },
  );
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "update" && call.table === "post_enrichments"
    )?.value,
    { status: "approved", approved_at: "2026-01-01T00:00:00.000Z" },
  );
  assertEquals(calls.events[0], {
    tweetId: "t1",
    step: "enrich",
    status: "completed",
    meta: { source: "approve_enrichment", approved_for_x: true },
    error: undefined,
  });
});

Deno.test("record enrichment feedback validates labels and truncates note", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps();

  const bad = await recordEnrichmentFeedbackAdminAction(
    supabase,
    { tweet_id: "t1", feedback: "bad" },
    actionDeps,
  );
  const ok = await recordEnrichmentFeedbackAdminAction(
    supabase,
    { tweet_id: "t1", feedback: "too_ai", note: "x".repeat(600) },
    actionDeps,
  );

  assertEquals(bad.status, 400);
  assertEquals(ok.body, { ok: true });
  const enrichmentPatch = supabase.calls.find((call) =>
    call.op === "update" && call.table === "post_enrichments"
  )?.value as Record<string, unknown>;
  assertEquals(enrichmentPatch.feedback_label, "too_ai");
  assertEquals(String(enrichmentPatch.feedback_note).length, 500);
  assertEquals(calls.events[0].step, "enrich_feedback");
});

Deno.test("select enrichment variant handles missing and successful variants", async () => {
  const sourceContext = {
    voice: {
      variants: [
        { kind: "bad", final_x_text: "" },
        {
          kind: "short_punch",
          final_x_text: "Final text",
          creator_angle: "Angle",
          why_it_matters: "Why",
        },
      ],
    },
  };
  const supabase = fakeSupabase({
    posts: { t1: { source_context: sourceContext } },
  });
  const { deps: actionDeps, calls } = deps();

  const missing = await selectEnrichmentVariantAdminAction(
    supabase,
    { tweet_id: "t1", variant: "none" },
    actionDeps,
  );
  const noText = await selectEnrichmentVariantAdminAction(
    supabase,
    { tweet_id: "t1", variant: "bad" },
    actionDeps,
  );
  const ok = await selectEnrichmentVariantAdminAction(
    supabase,
    { tweet_id: "t1", variant: "short_punch" },
    actionDeps,
  );

  assertEquals(missing.status, 404);
  assertEquals(noText.status, 400);
  assertEquals(ok.body, {
    ok: true,
    selected_variant: "short_punch",
    final_x_text: "Final text",
  });
  assertEquals(calls.events[0].step, "enrich_variant");
});

Deno.test("enrich post returns translation preflight failure without queueing", async () => {
  const supabase = fakeSupabase({
    posts: {
      t1: { tweet_id: "t1", text_translated: null, translated_at: null },
    },
  });
  const { deps: actionDeps } = deps({
    runTranslationOnly: async () => ({ ok: false, error: "translate failed" }),
  });

  const result = await enrichPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    actionDeps,
  );

  assertEquals(result.status, 200);
  assertEquals(
    (result.body as Record<string, unknown>).error,
    "translation preflight failed: translate failed",
  );
  assertEquals(
    supabase.calls.filter((call) =>
      call.op === "upsert" && call.table === "jobs"
    ),
    [],
  );
});

Deno.test("enrich post resets fields, queues enrich job, and records dispatch", async () => {
  const supabase = fakeSupabase({
    posts: { t1: { tweet_id: "t1", text_translated: "translated" } },
  });
  const { deps: actionDeps, calls } = deps();

  const result = await enrichPostAdminAction(
    supabase,
    { tweet_id: "t1" },
    actionDeps,
  );

  assertEquals((result.body as Record<string, unknown>).ok, true);
  assertEquals(calls.worker, 1);
  assertEquals(
    supabase.calls.find((call) => call.op === "upsert" && call.table === "jobs")
      ?.value,
    {
      type: "enrich",
      payload: { tweet_id: "t1", force_review: true },
      idempotency_key: "enrich:t1",
      status: "pending",
      attempts: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      locked_at: null,
      lease_expires_at: null,
      next_run_at: "2026-01-01T00:00:00.000Z",
      last_error: null,
    },
  );
  assertEquals(calls.events.map((event) => `${event.step}:${event.status}`), [
    "enrich:queued",
    "enrich_dispatch:completed",
  ]);
});

Deno.test("generate voice profile validates API key and persists generated profile", async () => {
  const supabase = fakeSupabase();
  const missing = deps({ readEnv: () => "" });
  const generated = deps();

  const fail = await generateVoiceProfileAdminAction(
    supabase,
    {},
    missing.deps,
  );
  const ok = await generateVoiceProfileAdminAction(
    supabase,
    { guide: "Custom guide" },
    generated.deps,
  );

  assertEquals(fail.status, 500);
  assertEquals((ok.body as Record<string, unknown>).ok, true);
  assertEquals(generated.calls.generator[0].apiKey, "openai-key");
  assertEquals(generated.calls.generator[0].model, "test-model");
  const settingsUpsert = supabase.calls.find((call) =>
    call.op === "upsert" && call.table === "settings"
  )?.value as Array<Record<string, unknown>>;
  assertEquals(settingsUpsert.map((row) => row.key), [
    "voice_guide",
    "personal_voice_profile",
  ]);
});

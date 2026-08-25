import { assertEquals } from "jsr:@std/assert";
import { ExternalPostingBlockedError } from "../_shared/externalPostingGuard.ts";
import {
  manualVideoIntakeCancelAdminAction,
  manualVideoIntakeCreateAdminAction,
  manualVideoIntakePostAdminAction,
  manualVideoIntakeSaveCaptionAdminAction,
  manualVideoIntakeSetDuplicateOverrideAdminAction,
  parseXPostUrl,
  type ManualVideoIntakeDeps,
} from "./manualVideoIntakeActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
  op: string;
  column?: string;
  value?: unknown;
  columns?: string;
};

type FakeConfig = {
  intake?: Record<string, unknown> | null;
  rpcError?: { message: string };
  runtimeControls?: Record<string, unknown>;
  post?: Record<string, unknown> | null;
  media?: Array<Record<string, unknown>>;
  renders?: Array<Record<string, unknown>>;
  settings?: Record<string, Record<string, unknown> | null>;
  xDelivery?: Record<string, unknown> | null;
};

type FakeStorageClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): PromiseLike<{ data?: { signedUrl?: string }; error?: unknown }>;
    };
  };
  rpcError?: { message: string };
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const runtimeControls = config.runtimeControls ?? {
    singleton_id: true,
    environment: "production",
    dedupe_enabled: true,
    translation_enabled: true,
    posting_mode: "enabled",
    updated_at: "2026-06-29T00:00:00.000Z",
    updated_by: null,
  };
  const client: SupabaseAdminClient & { calls: FakeCall[] } & FakeStorageClient = {
    calls,
    from(tableName: string) {
      const state = {
        filters: [] as FakeCall[],
        patch: null as Record<string, unknown> | null,
      };
      const resolve = () => {
        if (tableName === "manual_video_intakes") {
          return { data: config.intake ?? null };
        }
        if (tableName === "runtime_controls") return { data: [runtimeControls] };
        if (tableName === "posts") return { data: config.post ?? null };
        if (tableName === "media") return { data: config.media ?? [] };
        if (tableName === "video_renders") return { data: config.renders ?? [] };
        if (tableName === "x_deliveries") return { data: config.xDelivery ?? null };
        if (tableName === "settings") {
          const key = state.filters.find((filter) => filter.column === "key")?.value;
          return { data: config.settings?.[String(key)] ?? null };
        }
        return { data: null };
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
        insert(value: Record<string, unknown>) {
          calls.push({ table: tableName, op: "insert", value });
          return builder;
        },
        update(value: Record<string, unknown>) {
          state.patch = value;
          calls.push({ table: tableName, op: "update", value });
          return builder;
        },
        upsert(value: Record<string, unknown>) {
          calls.push({ table: tableName, op: "upsert", value });
          return Promise.resolve({});
        },
        eq(column: string, value: unknown) {
          const call = { table: tableName, op: "eq", column, value };
          state.filters.push(call);
          calls.push(call);
          return builder;
        },
        in(column: string, value: unknown[]) {
          calls.push({ table: tableName, op: "in", column, value });
          return builder;
        },
        order(column: string) {
          calls.push({ table: tableName, op: "order", column });
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
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ op: "rpc", column: name, value: args });
      return Promise.resolve({ data: null, error: config.rpcError ?? null });
    },
    storage: {
      from() {
        return {
          createSignedUrl(path: string) {
            calls.push({ op: "signed_url", value: path });
            return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` } });
          },
        };
      },
    },
  };
  return client;
}

function deps(events: Array<Record<string, unknown>> = []): ManualVideoIntakeDeps {
  return {
    insertAdminPipelineEvent: async (_supabase, tweetId, step, status, meta) => {
      events.push({ tweetId, step, status, meta });
    },
    readEnv: (key) => ({
      XOT_ENVIRONMENT: "production",
      ALLOW_EXTERNAL_POSTING: "true",
    } as Record<string, string>)[key] ?? "",
  };
}

const intakeRow = {
  id: "intake-1",
  tweet_id: "1234567890",
  source_url: "https://x.com/account/status/1234567890",
  source_handle: "account",
  created_by: "user-1",
  status: "ready",
  caption_draft: "draft",
  caption_edited: null,
  selected_render_id: "render-1",
  safety_flags: {},
  duplicate_override: false,
  duplicate_override_reason: null,
  posted_x_tweet_id: null,
  posted_at: null,
  last_error: null,
  blocks_auto_delivery: true,
  created_at: "2026-06-29T00:00:00.000Z",
  updated_at: "2026-06-29T00:00:00.000Z",
};

Deno.test("parseXPostUrl accepts canonical X and Twitter status URLs", () => {
  assertEquals(parseXPostUrl("https://x.com/some_user/status/1234567890123")?.tweetId, "1234567890123");
  assertEquals(parseXPostUrl("https://twitter.com/some_user/statuses/1234567890123?s=20")?.normalizedUrl, "https://x.com/some_user/status/1234567890123");
  assertEquals(parseXPostUrl("https://example.com/some_user/status/1234567890123"), null);
});

Deno.test("manual intake create rejects invalid URLs before database side effects", async () => {
  const supabase = fakeSupabase();

  const result = await manualVideoIntakeCreateAdminAction(
    supabase,
    { url: "not-a-tweet" },
    deps(),
    "user-1",
  );

  assertEquals(result.status, 400);
  assertEquals(supabase.calls, []);
});

Deno.test("caption save validates non-empty caption before update", async () => {
  const supabase = fakeSupabase({ intake: intakeRow });

  const result = await manualVideoIntakeSaveCaptionAdminAction(
    supabase,
    { intake_id: "intake-1", caption: "   " },
    deps(),
  );

  assertEquals(result.status, 400);
  assertEquals(supabase.calls.some((call) => call.op === "update"), false);
});

Deno.test("duplicate override requires an operator reason", async () => {
  const supabase = fakeSupabase({ intake: intakeRow });

  const result = await manualVideoIntakeSetDuplicateOverrideAdminAction(
    supabase,
    { intake_id: "intake-1", enabled: true, reason: " " },
    deps(),
  );

  assertEquals(result.status, 400);
  assertEquals(supabase.calls.some((call) => call.op === "update"), false);
});

Deno.test("manual post action refuses missing confirmation before invoking x-poster", async () => {
  const supabase = fakeSupabase({ intake: intakeRow });

  const result = await manualVideoIntakePostAdminAction(
    supabase,
    { intake_id: "intake-1" },
    deps(),
  );

  assertEquals(result.status, 400);
  assertEquals(supabase.calls.some((call) => call.table === "x_deliveries"), false);
});

Deno.test("manual post action fails before changing intake state when server posting configuration is unavailable", async () => {
  const events: Array<Record<string, unknown>> = [];
  const supabase = fakeSupabase({ intake: intakeRow });

  const result = await manualVideoIntakePostAdminAction(
    supabase,
    {
      intake_id: "intake-1",
      confirm_manual_post: true,
      render_id: "render-1",
      caption: "draft",
    },
    deps(events),
  );

  assertEquals(result.status, 503);
  assertEquals(supabase.calls.some((call) => call.op === "update"), false);
  assertEquals(events, []);
});

Deno.test("Preview manual post blocks before snapshot, state update, event, or provider fetch", async () => {
  const events: Array<Record<string, unknown>> = [];
  const supabase = fakeSupabase({
    intake: intakeRow,
    runtimeControls: {
      singleton_id: true,
      environment: "preview",
      dedupe_enabled: false,
      translation_enabled: false,
      posting_mode: "blocked",
      updated_at: "2026-06-29T00:00:00.000Z",
      updated_by: null,
    },
  });
  let providerFetches = 0;
  const result = await manualVideoIntakePostAdminAction(
    supabase,
    {
      intake_id: "intake-1",
      confirm_manual_post: true,
      render_id: "render-1",
      caption: "draft",
    },
    {
      ...deps(events),
      readEnv: (key) => ({
        XOT_ENVIRONMENT: "preview",
        ALLOW_EXTERNAL_POSTING: "true",
      } as Record<string, string>)[key],
      fetchImpl: async () => {
        providerFetches += 1;
        return new Response("{}", { status: 200 });
      },
    },
  );
  assertEquals((result.body as Record<string, unknown>).code, "external_posting_blocked");
  assertEquals(providerFetches, 0);
  assertEquals(events, []);
  assertEquals(supabase.calls.some((call) => call.op === "update" || call.op === "insert" || call.op === "upsert"), false);
});

Deno.test("manual post re-checks the breaker immediately before dispatch without durable writes", async () => {
  const events: Array<Record<string, unknown>> = [];
  const supabase = fakeSupabase({
    intake: intakeRow,
    post: {
      tweet_id: "1234567890",
      text_translated: "translated",
      text_original: "original",
      author_handle: "account",
      url: intakeRow.source_url,
      created_at: intakeRow.created_at,
    },
    media: [{
      id: "media-1",
      tweet_id: "1234567890",
      kind: "video",
      storage_path: "source.mp4",
      mime_type: "video/mp4",
      ordering: 0,
    }],
    renders: [{
      id: "render-1",
      tweet_id: "1234567890",
      status: "completed",
      output_storage_path: "output.mp4",
    }],
    settings: {
      story_memory: { value: { enabled: false } },
      x_posting_config: { value: { enabled: true, allow_video: true, max_chars: 280 } },
    },
  });
  let guardCalls = 0;
  let providerInvokes = 0;
  const result = await manualVideoIntakePostAdminAction(
    supabase,
    {
      intake_id: "intake-1",
      confirm_manual_post: true,
      render_id: "render-1",
      caption: "draft",
    },
    {
      ...deps(events),
      readEnv: (key) => ({
        SUPABASE_URL: "https://supabase.example",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only",
        XOT_ENVIRONMENT: "production",
        ALLOW_EXTERNAL_POSTING: "true",
      } as Record<string, string>)[key],
      requireExternalPosting: async () => {
        guardCalls += 1;
        if (guardCalls === 2) throw new ExternalPostingBlockedError("database_control");
      },
      fetchImpl: async () => {
        providerInvokes += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assertEquals(guardCalls, 2);
  assertEquals(providerInvokes, 0);
  assertEquals((result.body as Record<string, unknown>).code, "external_posting_blocked");
  assertEquals(events, []);
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "update" || call.op === "insert" || call.op === "upsert"
    ),
    false,
  );
});
Deno.test("manual post action blocks historical lineage before any intake mutation", async () => {
  const supabase = fakeSupabase({
    intake: intakeRow,
    rpcError: { message: "delivery_cutover_blocked:historical" },
  });

  const result = await manualVideoIntakePostAdminAction(
    supabase,
    { intake_id: "intake-1", confirm_manual_post: true },
    deps(),
  );

  assertEquals(result.status, 409);
  assertEquals((result.body as Record<string, unknown>).code, "delivery_cutover_blocked");
  assertEquals(supabase.calls.filter((call) => call.op === "update"), []);
});

Deno.test("cancel marks the intake canceled and records a pipeline event", async () => {
  const events: Array<Record<string, unknown>> = [];
  const supabase = fakeSupabase({ intake: intakeRow });

  const result = await manualVideoIntakeCancelAdminAction(
    supabase,
    { intake_id: "intake-1" },
    deps(events),
  );

  assertEquals(result.body, { ok: true, intake_id: "intake-1", status: "canceled" });
  assertEquals(
    supabase.calls.find((call) => call.op === "update")?.value,
    { status: "canceled", last_error: null },
  );
  assertEquals(events[0], {
    tweetId: "1234567890",
    step: "manual_intake",
    status: "completed",
    meta: { action: "canceled", intake_id: "intake-1" },
  });
});

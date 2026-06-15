import { assertEquals } from "jsr:@std/assert";
import {
  getXStatusAdminAction,
  sendTestTweetAdminAction,
  testHydrateTweetAdminAction,
  verifyXCredentialsAdminAction,
  type XApiActionDeps,
} from "./xApiActions.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table?: string;
  op: string;
  column?: string;
  value?: unknown;
  columns?: string;
  args?: unknown;
};

type FakeConfig = {
  settings?: Record<string, unknown>;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: FakeCall[] = [];
  const settings = {
    x_api_controls: { my_x_enabled: true, verify_cache_minutes: 15 },
    x_self_id: {},
    ...(config.settings ?? {}),
  };
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const filters: FakeCall[] = [];
      const resolve = () => {
        if (tableName === "settings") {
          const key = filters.find((call) =>
            call.op === "eq" && call.column === "key"
          )?.value;
          return typeof key === "string"
            ? { data: { value: settings[key] } }
            : { data: [] };
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
        insert(value: Record<string, unknown>) {
          calls.push({ table: tableName, op: "insert", value });
          return Promise.resolve({});
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

function deps(
  responseBody: unknown = {
    data: { id: "u1", username: "masih", name: "Masih" },
  },
) {
  const calls = {
    fetches: [] as Array<Record<string, unknown>>,
    oauth: [] as Array<Record<string, unknown>>,
  };
  const env: Record<string, string> = {
    TWITTER_CONSUMER_KEY: "ck",
    TWITTER_CONSUMER_SECRET: "cs",
    TWITTER_ACCESS_TOKEN: "at",
    TWITTER_ACCESS_TOKEN_SECRET: "ats",
  };
  const actionDeps: XApiActionDeps = {
    readEnv: (key) => env[key],
    oauthHeader: async (method, baseUrl, queryParams, ck, cs, at, ats) => {
      calls.oauth.push({ method, baseUrl, queryParams, ck, cs, at, ats });
      return "OAuth test";
    },
    fetchImpl: async (input, init) => {
      calls.fetches.push({ input: String(input), init });
      return new Response(JSON.stringify(responseBody), { status: 200 });
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  return { deps: actionDeps, calls };
}

Deno.test("x api status reports configured credential secrets", () => {
  assertEquals(
    getXStatusAdminAction({
      readEnv: (key) => key === "TWITTER_CONSUMER_KEY" ? "ck" : "",
    }),
    {
      success: true,
      status: {
        TWITTER_CONSUMER_KEY: true,
        TWITTER_CONSUMER_SECRET: false,
        TWITTER_ACCESS_TOKEN: false,
        TWITTER_ACCESS_TOKEN_SECRET: false,
      },
    },
  );
});

Deno.test("verify credentials uses fresh cached self without an owned read", async () => {
  const supabase = fakeSupabase({
    settings: {
      x_api_controls: { my_x_enabled: false, verify_cache_minutes: 15 },
      x_self_id: {
        id: "cached-id",
        username: "cached",
        name: "Cached Name",
        cached_at: "2025-12-31T23:55:00.000Z",
      },
    },
  });
  const { deps: actionDeps, calls } = deps();

  const result = await verifyXCredentialsAdminAction(supabase, actionDeps);

  assertEquals(result.body, {
    ok: true,
    cached: true,
    id: "cached-id",
    handle: "cached",
    name: "Cached Name",
    cached_at: "2025-12-31T23:55:00.000Z",
  });
  assertEquals(calls.fetches, []);
});

Deno.test("verify credentials respects disabled owned reads without secrets or fetch", async () => {
  const supabase = fakeSupabase({
    settings: {
      x_api_controls: { my_x_enabled: false, verify_cache_minutes: 15 },
      x_self_id: {},
    },
  });
  const { deps: actionDeps, calls } = deps();

  const result = await verifyXCredentialsAdminAction(supabase, actionDeps);

  assertEquals(result.status, 200);
  assertEquals((result.body as Record<string, unknown>).disabled, true);
  assertEquals(
    (result.body as Record<string, unknown>).reason,
    "owned_reads_disabled",
  );
  assertEquals(calls.fetches, []);
});

Deno.test("verify credentials fetches, caches self, and records x api event", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps({
    data: { id: "u1", username: "masih", name: "Masih" },
  });

  const result = await verifyXCredentialsAdminAction(supabase, actionDeps);

  assertEquals((result.body as Record<string, unknown>).ok, true);
  assertEquals((result.body as Record<string, unknown>).id, "u1");
  assertEquals(calls.oauth[0], {
    method: "GET",
    baseUrl: "https://api.x.com/2/users/me",
    queryParams: {},
    ck: "ck",
    cs: "cs",
    at: "at",
    ats: "ats",
  });
  assertEquals(calls.fetches[0].input, "https://api.x.com/2/users/me");
  assertEquals(
    supabase.calls.find((call) =>
      call.op === "upsert" && call.table === "settings" &&
      (call.value as Record<string, unknown>).key === "x_self_id"
    )?.value,
    {
      key: "x_self_id",
      value: {
        id: "u1",
        username: "masih",
        name: "Masih",
        cached_at: "2026-01-01T00:00:00.000Z",
      },
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.op === "insert" && call.table === "x_api_events"
    ),
    true,
  );
});

Deno.test("send test tweet validates payload before credentials", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps();

  const empty = await sendTestTweetAdminAction(
    supabase,
    { text: " " },
    actionDeps,
  );
  const badReply = await sendTestTweetAdminAction(supabase, {
    text: "hello",
    in_reply_to_tweet_id: "abc",
  }, actionDeps);

  assertEquals(empty.status, 400);
  assertEquals(badReply.status, 400);
  assertEquals(calls.fetches, []);
});

Deno.test("send test tweet posts JSON body and returns created id", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps({
    data: { id: "tweet-1", text: "hi" },
  });

  const result = await sendTestTweetAdminAction(supabase, {
    text: " hi ",
    in_reply_to_tweet_id: "123",
  }, actionDeps);

  assertEquals((result.body as Record<string, unknown>).ok, true);
  assertEquals((result.body as Record<string, unknown>).tweet_id, "tweet-1");
  assertEquals(calls.fetches[0].input, "https://api.x.com/2/tweets");
  assertEquals(
    JSON.parse(String((calls.fetches[0].init as RequestInit).body)),
    {
      text: "hi",
      reply: { in_reply_to_tweet_id: "123" },
    },
  );
});

Deno.test("test hydrate tweet validates numeric id and reads note tweet fields", async () => {
  const supabase = fakeSupabase();
  const { deps: actionDeps, calls } = deps({
    data: { text: "short", lang: "en", note_tweet: { text: "long note" } },
  });

  const invalid = await testHydrateTweetAdminAction(
    supabase,
    { tweet_id: "abc" },
    actionDeps,
  );
  const result = await testHydrateTweetAdminAction(
    supabase,
    { tweet_id: "123456" },
    actionDeps,
  );

  assertEquals(invalid.status, 400);
  assertEquals(
    calls.fetches[0].input,
    "https://api.x.com/2/tweets/123456?tweet.fields=note_tweet%2Ctext%2Clang",
  );
  assertEquals(result.body, {
    ok: true,
    tweet_id: "123456",
    text: "short",
    lang: "en",
    note_tweet: "long note",
    raw: {
      data: { text: "short", lang: "en", note_tweet: { text: "long note" } },
    },
  });
});

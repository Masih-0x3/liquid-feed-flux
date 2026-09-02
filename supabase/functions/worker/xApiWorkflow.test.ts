import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import {
  buildHydratedTweetPatch,
  countDailyHydrationsUsed,
  hydrateOauthHeader,
  hydratePercentEncode,
  loadHydrationSettings,
} from "./xApiWorkflow.ts";

type FakeCall = {
  table: string;
  action: string;
  value?: unknown;
  filters?: Array<{ column: string; value: unknown }>;
};

function createSettingsSupabase(options: {
  settings?: Record<string, unknown>;
  throwForKeys?: string[];
} = {}) {
  const calls: FakeCall[] = [];
  const throwForKeys = new Set(options.throwForKeys ?? []);
  return {
    calls,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const builder = {
        select(columns: string) {
          calls.push({ table, action: "select", value: columns });
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        maybeSingle() {
          const key = filters.find((filter) => filter.column === "key")?.value;
          calls.push({ table, action: "maybeSingle", filters: [...filters] });
          if (typeof key === "string" && throwForKeys.has(key)) {
            throw new Error(`${key}_failed`);
          }
          return Promise.resolve({
            data: typeof key === "string" && key in (options.settings ?? {})
              ? { value: options.settings?.[key] }
              : null,
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

function createCountSupabase(options: { count?: number; throws?: boolean }) {
  const calls: FakeCall[] = [];
  return {
    calls,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const builder = {
        select(columns: string, selectOptions: unknown) {
          calls.push({
            table,
            action: "select",
            value: { columns, selectOptions },
          });
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        gte(column: string, value: unknown) {
          filters.push({ column, value });
          calls.push({ table, action: "gte", filters: [...filters] });
          if (options.throws) throw new Error("count_failed");
          return Promise.resolve({ count: options.count ?? 0, error: null });
        },
      };
      return builder;
    },
  };
}

async function withFrozenTime<T>(
  nowMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

Deno.test("hydratePercentEncode follows OAuth percent encoding for reserved characters", () => {
  assertEquals(
    hydratePercentEncode("tweet.fields=note_tweet,text,lang"),
    "tweet.fields%3Dnote_tweet%2Ctext%2Clang",
  );
  assertEquals(hydratePercentEncode("!*()'"), "%21%2A%28%29%27");
});

Deno.test("hydrateOauthHeader builds OAuth 1.0 Authorization header", async () => {
  await withFrozenTime(Date.parse("2026-01-01T00:00:00Z"), async () => {
    const header = await hydrateOauthHeader(
      "GET",
      "https://api.x.com/2/tweets/123",
      { "tweet.fields": "note_tweet,text,lang" },
      "consumer-key",
      "consumer-secret",
      "access-token",
      "token-secret",
    );

    assert(header.startsWith("OAuth "));
    assertMatch(header, /oauth_consumer_key="consumer-key"/);
    assertMatch(header, /oauth_nonce="[A-Fa-f0-9]{32}"/);
    assertMatch(header, /oauth_signature_method="HMAC-SHA1"/);
    assertMatch(header, /oauth_timestamp="1767225600"/);
    assertMatch(header, /oauth_token="access-token"/);
    assertMatch(header, /oauth_version="1.0"/);
    assertMatch(header, /oauth_signature="[^"]+"/);
  });
});

Deno.test("loadHydrationSettings reads kill switch and daily budget", async () => {
  const supabase = createSettingsSupabase({
    settings: {
      twitter_hydration: { enabled: false },
      x_rate_limits: { hydrations_per_day: 12.9 },
    },
  });

  const settings = await loadHydrationSettings(supabase);

  assertEquals(settings, { enabled: false, daily_budget: 12, available: true });
});

Deno.test("loadHydrationSettings reports unavailable when settings reads fail", async () => {
  const supabase = createSettingsSupabase({
    throwForKeys: ["twitter_hydration", "x_rate_limits"],
  });

  const settings = await loadHydrationSettings(supabase);

  assertEquals(settings, { enabled: true, daily_budget: 100, available: false });
});

Deno.test("countDailyHydrationsUsed counts x_api hydrations from the last day", async () => {
  const supabase = createCountSupabase({ count: 7 });

  await withFrozenTime(Date.parse("2026-01-02T00:00:00.000Z"), async () => {
    assertEquals(await countDailyHydrationsUsed(supabase), 7);
  });

  const gteCall = supabase.calls.find((call) => call.action === "gte");
  assert(gteCall);
  assertEquals(gteCall.filters?.at(-1), {
    column: "hydrated_at",
    value: "2026-01-01T00:00:00.000Z",
  });
});

Deno.test("countDailyHydrationsUsed reports unavailable when the count query fails", async () => {
  const supabase = createCountSupabase({ throws: true });

  assertEquals(await countDailyHydrationsUsed(supabase), null);
});

Deno.test("buildHydratedTweetPatch prefers note tweet text and preserves hydration fields", () => {
  const patch = buildHydratedTweetPatch({
    data: {
      text: "truncated",
      note_tweet: { text: "full note tweet text" },
      lang: "fa",
    },
  }, "2026-01-02T03:04:05.000Z");

  assertEquals(patch, {
    fullText: "full note tweet text",
    updatePayload: {
      text_original: "full note tweet text",
      hydrated_at: "2026-01-02T03:04:05.000Z",
      hydration_source: "x_api",
      is_truncated: false,
      translated_at: null,
      text_translated: null,
      lang_original: "fa",
    },
  });
});

Deno.test("buildHydratedTweetPatch falls back to regular text and omits empty lang", () => {
  const patch = buildHydratedTweetPatch({
    data: {
      text: "regular tweet text",
      lang: "",
    },
  }, "2026-01-02T03:04:05.000Z");

  assertEquals(patch, {
    fullText: "regular tweet text",
    updatePayload: {
      text_original: "regular tweet text",
      hydrated_at: "2026-01-02T03:04:05.000Z",
      hydration_source: "x_api",
      is_truncated: false,
      translated_at: null,
      text_translated: null,
    },
  });
});

Deno.test("buildHydratedTweetPatch returns null for empty X API text", () => {
  assertEquals(buildHydratedTweetPatch({ data: {} }), null);
});

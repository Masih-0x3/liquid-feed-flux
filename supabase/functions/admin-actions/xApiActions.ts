import {
  recordXApiEvent,
} from "../_shared/xApiLedger.ts";
import { isMyXEnabled } from "../_shared/myXControls.ts";
import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ReadEnvFn = (key: string) => string | undefined;

type OAuthHeaderFn = (
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  ck: string,
  cs: string,
  at: string,
  ats: string,
) => Promise<string>;

export type XApiActionDeps = {
  fetchImpl?: FetchFn;
  readEnv?: ReadEnvFn;
  oauthHeader?: OAuthHeaderFn;
  now?: () => Date;
  externalPostingOptions?: {
    environment?: string;
    allowExternalPosting?: string;
  };
};

type XCreds = { ck: string; cs: string; at: string; ats: string };

const X_TEXT_ENCODER = new TextEncoder();

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readEnv(key: string, deps?: Pick<XApiActionDeps, "readEnv">): string {
  return deps?.readEnv?.(key) ?? Deno.env.get(key) ?? "";
}

function now(deps?: Pick<XApiActionDeps, "now">): Date {
  return deps?.now?.() ?? new Date();
}

function xPercentEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function xHmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    X_TEXT_ENCODER.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    X_TEXT_ENCODER.encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function xOauthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  ck: string,
  cs: string,
  at: string,
  ats: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort().map((k) =>
    `${xPercentEncode(k)}=${xPercentEncode(allParams[k])}`
  ).join("&");
  const baseString = `${method.toUpperCase()}&${xPercentEncode(baseUrl)}&${
    xPercentEncode(paramString)
  }`;
  const signingKey = `${xPercentEncode(cs)}&${xPercentEncode(ats)}`;
  oauthParams.oauth_signature = await xHmacSha1(signingKey, baseString);
  return `OAuth ${
    Object.keys(oauthParams).sort().map((k) =>
      `${xPercentEncode(k)}="${xPercentEncode(oauthParams[k])}"`
    ).join(", ")
  }`;
}

function getXCreds(deps?: Pick<XApiActionDeps, "readEnv">): XCreds | null {
  const ck = readEnv("TWITTER_CONSUMER_KEY", deps);
  const cs = readEnv("TWITTER_CONSUMER_SECRET", deps);
  const at = readEnv("TWITTER_ACCESS_TOKEN", deps);
  const ats = readEnv("TWITTER_ACCESS_TOKEN_SECRET", deps);
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}

export async function recordAdminXApiAttempt(
  supabase: SupabaseAdminClient,
  input: {
    action: string;
    endpoint: string;
    method?: string;
    tweetId?: string | null;
    userId?: string | null;
    error?: string | null;
    requestCounted?: boolean;
    estimatedBillableUnit?: string | null;
  },
  response?: Response | null,
) {
  await recordXApiEvent(supabase, {
    source: "admin-actions",
    sourceAction: input.action,
    endpoint: input.endpoint,
    method: input.method ?? "GET",
    tweetId: input.tweetId ?? null,
    userId: input.userId ?? null,
    ok: response?.ok ?? false,
    status: response?.status ?? null,
    error: input.error ??
      (response && !response.ok ? `HTTP ${response.status}` : null),
    requestCounted: input.requestCounted,
    estimatedBillableUnit: input.estimatedBillableUnit ?? null,
  }, response ?? null);
}

export function getXStatusAdminAction(
  deps: Pick<XApiActionDeps, "readEnv"> = {},
) {
  return {
    success: true,
    status: {
      TWITTER_CONSUMER_KEY: !!readEnv("TWITTER_CONSUMER_KEY", deps),
      TWITTER_CONSUMER_SECRET: !!readEnv("TWITTER_CONSUMER_SECRET", deps),
      TWITTER_ACCESS_TOKEN: !!readEnv("TWITTER_ACCESS_TOKEN", deps),
      TWITTER_ACCESS_TOKEN_SECRET: !!readEnv(
        "TWITTER_ACCESS_TOKEN_SECRET",
        deps,
      ),
    },
  };
}

export async function verifyXCredentialsAdminAction(
  supabase: SupabaseAdminClient,
  deps: XApiActionDeps = {},
): Promise<AdminActionResponse> {
  const { data: controlsRow } = await table(supabase, "settings").select(
    "value",
  )
    .eq("key", "x_api_controls")
    .maybeSingle();
  const controls = asRecord(asRecord(controlsRow).value);
  const cacheMinutes = typeof controls.verify_cache_minutes === "number"
    ? controls.verify_cache_minutes
    : 15;
  const { data: cachedRow } = await table(supabase, "settings").select("value")
    .eq("key", "x_self_id")
    .maybeSingle();
  const cached = asRecord(asRecord(cachedRow).value);
  const cachedAt = typeof cached.cached_at === "string"
    ? new Date(cached.cached_at).getTime()
    : 0;
  const hasFreshCachedSelf = cached.id && cached.username &&
    cachedAt > now(deps).getTime() - cacheMinutes * 60 * 1000;
  if (hasFreshCachedSelf) {
    return {
      body: {
        ok: true,
        cached: true,
        id: cached.id,
        handle: cached.username,
        name: cached.name,
        cached_at: cached.cached_at,
      },
    };
  }
  if (!isMyXEnabled(controls)) {
    return {
      body: {
        ok: false,
        disabled: true,
        reason: "owned_reads_disabled",
        error:
          "Owned-read credential verification is paused to prevent X API user-read charges.",
      },
      status: 200,
    };
  }
  const creds = getXCreds(deps);
  if (!creds) {
    return {
      body: { ok: false, error: "One or more TWITTER_* secrets are missing" },
      status: 200,
    };
  }
  const url = "https://api.x.com/2/users/me";
  try {
    const oauth = deps.oauthHeader ?? xOauthHeader;
    const auth = await oauth(
      "GET",
      url,
      {},
      creds.ck,
      creds.cs,
      creds.at,
      creds.ats,
    );
    const resp = await (deps.fetchImpl ?? fetch)(url, {
      headers: { Authorization: auth },
    });
    const text = await resp.text();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
    await recordAdminXApiAttempt(supabase, {
      action: "verify_credentials",
      endpoint: url,
      method: "GET",
    }, resp);
    if (!resp.ok) {
      return {
        body: {
          ok: false,
          error: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
          raw: parsedBody,
        },
      };
    }
    const user = (parsedBody as {
      data?: { id?: string; username?: string; name?: string };
    })?.data;
    if (user?.id) {
      const stamp = now(deps).toISOString();
      await table(supabase, "settings").upsert({
        key: "x_self_id",
        value: {
          id: user.id,
          username: user.username,
          name: user.name,
          cached_at: stamp,
        },
        updated_at: stamp,
      }, { onConflict: "key" });
    }
    return {
      body: {
        ok: true,
        id: user?.id,
        handle: user?.username,
        name: user?.name,
        raw: parsedBody,
      },
    };
  } catch (e) {
    await recordAdminXApiAttempt(supabase, {
      action: "verify_credentials",
      endpoint: url,
      method: "GET",
      error: (e as Error).message,
    }, null);
    return { body: { ok: false, error: (e as Error).message } };
  }
}

export async function sendTestTweetAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: XApiActionDeps = {},
): Promise<AdminActionResponse> {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const replyTo = typeof body.in_reply_to_tweet_id === "string"
    ? body.in_reply_to_tweet_id.trim()
    : "";
  if (text.length === 0 || text.length > 280) {
    return {
      body: { ok: false, error: "text must be 1-280 characters" },
      status: 400,
    };
  }
  if (replyTo && !/^\d{1,25}$/.test(replyTo)) {
    return {
      body: {
        ok: false,
        error: "in_reply_to_tweet_id must be a numeric tweet ID",
      },
      status: 400,
    };
  }
  return {
    body: {
      ok: false,
      code: "delivery_cutover_blocked",
      error: "Synthetic X test tweets are disabled during the immutable delivery cutover",
    },
    status: 409,
  };
}

export async function testHydrateTweetAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: XApiActionDeps = {},
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (!/^\d{1,25}$/.test(tweetId)) {
    return {
      body: { ok: false, error: "tweet_id must be a numeric tweet ID" },
      status: 400,
    };
  }
  const creds = getXCreds(deps);
  if (!creds) {
    return {
      body: { ok: false, error: "One or more TWITTER_* secrets are missing" },
      status: 200,
    };
  }
  const baseUrl = `https://api.x.com/2/tweets/${tweetId}`;
  const queryParams = { "tweet.fields": "note_tweet,text,lang" };
  try {
    const oauth = deps.oauthHeader ?? xOauthHeader;
    const auth = await oauth(
      "GET",
      baseUrl,
      queryParams,
      creds.ck,
      creds.cs,
      creds.at,
      creds.ats,
    );
    const url = `${baseUrl}?${
      Object.entries(queryParams).map(([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      ).join("&")
    }`;
    const resp = await (deps.fetchImpl ?? fetch)(url, {
      headers: { Authorization: auth },
    });
    const respText = await resp.text();
    let respBody: unknown;
    try {
      respBody = JSON.parse(respText);
    } catch {
      respBody = respText;
    }
    await recordAdminXApiAttempt(supabase, {
      action: "test_hydrate",
      endpoint: baseUrl,
      method: "GET",
      tweetId,
    }, resp);
    if (!resp.ok) {
      return {
        body: {
          ok: false,
          error: `HTTP ${resp.status}: ${respText.slice(0, 300)}`,
          raw: respBody,
        },
      };
    }
    const data = (respBody as {
      data?: { text?: string; lang?: string; note_tweet?: { text?: string } };
    })?.data;
    return {
      body: {
        ok: true,
        tweet_id: tweetId,
        text: data?.text,
        lang: data?.lang,
        note_tweet: data?.note_tweet?.text,
        raw: respBody,
      },
    };
  } catch (e) {
    await recordAdminXApiAttempt(supabase, {
      action: "test_hydrate",
      endpoint: baseUrl,
      method: "GET",
      tweetId,
      error: (e as Error).message,
    }, null);
    return { body: { ok: false, error: (e as Error).message } };
  }
}

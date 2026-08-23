import {
  recordXApiEvent,
} from "../_shared/xApiLedger.ts";

type TwitterCreds = {
  ck: string;
  cs: string;
  at: string;
  ats: string;
};

type HydrationSettings = {
  enabled: boolean;
  daily_budget: number;
  available: boolean;
};

type HydratedTweetPatch = {
  fullText: string;
  updatePayload: Record<string, unknown>;
};

type HydrationQueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type HydrationSettingsQuery = {
  eq(column: string, value: unknown): HydrationSettingsQuery;
  maybeSingle(): PromiseLike<HydrationQueryResult>;
};

type HydrationCountQuery = {
  eq(column: string, value: unknown): HydrationCountQuery;
  gte(column: string, value: unknown): PromiseLike<HydrationQueryResult>;
};

type HydrationSettingsClient = {
  from(table: string): {
    select(columns: string, options?: Record<string, unknown>): HydrationSettingsQuery;
  };
};

type HydrationCountClient = {
  from(table: string): {
    select(columns: string, options?: Record<string, unknown>): HydrationCountQuery;
  };
};

type SettingRecord = Record<string, unknown>;

function parseSettingValue(row: unknown): SettingRecord | null | false {
  if (row === null || row === undefined) return null;
  if (typeof row !== "object" || Array.isArray(row) || !("value" in row)) {
    return false;
  }
  const value = row.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return value as SettingRecord;
}

const HYDRATE_TEXT_ENCODER = new TextEncoder();

export function hydratePercentEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hydrateHmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    HYDRATE_TEXT_ENCODER.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    HYDRATE_TEXT_ENCODER.encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function hydrateOauthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  tokenSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort()
    .map((k) =>
      `${hydratePercentEncode(k)}=${hydratePercentEncode(allParams[k])}`
    )
    .join("&");
  const baseString = `${method.toUpperCase()}&${
    hydratePercentEncode(baseUrl)
  }&${hydratePercentEncode(paramString)}`;
  const signingKey = `${hydratePercentEncode(consumerSecret)}&${
    hydratePercentEncode(tokenSecret)
  }`;
  oauthParams.oauth_signature = await hydrateHmacSha1(signingKey, baseString);
  return `OAuth ${
    Object.keys(oauthParams).sort()
      .map((k) =>
        `${hydratePercentEncode(k)}="${hydratePercentEncode(oauthParams[k])}"`
      )
      .join(", ")
  }`;
}

// Reads Twitter creds strictly from environment secrets.
export async function getTwitterCreds(
  _supabase: unknown,
): Promise<TwitterCreds | null> {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY") || "";
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET") || "";
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN") || "";
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET") || "";
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}

// Record hydration X API attempts in the canonical x_api_events ledger.
export async function recordXApiCall(
  supabase: unknown,
  errorMsg?: string | null,
  response?: Response | null,
  tweetId?: string | null,
): Promise<void> {
  const requestCounted = errorMsg !== "no_creds";
  await recordXApiEvent(
    supabase,
    {
      source: "worker",
      sourceAction: "hydrate_tweet",
      endpoint: tweetId ? `/2/tweets/${tweetId}` : "/2/tweets/:id",
      method: "GET",
      tweetId,
      ok: response?.ok ?? false,
      status: response?.status ?? null,
      error: errorMsg ??
        (response && !response.ok ? `HTTP ${response.status}` : null),
      requestCounted,
      estimatedBillableUnit: "post_read",
    },
    response ?? null,
  );
}

// Load hydration toggle + daily budget from settings.
// - twitter_hydration.enabled (default true): master kill switch
// - x_rate_limits.hydrations_per_day (default 100): max X reads per 24h for hydration
export async function loadHydrationSettings(
  supabase: HydrationSettingsClient,
): Promise<HydrationSettings> {
  let enabled = true;
  let daily_budget = 100;
  let available = true;
  try {
    const { data: th, error: thError } = await supabase.from("settings").select("value")
      .eq("key", "twitter_hydration")
      .maybeSingle();
    if (thError) available = false;
    if (th && typeof th === "object" && "value" in th &&
      (th.value === null || Array.isArray(th.value))) available = false;
    const twitterHydration = parseSettingValue(th);
    if (twitterHydration === false) {
      available = false;
    } else if (
      twitterHydration !== null &&
      "enabled" in twitterHydration
    ) {
      if (typeof twitterHydration.enabled !== "boolean") {
        available = false;
      } else if (twitterHydration.enabled === false) {
        enabled = false;
      }
    }
  } catch { available = false; }
  try {
    const { data: rl, error: rlError } = await supabase.from("settings").select("value")
      .eq("key", "x_rate_limits")
      .maybeSingle();
    if (rlError) available = false;
    if (rl && typeof rl === "object" && "value" in rl &&
      (rl.value === null || Array.isArray(rl.value))) available = false;
    const rateLimits = parseSettingValue(rl);
    if (rateLimits === false) {
      available = false;
    } else if (
      rateLimits !== null &&
      "hydrations_per_day" in rateLimits
    ) {
      if (
        typeof rateLimits.hydrations_per_day !== "number" ||
        !Number.isFinite(rateLimits.hydrations_per_day) ||
        rateLimits.hydrations_per_day <= 0
      ) {
        available = false;
      } else {
        daily_budget = Math.floor(rateLimits.hydrations_per_day);
      }
    }
  } catch { available = false; }
  return { enabled, daily_budget, available };
}

// Count hydration X API calls in the last 24h. We use posts.hydrated_at with
// hydration_source='x_api' (the only source that consumed an actual X read).
export async function countDailyHydrationsUsed(
  supabase: HydrationCountClient,
): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("posts")
      .select("tweet_id", { count: "exact", head: true })
      .eq("hydration_source", "x_api")
      .gte("hydrated_at", since);
    if (error || !Number.isSafeInteger(count) || count < 0) return null;
    return count;
  } catch {
    return null;
  }
}

export function buildHydratedTweetPatch(
  json: Record<string, unknown>,
  nowIso = new Date().toISOString(),
): HydratedTweetPatch | null {
  const data = (json.data || {}) as Record<string, unknown>;
  const noteTweet = (data.note_tweet || {}) as Record<string, unknown>;
  const fullText = (noteTweet.text as string) || (data.text as string) || "";
  const lang = (data.lang as string) || null;

  if (!fullText) return null;

  const updatePayload: Record<string, unknown> = {
    text_original: fullText,
    hydrated_at: nowIso,
    hydration_source: "x_api",
    is_truncated: false,
    // Invalidate stale truncated translations so downstream delivery gates
    // cannot use old text before post-hydrate translation completes.
    translated_at: null,
    text_translated: null,
  };
  if (lang) updatePayload.lang_original = lang;

  return { fullText, updatePayload };
}

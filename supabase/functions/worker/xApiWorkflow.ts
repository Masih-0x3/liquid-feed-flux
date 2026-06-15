import {
  recordLegacyXApiUsage,
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
};

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
  // deno-lint-ignore no-explicit-any
  _supabase: any,
): Promise<TwitterCreds | null> {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY") || "";
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET") || "";
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN") || "";
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET") || "";
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}

// Best-effort increment of x_api_usage settings counter (rolling 24h).
export async function recordXApiCall(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
  if (requestCounted) {
    await recordLegacyXApiUsage(supabase, {
      error: errorMsg ??
        (response && !response.ok ? `hydrate: HTTP ${response.status}` : null),
    });
  }
}

// Load hydration toggle + daily budget from settings.
// - twitter_hydration.enabled (default true): master kill switch
// - x_rate_limits.hydrations_per_day (default 100): max X reads per 24h for hydration
export async function loadHydrationSettings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<HydrationSettings> {
  let enabled = true;
  let daily_budget = 100;
  try {
    const { data: th } = await supabase.from("settings").select("value")
      .eq("key", "twitter_hydration")
      .maybeSingle();
    if (th?.value && typeof th.value === "object") {
      const v = th.value as Record<string, unknown>;
      if (v.enabled === false) enabled = false;
    }
  } catch {
    // keep default
  }
  try {
    const { data: rl } = await supabase.from("settings").select("value")
      .eq("key", "x_rate_limits")
      .maybeSingle();
    if (rl?.value && typeof rl.value === "object") {
      const v = rl.value as Record<string, unknown>;
      const n = Number(v.hydrations_per_day);
      if (Number.isFinite(n) && n > 0) daily_budget = Math.floor(n);
    }
  } catch {
    // keep default
  }
  return { enabled, daily_budget };
}

// Count hydration X API calls in the last 24h. We use posts.hydrated_at with
// hydration_source='x_api' (the only source that consumed an actual X read).
export async function countDailyHydrationsUsed(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("posts")
      .select("tweet_id", { count: "exact", head: true })
      .eq("hydration_source", "x_api")
      .gte("hydrated_at", since);
    return Number(count || 0);
  } catch {
    return 0;
  }
}

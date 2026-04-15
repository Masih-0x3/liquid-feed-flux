import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();

interface DigestConfig {
  twitter_consumer_key: string;
  twitter_consumer_secret: string;
  twitter_access_token: string;
  twitter_access_token_secret: string;
  frequency_minutes: number;
  max_bullets: number;
  min_posts: number;
  header_format: string;
}

interface OpenAIConfig {
  model: string;
  temperature: number;
  max_completion_tokens: number;
}

const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  twitter_consumer_key: "",
  twitter_consumer_secret: "",
  twitter_access_token: "",
  twitter_access_token_secret: "",
  frequency_minutes: 30,
  max_bullets: 10,
  min_posts: 2,
  header_format: "📰 News Digest — {time}",
};

const DEFAULT_OPENAI_CONFIG: OpenAIConfig = {
  model: "gpt-4o-mini",
  temperature: 0.3,
  max_completion_tokens: 1500,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDigestConfigOverride(value: unknown): Partial<DigestConfig> {
  if (!isRecord(value)) return {};

  const frequencyMinutes = readNumber(value.frequency_minutes);
  const maxBullets = readNumber(value.max_bullets);
  const minPosts = readNumber(value.min_posts);

  return {
    ...(readString(value.twitter_consumer_key) !== undefined ? { twitter_consumer_key: readString(value.twitter_consumer_key)! } : {}),
    ...(readString(value.twitter_consumer_secret) !== undefined ? { twitter_consumer_secret: readString(value.twitter_consumer_secret)! } : {}),
    ...(readString(value.twitter_access_token) !== undefined ? { twitter_access_token: readString(value.twitter_access_token)! } : {}),
    ...(readString(value.twitter_access_token_secret) !== undefined ? { twitter_access_token_secret: readString(value.twitter_access_token_secret)! } : {}),
    ...(frequencyMinutes !== undefined ? { frequency_minutes: Math.max(5, Math.min(1440, Math.round(frequencyMinutes))) } : {}),
    ...(maxBullets !== undefined ? { max_bullets: Math.max(1, Math.min(20, Math.round(maxBullets))) } : {}),
    ...(minPosts !== undefined ? { min_posts: Math.max(1, Math.min(50, Math.round(minPosts))) } : {}),
    ...(readString(value.header_format) !== undefined ? { header_format: readString(value.header_format)! } : {}),
  };
}

function readOpenAIConfig(value: unknown): OpenAIConfig {
  if (!isRecord(value)) return DEFAULT_OPENAI_CONFIG;

  const model = readString(value.model) || DEFAULT_OPENAI_CONFIG.model;
  const temperature = readNumber(value.temperature);
  const maxCompletionTokens = readNumber(value.max_completion_tokens) ?? readNumber(value.max_tokens);

  return {
    model,
    temperature: temperature !== undefined ? Math.max(0, Math.min(2, temperature)) : DEFAULT_OPENAI_CONFIG.temperature,
    max_completion_tokens: maxCompletionTokens !== undefined
      ? Math.max(600, Math.min(4000, Math.round(maxCompletionTokens)))
      : DEFAULT_OPENAI_CONFIG.max_completion_tokens,
  };
}

function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-5|gpt-4\.1|o3|o4)/.test(model);
}

function supportsTemperature(model: string): boolean {
  return !usesMaxCompletionTokens(model);
}

function buildThreadTweets(summary: string, header: string): string[] {
  const lines = summary.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const tweets: string[] = [];
  let current = `${header}\n\n`;

  for (const line of lines) {
    if ((current + line + "\n").length > 270) {
      tweets.push(current.trim());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) tweets.push(current.trim());
  return tweets;
}

// ── OAuth 1.0a helpers ──────────────────────────────────────────────
function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function oauthNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function oauthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  tokenSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  oauthParams.oauth_signature = await hmacSha1(signingKey, baseString);

  return `OAuth ${Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(", ")}`;
}

// ── Twitter API helpers ─────────────────────────────────────────────
async function postTweet(
  text: string,
  replyToId: string | null,
  ck: string,
  cs: string,
  at: string,
  ats: string,
): Promise<{ id: string }> {
  const url = "https://api.x.com/2/tweets";
  const body: Record<string, unknown> = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };

  const auth = await oauthHeader("POST", url, {}, ck, cs, at, ats);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twitter API ${res.status}: ${errText}`);
  }

  const json = await res.json();
  return { id: json.data.id };
}

// ── Main handler ────────────────────────────────────────────────────
function validateInternalToken(req: Request): Response | null {
  const token = req.headers.get('x-internal-token') || '';
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET') || '';
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (expected && token === expected) return null;
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;
  if (anonKey && authHeader === `Bearer ${anonKey}`) return null;
  if (!expected) return null;

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authError = validateInternalToken(req);
  if (authError) return authError;

  let dryRun = false;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    let requestBody: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (isRecord(parsed)) requestBody = parsed;
    } catch {
      requestBody = {};
    }

    dryRun = requestBody.dry_run === true;

    const { data: settingsRows, error: settingsError } = await sb
      .from("settings")
      .select("key, value")
      .in("key", ["digest_config", "openai_config"]);

    if (settingsError) throw settingsError;

    const settingsMap = Object.fromEntries((settingsRows || []).map((row) => [row.key, row.value])) as Record<string, unknown>;
    const hasSavedDigestConfig = isRecord(settingsMap.digest_config);

    const digestConfig = {
      ...DEFAULT_DIGEST_CONFIG,
      ...readDigestConfigOverride(settingsMap.digest_config),
      ...(dryRun ? readDigestConfigOverride(requestBody.config) : {}),
    } satisfies DigestConfig;

    const openaiConfig = readOpenAIConfig(settingsMap.openai_config);

    if (!dryRun && !hasSavedDigestConfig) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_config" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const freqMinutes = digestConfig.frequency_minutes;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - freqMinutes * 60 * 1000);

    const { data: posts, error: postsErr } = await sb
      .from("posts")
      .select("tweet_id, text_translated, text_original, author_handle, url, has_media, tweeted_at, created_at")
      .gte("created_at", periodStart.toISOString())
      .lte("created_at", periodEnd.toISOString())
      .not("text_translated", "is", null)
      .eq("delivery_decision", "deliver")
      .order("created_at", { ascending: true });

    if (postsErr) throw postsErr;

    if (!dryRun && (!posts || posts.length < digestConfig.min_posts)) {
      await sb.from("digests").insert({
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_ids: (posts || []).map((post) => post.tweet_id),
        status: "skipped",
        error: `Only ${posts?.length || 0} posts (min: ${digestConfig.min_posts})`,
      });

      return new Response(JSON.stringify({ skipped: true, post_count: posts?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bulletPrompt = (posts || [])
      .map((post, index) => `${index + 1}. @${post.author_handle || "unknown"}: ${post.text_translated || post.text_original || ""}`)
      .join("\n");

    const systemPrompt = `You are a senior news editor at a respected wire service. Your task is to compile the following raw posts into a polished, editorial-quality news digest.

Guidelines:
- Write at most ${digestConfig.max_bullets} news items using bullet points (•).
- Each item should be a clear, informative sentence that provides context — not just a headline. Include key details (who, what, why, implications) when available.
- Group related stories together and order them by significance (most important first).
- If multiple posts cover the same event, merge them into a single, richer bullet that synthesizes the information.
- Maintain a neutral, authoritative journalistic tone throughout.
- Ensure the digest reads as a cohesive briefing — transitions between topics should feel natural, not disjointed.
- Write in the same language as the source posts (Persian/Farsi if the posts are translated to Persian).
- Do NOT include usernames, handles, links, or source attribution.
- Do NOT repeat the same fact across multiple bullets.
- Prioritize geopolitical, military, sanctions, and breaking news over routine or minor stories.`;

    if (dryRun && (!posts || posts.length === 0)) {
      return new Response(JSON.stringify({
        dry_run: true,
        reason: "no_posts",
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_count: 0,
        posts: [],
        digest_config: {
          frequency_minutes: digestConfig.frequency_minutes,
          max_bullets: digestConfig.max_bullets,
          min_posts: digestConfig.min_posts,
          header_format: digestConfig.header_format,
          twitter_credentials_configured: Boolean(
            digestConfig.twitter_consumer_key &&
            digestConfig.twitter_consumer_secret &&
            digestConfig.twitter_access_token &&
            digestConfig.twitter_access_token_secret,
          ),
        },
        openai_request: {
          model: openaiConfig.model,
          ...(usesMaxCompletionTokens(openaiConfig.model)
            ? { max_completion_tokens: openaiConfig.max_completion_tokens }
            : { max_tokens: openaiConfig.max_completion_tokens }),
          ...(supportsTemperature(openaiConfig.model) ? { temperature: openaiConfig.temperature } : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "(no posts in this period)" },
          ],
        },
        openai_system_prompt: systemPrompt,
        openai_user_prompt: "(no posts in this period)",
        openai_response: "",
        openai_finish_reason: null,
        openai_usage: null,
        formatted_tweets: [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiRequestPayload: Record<string, unknown> = {
      model: openaiConfig.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: bulletPrompt },
      ],
      ...(usesMaxCompletionTokens(openaiConfig.model)
        ? { max_completion_tokens: openaiConfig.max_completion_tokens }
        : { max_tokens: openaiConfig.max_completion_tokens }),
      ...(supportsTemperature(openaiConfig.model) ? { temperature: openaiConfig.temperature } : {}),
    };

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(openaiRequestPayload),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI ${openaiRes.status}: ${errText}`);
    }

    const openaiJson = await openaiRes.json();
    const openaiChoice = openaiJson.choices?.[0];
    const summary = typeof openaiChoice?.message?.content === "string" ? openaiChoice.message.content.trim() : "";
    const openaiFinishReason = openaiChoice?.finish_reason ?? null;
    const openaiUsage = openaiJson.usage ?? null;

    const timeStr = periodEnd.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const header = digestConfig.header_format.replace("{time}", timeStr);
    const tweets = buildThreadTweets(summary, header);

    if (dryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_count: posts?.length || 0,
        posts: (posts || []).map((post) => ({
          tweet_id: post.tweet_id,
          author_handle: post.author_handle,
          text_translated: post.text_translated,
          text_original: post.text_original,
          created_at: post.created_at,
        })),
        digest_config: {
          frequency_minutes: digestConfig.frequency_minutes,
          max_bullets: digestConfig.max_bullets,
          min_posts: digestConfig.min_posts,
          header_format: digestConfig.header_format,
          twitter_credentials_configured: Boolean(
            digestConfig.twitter_consumer_key &&
            digestConfig.twitter_consumer_secret &&
            digestConfig.twitter_access_token &&
            digestConfig.twitter_access_token_secret,
          ),
        },
        openai_request: openaiRequestPayload,
        openai_system_prompt: systemPrompt,
        openai_user_prompt: bulletPrompt,
        openai_response: summary,
        openai_finish_reason: openaiFinishReason,
        openai_usage: openaiUsage,
        formatted_tweets: tweets,
        warning: summary ? null : `OpenAI returned empty summary${openaiFinishReason ? ` (finish_reason: ${openaiFinishReason})` : ""}`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!summary) {
      throw new Error(`OpenAI returned empty summary${openaiFinishReason ? ` (finish_reason: ${openaiFinishReason})` : ""}`);
    }

    if (
      !digestConfig.twitter_consumer_key ||
      !digestConfig.twitter_consumer_secret ||
      !digestConfig.twitter_access_token ||
      !digestConfig.twitter_access_token_secret
    ) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_twitter_keys" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tweetIds: string[] = [];
    let replyTo: string | null = null;

    for (const tweetText of tweets) {
      const result = await postTweet(
        tweetText,
        replyTo,
        digestConfig.twitter_consumer_key,
        digestConfig.twitter_consumer_secret,
        digestConfig.twitter_access_token,
        digestConfig.twitter_access_token_secret,
      );
      tweetIds.push(result.id);
      replyTo = result.id;
    }

    await sb.from("digests").insert({
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      post_ids: (posts || []).map((post) => post.tweet_id),
      summary_text: summary,
      twitter_tweet_ids: tweetIds,
      status: "posted",
    });

    return new Response(JSON.stringify({ success: true, tweet_count: tweetIds.length, post_count: posts?.length || 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("digest-compiler error:", err);

    if (!dryRun) {
      try {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await sb.from("digests").insert({
          period_start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          period_end: new Date().toISOString(),
          status: "failed",
          error: (err as Error).message?.substring(0, 500),
        });
      } catch {
        // ignore logging failure
      }
    }

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

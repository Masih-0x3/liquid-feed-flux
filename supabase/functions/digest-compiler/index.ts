import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const encoder = new TextEncoder();

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
  method: string, url: string, params: Record<string, string>,
  consumerKey: string, consumerSecret: string, accessToken: string, tokenSecret: string
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
  const paramString = Object.keys(allParams).sort().map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  oauthParams.oauth_signature = await hmacSha1(signingKey, baseString);

  return "OAuth " + Object.keys(oauthParams).sort().map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(", ");
}

// ── Twitter API helpers ─────────────────────────────────────────────
async function postTweet(
  text: string, replyToId: string | null,
  ck: string, cs: string, at: string, ats: string
): Promise<{ id: string }> {
  const url = "https://api.x.com/2/tweets";
  const body: Record<string, unknown> = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };

  // Do NOT include POST body params in OAuth signature for JSON requests
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // 1. Load config
    const { data: configRow } = await sb.from("settings").select("value").eq("key", "digest_config").single();
    const config = configRow?.value as {
      twitter_consumer_key: string; twitter_consumer_secret: string;
      twitter_access_token: string; twitter_access_token_secret: string;
      frequency_minutes: number; max_bullets: number; min_posts: number; header_format: string;
    } | null;

    if (!config || !config.twitter_consumer_key) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_config" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const freqMinutes = config.frequency_minutes || 30;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - freqMinutes * 60 * 1000);

    // 2. Fetch recent delivered posts
    const { data: posts, error: postsErr } = await sb
      .from("posts")
      .select("tweet_id, text_translated, text_original, author_handle, url, has_media, tweeted_at")
      .gte("created_at", periodStart.toISOString())
      .lte("created_at", periodEnd.toISOString())
      .not("text_translated", "is", null)
      .eq("delivery_decision", "deliver")
      .order("created_at", { ascending: true });

    if (postsErr) throw postsErr;

    if (!posts || posts.length < (config.min_posts || 2)) {
      // Record skipped digest
      await sb.from("digests").insert({
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_ids: (posts || []).map((p) => p.tweet_id),
        status: "skipped",
        error: `Only ${posts?.length || 0} posts (min: ${config.min_posts || 2})`,
      });
      return new Response(JSON.stringify({ skipped: true, post_count: posts?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Build summary via OpenAI
    const bulletPrompt = posts.map((p, i) =>
      `${i + 1}. @${p.author_handle || "unknown"}: ${p.text_translated || p.text_original}`
    ).join("\n");

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a news editor. Summarize the following posts into a concise bullet-point digest. Use at most ${config.max_bullets || 10} bullet points. Each bullet should be one sentence. Write in the same language as the posts. Use emoji bullets (•). Do not include attribution or links.`,
          },
          { role: "user", content: bulletPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI ${openaiRes.status}: ${errText}`);
    }

    const openaiJson = await openaiRes.json();
    const summary = openaiJson.choices?.[0]?.message?.content?.trim() || "";

    // 4. Format into tweet-sized chunks (280 char limit)
    const timeStr = periodEnd.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const header = (config.header_format || "📰 News Digest — {time}").replace("{time}", timeStr);

    const tweets: string[] = [];
    const lines = summary.split("\n").filter((l: string) => l.trim());
    let current = header + "\n\n";

    for (const line of lines) {
      if ((current + line + "\n").length > 270) {
        tweets.push(current.trim());
        current = "";
      }
      current += line + "\n";
    }
    if (current.trim()) tweets.push(current.trim());

    // 5. Post as Twitter thread
    const { twitter_consumer_key: ck, twitter_consumer_secret: cs, twitter_access_token: at, twitter_access_token_secret: ats } = config;
    const tweetIds: string[] = [];
    let replyTo: string | null = null;

    for (const tweetText of tweets) {
      const result = await postTweet(tweetText, replyTo, ck, cs, at, ats);
      tweetIds.push(result.id);
      replyTo = result.id;
    }

    // 6. Record digest
    await sb.from("digests").insert({
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      post_ids: posts.map((p) => p.tweet_id),
      summary_text: summary,
      twitter_tweet_ids: tweetIds,
      status: "posted",
    });

    return new Response(JSON.stringify({ success: true, tweet_count: tweetIds.length, post_count: posts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("digest-compiler error:", err);

    // Try to record failure
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await sb.from("digests").insert({
        period_start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        period_end: new Date().toISOString(),
        status: "failed",
        error: (err as Error).message?.substring(0, 500),
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

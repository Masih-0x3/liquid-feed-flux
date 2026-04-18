// X Poster — score-gated, media-required posting pipeline.
// Cron-driven worker that posts qualifying posts to X via OAuth 1.0a v2 with
// optional media upload. All quotas/templates read from the `settings` table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};

const enc = new TextEncoder();

// ─── OAuth 1.0a helpers (mirror digest-compiler) ─────────────────────
function pe(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function oauthHeader(
  method: string, url: string, params: Record<string, string>,
  ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...params };
  const paramStr = Object.keys(all).sort().map((k) => `${pe(k)}=${pe(all[k])}`).join('&');
  const baseStr = `${method.toUpperCase()}&${pe(url)}&${pe(paramStr)}`;
  const signKey = `${pe(cs)}&${pe(ats)}`;
  oauth.oauth_signature = await hmacSha1(signKey, baseStr);
  return `OAuth ${Object.keys(oauth).sort().map((k) => `${pe(k)}="${pe(oauth[k])}"`).join(', ')}`;
}

// ─── Auth (cron / internal only) ─────────────────────────────────────
function checkAuth(req: Request): Response | null {
  const internal = req.headers.get('x-internal-token') || '';
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET') || '';
  const auth = req.headers.get('Authorization') || '';
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (expected && internal === expected) return null;
  if (svc && auth === `Bearer ${svc}`) return null;
  if (anon && auth === `Bearer ${anon}`) return null;
  if (!expected) return null;
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ─── Types ───────────────────────────────────────────────────────────
interface PostingConfig {
  enabled: boolean;
  min_score: number;
  require_media: boolean;
  post_template: string;
  leading_emoji: string;
  hashtags: string;
  max_chars: number;
  dedupe_window_hours: number;
  post_only_decision_deliver: boolean;
  /** ISO timestamp — only posts created at/after this are eligible. Set when posting is (re)enabled. */
  start_posting_from?: string | null;
}
interface RateLimits {
  posts_per_hour: number;
  posts_per_day: number;
  monthly_post_budget: number;
  media_uploads_per_day: number;
}

const DEFAULT_CFG: PostingConfig = {
  enabled: false, min_score: 14, require_media: true,
  post_template: '{leading_emoji} {translated_text}', leading_emoji: '📰',
  hashtags: '', max_chars: 280, dedupe_window_hours: 48, post_only_decision_deliver: true,
};
const DEFAULT_LIMITS: RateLimits = {
  posts_per_hour: 20, posts_per_day: 100, monthly_post_budget: 2500, media_uploads_per_day: 200,
};

// ─── Helpers ─────────────────────────────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

// U+200F = Right-to-Left Mark. Forces X/Twitter to render the entire tweet RTL,
// even when it begins with emoji, hashtags, digits, or Latin punctuation.
const RLM = '\u200F';

function formatTweet(tpl: string, vars: Record<string, string>, max: number): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  // Reserve 1 char for the leading RLM so we never exceed max after prepending.
  const budget = Math.max(1, max - 1);
  if (out.length > budget) out = out.slice(0, budget - 1).trimEnd() + '…';
  return RLM + out;
}

async function trimRollingWindow(arr: string[], windowMs: number): Promise<string[]> {
  const cutoff = Date.now() - windowMs;
  return (arr || []).filter((ts) => { try { return new Date(ts).getTime() > cutoff; } catch { return false; } });
}

// ─── Media validation (images only — RSS.app does not provide native videos) ──
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per X spec

interface MediaRow {
  id: string;
  storage_path: string | null;
  downloaded_at: string | null;
  mime_type: string | null;
  file_size: number | null;
  kind: string | null;
}

function selectUploadable(rows: MediaRow[]): { ok: MediaRow[]; reason?: string } {
  const downloaded = rows.filter((r) => r.downloaded_at && r.storage_path);
  if (downloaded.length === 0) return { ok: [], reason: 'no_media' };

  const images = downloaded.filter((r) => ALLOWED_IMAGE.includes(r.mime_type || '') && (r.file_size ?? 0) <= MAX_IMAGE_BYTES);

  if (images.length > 0) return { ok: images.slice(0, 4) };
  return { ok: [], reason: 'no_supported_media' };
}

// ─── X media upload (image, simple base64) ───────────────────────────
async function uploadImage(
  bytes: Uint8Array, mime: string, ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const b64 = btoa(String.fromCharCode(...bytes));
  const params: Record<string, string> = { media_data: b64 };
  const auth = await oauthHeader('POST', url, params, ck, cs, at, ats);
  const body = new URLSearchParams(params);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`media upload ${resp.status}: ${text.slice(0, 300)} (mime=${mime})`);
  const json = JSON.parse(text);
  return String(json.media_id_string || json.media_id);
}

// ─── Post tweet ──────────────────────────────────────────────────────
async function postTweet(
  text: string, mediaIds: string[], ck: string, cs: string, at: string, ats: string,
): Promise<{ id: string; raw: unknown }> {
  const url = 'https://api.x.com/2/tweets';
  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
  const auth = await oauthHeader('POST', url, {}, ck, cs, at, ats);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text2 = await resp.text();
  let json: unknown; try { json = JSON.parse(text2); } catch { json = text2; }
  if (!resp.ok) {
    const err = new Error(`tweet ${resp.status}: ${text2.slice(0, 400)}`);
    (err as { status?: number }).status = resp.status;
    (err as { raw?: unknown }).raw = json;
    throw err;
  }
  const d = (json as { data?: { id?: string } }).data;
  return { id: String(d?.id), raw: json };
}

// ─── Main ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(supabaseUrl, svcKey);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const onlyTweetId = typeof body.tweet_id === 'string' ? body.tweet_id : null;

  // Load settings
  const { data: settingsRows } = await sb.from('settings').select('key, value')
    .in('key', ['x_posting_config', 'x_rate_limits', 'x_api_usage']);
  const sm: Record<string, unknown> = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
  const cfg: PostingConfig = { ...DEFAULT_CFG, ...(isRecord(sm.x_posting_config) ? sm.x_posting_config : {}) } as PostingConfig;
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...(isRecord(sm.x_rate_limits) ? sm.x_rate_limits : {}) } as RateLimits;
  const usage = isRecord(sm.x_api_usage) ? sm.x_api_usage as Record<string, unknown> : {};

  if (!cfg.enabled && !dryRun && !onlyTweetId) {
    return new Response(JSON.stringify({ skipped: true, reason: 'disabled' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // X creds
  const ck = Deno.env.get('TWITTER_CONSUMER_KEY') || '';
  const cs = Deno.env.get('TWITTER_CONSUMER_SECRET') || '';
  const at = Deno.env.get('TWITTER_ACCESS_TOKEN') || '';
  const ats = Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET') || '';
  if (!ck || !cs || !at || !ats) {
    return new Response(JSON.stringify({ error: 'X credentials not configured' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Quota check
  const posts24hArr = await trimRollingWindow((usage.posts_24h as string[]) || [], 24 * 60 * 60 * 1000);
  const posts1hCount = posts24hArr.filter((ts) => new Date(ts).getTime() > Date.now() - 60 * 60 * 1000).length;
  const mediaUp24hArr = await trimRollingWindow((usage.media_uploads_24h as string[]) || [], 24 * 60 * 60 * 1000);

  const { count: monthlyPosts } = await sb.from('x_deliveries').select('*', { count: 'exact', head: true })
    .eq('status', 'posted').gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());

  function quotaBlock(): string | null {
    if (posts1hCount >= limits.posts_per_hour) return 'rate_limit_hour';
    if (posts24hArr.length >= limits.posts_per_day) return 'rate_limit_day';
    if ((monthlyPosts ?? 0) >= limits.monthly_post_budget) return 'rate_limit_month';
    if (mediaUp24hArr.length >= limits.media_uploads_per_day) return 'rate_limit_media';
    return null;
  }

  // Select candidates
  const dedupeCutoff = new Date(Date.now() - cfg.dedupe_window_hours * 3600 * 1000).toISOString();
  const { data: existingRows } = await sb.from('x_deliveries').select('post_id').gte('created_at', dedupeCutoff);
  const existing = new Set((existingRows || []).map((r) => r.post_id as string));

  let candidatesQ = sb.from('posts')
    .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, delivery_decision, url, accounts!inner(handle)')
    .gte('created_at', dedupeCutoff)
    .not('text_translated', 'is', null);

  if (onlyTweetId) candidatesQ = candidatesQ.eq('tweet_id', onlyTweetId);
  else {
    candidatesQ = candidatesQ.gte('importance_score', cfg.min_score);
    if (cfg.post_only_decision_deliver) candidatesQ = candidatesQ.eq('delivery_decision', 'deliver');
    // NOTE: require_media is intentionally NOT applied as a DB filter.
    // We post all eligible items; media is attached only when present & valid.
    // The legacy `require_media` flag is kept in the type for back-compat but no longer gates posting.
    candidatesQ = candidatesQ.order('created_at', { ascending: false }).limit(5);
  }

  const { data: posts, error: postsErr } = await candidatesQ;
  if (postsErr) {
    return new Response(JSON.stringify({ error: postsErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const results: Array<Record<string, unknown>> = [];
  const candidates = (posts || []).filter((p) => onlyTweetId || !existing.has(p.tweet_id));

  for (const post of candidates) {
    const tweetId = post.tweet_id;
    const startedAt = Date.now();

    // Fetch media rows
    const { data: mediaRows } = await sb.from('media')
      .select('id, storage_path, downloaded_at, mime_type, file_size, kind')
      .eq('tweet_id', tweetId)
      .order('ordering', { ascending: true });

    // Quota check (per-iteration in case prior iterations posted)
    const blocked = quotaBlock();
    if (blocked) {
      if (!dryRun) await sb.from('x_deliveries').insert({ post_id: tweetId, status: 'skipped', skip_reason: blocked });
      results.push({ tweet_id: tweetId, status: 'skipped', reason: blocked });
      continue;
    }

    // Media handling: attach images if present & valid; otherwise post text-only.
    // We never SKIP a post for missing/invalid media — we just omit the media upload.
    let mediaIds: string[] = [];
    let mediaCount = 0;
    let mediaBytes = 0;
    let mediaKind: string | null = null;

    if (mediaRows && mediaRows.length > 0) {
      const sel = selectUploadable(mediaRows as MediaRow[]);
      if (sel.ok.length > 0 && !dryRun) {
        try {
          for (const m of sel.ok) {
            const { data: blob, error: dlErr } = await sb.storage.from('temp-media').download(m.storage_path!);
            if (dlErr || !blob) throw new Error(`download ${m.storage_path}: ${dlErr?.message || 'no blob'}`);
            const buf = new Uint8Array(await blob.arrayBuffer());
            const id = await uploadImage(buf, m.mime_type || 'image/jpeg', ck, cs, at, ats);
            mediaIds.push(id);
            mediaBytes += buf.length;
            mediaCount += 1;
            mediaUp24hArr.push(new Date().toISOString());
          }
          mediaKind = 'image';
        } catch (e) {
          // Media upload failed — fall back to text-only rather than dropping the post.
          mediaIds = [];
          mediaCount = 0;
          mediaBytes = 0;
          mediaKind = null;
          console.warn(`[x-poster] media upload failed for ${tweetId}, posting text-only: ${(e as Error).message}`);
        }
      } else if (sel.ok.length > 0 && dryRun) {
        mediaCount = sel.ok.length;
        mediaKind = 'image';
      }
    }

    // Format text
    const accountHandle = (post.accounts as { handle?: string })?.handle || '';
    const text = formatTweet(cfg.post_template, {
      leading_emoji: cfg.leading_emoji,
      translated_text: post.text_translated || '',
      hashtags: cfg.hashtags,
      author_handle: post.author_handle || accountHandle,
    }, cfg.max_chars);

    if (dryRun) {
      results.push({ tweet_id: tweetId, status: 'dry_run', preview_text: text, media_count: mediaCount, media_kind: mediaKind });
      continue;
    }

    // Post tweet
    try {
      const { id: xId, raw } = await postTweet(text, mediaIds, ck, cs, at, ats);
      const latency = Date.now() - startedAt;
      posts24hArr.push(new Date().toISOString());
      await sb.from('x_deliveries').insert({
        post_id: tweetId, x_tweet_id: xId, status: 'posted',
        media_count: mediaCount, media_bytes: mediaBytes, media_kind: mediaKind,
        posted_at: new Date().toISOString(), latency_ms: latency, api_response: raw, attempts: 1,
      });
      results.push({ tweet_id: tweetId, status: 'posted', x_tweet_id: xId, latency_ms: latency });
    } catch (e) {
      const status = (e as { status?: number }).status || 0;
      const errMsg = (e as Error).message;
      const isRetriable = status === 429 || status >= 500;
      await sb.from('x_deliveries').insert({
        post_id: tweetId, status: isRetriable ? 'pending' : 'failed',
        last_error: errMsg, attempts: 1,
        api_response: (e as { raw?: unknown }).raw ?? null,
      });
      results.push({ tweet_id: tweetId, status: isRetriable ? 'pending' : 'failed', error: errMsg });
    }
  }

  // Persist usage
  if (!dryRun) {
    const nextUsage = {
      ...usage,
      posts_24h: posts24hArr,
      posts_total: ((usage.posts_total as number) ?? 0) + results.filter((r) => r.status === 'posted').length,
      media_uploads_24h: mediaUp24hArr,
      media_bytes_24h: ((usage.media_bytes_24h as number) ?? 0),
      last_post_error: results.find((r) => r.status === 'failed')?.error ?? null,
    };
    await sb.from('settings').upsert({ key: 'x_api_usage', value: nextUsage, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

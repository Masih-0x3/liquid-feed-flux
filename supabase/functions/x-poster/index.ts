// X Poster — score-gated posting pipeline.
// Cron-driven worker that posts qualifying posts to X via OAuth 1.0a v2 with
// optional media upload. All quotas/templates read from the `settings` table.
// Deployed with verify_jwt=false; auth handled in checkAuth().

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
  allow_video?: boolean;
  post_template: string;
  leading_emoji: string;
  hashtags: string;
  hashtag_pool?: string[];
  hashtags_per_post?: number;
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
  hashtags: '', hashtag_pool: [], hashtags_per_post: 1,
  max_chars: 280, dedupe_window_hours: 48, post_only_decision_deliver: true,
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

// ─── Media validation & tier selection ───────────────────────────────
// Cost-first policy:
//   - text only        → no media/upload calls at all
//   - has image(s)     → upload up to 4 images
//   - has video        → upload ONLY the video (ignore images), one media_id
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;        // 5MB per X spec
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;       // 50MB safety cap (X allows up to 512MB)
const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;      // 4MB chunks for APPEND
const VIDEO_PROCESS_TIMEOUT_MS = 55 * 1000;     // total polling budget

interface MediaRow {
  id: string;
  storage_path: string | null;
  downloaded_at: string | null;
  mime_type: string | null;
  file_size: number | null;
  kind: string | null;
}

type Tier = 'text' | 'image' | 'video';
interface TierSelection { tier: Tier; items: MediaRow[]; reason?: string }

function selectMediaTier(rows: MediaRow[]): TierSelection {
  const downloaded = rows.filter((r) => r.downloaded_at && r.storage_path);
  if (downloaded.length === 0) return { tier: 'text', items: [], reason: 'no_downloaded_media' };

  const video = downloaded.find((r) =>
    (r.kind === 'video' || (r.mime_type || '').startsWith('video/'))
    && (r.mime_type || '').startsWith('video/')
    && (r.file_size ?? 0) > 0
    && (r.file_size ?? 0) <= MAX_VIDEO_BYTES,
  );
  if (video) return { tier: 'video', items: [video] };

  const images = downloaded.filter(
    (r) => ALLOWED_IMAGE.includes(r.mime_type || '') && (r.file_size ?? 0) <= MAX_IMAGE_BYTES,
  );
  if (images.length > 0) return { tier: 'image', items: images.slice(0, 4) };

  return { tier: 'text', items: [], reason: 'no_supported_media' };
}

// ─── X media upload (image, simple base64) ───────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

async function uploadImage(
  bytes: Uint8Array, mime: string, ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  const b64 = bytesToBase64(bytes);
  const params: Record<string, string> = { media_data: b64 };
  const auth = await oauthHeader('POST', UPLOAD_URL, params, ck, cs, at, ats);
  const resp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`media upload ${resp.status}: ${text.slice(0, 300)} (mime=${mime})`);
  const json = JSON.parse(text);
  return String(json.media_id_string || json.media_id);
}

// ─── X media upload (video, chunked INIT/APPEND/FINALIZE/STATUS) ─────
async function uploadVideoChunked(
  bytes: Uint8Array, mime: string, ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  // INIT
  const initParams: Record<string, string> = {
    command: 'INIT',
    media_type: mime,
    total_bytes: String(bytes.length),
    media_category: 'tweet_video',
  };
  const initAuth = await oauthHeader('POST', UPLOAD_URL, initParams, ck, cs, at, ats);
  const initResp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: initAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(initParams),
  });
  const initText = await initResp.text();
  if (!initResp.ok) throw new Error(`video INIT ${initResp.status}: ${initText.slice(0, 300)}`);
  const initJson = JSON.parse(initText);
  const mediaId = String(initJson.media_id_string || initJson.media_id);

  // APPEND — multipart/form-data; OAuth signs URL + query params (body excluded).
  let segment = 0;
  for (let offset = 0; offset < bytes.length; offset += VIDEO_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + VIDEO_CHUNK_BYTES, bytes.length));
    const appendAuth = await oauthHeader('POST', UPLOAD_URL, {}, ck, cs, at, ats);
    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', mediaId);
    form.append('segment_index', String(segment));
    form.append('media', new Blob([chunk], { type: 'application/octet-stream' }));
    const appendResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: appendAuth },
      body: form,
    });
    const appendText = await appendResp.text();
    if (!appendResp.ok) throw new Error(`video APPEND seg=${segment} ${appendResp.status}: ${appendText.slice(0, 300)}`);
    segment += 1;
  }

  // FINALIZE
  const finParams: Record<string, string> = { command: 'FINALIZE', media_id: mediaId };
  const finAuth = await oauthHeader('POST', UPLOAD_URL, finParams, ck, cs, at, ats);
  const finResp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: finAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(finParams),
  });
  const finText = await finResp.text();
  if (!finResp.ok) throw new Error(`video FINALIZE ${finResp.status}: ${finText.slice(0, 300)}`);
  const finJson = JSON.parse(finText);

  // STATUS poll if async processing
  let processing = finJson.processing_info as { state?: string; check_after_secs?: number; error?: { message?: string } } | undefined;
  const deadline = Date.now() + VIDEO_PROCESS_TIMEOUT_MS;
  while (processing && processing.state && processing.state !== 'succeeded') {
    if (processing.state === 'failed') {
      throw new Error(`video processing failed: ${processing.error?.message || 'unknown'}`);
    }
    if (Date.now() > deadline) throw new Error('video processing timeout');
    const wait = Math.max(1, processing.check_after_secs ?? 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    const statusParams: Record<string, string> = { command: 'STATUS', media_id: mediaId };
    const qs = new URLSearchParams(statusParams).toString();
    const statusAuth = await oauthHeader('GET', UPLOAD_URL, statusParams, ck, cs, at, ats);
    const statusResp = await fetch(`${UPLOAD_URL}?${qs}`, {
      method: 'GET',
      headers: { Authorization: statusAuth },
    });
    const statusText = await statusResp.text();
    if (!statusResp.ok) throw new Error(`video STATUS ${statusResp.status}: ${statusText.slice(0, 300)}`);
    const statusJson = JSON.parse(statusText);
    processing = statusJson.processing_info;
  }

  return mediaId;
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
  const sb = createClient<any, any>(supabaseUrl, svcKey);

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
  // Hard floor: never look at posts created before X posting was enabled.
  const startFrom = cfg.start_posting_from || null;
  const effectiveCutoff = startFrom && startFrom > dedupeCutoff ? startFrom : dedupeCutoff;

  const { data: existingRows } = await sb.from('x_deliveries').select('post_id').eq('status', 'posted').gte('created_at', dedupeCutoff);
  const existing = new Set((existingRows || []).map((r) => r.post_id as string));

  let candidatesQ = sb.from('posts')
    .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, delivery_decision, url, is_truncated, hydrated_at, created_at, accounts!inner(handle)')
    .gte('created_at', effectiveCutoff)
    .not('text_translated', 'is', null);

  if (onlyTweetId) candidatesQ = candidatesQ.eq('tweet_id', onlyTweetId);
  else {
    candidatesQ = candidatesQ.gte('importance_score', cfg.min_score);
    if (cfg.post_only_decision_deliver) candidatesQ = candidatesQ.eq('delivery_decision', 'deliver');
    // Hydration gate: skip posts that are still truncated and awaiting hydration.
    // Without this, x-poster can publish the truncated first translation before
    // the hydrate_tweet job completes (~1-2 min later).
    candidatesQ = candidatesQ.or('is_truncated.eq.false,hydrated_at.not.is.null');
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

    // Media-required gate: if a post is known to have media, X must not post
    // text-only. Telegram can fetch remote media URLs directly, but X requires
    // uploaded bytes, so missing/invalid media must defer or fail instead of
    // silently burning the post as text.
    const postAgeMs = Date.now() - new Date((post as { created_at: string }).created_at).getTime();
    const hasMediaFlag = (post as { has_media?: boolean }).has_media === true;
    const anyDownloaded = (mediaRows || []).some((m) => (m as MediaRow).downloaded_at);
    if (hasMediaFlag && !anyDownloaded) {
      const { data: pendingJobs } = await sb.from('jobs')
        .select('id').in('type', ['resolve_media', 'download_media'])
        .in('status', ['pending', 'running'])
        .filter('payload->>tweet_id', 'eq', tweetId).limit(1);
      if (pendingJobs && pendingJobs.length > 0) {
        results.push({ tweet_id: tweetId, status: 'deferred', reason: 'media_pending', age_ms: postAgeMs });
        console.log(`[x-poster] deferring ${tweetId}: media still resolving (age=${Math.round(postAgeMs/1000)}s)`);
        continue;
      }
      // No pending job but media is missing — likely a dropped/collided
      // download_media job. Self-heal: enqueue a unique-keyed download and
      // defer this iteration so we never post text-only when media exists.
      const hasMediaRowWithSrc = (mediaRows || []).some((m) => (m as MediaRow & { id: string }).id);
      if (hasMediaRowWithSrc) {
        await sb.from('jobs').insert({
          type: 'download_media',
          payload: { tweet_id: tweetId },
          status: 'pending',
          idempotency_key: `download_media:xposter_heal:${tweetId}:${Date.now()}`,
          next_run_at: new Date().toISOString(),
          priority: 12,
        });
        results.push({ tweet_id: tweetId, status: 'deferred', reason: 'media_pending_self_healed', age_ms: postAgeMs });
        console.log(`[x-poster] self-healed missing download for ${tweetId}, deferring`);
        continue;
      }

      await sb.from('jobs').insert({
        type: 'resolve_media',
        payload: { tweet_id: tweetId },
        status: 'pending',
        idempotency_key: `resolve_media:xposter_heal:${tweetId}:${Date.now()}`,
        next_run_at: new Date().toISOString(),
        priority: 12,
      });
      results.push({ tweet_id: tweetId, status: 'deferred', reason: 'media_missing_self_healed', age_ms: postAgeMs });
      console.log(`[x-poster] self-healed missing media rows for ${tweetId}, deferring`);
      continue;
    }

    // Quota check (per-iteration in case prior iterations posted)
    const blocked = quotaBlock();
    if (blocked) {
      if (!dryRun) await sb.from('x_deliveries').insert({ post_id: tweetId, status: 'skipped', skip_reason: blocked });
      results.push({ tweet_id: tweetId, status: 'skipped', reason: blocked });
      continue;
    }

    // Media tier handling — safety-first:
    //   text  → only allowed when the source post does not claim media
    //   image → upload up to 4 images
    //   video → upload only the video (one media_id), ignore any images
    // For has_media posts, media upload is mandatory; never fall back to text-only.
    let mediaIds: string[] = [];
    let mediaCount = 0;
    let mediaBytes = 0;
    let mediaKind: string | null = null;
    let mediaWarning: string | null = null;

    const sel = selectMediaTier((mediaRows as MediaRow[]) || []);

    if (hasMediaFlag && sel.tier === 'text') {
      const reason = sel.reason || 'no_supported_media';
      await sb.from('x_deliveries').insert({
        post_id: tweetId,
        status: 'pending',
        skip_reason: reason,
        last_error: `media_required:${reason}`,
        attempts: 1,
      });
      results.push({ tweet_id: tweetId, status: 'deferred', reason: `media_required:${reason}` });
      console.warn(`[x-poster] refusing text-only post for ${tweetId}: ${reason}`);
      continue;
    }

    if (sel.tier !== 'text' && !dryRun) {
      try {
        if (sel.tier === 'video') {
          const m = sel.items[0];
          const { data: blob, error: dlErr } = await sb.storage.from('temp-media').download(m.storage_path!);
          if (dlErr || !blob) throw new Error(`download ${m.storage_path}: ${dlErr?.message || 'no blob'}`);
          const buf = new Uint8Array(await blob.arrayBuffer());
          const id = await uploadVideoChunked(buf, m.mime_type || 'video/mp4', ck, cs, at, ats);
          mediaIds.push(id);
          mediaBytes += buf.length;
          mediaCount = 1;
          mediaKind = 'video';
          mediaUp24hArr.push(new Date().toISOString());
        } else {
          for (const m of sel.items) {
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
        }
      } catch (e) {
        const errMsg = `media_upload_failed(${sel.tier}): ${(e as Error).message}`.slice(0, 500);
        await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'failed',
          media_count: 0,
          media_bytes: 0,
          media_kind: sel.tier,
          last_error: errMsg,
          attempts: 1,
        });
        results.push({ tweet_id: tweetId, status: 'failed', error: errMsg });
        console.warn(`[x-poster] ${sel.tier} upload failed for ${tweetId}; not posting text-only: ${(e as Error).message}`);
        continue;
      }
    } else if (sel.tier !== 'text' && dryRun) {
      mediaCount = sel.items.length;
      mediaKind = sel.tier;
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
        last_error: mediaWarning,
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

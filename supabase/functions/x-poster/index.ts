// X Poster — score-gated posting pipeline.
// Cron-driven worker that posts qualifying posts to X via OAuth 1.0a v2 with
// optional media upload. All quotas/templates read from the `settings` table.
// Deployed with verify_jwt=false; auth handled in requireInternalAuth().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireInternalAuth } from '../_shared/internalAuth.ts';
import { recordXApiEvent } from '../_shared/xApiLedger.ts';
import { buildXPostText, isEnrichmentBlockingXPost, pickHashtags } from '../_shared/xPostText.ts';
import { allowCompletedEnrichmentForPosting, doesEnrichmentBlockX, normalizeEnrichmentConfig } from '../_shared/enrich.ts';
import { duplicateXSkipReason } from '../_shared/duplicateGuard.ts';
import { assertFinalDuplicateState, normalizeDuplicateGateConfig, type FinalDuplicateAssertionResult } from '../_shared/dedupe.ts';
import {
  MAX_ATTEMPTED_VIDEO_DURATION_MS,
  isOverAttemptedVideoDuration,
  selectMediaTier,
  type XMediaRow,
} from '../_shared/mediaSelection.ts';
import {
  applyRenderedVideoPreference,
  decideVideoRenderGate,
  type VideoRenderRow,
} from '../_shared/videoRenderGate.ts';
import {
  normalizeVideoRenderConfigValue,
  type VideoRenderConfig,
} from '../_shared/videoRenderConfig.ts';
import {
  captureEdgeException,
  captureEdgeExceptionBackground,
  initSentryEdge,
} from '../_shared/sentry.ts';
import {
  claimXPostDelivery,
  completeXPostDelivery,
  failXPostDelivery,
  xPostClaimRejection,
  type XPostDeliveryClaim,
} from '../_shared/xPostDeliveryClaim.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};
initSentryEdge();

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
  /** Max posts per day (0 = unlimited). Reduces aggregator signals. */
  daily_budget?: number;
  /** Minimum minutes between posts (0 = no spacing). Reduces burst patterns. */
  min_spacing_minutes?: number;
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
const VIDEO_RENDER_VERSION = 'persian-subtitles-masihh-v1';

// ─── Helpers ─────────────────────────────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

// deno-lint-ignore no-explicit-any
async function loadVideoRenderConfig(sb: any): Promise<VideoRenderConfig> {
  try {
    const { data } = await sb.from('settings').select('value').eq('key', 'video_render_config').maybeSingle();
    return normalizeVideoRenderConfigValue(data?.value);
  } catch (_e) {
    return normalizeVideoRenderConfigValue({ render_version: VIDEO_RENDER_VERSION });
  }
}

// deno-lint-ignore no-explicit-any
async function insertVideoRenderPipelineEvent(
  sb: any,
  tweetId: string,
  status: string,
  error: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'video_render',
      status,
      error,
      meta,
    });
  } catch (_e) { /* best-effort */ }
}

// deno-lint-ignore no-explicit-any
async function dispatchVideoRendererForTarget(sb: any, renderId: string, tweetId: string, source: string): Promise<void> {
  const rendererUrl = (Deno.env.get('VIDEO_RENDERER_URL') ?? '').replace(/\/+$/, '');
  const rendererToken = (Deno.env.get('VIDEO_RENDERER_TOKEN') ?? '').trim();
  const meta = { render_id: renderId, dispatch_source: source };
  if (!rendererUrl || !rendererToken) {
    await insertVideoRenderPipelineEvent(sb, tweetId, 'queued', null, {
      ...meta,
      mode: 'poller_only',
      reason: !rendererUrl ? 'renderer_url_missing' : 'renderer_token_missing',
    });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetch(`${rendererUrl}/v1/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(rendererToken ? { Authorization: `Bearer ${rendererToken}` } : {}),
      },
      body: JSON.stringify({ render_id: renderId, tweet_id: tweetId, source }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      await insertVideoRenderPipelineEvent(sb, tweetId, 'failed', `renderer ${resp.status}: ${text.slice(0, 300)}`, meta);
    }
  } catch (error) {
    await insertVideoRenderPipelineEvent(sb, tweetId, 'failed', error instanceof Error ? error.message : String(error), meta);
  } finally {
    clearTimeout(timeout);
  }
}

// deno-lint-ignore no-explicit-any
async function gateXVideoRender(
  sb: any,
  tweetId: string,
  mediaRows: XMediaRow[],
  dispatchSource: string,
  dryRun: boolean,
): Promise<{ ready: boolean; blocked: boolean; reason?: string; mediaRows: XMediaRow[] }> {
  const cfg = await loadVideoRenderConfig(sb);
  const { data: renderRows, error } = await sb
    .from('video_renders')
    .select('id, tweet_id, source_media_id, status, failure_policy, output_storage_path, output_mime_type, output_file_size, duration_ms, width, height, render_version, error, block_reason, source_language, target_language, preflight, created_at, updated_at')
    .eq('tweet_id', tweetId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const decision = decideVideoRenderGate({
    tweetId,
    mediaRows,
    renderRows: (renderRows ?? []) as VideoRenderRow[],
    renderingEnabled: cfg.mode !== 'disabled',
  });

  if (cfg.mode === 'disabled') {
    return { ready: true, blocked: false, mediaRows };
  }

  if (cfg.mode === 'shadow') {
    if (decision.action === 'enqueue_render' && decision.media.id && !dryRun) {
      const { data: renderId, error: enqueueError } = await sb.rpc('enqueue_video_render', {
        p_tweet_id: tweetId,
        p_source_media_id: decision.media.id,
        p_render_version: cfg.renderVersion,
        p_failure_policy: cfg.failurePolicy,
      });
      if (enqueueError) throw enqueueError;
      if (renderId) await dispatchVideoRendererForTarget(sb, String(renderId), tweetId, dispatchSource);
    }
    await insertVideoRenderPipelineEvent(sb, tweetId, 'queued', null, {
      shadow: true,
      gate_action: decision.action,
      dispatch_source: dispatchSource,
    });
    return { ready: true, blocked: false, mediaRows };
  }

  if (decision.action === 'none' || decision.action === 'use_original') {
    return { ready: true, blocked: false, mediaRows };
  }
  if (decision.action === 'use_render') {
    return { ready: true, blocked: false, mediaRows: applyRenderedVideoPreference(mediaRows, decision) };
  }
  if (decision.action === 'block') {
    return { ready: false, blocked: true, reason: decision.reason || 'video_render_blocked' , mediaRows };
  }
  if (decision.action === 'enqueue_render') {
    if (!decision.media.id) return { ready: false, blocked: true, reason: 'video_render_source_missing_id', mediaRows };
    if (!dryRun) {
      const { data: renderId, error: enqueueError } = await sb.rpc('enqueue_video_render', {
        p_tweet_id: tweetId,
        p_source_media_id: decision.media.id,
        p_render_version: cfg.renderVersion,
        p_failure_policy: cfg.failurePolicy,
      });
      if (enqueueError) throw enqueueError;
      if (renderId) await dispatchVideoRendererForTarget(sb, String(renderId), tweetId, dispatchSource);
    }
    return { ready: false, blocked: false, reason: dryRun ? 'video_render_required' : 'video_render_queued', mediaRows };
  }
  if (decision.action === 'wait_media') {
    return { ready: false, blocked: false, reason: 'source_video_pending', mediaRows };
  }
  return { ready: false, blocked: false, reason: 'video_render_pending', mediaRows };
}

/** Persian (Jalali) date string like "۱۴ اردیبهشت ۱۴۰۵" using fa-IR Intl. */
function persianDateNow(): string {
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function trimRollingWindow(arr: string[], windowMs: number): Promise<string[]> {
  const cutoff = Date.now() - windowMs;
  return (arr || []).filter((ts) => { try { return new Date(ts).getTime() > cutoff; } catch { return false; } });
}

// ─── Media upload limits ─────────────────────────────────────────────
const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;      // 4MB chunks for APPEND
const VIDEO_PROCESS_TIMEOUT_MS = 55 * 1000;     // total polling budget

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
  // deno-lint-ignore no-explicit-any
  sb: any, tweetId: string,
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
  await recordXApiEvent(sb, {
    source: 'x-poster',
    sourceAction: 'media_upload_image',
    endpoint: UPLOAD_URL,
    method: 'POST',
    tweetId,
    error: resp.ok ? null : `media upload ${resp.status}`,
    estimatedBillableUnit: 'media_upload',
  }, resp);
  if (!resp.ok) throw new Error(`media upload ${resp.status}: ${text.slice(0, 300)} (mime=${mime})`);
  const json = JSON.parse(text);
  return String(json.media_id_string || json.media_id);
}

// ─── X media upload (video, chunked INIT/APPEND/FINALIZE/STATUS) ─────
async function uploadVideoChunked(
  bytes: Uint8Array, mime: string, ck: string, cs: string, at: string, ats: string,
  // deno-lint-ignore no-explicit-any
  sb: any, tweetId: string,
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
  await recordXApiEvent(sb, {
    source: 'x-poster',
    sourceAction: 'media_upload_video_init',
    endpoint: UPLOAD_URL,
    method: 'POST',
    tweetId,
    error: initResp.ok ? null : `video INIT ${initResp.status}`,
    estimatedBillableUnit: 'media_upload',
  }, initResp);
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
    const chunkBuffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(chunkBuffer).set(chunk);
    form.append('media', new Blob([chunkBuffer], { type: 'application/octet-stream' }));
    const appendResp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: appendAuth },
      body: form,
    });
    const appendText = await appendResp.text();
    await recordXApiEvent(sb, {
      source: 'x-poster',
      sourceAction: 'media_upload_video_append',
      endpoint: UPLOAD_URL,
      method: 'POST',
      tweetId,
      error: appendResp.ok ? null : `video APPEND ${appendResp.status}`,
      estimatedBillableUnit: 'media_upload',
      metadata: { segment },
    }, appendResp);
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
  await recordXApiEvent(sb, {
    source: 'x-poster',
    sourceAction: 'media_upload_video_finalize',
    endpoint: UPLOAD_URL,
    method: 'POST',
    tweetId,
    error: finResp.ok ? null : `video FINALIZE ${finResp.status}`,
    estimatedBillableUnit: 'media_upload',
  }, finResp);
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
    await recordXApiEvent(sb, {
      source: 'x-poster',
      sourceAction: 'media_upload_video_status',
      endpoint: UPLOAD_URL,
      method: 'GET',
      tweetId,
      error: statusResp.ok ? null : `video STATUS ${statusResp.status}`,
      estimatedBillableUnit: 'media_upload',
    }, statusResp);
    if (!statusResp.ok) throw new Error(`video STATUS ${statusResp.status}: ${statusText.slice(0, 300)}`);
    const statusJson = JSON.parse(statusText);
    processing = statusJson.processing_info;
  }

  return mediaId;
}

// ─── Post tweet ──────────────────────────────────────────────────────
async function postTweet(
  text: string, mediaIds: string[], ck: string, cs: string, at: string, ats: string,
  // deno-lint-ignore no-explicit-any
  sb: any, tweetId: string,
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
  await recordXApiEvent(sb, {
    source: 'x-poster',
    sourceAction: 'post_tweet',
    endpoint: url,
    method: 'POST',
    tweetId,
    error: resp.ok ? null : `tweet ${resp.status}`,
    estimatedBillableUnit: 'post_write',
    metadata: { media_count: mediaIds.length },
  }, resp);
  if (!resp.ok) {
    const err = new Error(`tweet ${resp.status}: ${text2.slice(0, 400)}`);
    (err as { status?: number }).status = resp.status;
    (err as { raw?: unknown }).raw = json;
    throw err;
  }
  const d = (json as { data?: { id?: string } }).data;
  const id = typeof d?.id === 'string' && /^\d+$/.test(d.id) ? d.id : '';
  if (!id) {
    const err = new Error(`tweet 200 but missing data.id: ${text2.slice(0, 400)}`);
    (err as { status?: number }).status = 502;
    (err as { raw?: unknown }).raw = json;
    throw err;
  }
  return { id, raw: json };
}

// ─── Main ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient<any, any>(supabaseUrl, svcKey);

  const authErr = await requireInternalAuth(req, sb, corsHeaders);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const onlyTweetId = typeof body.tweet_id === 'string' ? body.tweet_id : null;
  const targetTweetId = typeof body.target_tweet_id === 'string' ? body.target_tweet_id : null;
  const requestSource = typeof body.dispatch_source === 'string' ? body.dispatch_source : null;
  const forceRetry = body.force_retry === true || (onlyTweetId !== null && !dryRun);
  const claimTtlSeconds = typeof body.claim_ttl_seconds === 'number' ? body.claim_ttl_seconds : 1800;

  // Load settings
  const { data: settingsRows } = await sb.from('settings').select('key, value')
    .in('key', ['x_posting_config', 'x_rate_limits', 'enrichment_config', 'story_memory']);
  const sm: Record<string, unknown> = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
  const cfg: PostingConfig = { ...DEFAULT_CFG, ...(isRecord(sm.x_posting_config) ? sm.x_posting_config : {}) } as PostingConfig;
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...(isRecord(sm.x_rate_limits) ? sm.x_rate_limits : {}) } as RateLimits;
  const enrichmentCfg = normalizeEnrichmentConfig(isRecord(sm.enrichment_config) ? sm.enrichment_config : { enabled: false });
  const duplicateGateCfg = normalizeDuplicateGateConfig(isRecord(sm.story_memory) ? sm.story_memory : { enabled: false });
  const allowCompletedEnrichment = allowCompletedEnrichmentForPosting(enrichmentCfg);
  const enrichmentRequiredForX = doesEnrichmentBlockX(enrichmentCfg);

  if (!cfg.enabled && !dryRun) {
    return new Response(JSON.stringify({ skipped: true, reason: 'x_posting_disabled' }), {
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

  // Quota check: derive posting/media windows from x_deliveries, not the legacy
  // settings.x_api_usage arrays, which can drift from actual posted rows.
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ count: monthlyPosts }, { count: posts24hDb }, { count: posts1hDb }, { count: mediaUp24hDb }, { data: lastPostRows }] = await Promise.all([
    sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since30d),
    sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since24h),
    sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since1h),
    sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gt('media_count', 0).gte('created_at', since24h),
    sb.from('x_deliveries').select('created_at, posted_at').eq('status', 'posted').order('created_at', { ascending: false }).limit(1),
  ]);
  let posts24hCount = posts24hDb ?? 0;
  let posts1hCount = posts1hDb ?? 0;
  let mediaUp24hCount = mediaUp24hDb ?? 0;
  const lastPostAt = lastPostRows?.[0]?.posted_at || lastPostRows?.[0]?.created_at || null;
  let lastPostTimeMs = lastPostAt ? new Date(lastPostAt as string).getTime() : 0;

  const quotaBlock = (): string | null => {
    if (posts1hCount >= limits.posts_per_hour) return 'rate_limit_hour';
    if (posts24hCount >= limits.posts_per_day) return 'rate_limit_day';
    if ((monthlyPosts ?? 0) >= limits.monthly_post_budget) return 'rate_limit_month';
    if (mediaUp24hCount >= limits.media_uploads_per_day) return 'rate_limit_media';
    // Daily budget cap (anti-aggregator)
    if (cfg.daily_budget && cfg.daily_budget > 0 && posts24hCount >= cfg.daily_budget) return 'daily_budget_reached';
    // Minimum spacing between posts
    if (cfg.min_spacing_minutes && cfg.min_spacing_minutes > 0 && lastPostTimeMs > 0) {
      const minGapMs = cfg.min_spacing_minutes * 60 * 1000;
      if (Date.now() - lastPostTimeMs < minGapMs) return 'min_spacing';
    }
    return null;
  };

  // Select candidates
  const dedupeCutoff = new Date(Date.now() - cfg.dedupe_window_hours * 3600 * 1000).toISOString();
  // Hard floor: never look at posts created before X posting was enabled.
  const startFrom = cfg.start_posting_from || null;
  const effectiveCutoff = startFrom && startFrom > dedupeCutoff ? startFrom : dedupeCutoff;

  const { data: existingRows } = await sb.from('x_deliveries').select('post_id').in('status', ['posting', 'posted', 'pending']).gte('created_at', dedupeCutoff);
  const existing = new Set((existingRows || []).map((r) => r.post_id as string));

  let posts: Array<Record<string, unknown>> = [];
  let postsErr: { message: string } | null = null;
  if (!onlyTweetId) {
    const rpcLimit = targetTweetId ? 1 : 20;
    const rpcRes = await sb.rpc('get_x_post_candidates', {
      candidate_limit: rpcLimit,
      target_tweet_id: targetTweetId,
    });
    if (!rpcRes.error) {
      posts = ((rpcRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        accounts: { handle: row.account_handle },
      }));
    } else {
      console.warn('[x-poster] get_x_post_candidates RPC unavailable, using fallback query', rpcRes.error.message);
      let candidatesQ = sb.from('posts')
        .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, final_score, base_score, learned_score, learned_delta, x_gate_score, learning_confidence, delivery_decision, decision_reason, url, is_truncated, hydrated_at, created_at, final_x_text, composed_post_text, post_format_hint, humanized_commentary, commentary_hook, commentary_question, narrative_callback, thread_continuation, enrich_status, dedupe_status, dup_of_tweet_id, dup_similarity, dedupe_reason, accounts!inner(handle)')
        .gte('created_at', effectiveCutoff)
        .not('text_translated', 'is', null)
        .or(`x_gate_score.gte.${cfg.min_score},and(x_gate_score.is.null,final_score.gte.${cfg.min_score}),and(x_gate_score.is.null,final_score.is.null,importance_score.gte.${cfg.min_score})`);
      if (targetTweetId) candidatesQ = candidatesQ.eq('tweet_id', targetTweetId);
      if (cfg.post_only_decision_deliver) candidatesQ = candidatesQ.eq('delivery_decision', 'deliver');
      candidatesQ = candidatesQ.or('is_truncated.eq.false,hydrated_at.not.is.null');
      if (enrichmentRequiredForX) {
        const allowedEnrichStatuses = allowCompletedEnrichment
          ? 'approved,enriched,completed,skipped'
          : 'approved,enriched,skipped';
        candidatesQ = candidatesQ.or(`enrich_status.is.null,enrich_status.in.(${allowedEnrichStatuses})`);
      }
      const fallbackRes = await candidatesQ.order('created_at', { ascending: false }).limit(rpcLimit);
      posts = (fallbackRes.data ?? []) as Array<Record<string, unknown>>;
      postsErr = fallbackRes.error;
    }
  } else {
    const forceRes = await sb.from('posts')
      .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, final_score, delivery_decision, decision_reason, url, is_truncated, hydrated_at, created_at, final_x_text, composed_post_text, post_format_hint, humanized_commentary, commentary_hook, commentary_question, narrative_callback, thread_continuation, enrich_status, dedupe_status, dup_of_tweet_id, dup_similarity, dedupe_reason, accounts!inner(handle)')
      .eq('tweet_id', onlyTweetId)
      .limit(1);
    posts = (forceRes.data ?? []) as Array<Record<string, unknown>>;
    postsErr = forceRes.error;
  }

  if (postsErr) {
    return new Response(JSON.stringify({ error: postsErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const results: Array<Record<string, unknown>> = [];
  const candidates = (posts || []).filter((p) => {
    const id = String(p.tweet_id ?? '');
    if (!onlyTweetId && existing.has(id)) return false;
    return true;
  });

  for (const post of candidates) {
    const tweetId = String(post.tweet_id ?? '');
    if (!tweetId) continue;
    const startedAt = Date.now();
    const dispatchSource = String(post.dispatch_source ?? requestSource ?? (targetTweetId ? 'event' : onlyTweetId ? 'force' : 'cron'));
    const candidateReason = typeof post.candidate_reason === 'string' ? post.candidate_reason : null;
    const candidateAgeMs = typeof post.candidate_age_ms === 'number' ? post.candidate_age_ms : null;
    const enrichStatus = (post as { enrich_status?: string | null }).enrich_status;

    if (!onlyTweetId && isEnrichmentBlockingXPost(enrichStatus, allowCompletedEnrichment, enrichmentRequiredForX)) {
      const reason = `enrichment_${enrichStatus ?? 'not_approved'}`;
      results.push({ tweet_id: tweetId, status: 'deferred', reason });
      console.log(`[x-poster] deferring ${tweetId}: ${reason}`);
      continue;
    }
    if (onlyTweetId && isEnrichmentBlockingXPost(enrichStatus, allowCompletedEnrichment, enrichmentRequiredForX)) {
      console.log(`[x-poster] force-post requested for ${tweetId}; bypassing enrichment status ${enrichStatus ?? 'none'} and using the plain X template`);
    }

    if ((post as { is_truncated?: boolean }).is_truncated === true && !(post as { hydrated_at?: string | null }).hydrated_at) {
      results.push({ tweet_id: tweetId, status: 'deferred', reason: 'waiting_hydration' });
      console.log(`[x-poster] deferring ${tweetId}: waiting_hydration`);
      continue;
    }

    const { data: latestX } = await sb
      .from('x_deliveries')
      .select('status, last_error, skip_reason, x_tweet_id, claim_expires_at')
      .eq('post_id', tweetId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestXRecord = latestX as { status?: string; x_tweet_id?: string | null; claim_expires_at?: string | null } | null;
    const latestStatus = latestXRecord?.status;

    if (latestStatus === 'posted') {
      results.push({
        tweet_id: tweetId,
        status: 'skipped',
        reason: 'already_posted',
        x_tweet_id: latestXRecord?.x_tweet_id ?? null,
      });
      console.log(`[x-poster] skipping ${tweetId}: already posted to X`);
      continue;
    }

    if (latestStatus === 'posting' || latestStatus === 'pending') {
      const stale = latestStatus === 'posting' && latestXRecord?.claim_expires_at &&
        new Date(latestXRecord.claim_expires_at).getTime() < Date.now();
      results.push({
        tweet_id: tweetId,
        status: 'deferred',
        reason: stale ? 'stale_posting' : `active_x_${latestStatus}`,
      });
      console.log(`[x-poster] deferring ${tweetId}: active X status is ${latestStatus}`);
      continue;
    }

    if (!forceRetry && (latestStatus === 'failed' || latestStatus === 'skipped')) {
      results.push({
        tweet_id: tweetId,
        status: 'deferred',
        reason: `previous_x_${latestStatus}`,
      });
      console.log(`[x-poster] deferring ${tweetId}: previous X status is ${latestStatus}`);
      continue;
    }

    let finalDuplicateAssertion: FinalDuplicateAssertionResult;
    try {
      finalDuplicateAssertion = await assertFinalDuplicateState(sb, tweetId, duplicateGateCfg, {
        dryRun,
        source: onlyTweetId ? 'x_force_final_assertion' : targetTweetId ? 'x_target_final_assertion' : 'x_final_assertion',
      });
    } catch (e) {
      const error = (e as Error).message;
      if (!dryRun && latestStatus !== 'failed') {
        const { error: failErr } = await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'failed',
          skip_reason: 'dedupe_assertion_failed',
          last_error: `dedupe_assertion_failed:${error}`.slice(0, 1000),
          attempts: 0,
        });
        if (failErr) console.error('[x-poster] x_deliveries insert failed (dedupe assertion)', { tweetId, err: failErr.message });
      }
      results.push({
        tweet_id: tweetId,
        status: dryRun ? 'dry_run_deferred' : 'failed',
        reason: 'dedupe_assertion_failed',
        error,
      });
      console.warn(`[x-poster] refusing ${onlyTweetId ? 'forced ' : ''}X post for ${tweetId}: dedupe_assertion_failed:${error}`);
      continue;
    }
    if (finalDuplicateAssertion.blocked) {
      if (!dryRun && latestStatus !== 'skipped') {
        const { error: skipErr } = await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'skipped',
          skip_reason: 'duplicate_gate',
          last_error: finalDuplicateAssertion.reason ?? 'duplicate_gate',
          attempts: 0,
        });
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (final duplicate assertion)', { tweetId, err: skipErr.message });
      }
      results.push({
        tweet_id: tweetId,
        status: dryRun ? 'dry_run_skipped' : 'skipped',
        reason: 'duplicate_gate',
        dup_of_tweet_id: finalDuplicateAssertion.result?.dup_of_tweet_id ?? (post as { dup_of_tweet_id?: string | null }).dup_of_tweet_id ?? null,
        final_assertion: finalDuplicateAssertion.reason,
      });
      console.warn(`[x-poster] refusing ${onlyTweetId ? 'forced ' : ''}X post for ${tweetId}: ${finalDuplicateAssertion.reason ?? 'duplicate_gate'}`);
      continue;
    }

    const duplicateSkipReason = duplicateXSkipReason(post as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null });
    if (duplicateSkipReason) {
      if (!dryRun && latestStatus !== 'skipped') {
        const { error: skipErr } = await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'skipped',
          skip_reason: 'duplicate_gate',
          last_error: duplicateSkipReason,
          attempts: 0,
        });
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (duplicate gate)', { tweetId, err: skipErr.message });
      }
      results.push({
        tweet_id: tweetId,
        status: dryRun ? 'dry_run_skipped' : 'skipped',
        reason: 'duplicate_gate',
        dup_of_tweet_id: (post as { dup_of_tweet_id?: string | null }).dup_of_tweet_id ?? null,
      });
      console.warn(`[x-poster] refusing ${onlyTweetId ? 'forced ' : ''}X post for ${tweetId}: ${duplicateSkipReason}`);
      continue;
    }

    // Fetch media rows
    const { data: mediaRows } = await sb.from('media')
      .select('id, storage_path, downloaded_at, mime_type, file_size, kind, duration_ms, src_url')
      .eq('tweet_id', tweetId)
      .order('ordering', { ascending: true });

    // Media-required gate: if a post is known to have media, X must not post
    // text-only. Telegram can fetch remote media URLs directly, but X requires
    // uploaded bytes, so missing/invalid media must defer or fail instead of
    // silently burning the post as text.
    const postAgeMs = Date.now() - new Date((post as { created_at: string }).created_at).getTime();
    const hasMediaFlag = (post as { has_media?: boolean }).has_media === true;
    let mediaRowsForSelection = ((mediaRows as XMediaRow[] | null) ?? []);
    const anyDownloaded = mediaRowsForSelection.some((m) => m.downloaded_at);
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
      const hasMediaRowWithSrc = mediaRowsForSelection.some((m) => m.id);
      if (hasMediaRowWithSrc) {
        if (dryRun) {
          results.push({ tweet_id: tweetId, status: 'dry_run_deferred', reason: 'media_pending_self_heal_needed', age_ms: postAgeMs });
          continue;
        }
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

      if (dryRun) {
        results.push({ tweet_id: tweetId, status: 'dry_run_deferred', reason: 'media_missing_self_heal_needed', age_ms: postAgeMs });
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

    const renderGate = await gateXVideoRender(sb, tweetId, mediaRowsForSelection, dispatchSource, dryRun);
    if (!renderGate.ready) {
      const reason = renderGate.reason ?? 'video_render_pending';
      if (renderGate.blocked) {
        if (!dryRun) {
          const { error: skipErr } = await sb.from('x_deliveries').insert({
            post_id: tweetId,
            status: 'skipped',
            media_count: 0,
            media_bytes: 0,
            media_kind: 'video',
            skip_reason: reason,
            last_error: reason,
            attempts: 0,
          });
          if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (video render)', { tweetId, err: skipErr.message });
        }
        results.push({ tweet_id: tweetId, status: dryRun ? 'dry_run_skipped' : 'skipped', reason });
      } else {
        results.push({ tweet_id: tweetId, status: dryRun ? 'dry_run_deferred' : 'deferred', reason });
        console.log(`[x-poster] deferring ${tweetId}: ${reason}`);
      }
      continue;
    }
    mediaRowsForSelection = renderGate.mediaRows;

    // Quota check (per-iteration in case prior iterations posted)
    const blocked = quotaBlock();
    if (blocked) {
      if (!dryRun) {
        const { error: skipErr } = await sb.from('x_deliveries').insert({ post_id: tweetId, status: 'skipped', skip_reason: blocked });
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed', { tweetId, err: skipErr.message });
      }
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
    let deliveryClaim: XPostDeliveryClaim | null = null;

    const sel = selectMediaTier(mediaRowsForSelection, { allowVideo: cfg.allow_video === true });

    if (sel.tier === 'blocked') {
      const reason = sel.reason || 'media_blocked';
      if (dryRun) {
        results.push({ tweet_id: tweetId, status: 'dry_run_deferred', reason });
        continue;
      }

      if (reason === 'video_disabled_by_config') {
        const { error: skipErr } = await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'skipped',
          media_count: 0,
          media_bytes: 0,
          media_kind: 'video',
          skip_reason: reason,
          last_error: 'Video posting is disabled in x_posting_config.allow_video',
          attempts: 0,
        });
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (video disabled)', { tweetId, err: skipErr.message });
        results.push({ tweet_id: tweetId, status: 'skipped', reason });
        console.warn(`[x-poster] skipping ${tweetId}: ${reason}`);
        continue;
      }

      const { data: mediaJobs } = await sb.from('jobs')
        .select('id')
        .in('type', ['resolve_media', 'download_media'])
        .in('status', ['pending', 'running'])
        .filter('payload->>tweet_id', 'eq', tweetId)
        .limit(1);

      if (mediaJobs && mediaJobs.length > 0) {
        results.push({ tweet_id: tweetId, status: 'deferred', reason, age_ms: postAgeMs });
        console.log(`[x-poster] deferring ${tweetId}: ${reason}`);
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
      results.push({ tweet_id: tweetId, status: 'deferred', reason: `${reason}_self_healed`, age_ms: postAgeMs });
      console.warn(`[x-poster] refused invalid video media for ${tweetId}; queued resolve_media (${reason})`);
      continue;
    }

    if (hasMediaFlag && sel.tier === 'text') {
      const reason = sel.reason || 'no_supported_media';
      if (dryRun) {
        results.push({ tweet_id: tweetId, status: 'dry_run_deferred', reason: `media_required:${reason}` });
        continue;
      }
      const { error: skipErr } = await sb.from('x_deliveries').insert({
        post_id: tweetId,
        status: 'skipped',
        skip_reason: reason,
        last_error: `media_required:${reason}`,
        attempts: 1,
      });
      if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (media required)', { tweetId, err: skipErr.message });
      results.push({ tweet_id: tweetId, status: 'skipped', reason: `media_required:${reason}` });
      console.warn(`[x-poster] skipping text-only post for ${tweetId}: ${reason}`);
      continue;
    }

    if (!dryRun) {
      try {
        deliveryClaim = await claimXPostDelivery(sb, {
          postId: tweetId,
          source: dispatchSource,
          forceRetry,
          ttlSeconds: claimTtlSeconds,
        });
      } catch (e) {
        const errMsg = (e as Error).message;
        await insertXPipelineEvent(sb, tweetId, 'failed', new Date(startedAt).toISOString(), new Date().toISOString(), errMsg, {
          candidate_reason: candidateReason,
          candidate_age_ms: candidateAgeMs,
          dispatch_source: dispatchSource,
          claim_error: true,
        });
        results.push({ tweet_id: tweetId, status: 'failed', reason: 'claim_failed', error: errMsg, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource });
        console.error('[x-poster] claim_x_post_delivery failed', { tweetId, err: errMsg });
        continue;
      }
      if (!deliveryClaim.claimed || !deliveryClaim.deliveryId || !deliveryClaim.claimToken) {
        const rejection = xPostClaimRejection(deliveryClaim);
        await insertXPipelineEvent(sb, tweetId, rejection.status, new Date(startedAt).toISOString(), new Date().toISOString(), null, {
          candidate_reason: candidateReason,
          candidate_age_ms: candidateAgeMs,
          dispatch_source: dispatchSource,
          reason: rejection.reason,
          existing_status: deliveryClaim.existingStatus,
          existing_x_tweet_id: deliveryClaim.existingXTweetId,
          claim_expires_at: deliveryClaim.claimExpiresAt,
        });
        results.push({ tweet_id: tweetId, ...rejection, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource });
        console.log(`[x-poster] deferring ${tweetId}: X claim not acquired (${rejection.reason})`);
        continue;
      }
    }

    if (sel.tier !== 'text' && !dryRun) {
      if (sel.tier === 'video') {
        const durationMs = sel.items[0]?.duration_ms ?? null;
        if (isOverAttemptedVideoDuration(durationMs)) {
          const seconds = Math.round(durationMs / 1000);
          const reason = `video_too_long_for_config:${seconds}s`;
          const skipOk = deliveryClaim
            ? await failXPostDelivery(sb, {
              deliveryId: deliveryClaim.deliveryId!,
              claimToken: deliveryClaim.claimToken!,
              status: 'skipped',
              error: `configured video duration cap is ${MAX_ATTEMPTED_VIDEO_DURATION_MS / 1000}s`,
              skipReason: reason,
              mediaKind: 'video',
            })
            : false;
          if (!skipOk) console.error('[x-poster] x_deliveries claim release skipped failed (video duration)', { tweetId });
          results.push({ tweet_id: tweetId, status: 'skipped', reason });
          console.warn(`[x-poster] skipping ${tweetId}: ${reason}`);
          continue;
        }
      }
      try {
        if (sel.tier === 'video') {
          const m = sel.items[0];
          const { data: blob, error: dlErr } = await sb.storage.from('temp-media').download(m.storage_path!);
          if (dlErr || !blob) throw new Error(`download ${m.storage_path}: ${dlErr?.message || 'no blob'}`);
          const buf = new Uint8Array(await blob.arrayBuffer());
          const id = await uploadVideoChunked(buf, m.mime_type || 'video/mp4', ck, cs, at, ats, sb, tweetId);
          mediaIds.push(id);
          mediaBytes += buf.length;
          mediaCount = 1;
          mediaKind = 'video';
          mediaUp24hCount += 1;
        } else {
          for (const m of sel.items) {
            const { data: blob, error: dlErr } = await sb.storage.from('temp-media').download(m.storage_path!);
            if (dlErr || !blob) throw new Error(`download ${m.storage_path}: ${dlErr?.message || 'no blob'}`);
            const buf = new Uint8Array(await blob.arrayBuffer());
            const id = await uploadImage(buf, m.mime_type || 'image/jpeg', ck, cs, at, ats, sb, tweetId);
            mediaIds.push(id);
            mediaBytes += buf.length;
            mediaCount += 1;
            mediaUp24hCount += 1;
          }
          mediaKind = 'image';
        }
      } catch (e) {
        const errMsg = `media_upload_failed(${sel.tier}): ${(e as Error).message}`.slice(0, 500);
        try {
          const failOk = deliveryClaim
            ? await failXPostDelivery(sb, {
              deliveryId: deliveryClaim.deliveryId!,
              claimToken: deliveryClaim.claimToken!,
              error: errMsg,
              mediaKind: sel.tier,
            })
            : false;
          if (!failOk) console.error('[x-poster] x_deliveries claim release failed (media)', { tweetId });
        } catch (failErr) {
          console.error('[x-poster] fail_x_post_delivery failed (media)', { tweetId, err: (failErr as Error).message });
        }
        results.push({ tweet_id: tweetId, status: 'failed', error: errMsg });
        console.warn(`[x-poster] ${sel.tier} upload failed for ${tweetId}; not posting text-only: ${(e as Error).message}`);
        continue;
      }
    } else if (sel.tier !== 'text' && dryRun) {
      mediaCount = sel.items.length;
      mediaKind = sel.tier;
    }

    // Format text: creator-analysis draft only when approved, or when the
    // enrichment config explicitly allows auto-completed drafts. Otherwise use
    // the plain translation template so review-pending drafts never leak to X.
    const pickedHashtags = pickHashtags(cfg.hashtag_pool, cfg.hashtags_per_post ?? 0);
    const hashtagsValue = pickedHashtags || cfg.hashtags || '';
    const text = buildXPostText({
      post: post as Parameters<typeof buildXPostText>[0]['post'],
      cfg,
      hashtagsValue,
      persianDate: persianDateNow(),
      allowCompletedEnrichment,
    });

    if (dryRun) {
      results.push({ tweet_id: tweetId, status: 'dry_run', preview_text: text, media_count: mediaCount, media_kind: mediaKind, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource });
      continue;
    }

    const xApiStartedAt = Date.now();
    let xId = '';
    let raw: unknown = null;
    try {
      const posted = await postTweet(text, mediaIds, ck, cs, at, ats, sb, tweetId);
      xId = posted.id;
      raw = posted.raw;
    } catch (e) {
      const xApiMs = Date.now() - xApiStartedAt;
      const status = (e as { status?: number }).status || 0;
      const errMsg = (e as Error).message;
      const isRetriable = status === 429 || status >= 500;
      captureEdgeExceptionBackground(e, {
        functionName: "x-poster",
        action: "post_error",
        tags: {
          status,
          retriable: isRetriable,
        },
        extra: {
          tweet_id: tweetId,
          candidate_reason: candidateReason,
          dispatch_source: dispatchSource,
          x_api_ms: xApiMs,
        },
      });
      try {
        const failOk = deliveryClaim
          ? await failXPostDelivery(sb, {
            deliveryId: deliveryClaim.deliveryId!,
            claimToken: deliveryClaim.claimToken!,
            error: errMsg,
            apiResponse: (e as { raw?: unknown }).raw ?? null,
            skipReason: isRetriable ? 'x_api_retriable' : null,
            nextRetryAt: isRetriable ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
            mediaCount,
            mediaBytes,
            mediaKind,
          })
          : false;
        if (!failOk) console.error('[x-poster] x_deliveries claim release failed (post)', { tweetId });
      } catch (failErr) {
        console.error('[x-poster] fail_x_post_delivery failed (post)', { tweetId, err: (failErr as Error).message });
      }
      await insertXPipelineEvent(sb, tweetId, 'failed', new Date(xApiStartedAt).toISOString(), new Date().toISOString(), errMsg, {
        x_api_ms: xApiMs,
        retriable: isRetriable,
        candidate_reason: candidateReason,
        candidate_age_ms: candidateAgeMs,
        dispatch_source: dispatchSource,
      });
      results.push({ tweet_id: tweetId, status: 'failed', error: errMsg, retriable: isRetriable, x_api_ms: xApiMs, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource });
      continue;
    }

    const xApiMs = Date.now() - xApiStartedAt;
    const latency = Date.now() - startedAt;
    posts24hCount += 1;
    posts1hCount += 1;
    lastPostTimeMs = Date.now();
    const postedAt = new Date().toISOString();
    let deliveryWriteConfirmed = false;
    let deliveryWriteError: string | null = null;
    try {
      deliveryWriteConfirmed = deliveryClaim
        ? await completeXPostDelivery(sb, {
          deliveryId: deliveryClaim.deliveryId!,
          claimToken: deliveryClaim.claimToken!,
          xTweetId: xId,
          mediaCount,
          mediaBytes,
          mediaKind,
          postedAt,
          latencyMs: latency,
          apiResponse: raw,
          lastError: mediaWarning,
        })
        : false;
      if (!deliveryWriteConfirmed) deliveryWriteError = 'claim_completion_rejected';
    } catch (e) {
      deliveryWriteError = (e as Error).message;
      captureEdgeExceptionBackground(e, {
        functionName: "x-poster",
        action: "claim_complete_error",
        extra: {
          tweet_id: tweetId,
          x_tweet_id: xId,
          dispatch_source: dispatchSource,
        },
      });
    }
    if (deliveryWriteError) {
      console.error('[x-poster] complete_x_post_delivery failed after X accepted post', { tweetId, xId, err: deliveryWriteError });
    }

    await insertXPipelineEvent(sb, tweetId, deliveryWriteConfirmed ? 'completed' : 'failed', new Date(xApiStartedAt).toISOString(), new Date().toISOString(), deliveryWriteError, {
      x_tweet_id: xId,
      x_api_ms: xApiMs,
      latency_ms: latency,
      media_count: mediaCount,
      media_kind: mediaKind,
      candidate_reason: candidateReason,
      candidate_age_ms: candidateAgeMs,
      dispatch_source: dispatchSource,
      delivery_write_confirmed: deliveryWriteConfirmed,
    });
    const renderCfg = await loadVideoRenderConfig(sb);
    try {
      await sb.rpc('mark_video_render_posted', {
        p_tweet_id: tweetId,
        p_retention_hours: renderCfg.retentionHours,
      });
    } catch (_e) { /* best-effort */ }
    results.push({ tweet_id: tweetId, status: 'posted', x_tweet_id: xId, latency_ms: latency, x_api_ms: xApiMs, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource, delivery_write_confirmed: deliveryWriteConfirmed });
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  } catch (error) {
    console.error('[x-poster] fatal', error instanceof Error ? error.message : String(error));
    await captureEdgeException(error, {
      functionName: "x-poster",
      action: "fatal",
      request: req,
    });
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function insertXPipelineEvent(
  // deno-lint-ignore no-explicit-any
  sb: any,
  tweetId: string,
  status: string,
  startedAt: string | null,
  endedAt: string | null,
  error: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'x_post',
      status,
      started_at: startedAt,
      ended_at: endedAt,
      error,
      meta,
    });
  } catch (_e) { /* best-effort */ }
}

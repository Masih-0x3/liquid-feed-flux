// X Poster — score-gated posting pipeline.
// Cron-driven worker that posts qualifying posts to X via OAuth 1.0a v2 with
// optional media upload. All quotas/templates read from the `settings` table.
// Deployed with verify_jwt=false; auth handled in requireInternalAuth().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireInternalAuth } from '../_shared/internalAuth.ts';
import {
  checkExternalPosting,
  requireExternalPosting,
  type ExternalPostingGuardOptions,
} from '../_shared/externalPostingGuard.ts';
import type { RuntimeControlsQueryClient } from '../_shared/runtimeControls.ts';
import { recordXApiEvent } from '../_shared/xApiLedger.ts';
import { buildXPostText, isEnrichmentBlockingXPost, pickHashtags } from '../_shared/xPostText.ts';
import { allowCompletedEnrichmentForPosting, doesEnrichmentBlockX, normalizeEnrichmentConfig } from '../_shared/enrich.ts';
import { duplicateXSkipReason } from '../_shared/duplicateGuard.ts';
import {
  assertFinalDuplicateState,
  fetchObservedStoryEmbedding,
  normalizeDuplicateGateConfig,
  observedDedupeOpenAI,
  type FinalDuplicateAssertionResult,
} from '../_shared/dedupe.ts';
import { finishWorkflowRun, startWorkflowRun } from '../_shared/observability.ts';
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
  markXPostDeliveryProviderStarted,
  xPostClaimRejection,
  type XPostDeliveryClaim,
} from '../_shared/xPostDeliveryClaim.ts';
import {
  isProcessedRenderStoragePath,
  repairStaleMediaObject,
  StaleMediaObjectError,
  staleMediaObjectErrorForDownload,
} from '../_shared/staleMediaRepair.ts';
import {
  getXQuotaBlockReason,
  X_POSTING_QUOTA_MAX,
  X_QUOTA_UNAVAILABLE,
} from '../_shared/xQuotaAdmission.ts';

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
  /** Automatic X posting never catches up posts older than this. Manual force still bypasses it. */
  max_candidate_age_minutes?: number;
  /** Hard cap for one automatic cron/event run so newly unblocked queues cannot drain in a burst. */
  max_posts_per_run?: number;
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
  max_candidate_age_minutes: 30, max_posts_per_run: 1,
};
const DEFAULT_LIMITS: RateLimits = {
  posts_per_hour: 20, posts_per_day: 100, monthly_post_budget: 2500, media_uploads_per_day: 200,
};
const VIDEO_RENDER_VERSION = 'persian-subtitles-masihh-v1';

/** Public provider seam. The guard is the last operation before network I/O. */
export async function guardedExternalProviderFetch(
  client: RuntimeControlsQueryClient,
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ExternalPostingGuardOptions = {},
): Promise<Response> {
  await requireExternalPosting(client, options);
  return fetch(input, init);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
function isPositiveSafeInteger(v: unknown): v is number {
  return isNonNegativeSafeInteger(v) && v > 0;
}
function isBoundedPositiveSafeInteger(v: unknown, max: number): v is number {
  return isPositiveSafeInteger(v) && v <= max;
}
function isOptionalNonNegativeSafeInteger(v: unknown): boolean {
  return v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
}

type PreparedMediaUpload = {
  bytes: Uint8Array;
  mimeType: string;
};

async function downloadMediaForUpload(
  sb: any,
  row: XMediaRow,
): Promise<PreparedMediaUpload> {
  const storagePath = row.storage_path;
  if (!storagePath) throw new Error('media_missing_storage_path');
  const { data: blob, error } = await sb.storage.from('temp-media').download(storagePath);
  if (error || !blob) {
    const staleError = staleMediaObjectErrorForDownload(storagePath, error, {
      id: row.id ?? null,
    });
    if (staleError) throw staleError;
    throw new Error('media_download_failed');
  }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: row.mime_type || (blob as Blob).type || 'application/octet-stream',
  };
}

async function repairOriginalStaleMediaForX(
  sb: any,
  tweetId: string,
  error: StaleMediaObjectError,
  source: string,
): Promise<boolean> {
  if (isProcessedRenderStoragePath(error.storagePath)) return false;
  try {
    await repairStaleMediaObject(sb, {
      tweetId,
      mediaId: error.mediaId,
      storagePath: error.storagePath,
      source,
    });
    return true;
  } catch (_repairError) {
    console.warn('[x-poster] stale media repair failed; preserving stable failure envelope', {
      tweet_id: tweetId,
      source,
      error: 'stale_media_repair_failed',
    });
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function loadVideoRenderConfig(sb: any): Promise<VideoRenderConfig> {
  const { data, error } = await sb.from('settings').select('value').eq('key', 'video_render_config').maybeSingle();
  if (error) {
    throw new Error('video_render_config_read_failed');
  }
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('video_render_config_invalid_response');
  }
  return normalizeVideoRenderConfigValue(data?.value);
}

// Retention cleanup runs after X has accepted the provider request. Its
// configuration read must never rewrite an already-ambiguous provider result
// into a second failure, so this helper is deliberately isolated from the
// pre-provider gate above.
// deno-lint-ignore no-explicit-any
async function loadVideoRenderRetentionHours(sb: any): Promise<number> {
  try {
    return (await loadVideoRenderConfig(sb)).retentionHours;
  } catch (_e) {
    return normalizeVideoRenderConfigValue({ render_version: VIDEO_RENDER_VERSION }).retentionHours;
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
    const { error: pipelineEventError } = await sb.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'video_render',
      status,
      error,
      meta,
    });
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: 'x-poster',
        action: 'video_pipeline_event_insert_failed',
        error: 'video_pipeline_event_insert_failed',
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: 'x-poster',
      action: 'video_pipeline_event_insert_failed',
      error: 'video_pipeline_event_insert_failed',
    }));
  }
}

// deno-lint-ignore no-explicit-any
async function markVideoRenderPostedBestEffort(
  sb: any,
  tweetId: string,
  retentionHours: number,
): Promise<void> {
  try {
    const { error: markPostedError } = await sb.rpc('mark_video_render_posted', {
      p_tweet_id: tweetId,
      p_retention_hours: retentionHours,
    });
    if (markPostedError) {
      console.warn(JSON.stringify({
        function: 'x-poster',
        action: 'video_render_posted_update_failed',
        error: 'video_render_posted_update_failed',
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: 'x-poster',
      action: 'video_render_posted_update_failed',
      error: 'video_render_posted_update_failed',
    }));
  }
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
      const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599
        ? resp.status
        : 0;
      await insertVideoRenderPipelineEvent(sb, tweetId, 'failed', `renderer_http_${status}`, meta);
    }
  } catch (error) {
    await insertVideoRenderPipelineEvent(sb, tweetId, 'failed', 'renderer_dispatch_failed', meta);
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
  if (!Array.isArray(renderRows)) throw new Error('x_poster_video_render_result_invalid');

  const decision = decideVideoRenderGate({
    tweetId,
    mediaRows,
    renderRows: renderRows as VideoRenderRow[],
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

function safeXProviderHttpError(operation: string, status: unknown): string {
  const safeOperation = /^[a-z][a-z0-9_]{1,40}$/.test(operation)
    ? operation
    : "request";
  const numericStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 0;
  return `x_provider_${safeOperation}_http_${numericStatus}`;
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
  // deno-lint-ignore no-explicit-any
  sb: any, tweetId: string,
): Promise<string> {
  const b64 = bytesToBase64(bytes);
  const params: Record<string, string> = { media_data: b64 };
  const auth = await oauthHeader('POST', UPLOAD_URL, params, ck, cs, at, ats);
  const resp = await guardedExternalProviderFetch(sb, UPLOAD_URL, {
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
  if (!resp.ok) throw new Error(safeXProviderHttpError('media_upload_image', resp.status));
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
  const initResp = await guardedExternalProviderFetch(sb, UPLOAD_URL, {
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
  if (!initResp.ok) throw new Error(safeXProviderHttpError('video_init', initResp.status));
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
    const appendResp = await guardedExternalProviderFetch(sb, UPLOAD_URL, {
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
    if (!appendResp.ok) throw new Error(safeXProviderHttpError('video_append', appendResp.status));
    segment += 1;
  }

  // FINALIZE
  const finParams: Record<string, string> = { command: 'FINALIZE', media_id: mediaId };
  const finAuth = await oauthHeader('POST', UPLOAD_URL, finParams, ck, cs, at, ats);
  const finResp = await guardedExternalProviderFetch(sb, UPLOAD_URL, {
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
  if (!finResp.ok) throw new Error(safeXProviderHttpError('video_finalize', finResp.status));
  const finJson = JSON.parse(finText);

  // STATUS poll if async processing
  let processing = finJson.processing_info as { state?: string; check_after_secs?: number; error?: { message?: string } } | undefined;
  const deadline = Date.now() + VIDEO_PROCESS_TIMEOUT_MS;
  while (processing && processing.state && processing.state !== 'succeeded') {
    if (processing.state === 'failed') {
      throw new Error('x_provider_video_processing_failed');
    }
    if (Date.now() > deadline) throw new Error('video processing timeout');
    const wait = Math.max(1, processing.check_after_secs ?? 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    const statusParams: Record<string, string> = { command: 'STATUS', media_id: mediaId };
    const qs = new URLSearchParams(statusParams).toString();
    const statusAuth = await oauthHeader('GET', UPLOAD_URL, statusParams, ck, cs, at, ats);
    const statusResp = await guardedExternalProviderFetch(sb, `${UPLOAD_URL}?${qs}`, {
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
    if (!statusResp.ok) throw new Error(safeXProviderHttpError('video_status', statusResp.status));
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
  const resp = await guardedExternalProviderFetch(sb, url, {
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
    const err = new Error(safeXProviderHttpError('post_tweet', resp.status));
    (err as { status?: number }).status = resp.status;
    throw err;
  }
  const d = (json as { data?: { id?: string } }).data;
  const id = typeof d?.id === 'string' && /^\d+$/.test(d.id) ? d.id : '';
  if (!id) {
    const err = new Error('x_provider_post_tweet_missing_id');
    (err as { status?: number }).status = 502;
    throw err;
  }
  return { id, raw: json };
}

function cleanString(value: unknown, maxLength = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeManualFailureCode(reason: unknown): string {
  const value = typeof reason === 'string' ? reason.trim() : '';
  const match = value.match(/^([a-z][a-z0-9_]{1,80})/);
  return match?.[1] ?? 'manual_failure';
}

function safeManualFailureMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const source = meta as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ['render_id', 'media_id', 'dup_of_tweet_id']) {
    const value = cleanString(source[key], 80);
    if (value) safe[key] = value;
  }
  if (source.duplicate_gate === true) safe.duplicate_gate = true;
  if (typeof source.x_api_ms === 'number' && Number.isFinite(source.x_api_ms)) {
    safe.x_api_ms = Math.max(0, Math.min(600_000, Math.floor(source.x_api_ms)));
  }
  return safe;
}

function safeXPosterErrorCode(error: unknown, fallback = 'x_poster_failed'): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
    ? error
    : '';
  const match = message.trim().match(/^([a-z][a-z0-9_]{1,96})/);
  return match?.[1] ?? fallback;
}

function xPosterJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function quotaUnavailableResponse(): Response {
  return xPosterJson({ ok: false, skipped: true, reason: X_QUOTA_UNAVAILABLE }, 503);
}

// deno-lint-ignore no-explicit-any
async function updateManualIntake(sb: any, intakeId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const { error: updateError } = await sb.from('manual_video_intakes').update({
      ...patch,
      updated_at: new Date().toISOString(),
    }).eq('id', intakeId);
    if (updateError) {
      throw new Error('manual_intake_persistence_failed');
    }
  } catch (e) {
    console.error('[x-poster] manual intake update failed', { intakeId, err: safeXPosterErrorCode(e, 'manual_intake_update_failed') });
    throw e;
  }
}

// deno-lint-ignore no-explicit-any
async function completeManualFailure(
  sb: any,
  input: {
    intakeId: string;
    tweetId: string;
    status: 'blocked' | 'failed' | 'ambiguous';
    reason: string;
    startedAt: number;
    meta?: Record<string, unknown>;
  },
): Promise<Response> {
  const reasonCode = safeManualFailureCode(input.reason);
  await updateManualIntake(sb, input.intakeId, {
    status: input.status,
    last_error: reasonCode,
  });
  await insertXPipelineEvent(
    sb,
    input.tweetId,
    input.status === 'blocked' ? 'skipped' : 'failed',
    new Date(input.startedAt).toISOString(),
    new Date().toISOString(),
    reasonCode,
    {
      dispatch_source: 'manual_video_intake',
      intake_id: input.intakeId,
      reason: reasonCode,
      ...safeManualFailureMeta(input.meta),
    },
  );
  return xPosterJson({
    ok: false,
    status: input.status,
    reason: reasonCode,
    tweet_id: input.tweetId,
    intake_id: input.intakeId,
  });
}

// deno-lint-ignore no-explicit-any
async function assertObservedFinalDuplicateState(params: {
  sb: any;
  tweetId: string;
  duplicateGateCfg: unknown;
  dryRun: boolean;
  source: string;
  sourceFunction: string;
  metadata?: Record<string, unknown>;
}): Promise<FinalDuplicateAssertionResult> {
  const workflowRunId = `x-poster-final-dedupe:${params.tweetId}:${crypto.randomUUID()}`;
  const workflowRunKey = `x-poster:dedupe-final:${workflowRunId}`;
  const metadata = {
    assertion_source: params.source,
    dry_run: params.dryRun,
    ...(params.metadata ?? {}),
  };

  await startWorkflowRun(params.sb, {
    runKey: workflowRunKey,
    workflowName: 'dedupe-pipeline',
    workflowRunId,
    status: 'running',
    source: 'x-poster',
    sourceFunction: params.sourceFunction,
    subjectType: 'post',
    subjectId: params.tweetId,
    tweetId: params.tweetId,
    metadata,
  });

  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
    const result = await assertFinalDuplicateState(params.sb, params.tweetId, params.duplicateGateCfg, {
      dryRun: params.dryRun,
      source: params.source,
      fetchEmbedding: (text) =>
        fetchObservedStoryEmbedding({
          supabase: params.sb,
          workflowRunKey,
          apiKey: openaiApiKey,
          text,
          metadata,
        }),
      callOpenAI: observedDedupeOpenAI(params.sb, workflowRunKey, metadata),
    });

    if (result.outcome === 'unknown') {
      throw new Error(`dedupe_assertion_unknown:${result.reason ?? 'unknown'}`);
    }

    await finishWorkflowRun(
      params.sb,
      workflowRunKey,
      result.checked ? 'completed' : 'skipped',
      {
        ...metadata,
        checked: result.checked,
        blocked: result.blocked,
        reason: result.reason,
        result_status: result.result?.status ?? null,
        result_method: result.result?.method ?? null,
      },
    );
    return result;
  } catch (error) {
    await finishWorkflowRun(params.sb, workflowRunKey, 'failed', metadata, error);
    throw error;
  }
}

// deno-lint-ignore no-explicit-any
async function handleManualVideoIntakePost(params: {
  sb: any;
  body: Record<string, unknown>;
  cfg: PostingConfig;
  duplicateGateCfg: unknown;
  claimTtlSeconds: number;
  quotaBlock: () => string | null;
  ck: string;
  cs: string;
  at: string;
  ats: string;
}): Promise<Response | null> {
  const manualIntakeId = cleanString(params.body.manual_intake_id, 80);
  if (!manualIntakeId) return null;

  const startedAt = Date.now();
  if (params.body.confirm_manual_post !== true) {
    return xPosterJson({ ok: false, error: 'confirm_manual_post is required' }, 400);
  }

  const { data: intake, error: intakeError } = await params.sb
    .from('manual_video_intakes')
    .select('id, tweet_id, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at')
    .eq('id', manualIntakeId)
    .maybeSingle();
  if (intakeError) {
    return xPosterJson({ ok: false, error: 'manual_intake_lookup_failed' }, 500);
  }
  if (!intake) {
    return xPosterJson({ ok: false, error: 'manual intake not found' }, 404);
  }

  const tweetId = String(intake.tweet_id ?? '');
  const requestedTweetId = cleanString(params.body.tweet_id, 80);
  if (!tweetId || (requestedTweetId && requestedTweetId !== tweetId)) {
    return xPosterJson({ ok: false, error: 'manual intake tweet mismatch' }, 400);
  }
  if (intake.status === 'canceled') {
    return xPosterJson({ ok: false, error: 'manual intake is canceled', intake_id: manualIntakeId }, 400);
  }
  if (typeof intake.posted_x_tweet_id === 'string' && intake.posted_x_tweet_id) {
    return xPosterJson({
      ok: true,
      status: 'skipped',
      reason: 'already_posted',
      tweet_id: tweetId,
      intake_id: manualIntakeId,
      x_tweet_id: intake.posted_x_tweet_id,
    });
  }

  const textOverride = cleanString(params.body.text_override, 1200);
  const caption = textOverride ||
    cleanString(intake.caption_edited, 1200) ||
    cleanString(intake.caption_draft, 1200);
  if (!caption) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: 'caption_required',
      startedAt,
    });
  }
  const maxChars = Number(params.cfg.max_chars || 280);
  if (caption.length > maxChars) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: `caption_too_long:${caption.length}/${maxChars}`,
      startedAt,
    });
  }

  const { data: latestX, error: latestXError } = await params.sb
    .from('x_deliveries')
    .select('status, x_tweet_id, posted_at, created_at')
    .eq('post_id', tweetId)
    .eq('status', 'posted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestXError) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'delivery_lookup_failed',
      startedAt,
    });
  }
  if (latestX?.status === 'posted' && latestX.x_tweet_id) {
    await updateManualIntake(params.sb, manualIntakeId, {
      status: 'posted',
      posted_x_tweet_id: latestX.x_tweet_id,
      posted_at: latestX.posted_at ?? latestX.created_at ?? new Date().toISOString(),
      blocks_auto_delivery: false,
    });
    return xPosterJson({
      ok: true,
      status: 'skipped',
      reason: 'already_posted',
      tweet_id: tweetId,
      intake_id: manualIntakeId,
      x_tweet_id: latestX.x_tweet_id,
    });
  }

  const selectedRenderId = cleanString(params.body.render_id, 80) ||
    cleanString(intake.selected_render_id, 80);
  if (!selectedRenderId) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: 'completed_render_required',
      startedAt,
    });
  }

  const { data: post, error: postError } = await params.sb
    .from('posts')
    .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, final_score, delivery_decision, decision_reason, url, is_truncated, hydrated_at, created_at, final_x_text, composed_post_text, post_format_hint, humanized_commentary, commentary_hook, commentary_question, narrative_callback, thread_continuation, enrich_status, dedupe_status, dup_of_tweet_id, dup_similarity, dedupe_reason')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (postError || !post) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'post_lookup_failed',
      startedAt,
    });
  }

  const duplicateOverride = intake.duplicate_override === true &&
    cleanString(intake.duplicate_override_reason, 500).length > 0;
  if (!duplicateOverride) {
    let finalDuplicateAssertion: FinalDuplicateAssertionResult;
    try {
      finalDuplicateAssertion = await assertObservedFinalDuplicateState({
        sb: params.sb,
        tweetId,
        duplicateGateCfg: params.duplicateGateCfg,
        dryRun: false,
        source: 'manual_video_intake_final_assertion',
        sourceFunction: 'handleManualVideoIntakePost',
        metadata: {
          intake_id: manualIntakeId,
        },
      });
    } catch (e) {
      return completeManualFailure(params.sb, {
        intakeId: manualIntakeId,
        tweetId,
        status: 'failed',
        reason: 'dedupe_assertion_failed',
        startedAt,
      });
    }
    if (finalDuplicateAssertion.blocked) {
      return completeManualFailure(params.sb, {
        intakeId: manualIntakeId,
        tweetId,
        status: 'blocked',
        reason: finalDuplicateAssertion.reason ?? 'duplicate_gate',
        startedAt,
        meta: {
          duplicate_gate: true,
          dup_of_tweet_id: finalDuplicateAssertion.result?.dup_of_tweet_id ?? null,
        },
      });
    }

    const duplicateSkipReason = duplicateXSkipReason(post as {
      dedupe_status?: string | null;
      dup_of_tweet_id?: string | null;
      dedupe_reason?: string | null;
    });
    if (duplicateSkipReason) {
      return completeManualFailure(params.sb, {
        intakeId: manualIntakeId,
        tweetId,
        status: 'blocked',
        reason: duplicateSkipReason,
        startedAt,
        meta: { duplicate_gate: true },
      });
    }
  }

  const { data: mediaRows, error: mediaRowsError } = await params.sb.from('media')
    .select('id, storage_path, downloaded_at, mime_type, file_size, kind, duration_ms, src_url')
    .eq('tweet_id', tweetId)
    .order('ordering', { ascending: true });
  if (mediaRowsError) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'media_lookup_failed',
      startedAt,
    });
  }
  if (!Array.isArray(mediaRows)) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'media_lookup_invalid_response',
      startedAt,
    });
  }
  const rawMediaRows = mediaRows as XMediaRow[];

  const { data: renderRow, error: renderError } = await params.sb
    .from('video_renders')
    .select('id, tweet_id, source_media_id, status, output_storage_path, output_mime_type, output_file_size, duration_ms, width, height, render_version, updated_at')
    .eq('id', selectedRenderId)
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (renderError || !renderRow) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: 'render_lookup_failed',
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }
  if (renderRow.status !== 'completed' || !renderRow.output_storage_path) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: `render_not_ready:${renderRow.status ?? 'unknown'}`,
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }

  const sourceMedia = rawMediaRows.find((row) => row.id && row.id === renderRow.source_media_id) ??
    rawMediaRows.find((row) => String(row.kind ?? '').toLowerCase() === 'video' || String(row.mime_type ?? '').startsWith('video/')) ??
    {
      id: renderRow.source_media_id ?? `render:${renderRow.id}`,
      kind: 'video',
      storage_path: renderRow.output_storage_path,
      downloaded_at: renderRow.updated_at ?? new Date().toISOString(),
      mime_type: renderRow.output_mime_type ?? 'video/mp4',
      file_size: renderRow.output_file_size ?? null,
      duration_ms: renderRow.duration_ms ?? null,
      src_url: null,
    };
  const renderedRows = rawMediaRows.some((row) => row.id === sourceMedia.id)
    ? applyRenderedVideoPreference(rawMediaRows, {
      action: 'use_render',
      media: sourceMedia,
      render: renderRow as VideoRenderRow,
    })
    : [sourceMedia as XMediaRow];

  const sel = selectMediaTier(renderedRows, { allowVideo: params.cfg.allow_video === true });
  if (sel.tier === 'blocked') {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: sel.reason ?? 'media_blocked',
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }
  if (sel.tier !== 'video') {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: sel.reason ? `video_required:${sel.reason}` : 'video_required',
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }
  const durationMs = sel.items[0]?.duration_ms ?? null;
  if (isOverAttemptedVideoDuration(durationMs)) {
    const seconds = Math.round((durationMs ?? 0) / 1000);
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: `video_too_long_for_config:${seconds}s`,
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }

  const quotaReason = params.quotaBlock();
  if (quotaReason) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'blocked',
      reason: quotaReason,
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }

  let preparedVideo: PreparedMediaUpload;
  try {
    preparedVideo = await downloadMediaForUpload(params.sb, sel.items[0]);
  } catch (e) {
    if (
      e instanceof StaleMediaObjectError &&
      await repairOriginalStaleMediaForX(params.sb, tweetId, e, 'manual_video_intake')
    ) {
      return completeManualFailure(params.sb, {
        intakeId: manualIntakeId,
        tweetId,
        status: 'blocked',
        reason: `stale_media_repair_queued:${e.storagePath}`,
        startedAt,
        meta: { render_id: selectedRenderId, media_id: e.mediaId },
      });
    }
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: safeXPosterErrorCode(e, 'media_upload_failed_video'),
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }

  await updateManualIntake(params.sb, manualIntakeId, {
    status: 'post_requested',
    selected_render_id: selectedRenderId,
    last_error: null,
  });

  let deliveryClaim: XPostDeliveryClaim | null = null;
  try {
    deliveryClaim = await claimXPostDelivery(params.sb, {
      postId: tweetId,
      source: 'manual_video_intake',
      forceRetry: duplicateOverride,
      ttlSeconds: params.claimTtlSeconds,
    });
  } catch (e) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'claim_failed',
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }
  if (!deliveryClaim.claimed || !deliveryClaim.deliveryId || !deliveryClaim.claimToken) {
    const rejection = xPostClaimRejection(deliveryClaim);
    if (rejection.reason === 'already_posted' && rejection.x_tweet_id) {
      await updateManualIntake(params.sb, manualIntakeId, {
        status: 'posted',
        posted_x_tweet_id: rejection.x_tweet_id,
        posted_at: new Date().toISOString(),
        blocks_auto_delivery: false,
      });
    } else {
      await updateManualIntake(params.sb, manualIntakeId, {
        status: 'blocked',
        last_error: rejection.reason,
      });
    }
    return xPosterJson({
      ok: false,
      tweet_id: tweetId,
      intake_id: manualIntakeId,
      ...rejection,
    });
  }

  // Durable provider-start boundary: recorded BEFORE the first irreversible X
  // provider call. If the durable marker cannot be written, the provider is never
  // invoked (fail-closed). Once the provider may accept, a DB completion failure
  // is ambiguous and must NOT be reported as success.
  let providerStarted = false;
  try {
    providerStarted = await markXPostDeliveryProviderStarted(params.sb, {
      deliveryId: deliveryClaim.deliveryId,
      claimToken: deliveryClaim.claimToken,
      claimGeneration: deliveryClaim.claimGeneration,
    });
  } catch (e) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: safeXPosterErrorCode(e, 'provider_start_marker_failed'),
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }
  if (!providerStarted) {
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: 'provider_start_marker_rejected',
      startedAt,
      meta: { render_id: selectedRenderId },
    });
  }

  let mediaId = '';
  let mediaBytes = 0;
  try {
    mediaId = await uploadVideoChunked(
      preparedVideo.bytes,
      preparedVideo.mimeType || 'video/mp4',
      params.ck,
      params.cs,
      params.at,
      params.ats,
      params.sb,
      tweetId,
    );
    mediaBytes = preparedVideo.bytes.length;
  } catch (e) {
    const errMsg = safeXPosterErrorCode(e, 'media_upload_failed_video');
    try {
      await failXPostDelivery(params.sb, {
        deliveryId: deliveryClaim.deliveryId,
        claimToken: deliveryClaim.claimToken,
        claimGeneration: deliveryClaim.claimGeneration,
        error: errMsg,
        mediaKind: 'video',
        // provider_started_at is already durable. A media-upload failure can
        // mean that X accepted part of the request, so let the RPC classify it
        // as ambiguous. Never release it as a retryable pre-provider failure.
        skipReason: null,
        nextRetryAt: null,
      });
    } catch (failErr) {
      console.error('[x-poster] manual fail_x_post_delivery failed (media)', { tweetId, err: safeXPosterErrorCode(failErr, 'fail_x_post_delivery_failed') });
    }
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'ambiguous',
      reason: 'x_media_provider_outcome_unknown',
      startedAt,
      meta: { render_id: selectedRenderId, provider_started: true },
    });
  }

  const xApiStartedAt = Date.now();
  let xId = '';
  let raw: unknown = null;
  try {
    const posted = await postTweet(
      caption,
      [mediaId],
      params.ck,
      params.cs,
      params.at,
      params.ats,
      params.sb,
      tweetId,
    );
    xId = posted.id;
    raw = posted.raw;
  } catch (e) {
    const xApiMs = Date.now() - xApiStartedAt;
    const status = (e as { status?: number }).status || 0;
    const errMsg = safeXPosterErrorCode(e, 'x_provider_post_tweet_failed');
    const isRetriable = status === 429 || status >= 500;
    captureEdgeExceptionBackground(e, {
      functionName: 'x-poster',
      action: 'manual_post_error',
      tags: { status, retriable: isRetriable },
      extra: {
        tweet_id: tweetId,
        intake_id: manualIntakeId,
        render_id: selectedRenderId,
        x_api_ms: xApiMs,
      },
    });
    try {
      await failXPostDelivery(params.sb, {
        deliveryId: deliveryClaim.deliveryId,
        claimToken: deliveryClaim.claimToken,
        claimGeneration: deliveryClaim.claimGeneration,
        error: errMsg,
        apiResponse: null,
        skipReason: isRetriable ? 'x_api_retriable' : null,
        nextRetryAt: isRetriable ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
        mediaCount: 1,
        mediaBytes,
        mediaKind: 'video',
      });
    } catch (failErr) {
      console.error('[x-poster] manual fail_x_post_delivery failed (post)', { tweetId, err: safeXPosterErrorCode(failErr, 'fail_x_post_delivery_failed') });
    }
    return completeManualFailure(params.sb, {
      intakeId: manualIntakeId,
      tweetId,
      status: 'failed',
      reason: errMsg,
      startedAt,
      meta: { render_id: selectedRenderId, x_api_ms: xApiMs },
    });
  }

  const postedAt = new Date().toISOString();
  const latency = Date.now() - startedAt;
  const xApiMs = Date.now() - xApiStartedAt;
  let deliveryWriteConfirmed = false;
  let deliveryWriteError: string | null = null;
  try {
    deliveryWriteConfirmed = await completeXPostDelivery(params.sb, {
      deliveryId: deliveryClaim.deliveryId,
      claimToken: deliveryClaim.claimToken,
      claimGeneration: deliveryClaim.claimGeneration,
      xTweetId: xId,
      mediaCount: 1,
      mediaBytes,
      mediaKind: 'video',
      postedAt,
      latencyMs: latency,
      apiResponse: raw,
      lastError: null,
    });
    if (!deliveryWriteConfirmed) deliveryWriteError = 'claim_completion_rejected';
  } catch (e) {
    deliveryWriteError = safeXPosterErrorCode(e, 'claim_completion_failed');
    captureEdgeExceptionBackground(e, {
      functionName: 'x-poster',
      action: 'manual_claim_complete_error',
      extra: {
        tweet_id: tweetId,
        x_tweet_id: xId,
        intake_id: manualIntakeId,
        render_id: selectedRenderId,
      },
    });
  }

  await insertXPipelineEvent(params.sb, tweetId, deliveryWriteConfirmed ? 'completed' : 'failed', new Date(xApiStartedAt).toISOString(), new Date().toISOString(), deliveryWriteError, {
    x_tweet_id: xId,
    x_api_ms: xApiMs,
    latency_ms: latency,
    media_count: 1,
    media_kind: 'video',
    dispatch_source: 'manual_video_intake',
    intake_id: manualIntakeId,
    render_id: selectedRenderId,
    duplicate_override: duplicateOverride,
    delivery_write_confirmed: deliveryWriteConfirmed,
  });
  const retentionHours = await loadVideoRenderRetentionHours(params.sb);
  await markVideoRenderPostedBestEffort(params.sb, tweetId, retentionHours);
  await updateManualIntake(params.sb, manualIntakeId, {
    status: deliveryWriteConfirmed ? 'posted' : 'ambiguous',
    posted_x_tweet_id: xId,
    posted_at: postedAt,
    selected_render_id: selectedRenderId,
    blocks_auto_delivery: !deliveryWriteConfirmed,
    last_error: deliveryWriteError,
  });

  return xPosterJson({
    ok: deliveryWriteConfirmed,
    status: deliveryWriteConfirmed ? 'posted' : 'ambiguous',
    tweet_id: tweetId,
    intake_id: manualIntakeId,
    render_id: selectedRenderId,
    x_tweet_id: xId,
    latency_ms: latency,
    x_api_ms: xApiMs,
    delivery_write_confirmed: deliveryWriteConfirmed,
  });
}

// ─── Main ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
  const authErr = await requireInternalAuth(req, corsHeaders);
  if (authErr) return authErr;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient<any, any>(supabaseUrl, svcKey);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const onlyTweetId = typeof body.tweet_id === 'string' ? body.tweet_id : null;
  const targetTweetId = typeof body.target_tweet_id === 'string' ? body.target_tweet_id : null;
  const requestSource = typeof body.dispatch_source === 'string' ? body.dispatch_source : null;
  const forceRetry = body.force_retry === true || (onlyTweetId !== null && !dryRun);
  const claimTtlSeconds = typeof body.claim_ttl_seconds === 'number' ? body.claim_ttl_seconds : 1800;

  // Entry guard is defense in depth. It runs before candidate/settings work and
  // returns a stable locked result for Preview or any invalid control state.
  const postingGuard = await checkExternalPosting(sb);
  if (!postingGuard.allowed) {
    return xPosterJson({
      ok: false,
      status: 'locked',
      reason: 'external_posting_blocked',
    });
  }

  // Load settings
  let settingsRows: unknown = null;
  let settingsError: unknown = null;
  try {
    const settingsResult = await sb.from('settings').select('key, value')
      .in('key', ['x_posting_config', 'x_rate_limits', 'enrichment_config', 'story_memory']);
    settingsRows = settingsResult?.data;
    settingsError = settingsResult?.error;
  } catch (_error) {
    console.error('[x-poster] quota settings unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  if (settingsError !== null || !Array.isArray(settingsRows)) {
    console.error('[x-poster] quota settings unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  if (settingsRows.some((row) => !isRecord(row) || typeof row.key !== 'string')) {
    console.error('[x-poster] quota settings malformed', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  const sm: Record<string, unknown> = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
  const hasSetting = (key: string) => Object.prototype.hasOwnProperty.call(sm, key);
  const rawPostingConfig = sm.x_posting_config;
  const rawRateLimits = sm.x_rate_limits;
  const requiredPostingQuotaFields: Array<[string, number]> = [
    ['posts_per_hour', X_POSTING_QUOTA_MAX.posts_per_hour],
    ['posts_per_day', X_POSTING_QUOTA_MAX.posts_per_day],
    ['monthly_post_budget', X_POSTING_QUOTA_MAX.monthly_post_budget],
    ['media_uploads_per_day', X_POSTING_QUOTA_MAX.media_uploads_per_day],
  ];
  if (
    !hasSetting('x_posting_config') ||
    !isRecord(rawPostingConfig) ||
    typeof rawPostingConfig.enabled !== 'boolean' ||
    !isOptionalNonNegativeSafeInteger(rawPostingConfig.daily_budget) ||
    !isOptionalNonNegativeSafeInteger(rawPostingConfig.min_spacing_minutes) ||
    (rawPostingConfig.max_posts_per_run !== undefined && !isBoundedPositiveSafeInteger(rawPostingConfig.max_posts_per_run, 20)) ||
    !hasSetting('x_rate_limits') ||
    !isRecord(rawRateLimits) ||
    requiredPostingQuotaFields.some(([field, max]) => !isBoundedPositiveSafeInteger(rawRateLimits[field], max))
  ) {
    console.error('[x-poster] quota setting shape unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  const cfg: PostingConfig = { ...DEFAULT_CFG, ...rawPostingConfig } as PostingConfig;
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...rawRateLimits } as RateLimits;
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
  type QuotaQueryResult = {
    data: unknown;
    error: unknown;
    count: number | null;
  };
  let quotaResults: Array<Record<string, unknown>> = [];
  try {
    quotaResults = await Promise.all([
      sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since30d),
      sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since24h),
      sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since1h),
      sb.from('x_deliveries').select('*', { count: 'exact', head: true }).eq('status', 'posted').gt('media_count', 0).gte('created_at', since24h),
      sb.from('x_deliveries').select('created_at, posted_at').eq('status', 'posted').order('created_at', { ascending: false }).limit(1),
    ]) as unknown as Array<Record<string, unknown>>;
  } catch (_error) {
    console.error('[x-poster] quota reads unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  if (
    quotaResults.length !== 5 ||
    quotaResults.some((result) => result.error !== null)
  ) {
    console.error('[x-poster] quota reads unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  const [
    monthlyQuota,
    posts24hQuota,
    posts1hQuota,
    mediaUp24hQuota,
    lastPostQuota,
  ] = quotaResults;
  const monthlyPosts = monthlyQuota.count;
  const posts24hDb = posts24hQuota.count;
  const posts1hDb = posts1hQuota.count;
  const mediaUp24hDb = mediaUp24hQuota.count;
  const lastPostRows = lastPostQuota.data;
  if (
    !Array.isArray(lastPostRows) ||
    (lastPostRows[0] !== undefined && !isRecord(lastPostRows[0])) ||
    !isNonNegativeSafeInteger(monthlyPosts) ||
    !isNonNegativeSafeInteger(posts24hDb) ||
    !isNonNegativeSafeInteger(posts1hDb) ||
    !isNonNegativeSafeInteger(mediaUp24hDb)
  ) {
    console.error('[x-poster] quota history malformed', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  let posts24hCount = posts24hDb;
  let posts1hCount = posts1hDb;
  let monthlyPostsCount = monthlyPosts;
  let mediaUp24hCount = mediaUp24hDb;
  const latestPost = lastPostRows[0];
  const lastPostAt = latestPost?.posted_at ?? latestPost?.created_at;
  if (latestPost !== undefined && typeof lastPostAt !== 'string') {
    console.error('[x-poster] quota history timestamp malformed', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }
  let lastPostTimeMs = latestPost === undefined ? 0 : new Date(lastPostAt).getTime();

  const quotaBlock = (): string | null => {
    return getXQuotaBlockReason({
      available: true,
      nowMs: Date.now(),
      limits,
      config: cfg,
      snapshot: {
        posts1h: posts1hCount,
        posts24h: posts24hCount,
        posts30d: monthlyPostsCount,
        mediaUploads24h: mediaUp24hCount,
        lastPostTimeMs,
      },
    });
  };

  if (quotaBlock() === X_QUOTA_UNAVAILABLE) {
    console.error('[x-poster] quota admission unavailable', { code: X_QUOTA_UNAVAILABLE });
    return quotaUnavailableResponse();
  }

  const manualResponse = await handleManualVideoIntakePost({
    sb,
    body,
    cfg,
    duplicateGateCfg,
    claimTtlSeconds,
    quotaBlock,
    ck,
    cs,
    at,
    ats,
  });
  if (manualResponse) return manualResponse;

  // Select candidates
  const dedupeCutoff = new Date(Date.now() - cfg.dedupe_window_hours * 3600 * 1000).toISOString();
  const maxCandidateAgeMinutes = Math.max(1, Math.min(1440, Number(cfg.max_candidate_age_minutes ?? 30) || 30));
  const freshnessCutoff = new Date(Date.now() - maxCandidateAgeMinutes * 60 * 1000).toISOString();
  // Hard floor: never look at posts created before X posting was enabled.
  const startFrom = cfg.start_posting_from || null;
  const effectiveCutoff = [dedupeCutoff, freshnessCutoff, startFrom].filter((v): v is string => !!v).sort().at(-1) ?? freshnessCutoff;
  const maxPostsPerRun = Math.max(1, Math.min(20, Number(cfg.max_posts_per_run ?? 1) || 1));

  const { data: existingRows, error: existingRowsError } = await sb.from('x_deliveries').select('post_id').in('status', ['posting', 'posted', 'pending']).gte('created_at', dedupeCutoff);
  if (existingRowsError) {
    throw new Error('x_poster_existing_delivery_read_failed');
  }
  if (!Array.isArray(existingRows)) {
    throw new Error('x_poster_existing_delivery_result_invalid');
  }
  const existing = new Set((existingRows || []).map((r) => r.post_id as string));

  let posts: Array<Record<string, unknown>> = [];
  let postsErr: { message: string } | null = null;
  if (!onlyTweetId) {
    const rpcLimit = targetTweetId ? 1 : maxPostsPerRun;
    const rpcRes = await sb.rpc('get_x_post_candidates', {
      candidate_limit: rpcLimit,
      target_tweet_id: targetTweetId,
    });
    if (!rpcRes.error) {
      if (!Array.isArray(rpcRes.data)) {
        throw new Error('x_poster_candidate_result_invalid');
      }
      posts = ((rpcRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        accounts: { handle: row.account_handle },
      }));
    } else {
      console.warn('[x-poster] get_x_post_candidates RPC unavailable, using fallback query', { code: 'x_poster_candidate_rpc_unavailable' });
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
      if (!Array.isArray(fallbackRes.data) && !fallbackRes.error) {
        throw new Error('x_poster_candidate_result_invalid');
      }
      posts = (fallbackRes.data ?? []) as Array<Record<string, unknown>>;
      postsErr = fallbackRes.error;
    }
  } else {
    const forceRes = await sb.from('posts')
      .select('tweet_id, text_translated, text_original, author_handle, has_media, importance_score, final_score, delivery_decision, decision_reason, url, is_truncated, hydrated_at, created_at, final_x_text, composed_post_text, post_format_hint, humanized_commentary, commentary_hook, commentary_question, narrative_callback, thread_continuation, enrich_status, dedupe_status, dup_of_tweet_id, dup_similarity, dedupe_reason, accounts!inner(handle)')
      .eq('tweet_id', onlyTweetId)
      .limit(1);
    if (!Array.isArray(forceRes.data) && !forceRes.error) {
      throw new Error('x_poster_candidate_result_invalid');
    }
    posts = (forceRes.data ?? []) as Array<Record<string, unknown>>;
    postsErr = forceRes.error;
  }

  if (postsErr) {
    return new Response(JSON.stringify({ error: 'x_poster_candidate_read_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const results: Array<Record<string, unknown>> = [];
  const activeManualIntakeTweets = new Set<string>();
  if (!onlyTweetId && posts.length > 0) {
    const candidateTweetIds = Array.from(new Set(posts.map((p) => String(p.tweet_id ?? '')).filter(Boolean)));
    if (candidateTweetIds.length > 0) {
      const { data: manualRows, error: manualRowsError } = await sb
        .from('manual_video_intakes')
        .select('tweet_id')
        .in('tweet_id', candidateTweetIds)
        .eq('blocks_auto_delivery', true)
        .not('status', 'in', '(posted,canceled)');
      if (manualRowsError) {
        throw new Error('x_poster_manual_intake_read_failed');
      } else {
        if (!Array.isArray(manualRows)) {
          throw new Error('x_poster_manual_intake_result_invalid');
        }
        for (const row of manualRows ?? []) {
          if (row?.tweet_id) activeManualIntakeTweets.add(String(row.tweet_id));
        }
      }
    }
  }
  const candidates = (posts || []).filter((p) => {
    const id = String(p.tweet_id ?? '');
    if (!onlyTweetId && existing.has(id)) return false;
    if (!onlyTweetId && activeManualIntakeTweets.has(id)) return false;
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

    const { data: latestX, error: latestXError } = await sb
      .from('x_deliveries')
      .select('status, last_error, skip_reason, x_tweet_id, claim_expires_at')
      .eq('post_id', tweetId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestXError) {
      throw new Error('x_poster_latest_delivery_read_failed');
    }
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
    const finalAssertionSource = onlyTweetId ? 'x_force_final_assertion' : targetTweetId ? 'x_target_final_assertion' : 'x_final_assertion';
    try {
      finalDuplicateAssertion = await assertObservedFinalDuplicateState({
        sb,
        tweetId,
        duplicateGateCfg,
        dryRun,
        source: finalAssertionSource,
        sourceFunction: 'x-poster',
        metadata: {
          dispatch_source: dispatchSource,
          target_tweet: Boolean(targetTweetId),
          forced_post: Boolean(onlyTweetId),
        },
      });
    } catch (e) {
      const error = safeXPosterErrorCode(e, 'dedupe_assertion_failed');
      if (!dryRun && latestStatus !== 'failed') {
        const { error: failErr } = await sb.from('x_deliveries').insert({
          post_id: tweetId,
          status: 'failed',
          skip_reason: 'dedupe_assertion_failed',
          last_error: 'dedupe_assertion_failed',
          attempts: 0,
        });
        if (failErr) console.error('[x-poster] x_deliveries insert failed (dedupe assertion)', { tweetId, err: safeXPosterErrorCode(failErr, 'x_delivery_write_failed') });
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
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (final duplicate assertion)', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
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
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (duplicate gate)', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
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
    const { data: mediaRows, error: mediaRowsError } = await sb.from('media')
      .select('id, storage_path, downloaded_at, mime_type, file_size, kind, duration_ms, src_url')
      .eq('tweet_id', tweetId)
      .order('ordering', { ascending: true });
  if (mediaRowsError) {
    throw new Error('x_poster_media_read_failed');
  }
  if (!Array.isArray(mediaRows)) {
    throw new Error('x_poster_media_result_invalid');
  }

    // Media-required gate: if a post is known to have media, X must not post
    // text-only. Telegram can fetch remote media URLs directly, but X requires
    // uploaded bytes, so missing/invalid media must defer or fail instead of
    // silently burning the post as text.
    const postAgeMs = Date.now() - new Date((post as { created_at: string }).created_at).getTime();
    const hasMediaFlag = (post as { has_media?: boolean }).has_media === true;
    let mediaRowsForSelection = mediaRows as XMediaRow[];
    const anyDownloaded = mediaRowsForSelection.some((m) => m.downloaded_at);
    if (hasMediaFlag && !anyDownloaded) {
      const { data: pendingJobs, error: pendingJobsError } = await sb.from('jobs')
        .select('id').in('type', ['resolve_media', 'download_media'])
        .in('status', ['pending', 'running'])
        .filter('payload->>tweet_id', 'eq', tweetId).limit(1);
      if (pendingJobsError) {
        throw new Error('x_poster_pending_media_read_failed');
      }
      if (!Array.isArray(pendingJobs)) {
        throw new Error('x_poster_pending_media_result_invalid');
      }
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
        const { error: healDownloadError } = await sb.from('jobs').insert({
          type: 'download_media',
          payload: { tweet_id: tweetId },
          status: 'pending',
          idempotency_key: `download_media:xposter_heal:${tweetId}:${Date.now()}`,
          next_run_at: new Date().toISOString(),
          priority: 12,
        });
        if (healDownloadError) {
          throw new Error('x_poster_download_heal_enqueue_failed');
        }
        results.push({ tweet_id: tweetId, status: 'deferred', reason: 'media_pending_self_healed', age_ms: postAgeMs });
        console.log(`[x-poster] self-healed missing download for ${tweetId}, deferring`);
        continue;
      }

      if (dryRun) {
        results.push({ tweet_id: tweetId, status: 'dry_run_deferred', reason: 'media_missing_self_heal_needed', age_ms: postAgeMs });
        continue;
      }
      const { error: healResolveError } = await sb.from('jobs').insert({
        type: 'resolve_media',
        payload: { tweet_id: tweetId },
        status: 'pending',
        idempotency_key: `resolve_media:xposter_heal:${tweetId}:${Date.now()}`,
        next_run_at: new Date().toISOString(),
        priority: 12,
      });
      if (healResolveError) {
        throw new Error('x_poster_resolve_heal_enqueue_failed');
      }
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
          if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (video render)', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
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
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
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
        if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (video disabled)', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
        results.push({ tweet_id: tweetId, status: 'skipped', reason });
        console.warn(`[x-poster] skipping ${tweetId}: ${reason}`);
        continue;
      }

      const { data: mediaJobs, error: mediaJobsError } = await sb.from('jobs')
        .select('id')
        .in('type', ['resolve_media', 'download_media'])
        .in('status', ['pending', 'running'])
        .filter('payload->>tweet_id', 'eq', tweetId)
        .limit(1);
      if (mediaJobsError) {
        throw new Error('x_poster_pending_video_read_failed');
      }

      if (mediaJobs && mediaJobs.length > 0) {
        results.push({ tweet_id: tweetId, status: 'deferred', reason, age_ms: postAgeMs });
        console.log(`[x-poster] deferring ${tweetId}: ${reason}`);
        continue;
      }

      const { error: invalidVideoResolveError } = await sb.from('jobs').insert({
        type: 'resolve_media',
        payload: { tweet_id: tweetId },
        status: 'pending',
        idempotency_key: `resolve_media:xposter_heal:${tweetId}:${Date.now()}`,
        next_run_at: new Date().toISOString(),
        priority: 12,
      });
      if (invalidVideoResolveError) {
        throw new Error('x_poster_invalid_video_enqueue_failed');
      }
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
      if (skipErr) console.error('[x-poster] x_deliveries insert skipped failed (media required)', { tweetId, err: safeXPosterErrorCode(skipErr, 'x_delivery_write_failed') });
      results.push({ tweet_id: tweetId, status: 'skipped', reason: `media_required:${reason}` });
      console.warn(`[x-poster] skipping text-only post for ${tweetId}: ${reason}`);
      continue;
    }

    let preparedMediaUploads: PreparedMediaUpload[] = [];
    if (sel.tier !== 'text' && !dryRun) {
      try {
        preparedMediaUploads = [];
        for (const item of sel.items) {
          preparedMediaUploads.push(await downloadMediaForUpload(sb, item));
        }
      } catch (e) {
        if (
          e instanceof StaleMediaObjectError &&
          await repairOriginalStaleMediaForX(sb, tweetId, e, 'x_poster')
        ) {
          results.push({
            tweet_id: tweetId,
            status: 'deferred',
            reason: 'stale_media_repair_queued',
            media_id: e.mediaId,
          });
          console.warn(`[x-poster] deferred ${tweetId}: stale media object repair queued`);
          continue;
        }
        const errMsg = safeXPosterErrorCode(e, `media_upload_failed_${sel.tier}`);
        results.push({ tweet_id: tweetId, status: 'failed', error: errMsg });
        console.warn(`[x-poster] ${sel.tier} media preparation failed for ${tweetId}; not claiming delivery`, { code: errMsg });
        continue;
      }
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
        const errMsg = safeXPosterErrorCode(e, 'claim_x_post_delivery_failed');
        await insertXPipelineEvent(sb, tweetId, 'failed', new Date(startedAt).toISOString(), new Date().toISOString(), errMsg, {
          candidate_reason: candidateReason,
          candidate_age_ms: candidateAgeMs,
          dispatch_source: dispatchSource,
          claim_error: true,
        });
        results.push({ tweet_id: tweetId, status: 'failed', reason: 'claim_failed', error: errMsg, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource });
        console.error('[x-poster] claim_x_post_delivery failed', { tweetId, code: errMsg });
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

    if (!dryRun && sel.tier === 'video') {
      const durationMs = sel.items[0]?.duration_ms ?? null;
      if (isOverAttemptedVideoDuration(durationMs)) {
        const seconds = Math.round(durationMs / 1000);
        const reason = `video_too_long_for_config:${seconds}s`;
        const skipOk = deliveryClaim
          ? await failXPostDelivery(sb, {
            deliveryId: deliveryClaim.deliveryId!,
            claimToken: deliveryClaim.claimToken!,
            claimGeneration: deliveryClaim.claimGeneration,
            status: 'skipped',
            error: `configured video duration cap is ${MAX_ATTEMPTED_VIDEO_DURATION_MS / 1000}s`,
            skipReason: reason,
            mediaKind: 'video',
          })
          : false;
        if (!skipOk) console.error('[x-poster] x_deliveries claim release skip failed (video duration)', { tweetId });
        results.push({ tweet_id: tweetId, status: 'skipped', reason });
        console.warn(`[x-poster] skipping ${tweetId}: ${reason}`);
        continue;
      }
    }

    // Durable provider-start boundary (batch, ALL tiers incl. text — SF2):
    // recorded immediately before the first irreversible X provider call (media
    // upload or tweet POST) for every non-dryRun delivery, text included. If the
    // durable marker cannot be written the provider is NOT invoked; once the
    // provider may accept a completion-DB failure is durable ambiguous, never
    // success. Previously the text tier skipped this and could leave a stuck
    // 'preparing' posting with no provider_start fence and no ambiguity.
    if (!dryRun && deliveryClaim) {
      let providerOk = false;
      try {
        providerOk = await markXPostDeliveryProviderStarted(sb, {
          deliveryId: deliveryClaim.deliveryId,
          claimToken: deliveryClaim.claimToken,
          claimGeneration: deliveryClaim.claimGeneration,
        });
      } catch (providerErr) {
        const failOk = await failXPostDelivery(sb, {
          deliveryId: deliveryClaim.deliveryId,
          claimToken: deliveryClaim.claimToken,
          claimGeneration: deliveryClaim.claimGeneration,
          error: safeXPosterErrorCode(providerErr, 'provider_start_marker_failed'),
          skipReason: 'provider_boundary_failed',
          mediaKind,
        });
        if (!failOk) console.error('[x-poster] provider-boundary fail release failed', { tweetId });
        results.push({ tweet_id: tweetId, status: 'failed', error: 'provider_start_marker_failed' });
        console.warn(`[x-poster] provider boundary marker failed for ${tweetId}; not posting`, { code: 'provider_start_marker_failed' });
        continue;
      }
      if (!providerOk) {
        results.push({ tweet_id: tweetId, status: 'failed', error: 'provider_start_marker_rejected' });
        console.warn(`[x-poster] provider boundary marker rejected for ${tweetId}; not posting`, { code: 'provider_start_marker_rejected' });
        continue;
      }
    }

    if (sel.tier !== 'text' && !dryRun) {
      try {
        if (sel.tier === 'video') {
          const prepared = preparedMediaUploads[0];
          if (!prepared) throw new Error('media_prepare_missing_video');
          const id = await uploadVideoChunked(prepared.bytes, prepared.mimeType || 'video/mp4', ck, cs, at, ats, sb, tweetId);
          mediaIds.push(id);
          mediaBytes += prepared.bytes.length;
          mediaCount = 1;
          mediaKind = 'video';
          mediaUp24hCount += 1;
        } else {
          for (const prepared of preparedMediaUploads) {
            const id = await uploadImage(prepared.bytes, prepared.mimeType || 'image/jpeg', ck, cs, at, ats, sb, tweetId);
            mediaIds.push(id);
            mediaBytes += prepared.bytes.length;
            mediaCount += 1;
            mediaUp24hCount += 1;
          }
          mediaKind = 'image';
        }
      } catch (e) {
        const errMsg = safeXPosterErrorCode(e, `media_upload_failed_${sel.tier}`);
        try {
          const failOk = deliveryClaim
            ? await failXPostDelivery(sb, {
              deliveryId: deliveryClaim.deliveryId!,
              claimToken: deliveryClaim.claimToken!,
              claimGeneration: deliveryClaim.claimGeneration,
              error: errMsg,
              mediaKind: sel.tier,
              skipReason: null,
              nextRetryAt: null,
            })
            : false;
          if (!failOk) console.error('[x-poster] x_deliveries claim release failed (media)', { tweetId });
        } catch (failErr) {
          console.error('[x-poster] fail_x_post_delivery failed (media)', { tweetId, err: safeXPosterErrorCode(failErr, 'fail_x_post_delivery_failed') });
        }
        results.push({ tweet_id: tweetId, status: 'ambiguous', error: 'x_media_provider_outcome_unknown' });
        console.warn(`[x-poster] ${sel.tier} upload outcome is ambiguous for ${tweetId}; not retrying`, { code: 'x_media_provider_outcome_unknown' });
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
      const errMsg = safeXPosterErrorCode(e, 'x_provider_post_tweet_failed');
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
            claimGeneration: deliveryClaim.claimGeneration,
            error: errMsg,
            apiResponse: null,
            skipReason: isRetriable ? 'x_api_retriable' : null,
            nextRetryAt: isRetriable ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
            mediaCount,
            mediaBytes,
            mediaKind,
          })
          : false;
        if (!failOk) console.error('[x-poster] x_deliveries claim release failed (post)', { tweetId });
      } catch (failErr) {
        console.error('[x-poster] fail_x_post_delivery failed (post)', { tweetId, err: safeXPosterErrorCode(failErr, 'fail_x_post_delivery_failed') });
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
    monthlyPostsCount += 1;
    lastPostTimeMs = Date.now();
    const postedAt = new Date().toISOString();
    let deliveryWriteConfirmed = false;
    let deliveryWriteError: string | null = null;
    try {
      deliveryWriteConfirmed = deliveryClaim
        ? await completeXPostDelivery(sb, {
          deliveryId: deliveryClaim.deliveryId!,
          claimToken: deliveryClaim.claimToken!,
          claimGeneration: deliveryClaim.claimGeneration,
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
      deliveryWriteError = safeXPosterErrorCode(e, 'claim_completion_failed');
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
    const retentionHours = await loadVideoRenderRetentionHours(sb);
    await markVideoRenderPostedBestEffort(sb, tweetId, retentionHours);
    results.push({ tweet_id: tweetId, status: deliveryWriteConfirmed ? 'posted' : 'ambiguous', x_tweet_id: xId, latency_ms: latency, x_api_ms: xApiMs, candidate_reason: candidateReason, candidate_age_ms: candidateAgeMs, dispatch_source: dispatchSource, delivery_write_confirmed: deliveryWriteConfirmed });
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  } catch (error) {
    const fatalCode = safeXPosterErrorCode(error, 'x_poster_fatal');
    console.error('[x-poster] fatal', { code: fatalCode });
    await captureEdgeException(new Error(fatalCode), {
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
    const { error: pipelineEventError } = await sb.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'x_post',
      status,
      started_at: startedAt,
      ended_at: endedAt,
      error,
      meta,
    });
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: 'x-poster',
        action: 'pipeline_event_insert_failed',
        error: 'x_pipeline_event_insert_failed',
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: 'x-poster',
      action: 'pipeline_event_insert_failed',
      error: 'x_pipeline_event_insert_failed',
    }));
  }
}

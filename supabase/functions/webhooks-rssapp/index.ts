import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  readRssWebhookAuthMode,
  requireRssWebhookAuth,
  serviceRoleBearerHeader,
} from "../_shared/internalAuth.ts";
import { filterSendableIngestMedia } from "../_shared/mediaSelection.ts";
import { filterReviewedRemoteMediaItems } from "../_shared/remoteMediaPolicy.ts";
import {
  normalizeRssWebhookText,
  parseBoundedRssItemMedia,
} from "../_shared/rssWebhookItemParser.ts";
import {
  extractBoundedRssWebhookItems,
  isRssWebhookPayloadError,
  parseBoundedRssWebhookJson,
  readBoundedRssWebhookBody,
  RssWebhookPayloadError,
  rssWebhookPayloadErrorStatus,
} from "../_shared/rssWebhookPayloadPolicy.ts";
import {
  captureEdgeException,
  captureEdgeExceptionBackground,
  initSentryEdge,
} from "../_shared/sentry.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token, x-rssapp-token, RSSApp-Signature',
};
initSentryEdge();

function webhookPayloadErrorResponse(error: RssWebhookPayloadError): Response {
  return new Response(JSON.stringify({
    error: 'Webhook payload rejected',
    code: error.code,
  }), {
    status: rssWebhookPayloadErrorStatus(error),
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function webhookUnauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const MAX_RSS_WEBHOOK_ITEM_ID_LENGTH = 1_024;

class RssWebhookPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RssWebhookPersistenceError';
  }
}

type RssWebhookQueryResult = {
  data?: unknown;
  error?: { message?: string } | null;
};

type RssWebhookQueryBuilder = PromiseLike<RssWebhookQueryResult> & {
  select(columns?: string): RssWebhookQueryBuilder;
  eq(column: string, value: unknown): RssWebhookQueryBuilder;
  limit(count: number): RssWebhookQueryBuilder;
  maybeSingle(): PromiseLike<RssWebhookQueryResult>;
  upsert(values: unknown, options?: Record<string, unknown>): RssWebhookQueryBuilder;
  update(values: Record<string, unknown>): RssWebhookQueryBuilder;
  insert(values: unknown): RssWebhookQueryBuilder;
  single(): PromiseLike<RssWebhookQueryResult>;
};

type RssWebhookSupabaseClient = {
  from(table: string): RssWebhookQueryBuilder;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RssWebhookQueryResult>;
  functions: {
    invoke(name: string, options?: Record<string, unknown>): PromiseLike<RssWebhookQueryResult>;
  };
};

// The durable receipt RPCs only ever call rpc(), so they are bounded to the narrow
// structural slice of the client that provides it. Keeping receipt helpers off the
// full RssWebhookSupabaseClient type preserves the module's stable 5 bounded helpers.
type RssReceiptRpcClient = Pick<RssWebhookSupabaseClient, 'rpc'>;

type RssWebhookItem = Record<string, unknown>;

function assertWebhookDatabaseSuccess(error: unknown, code: string): void {
  if (error) throw new RssWebhookPersistenceError(code);
}

function stableRssWebhookItemId(item: Record<string, unknown>): string | null {
  for (const value of [item.guid, item.id, item.link, item.url]) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id.length > 0 && id.length <= MAX_RSS_WEBHOOK_ITEM_ID_LENGTH) return id;
  }
  return null;
}

// Detect whether an RSS-ingested tweet text appears truncated.
// Conservative: require explicit markers OR (long text + no terminal punctuation).
function detectTruncation(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Explicit "show more" markers (case-insensitive)
  if (/(^|\s)(show\s+more|show\s+this\s+thread|read\s+more)\s*$/i.test(trimmed)) return true;

  // Trailing ellipsis variants: …, ..., […], [...]
  const endsWithEllipsis = /(\u2026|\.{3}|\[\u2026\]|\[\.{3}\])\s*$/.test(trimmed);
  if (endsWithEllipsis && trimmed.length >= 200) return true;

  // Hard length cliff (RSS.app commonly cuts around 270-280 chars) with no terminal punctuation
  if (trimmed.length >= 270) {
    const lastChar = trimmed.charAt(trimmed.length - 1);
    const terminalPunct = ['.', '!', '?', '\u061F', '"', ')', '\u201D', '\u300D'];
    if (!terminalPunct.includes(lastChar)) return true;
  }

  // --- Additional RSS.app-specific truncation signals ---

  // 1) Trailing pic.twitter.com URL fragment (e.g. "...make a… pic.", "...pic.twitt", "...pic.twitter.co")
  //    RSS.app frequently cuts inside the auto-appended pic.twitter.com/<id> URL.
  if (/\b(pic\.?|pic\.t|pic\.tw(?:itter)?(?:\.c(?:om?)?)?\/?)\s*$/i.test(trimmed)) return true;

  // 2) Mid-text ellipsis on long content with non-closing final char
  //    Catches "...make a… pic." style where the ellipsis sits inside the body.
  if (trimmed.length >= 240 && /(\u2026|\[\u2026\]|\.{3}|\[\.{3}\])/.test(trimmed)) {
    const lastChar = trimmed.charAt(trimmed.length - 1);
    const closingChars = ['"', ')', '\u201D', '\u300D', ']', '}'];
    if (!closingChars.includes(lastChar)) return true;
  }

  // 3) Long text ending on a dangling article / preposition / conjunction
  //    (optionally followed by a stray period). Real sentences don't end this way.
  if (trimmed.length >= 240) {
    const tokens = trimmed.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || '';
    if (/^(a|an|the|to|of|in|on|for|and|or|but|with|by|at|as|is|was|are|were|has|have|had)\.?$/i.test(lastToken)) {
      return true;
    }
  }

  return false;
}

// Read the twitter_hydration setting; default to enabled if missing.
async function isHydrationEnabled(supabase: RssWebhookSupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'twitter_hydration').maybeSingle();
    if (!isRecord(data) || !data.value || typeof data.value !== 'object') return true;
    const v = data.value as Record<string, unknown>;
    return v.enabled !== false;
  } catch { return true; }
}

async function isDuplicateGateEnabled(supabase: RssWebhookSupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'story_memory')
    .maybeSingle();
  assertWebhookDatabaseSuccess(error, 'rss_webhook_duplicate_gate_read_failed');
  const value = isRecord(data) ? data.value : undefined;
  return !!(value && typeof value === 'object' && (value as Record<string, unknown>).enabled === true);
}

async function enqueueContentPipelineEntry(supabase: RssWebhookSupabaseClient, tweetId: string, isTruncated: boolean, duplicateGateEnabled: boolean): Promise<string> {
  const type = duplicateGateEnabled ? 'dedupe' : 'translate';
  const step = duplicateGateEnabled ? 'dedupe' : 'translate';
  const idempotencyKey = duplicateGateEnabled ? `dedupe:${tweetId}` : `translate:${tweetId}`;
  const priority = duplicateGateEnabled ? 30 : 10;

  const { error } = await supabase
    .from('jobs')
    .upsert({
      type,
      payload: { tweet_id: tweetId },
      status: 'pending',
      priority,
      idempotency_key: idempotencyKey,
      next_run_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

  assertWebhookDatabaseSuccess(error, `rss_webhook_${type}_job_upsert_failed`);

  if (duplicateGateEnabled) {
    const { error: dedupeStatusError } = await supabase
      .from('posts')
      .update({
        dedupe_status: 'pending',
        dedupe_method: null,
        dedupe_confidence: null,
        dedupe_reason: 'queued:webhook',
        dedupe_checked_at: null,
      })
      .eq('tweet_id', tweetId);
    assertWebhookDatabaseSuccess(
      dedupeStatusError,
      'rss_webhook_dedupe_status_update_failed',
    );
  }

  console.log(JSON.stringify({ function: 'webhooks-rssapp', action: `${type}_job_created` }));
  const { error: eventError } = await supabase
    .from('pipeline_events')
    .insert({
      subject_type: 'post',
      subject_id: tweetId,
      step,
      status: 'queued',
      started_at: new Date().toISOString(),
      meta: { source: 'webhook', is_truncated: isTruncated },
    });
  assertWebhookDatabaseSuccess(
    eventError,
    `rss_webhook_${type}_pipeline_event_failed`,
  );
  return type;
}

type EdgeRuntimeWithWaitUntil = { waitUntil?: (promise: Promise<unknown>) => void };

function scheduleBackground(promise: Promise<unknown>): boolean {
  const edgeRuntime = (globalThis as { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// B3b1 (AIR-003): deterministic material receipt identity.
//
// The durable receipt_key is derived ONLY from the normalized feed/source identity
// concatenated with the canonical sorted stable-item and normalized-materialization
// content fingerprints. It MUST NOT include timestamp, random, or auth_mode material;
// auth_mode is stored on the row as metadata only. token vs signed delivery of the
// SAME normalized feed + canonical item-content set resolve to the SAME receipt_key,
// so repeat identical POSTs are idempotent. Item fingerprints are sorted, so item
// ORDER changes do NOT create a new receipt, but material CONTENT changes for the
// same item DO create a new receipt (content-sensitive fingerprint).
// =============================================================================

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Normalized feed identity: the stable source the webhook belongs to, not per-attempt.
// Prefer an explicit stable source id (data.feed_id / payload.feed_id / source.id),
// falling back to the payload URL. HMAC auth mode never contributes to the key.
function normalizedRssFeedIdentity(payload: Record<string, unknown>): string {
  const data = isRecord(payload.data) ? payload.data : null;
  const dataSource = data && isRecord(data.source) ? data.source : null;
  const payloadSource = isRecord(payload.source) ? payload.source : null;
  const feedId = data?.feed_id ?? payload.feed_id ?? dataSource?.id ?? payloadSource?.id;
  if (typeof feedId === 'string') {
    const trimmed = feedId.trim();
    if (trimmed.length > 0) return `feed:${trimmed.toLowerCase()}`;
  }
  if (typeof payload.url === 'string' && payload.url.trim().length > 0) return `url:${payload.url.trim()}`;
  return 'payload';
}

// Normalized materialization content for a single stable item: text + sorted media.
// auth_mode and per-attempt timestamps never enter the fingerprint.
function rssReceiptMaterialContent(item: RssWebhookItem): string {
  let text = '';
  if (item.title && typeof item.title === 'string') text = normalizeRssWebhookText(item.title);
  else if (item.description_text && typeof item.description_text === 'string') text = normalizeRssWebhookText(item.description_text);
  else if (item.description && typeof item.description === 'string') text = normalizeRssWebhookText(item.description, true);
  else if (item.content && typeof item.content === 'string') text = normalizeRssWebhookText(item.content, true);
  else if (item.summary && typeof item.summary === 'string') text = normalizeRssWebhookText(item.summary, true);
  else text = 'RSS Item - No content available';
  const media = parseBoundedRssItemMedia(item).map((m) => `${m.type}:${m.url}`).sort().join('|');
  return `${text}\n${media}`;
}

// Stable-item fingerprint: hash( stable_item_id : sha256(normalized material content) ).
async function rssReceiptItemFingerprint(item: RssWebhookItem): Promise<string> {
  const stableId = stableRssWebhookItemId(item);
  const idHash = await sha256Hex(stableId ?? '');
  const contentHash = await sha256Hex(rssReceiptMaterialContent(item));
  return sha256Hex(`${idHash}:${contentHash}`);
}

// Canonical, order-insensitive set of item fingerprints, concatenated deterministically.
async function rssCanonicalItemFingerprints(items: RssWebhookItem[]): Promise<string> {
  const fingerprints = await Promise.all(items.map((item) => rssReceiptItemFingerprint(item)));
  return fingerprints.sort().join('|');
}

// Deterministic material receipt key. NO time/random/auth-mode material at all.
async function computeRssWebhookReceiptKey(
  payloadRecord: Record<string, unknown> | null,
  items: RssWebhookItem[],
): Promise<string> {
  const feedPart = payloadRecord ? normalizedRssFeedIdentity(payloadRecord) : 'payload';
  const itemsPart = await rssCanonicalItemFingerprints(items);
  return sha256Hex(`${feedPart}|${itemsPart}`);
}

async function insertWorkerDispatchEvents(supabase: RssWebhookSupabaseClient, tweetIds: string[], status: 'queued' | 'failed', meta: Record<string, unknown>, error?: string | null): Promise<void> {
  const now = new Date().toISOString();
  const uniqueTweetIds = [...new Set(tweetIds)].filter(Boolean);
  if (uniqueTweetIds.length === 0) return;
  try {
    const { error: eventError } = await supabase.from('pipeline_events').insert(uniqueTweetIds.map((tweetId) => ({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'worker_dispatch',
      status,
      started_at: now,
      ended_at: status === 'failed' ? now : null,
      error: error ?? null,
      meta,
    })));
    if (eventError) throw eventError;
  } catch (eventError) {
    console.warn(JSON.stringify({
      function: 'webhooks-rssapp',
      action: 'worker_dispatch_event_insert_failed',
      code: 'rss_webhook_worker_dispatch_event_insert_failed',
    }));
  }
}

async function dispatchWorkerAfterWebhook(supabase: RssWebhookSupabaseClient, tweetIds: string[], jobTypes: string[], processedCount: number): Promise<void> {
  const uniqueJobTypes = [...new Set(jobTypes)].filter((type) =>
    ['dedupe', 'translate', 'download_media', 'resolve_media'].includes(type)
  );
  const uniqueTweetIds = [...new Set(tweetIds)].filter(Boolean);
  if (uniqueJobTypes.length === 0 || uniqueTweetIds.length === 0 || processedCount <= 0) return;

  const batchSize = Math.min(20, Math.max(5, processedCount * 3));
  const body = {
    trigger: 'webhook-dispatch',
    job_types: uniqueJobTypes,
    batch_size: batchSize,
    chain_depth: 0,
  };
  const meta = {
    dispatch_source: 'webhook',
    job_types: uniqueJobTypes,
    batch_size: batchSize,
    chain_depth: 0,
    processed_count: processedCount,
    tweet_count: uniqueTweetIds.length,
  };

  await insertWorkerDispatchEvents(supabase, uniqueTweetIds, 'queued', meta);

  const dispatchPromise = Promise.resolve(supabase.functions.invoke('worker', {
    body,
    headers: serviceRoleBearerHeader(),
  } as Record<string, unknown>)).then(({ error }: { error?: { message?: string } | null }) => {
    if (error) {
      return insertWorkerDispatchEvents(
        supabase,
        uniqueTweetIds,
        'failed',
        meta,
        'rss_webhook_worker_invoke_failed',
      );
    }
    return undefined;
  }).catch((_error: unknown) => insertWorkerDispatchEvents(
    supabase,
    uniqueTweetIds,
    'failed',
    meta,
    'rss_webhook_worker_invoke_failed',
  ));

  if (!scheduleBackground(dispatchPromise)) {
    await Promise.race([dispatchPromise, sleep(1500)]);
  }
}

// =============================================================================
// B3b1 (AIR-003): durable webhook receipt lifecycle.
//
// INV-3: HTTP 200 is returned ONLY after (a) the webhook_receipts row is durable and
// (b) every idempotency-keyed materialization/enqueue write for the accepted basis is
// durable. The fire-and-forget worker invoke (waitUntil) and pipeline_events telemetry
// NEVER establish success. A receipt insert/claim failure, an item materialization
// write failure, or a jobs enqueue failure => non-200 (500), never a false 200.
//
// INV-4: bounded-read / HMAC-auth / parse / extract failure, a 401 or 413+ rejection,
// or an empty / validate-only request returns BEFORE any receipt row is reserved.
// =============================================================================

type RssWebhookReceiptClaim = {
  reserved: boolean;
  reason?: string;
  claim_token?: string | null;
  claim_generation?: number | null;
};

async function reserveRssWebhookReceipt(
  supabase: RssReceiptRpcClient,
  receiptKey: string,
  authMode: string,
  feedId: string,
): Promise<RssWebhookReceiptClaim> {
  const { data, error } = await supabase.rpc('reserve_webhook_receipt', {
    p_receipt_key: receiptKey,
    p_auth_mode: authMode,
    p_feed_id: feedId,
  });
  if (error) throw new RssWebhookPersistenceError('rss_webhook_receipt_reserve_failed');
  // A rejected reserve is authoritative; never treat it as a success basis.
  if (!data || typeof data !== 'object') throw new RssWebhookPersistenceError('rss_webhook_receipt_reserve_invalid');
  return (data as { reserved: boolean; reason?: string; claim_token?: string | null; claim_generation?: number | null });
}

async function completeRssWebhookReceipt(
  supabase: RssReceiptRpcClient,
  receiptKey: string,
  claimToken: string | null,
  claimGeneration: number | null,
  itemOutcomes: Record<string, unknown>,
): Promise<void> {
  if (!claimToken || claimGeneration == null) {
    throw new RssWebhookPersistenceError('rss_webhook_receipt_claim_missing');
  }
  const { data, error } = await supabase.rpc('complete_webhook_receipt', {
    p_receipt_key: receiptKey,
    p_claim_token: claimToken,
    p_claim_generation: claimGeneration,
    p_item_outcomes: itemOutcomes,
  });
  if (error) throw new RssWebhookPersistenceError('rss_webhook_receipt_complete_failed');
  if (data !== true) throw new RssWebhookPersistenceError('rss_webhook_receipt_complete_rejected');
}

async function failRssWebhookReceipt(
  supabase: RssReceiptRpcClient,
  receiptKey: string,
  claimToken: string | null,
  claimGeneration: number | null,
  reason: string,
): Promise<void> {
  if (!claimToken || claimGeneration == null) return;
  const { error } = await supabase.rpc('fail_webhook_receipt', {
    p_receipt_key: receiptKey,
    p_claim_token: claimToken,
    p_claim_generation: claimGeneration,
    p_reason: reason,
  });
  if (error) return; // best-effort failure marking; the caller still returns non-200.
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let supabase!: RssWebhookSupabaseClient;
  let receiptKey = '';
  let receiptClaim: RssWebhookReceiptClaim = { reserved: false };
  let receiptReserved = false;

  try {
    // Reject requests with no usable credential before allocating the bounded
    // body. Signed requests are the only path that must read bytes before the
    // final HMAC check; dedicated token requests authenticate first.
    const authMode = readRssWebhookAuthMode(req);
    if (!authMode) return webhookUnauthorizedResponse();
    if (authMode === 'token') {
      const webhookAuthErr = await requireRssWebhookAuth(req, null, corsHeaders);
      if (webhookAuthErr) return webhookAuthErr;
    }

    // A signed RSS.app request must authenticate the exact bytes that the
    // parser later consumes. This one bounded read is reused for both paths.
    let rawBody: string;
    let rawBodyBytes: Uint8Array;
    try {
      const boundedBody = await readBoundedRssWebhookBody(req);
      rawBody = boundedBody.text;
      rawBodyBytes = boundedBody.bytes;
    } catch (error) {
      if (isRssWebhookPayloadError(error)) return webhookPayloadErrorResponse(error);
      throw error;
    }

    if (authMode === 'signed') {
      const webhookAuthErr = await requireRssWebhookAuth(req, null, corsHeaders, {
        rawBody,
        rawBodyBytes,
      });
      if (webhookAuthErr) return webhookAuthErr;
    }

    console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'received' }));
    
    let payload: unknown;
    try {
      payload = parseBoundedRssWebhookJson(rawBody);
    } catch (error) {
      if (isRssWebhookPayloadError(error)) return webhookPayloadErrorResponse(error);
      throw error;
    }

    if (payload === null || payload === undefined) {
      return new Response(JSON.stringify({ error: 'Empty payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payloadIsRecord = Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload);
    console.log(JSON.stringify({
      function: 'webhooks-rssapp',
      action: 'payload_parsed',
      // Payload keys are untrusted input. Keep telemetry structural so neither
      // user content nor a null JSON body can turn this diagnostic into a leak
      // or an unexpected 500 before the explicit empty-payload response.
      shape: payloadIsRecord ? 'object' : payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload,
      key_count: payloadIsRecord ? Object.keys(payload as Record<string, unknown>).length : 0,
    }));
    

    // Parse RSS items from the payload - handle RSS.app webhook structure.
    // The shared boundary has already capped body size, JSON structure, item
    // count, and nested enclosure/media arrays before this persistence path.
    let items: RssWebhookItem[];
    const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    // Alias for the self-test contract, which pins the validate-only declaration to the
    // payload object form. `payloadAny` is always a non-null object, so the self-test's
    // exact `payloadAny.validate_only === true` declaration match is unambiguous.
    const payloadAny = payloadRecord ?? {};
    const validateOnly = payloadAny.validate_only === true;
    try {
      items = extractBoundedRssWebhookItems(payload);
    } catch (error) {
      if (isRssWebhookPayloadError(error)) return webhookPayloadErrorResponse(error);
      throw error;
    }
    
    console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'items_detected', count: items.length }));
    
    if (validateOnly) {
      console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'validate_only', item_count: items.length }));
      return new Response(JSON.stringify({
        success: true,
        validate_only: true,
        message: 'Webhook authentication and payload parsing completed; no post or job was created.',
        items_detected: items.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (items.length === 0) {
      console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'test_notification' }));
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Test notification received',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    ) as unknown as RssWebhookSupabaseClient;

    // INV-1/INV-3: compute the deterministic material receipt key, reserve a durable
    // receipt row, and gate the entire materialization on a checked claim. A rejected
    // reserve (active claim, ambiguous, provider-in-progress) aborts non-success.
    // Outer lets (several with null sentinels) so the catch below can inspect whether a
    // claim was actually minted without hitting a TDZ for a const that never executed.
    let feedId: string;
    try {
      receiptKey = await computeRssWebhookReceiptKey(payloadRecord, items);
      feedId = payloadRecord ? normalizedRssFeedIdentity(payloadRecord) : 'unknown';
      receiptClaim = await reserveRssWebhookReceipt(supabase, receiptKey, authMode, feedId);
    } catch (claimError) {
      if (isRssWebhookPayloadError(claimError)) throw claimError;
      throw new RssWebhookPersistenceError('rss_webhook_receipt_reserve_failed');
    }
    if (!receiptClaim.reserved) {
      const reason = receiptClaim.reason ?? 'claim_conflict';
      if (reason === 'already_completed') {
        // Idempotent replay of an already-durable receipt: re-acknowledge success.
        return new Response(JSON.stringify({
          success: true,
          idempotent_replay: true,
          processed: items.length,
          total: items.length,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.warn(JSON.stringify({
        function: 'webhooks-rssapp',
        action: 'receipt_reserve_rejected',
        reason,
      }));
      throw new RssWebhookPersistenceError(`rss_webhook_receipt_active_${reason}`);
    }
    receiptReserved = true;

    let processedCount = 0;
    let dispatchableCount = 0;
    const dispatchTweetIds = new Set<string>();
    const dispatchJobTypes = new Set<string>();
    const itemOutcomes: Record<string, unknown> = {};
    const duplicateGateEnabled = await isDuplicateGateEnabled(supabase);

    for (const item of items) {
      try {
        console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'processing_item' }));
        
        // A retry must target the same idempotency key. Do not manufacture a
        // timestamp/random key for malformed items because it turns retries
        // into duplicate post creation.
        const tweetId = stableRssWebhookItemId(item);
        if (!tweetId) throw new RssWebhookPayloadError('rss_webhook_item_invalid');
        
        // Extract content from RSS.app webhook structure
        let text = '';
        
        // RSS.app webhook structure: data.items_new[].title and description_text
        if (item.title && typeof item.title === 'string') {
          text = normalizeRssWebhookText(item.title);
        } else if (item.description_text && typeof item.description_text === 'string') {
          text = normalizeRssWebhookText(item.description_text);
        } else if (item.description && typeof item.description === 'string') {
          text = normalizeRssWebhookText(item.description, true);
        } else if (item.content && typeof item.content === 'string') {
          text = normalizeRssWebhookText(item.content, true);
        } else if (item.summary && typeof item.summary === 'string') {
          text = normalizeRssWebhookText(item.summary, true);
        } else {
          text = 'RSS Item - No content available';
        }
        
        // Clean up common patterns in RSS content
        if (text) {
          // Remove Twitter attribution at the end (— @username date)
          text = text.replace(/—\s*@\w+.*?(\d{4})?\s*$/, '').trim();
          // Remove excessive whitespace
          text = normalizeRssWebhookText(text);
        }
        
        const rawUrl = item.link ?? item.url;
        const url = typeof rawUrl === 'string' ? rawUrl : '';
        
        // Extract author handle from tweet URL
        const authorHandle = extractAuthorFromUrl(url);
        
        const rawPublishedAt = item.pubDate ?? item.published ?? item.date;
        const publishedAt = typeof rawPublishedAt === 'string' || typeof rawPublishedAt === 'number'
          ? new Date(rawPublishedAt)
          : new Date();

        console.log(JSON.stringify({
          function: 'webhooks-rssapp',
          action: 'item_extracted',
          tweet_id_hash: await hashUrl(String(tweetId)),
          text_length: text.length,
          has_url: Boolean(url),
          author_known: Boolean(authorHandle),
        }));

        const { data: existingPost, error: existingPostError } = await supabase
          .from('posts')
          .select('tweet_id')
          .eq('tweet_id', tweetId)
          .maybeSingle();
        assertWebhookDatabaseSuccess(
          existingPostError,
          'rss_webhook_existing_post_read_failed',
        );
        if (isRecord(existingPost) && existingPost.tweet_id) {
          console.log(JSON.stringify({
            function: 'webhooks-rssapp',
            action: 'exact_tweet_replayed',
            tweet_id_hash: await hashUrl(String(tweetId)),
          }));
        }

        // Parse media from RSS item
        const mediaItems = parseBoundedRssItemMedia(item, text);
        console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'media_detected', count: mediaItems.length }));

        // Detect a likely video attachment that RSS cannot deliver directly.
        // Triggers a `resolve_media` job that uses the public fxtwitter/vxtwitter
        // proxy (zero X API quota) to fetch the real MP4 URL.
        const hasVideoSignal = detectVideoSignal(item, text, mediaItems);
        const prefilteredMediaItems = filterSendableIngestMedia(mediaItems, hasVideoSignal);
        const {
          accepted: sendableMediaItems,
          rejected: rejectedMediaItems,
        } = filterReviewedRemoteMediaItems(prefilteredMediaItems);
        if (rejectedMediaItems > 0) {
          console.warn(JSON.stringify({
            function: 'webhooks-rssapp',
            action: 'media_url_rejected_by_policy',
            rejected_count: rejectedMediaItems,
          }));
        }
        if (hasVideoSignal && sendableMediaItems.length !== mediaItems.length) {
          console.log(JSON.stringify({
            function: 'webhooks-rssapp',
            action: 'video_thumbnail_suppressed',
            original_media_count: mediaItems.length,
            sendable_media_count: sendableMediaItems.length,
          }));
        }

        // Find or create a default account first
        let accountId = null;
        
        const { data: accounts, error: accountsError } = await supabase
          .from('accounts')
          .select('*')
          .eq('enabled', true)
          .limit(1);
        assertWebhookDatabaseSuccess(accountsError, 'rss_webhook_account_lookup_failed');

        const accountRows = Array.isArray(accounts) ? accounts.filter(isRecord) : [];
        if (accountRows.length > 0 && typeof accountRows[0].id === 'string') {
          accountId = accountRows[0].id;
            console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'account_found' }));
        } else {
          // Create a default account
          const { data: newAccount, error: accountError } = await supabase
            .from('accounts')
            .insert({
              handle: 'news-channel',
              display_name: 'News Channel'
            })
            .select()
            .single();

          if (accountError) {
            throw new RssWebhookPersistenceError('rss_webhook_account_create_failed');
          }

          if (isRecord(newAccount) && typeof newAccount.id === 'string') {
            accountId = newAccount.id;
            console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'account_created' }));
          }
        }

        if (!accountId) {
          throw new RssWebhookPersistenceError('rss_webhook_account_missing');
        }

        // Detect truncation BEFORE upsert so we can persist the flag.
        // NOTE: We no longer hydrate here. Hydration is deferred to the worker
        // and only triggered AFTER scoring, for tweets that pass the editorial
        // threshold. This avoids spending X API reads on tweets that get filtered out.
        const isTruncated = detectTruncation(text);

        // Upsert post to database
        const { error: postError } = await supabase
          .from('posts')
          .upsert({
            tweet_id: tweetId,
            account_id: accountId,
            text_original: text,
            lang_original: 'auto',
            url: url,
            tweeted_at: publishedAt,
            has_media: sendableMediaItems.length > 0 || hasVideoSignal,
            author_handle: authorHandle,
            is_truncated: isTruncated,
          }, {
            onConflict: 'tweet_id'
          })
          .select()
          .single();

        if (postError) {
          throw new RssWebhookPersistenceError('rss_webhook_post_upsert_failed');
        }

        console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'post_upserted', truncated: isTruncated }));

        // Insert media items
        if (sendableMediaItems.length > 0) {
          const mediaRows = await Promise.all(
            sendableMediaItems.map(async (media, index) => ({
              tweet_id: tweetId,
              kind: media.type,
              src_url: media.url,
              src_url_hash: await hashUrl(media.url),
              width: media.width,
              height: media.height,
              duration_ms: media.duration,
              ordering: index
            }))
          );
          const { error: mediaError } = await supabase
            .from('media')
            .upsert(mediaRows, { onConflict: 'tweet_id,ordering' });

          if (mediaError) {
            throw new RssWebhookPersistenceError('rss_webhook_media_upsert_failed');
          }
          console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'media_inserted', count: sendableMediaItems.length }));
        }

        // Enqueue duplicate detection first when enabled. The worker only
        // advances unique/related items to translation and filtering.
        const entryJobType = await enqueueContentPipelineEntry(supabase, tweetId, isTruncated, duplicateGateEnabled);
        dispatchJobTypes.add(entryJobType);
        dispatchTweetIds.add(tweetId);
        dispatchableCount++;

        // Create media download job for tweets with media
        if (sendableMediaItems.length > 0) {
          const { error: downloadJobError } = await supabase
            .from('jobs')
            .upsert({
              type: 'download_media',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 12,
              idempotency_key: `download_media:${tweetId}`,
              next_run_at: new Date().toISOString()
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (downloadJobError) {
            throw new RssWebhookPersistenceError('rss_webhook_download_job_upsert_failed');
          }
          console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'media_download_job_created' }));
          dispatchJobTypes.add('download_media');
          dispatchTweetIds.add(tweetId);
          const { error: mediaEventError } = await supabase
            .from('pipeline_events')
            .insert({
              subject_type: 'post',
              subject_id: tweetId,
              step: 'media',
              status: 'queued',
              started_at: new Date().toISOString(),
              meta: { source: 'webhook', sendable_media_count: sendableMediaItems.length }
            });
          assertWebhookDatabaseSuccess(
            mediaEventError,
            'rss_webhook_media_pipeline_event_failed',
          );
        }

        // Enqueue resolve_media when a video is suspected. The job uses the
        // public fxtwitter/vxtwitter proxy (no X API quota) to discover the
        // real MP4 URL, then triggers the normal download_media flow.
        if (hasVideoSignal) {
          const { error: resolveJobError } = await supabase
            .from('jobs')
            .upsert({
              type: 'resolve_media',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 12,
              idempotency_key: `resolve_media:${tweetId}`,
              next_run_at: new Date().toISOString()
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (resolveJobError) {
            throw new RssWebhookPersistenceError('rss_webhook_resolve_job_upsert_failed');
          }
          console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'resolve_media_job_created' }));
          dispatchJobTypes.add('resolve_media');
          dispatchTweetIds.add(tweetId);
          const { error: resolveEventError } = await supabase
            .from('pipeline_events')
            .insert({
              subject_type: 'post', subject_id: tweetId,
              step: 'resolve_media', status: 'queued',
              started_at: new Date().toISOString(),
              meta: { source: 'webhook' }
            });
          assertWebhookDatabaseSuccess(
            resolveEventError,
            'rss_webhook_resolve_pipeline_event_failed',
          );
        }
        // Record the successful, durable materialization/enqueue for this stable item
        // so the terminal receipt records exactly which jobs were confirmed durable.
        // auth_mode/timestamps never enter this outcome, only per-item job identity.
        const itemJobs: string[] = [];
        itemJobs.push(entryJobType);
        if (sendableMediaItems.length > 0) itemJobs.push('download_media');
        if (hasVideoSignal) itemJobs.push('resolve_media');
        itemOutcomes[String(tweetId)] = { status: 'queued', jobs: [...new Set(itemJobs)].sort() };

        processedCount++;

      } catch (itemError) {
        if (isRssWebhookPayloadError(itemError)) throw itemError;
        const persistenceError = itemError instanceof RssWebhookPersistenceError
          ? itemError
          : new RssWebhookPersistenceError('rss_webhook_item_processing_failed');
        console.error(JSON.stringify({
          function: 'webhooks-rssapp',
          action: 'item_persistence_failed',
          code: persistenceError.code,
        }));
        captureEdgeExceptionBackground(new Error(persistenceError.code), {
          functionName: "webhooks-rssapp",
          action: "item_error",
          request: req,
        });
        throw persistenceError;
      }
    }

    console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'processed', processed_count: processedCount, item_count: items.length }));
    await dispatchWorkerAfterWebhook(supabase, [...dispatchTweetIds], [...dispatchJobTypes], dispatchableCount);

    // INV-3: only after every idempotency-keyed materialization/enqueue write is
    // durable do we persist the terminal 'completed' receipt and return 200. The
    // waitUntil worker invoke and pipeline_events telemetry are never the basis.
    await completeRssWebhookReceipt(supabase, receiptKey, receiptClaim.claim_token ?? null, receiptClaim.claim_generation ?? null, itemOutcomes);

    return new Response(JSON.stringify({
      success: true,
      receipt_key: receiptKey,
      processed: processedCount,
      total: items.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // INV-2: best-effort durable failure marking (a claimed receipt becomes 'failed'
    // or 'ambiguous'); the request still returns non-200. A TDZ-safe sentinel ensures
    // the catch never inspects a claim that was never minted.
    if (receiptReserved && typeof receiptClaim === 'object' && receiptClaim?.reserved === true) {
      try {
        await failRssWebhookReceipt(
          supabase,
          receiptKey,
          receiptClaim.claim_token ?? null,
          receiptClaim.claim_generation ?? null,
          error instanceof RssWebhookPersistenceError ? error.code : 'rss_webhook_receipt_processing_failed',
        );
      } catch {
        // Failure-marking must not mask the original non-200 outcome.
      }
    }
    if (isRssWebhookPayloadError(error)) return webhookPayloadErrorResponse(error);
    const code = error instanceof RssWebhookPersistenceError
      ? error.code
      : 'rss_webhook_processing_failed';
    console.error(JSON.stringify({
      function: 'webhooks-rssapp',
      action: 'fatal',
      code,
    }));
    try {
      await captureEdgeException(new Error(code), {
        functionName: "webhooks-rssapp",
        action: "fatal",
        request: req,
      });
    } catch {
      // Telemetry must not turn a truthful persistence failure into a hung request.
    }
    return new Response(JSON.stringify({ error: 'Internal server error', code }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function extractAuthorFromUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/]+)/i);
  if (match && match[1]) {
    const handle = match[1].toLowerCase();
    // Skip non-author paths
    if (['i', 'search', 'explore', 'home', 'settings', 'messages'].includes(handle)) return null;
    return handle;
  }
  return null;
}

// Heuristic detector: returns true when an RSS item looks like it carries a
// native X video/GIF that the RSS feed can't expose directly. Used to trigger
// the resolve_media job which fetches the real MP4 via the public proxy.
function detectVideoSignal(
  item: RssWebhookItem,
  text: string | undefined,
  mediaItems: Array<{ type: string; url: string }>,
): boolean {
  if (mediaItems.some((m) => m.type === 'video')) return true;

  const haystacks: string[] = [];
  if (text) haystacks.push(text);
  if (item?.description_html) haystacks.push(String(item.description_html));
  if (item?.description) haystacks.push(String(item.description));
  if (item?.content) haystacks.push(String(item.content));
  if (item?.thumbnail) haystacks.push(String(item.thumbnail));
  for (const m of mediaItems) haystacks.push(m.url);

  const blob = haystacks.join(' ');
  if (/video\.twimg\.com/i.test(blob)) return true;
  if (/(tweet_video_thumb|amplify_video_thumb|ext_tw_video_thumb)/i.test(blob)) return true;
  // pic.twitter.com short links accompany native videos when no image media row exists
  if (/pic\.twitter\.com\//i.test(blob) && !mediaItems.some((m) => m.type === 'image' && /pbs\.twimg\.com/.test(m.url))) {
    return true;
  }
  return false;
}

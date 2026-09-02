import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireInternalAuth } from "../_shared/internalAuth.ts";
import {
  type MediaDownloadEventMeta,
  safeMediaDownloadErrorCode,
  safeMediaDownloadEventMeta,
  safeMediaUrlHash,
  safeMediaUrlTelemetry,
} from "../_shared/safeMediaTelemetry.ts";
import {
  fetchReviewedRemoteMedia,
  MAX_REMOTE_MEDIA_ITEMS_PER_POST,
  validateReviewedRemoteMediaUrl,
} from "../_shared/remoteMediaPolicy.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";
import { createMediaProcessorHandler } from "./handler.ts";
import { cleanupOldMedia } from "./cleanupOldMedia.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};
initSentryEdge();

type MediaProcessorQueryResult = {
  data?: unknown;
  error?: { message?: string } | null;
};

type MediaProcessorQueryBuilder = PromiseLike<MediaProcessorQueryResult> & {
  select(columns: string): MediaProcessorQueryBuilder;
  eq(column: string, value: unknown): MediaProcessorQueryBuilder;
  is(column: string, value: unknown): MediaProcessorQueryBuilder;
  order(column: string, options?: Record<string, unknown>): MediaProcessorQueryBuilder;
  limit(value: number): MediaProcessorQueryBuilder;
  in(column: string, values: unknown[]): MediaProcessorQueryBuilder;
  not(column: string, operator: string, value: unknown): MediaProcessorQueryBuilder;
  update(values: Record<string, unknown>): MediaProcessorQueryBuilder;
  insert(values: Record<string, unknown>): PromiseLike<MediaProcessorQueryResult>;
  maybeSingle(): PromiseLike<MediaProcessorQueryResult>;
};

type MediaProcessorStorageBucket = {
  upload(path: string, body: Uint8Array, options?: Record<string, unknown>): PromiseLike<MediaProcessorQueryResult>;
  remove(paths: string[]): PromiseLike<MediaProcessorQueryResult>;
};

type MediaProcessorSupabaseClient = {
  from(table: string): MediaProcessorQueryBuilder;
  storage: {
    from(bucket: string): MediaProcessorStorageBucket;
  };
};

type MediaCleanupSupabaseClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error?: unknown }>;
    };
  };
  from(table: string): {
    update(values: Record<string, unknown>): {
      in(column: string, values: string[]): PromiseLike<unknown>;
    };
  };
};

function isMediaCleanupSupabaseClient(
  value: unknown,
): value is MediaCleanupSupabaseClient {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    rpc?: unknown;
    storage?: unknown;
    from?: unknown;
  };
  const storage = candidate.storage;
  const storageFrom = storage && typeof storage === "object"
    ? (storage as { from?: unknown }).from
    : undefined;
  if (
    typeof candidate.rpc !== "function" ||
    typeof candidate.from !== "function" ||
    typeof storageFrom !== "function"
  ) {
    return false;
  }
  return true;
}

function requireMediaCleanupSupabaseClient(
  value: unknown,
): MediaCleanupSupabaseClient {
  if (!isMediaCleanupSupabaseClient(value)) {
    throw new Error("media_cleanup_client_invalid");
  }
  return value;
}

const handler = createMediaProcessorHandler({
  corsHeaders,
  createSupabase: () => createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  ),
  requireInternalAuth,
  getEnv: (name) => Deno.env.get(name),
  downloadMediaForTweet,
  cleanupOldMedia: (supabase, dryRun, daysOld) =>
    cleanupOldMedia(
      requireMediaCleanupSupabaseClient(supabase),
      dryRun,
      daysOld,
      corsHeaders,
    ),
  getMediaInfo,
  captureException: captureEdgeException,
});

serve(handler);

async function downloadMediaForTweet(supabase: MediaProcessorSupabaseClient, tweetId: string, dryRun: boolean) {
  console.log(JSON.stringify({ function: 'media-processor', action: 'download_start', tweet_id: tweetId, dry_run: dryRun }));
  
  const { data: mediaItems, error: mediaError } = await supabase
    .from('media')
    .select('id, tweet_id, src_url, ordering, storage_path, src_url_hash')
    .eq('tweet_id', tweetId)
    .is('storage_path', null)
    .order('ordering', { ascending: true })
    .limit(MAX_REMOTE_MEDIA_ITEMS_PER_POST + 1);

  if (mediaError) throw new Error('media_query_failed');
  if (!Array.isArray(mediaItems)) throw new Error('media_query_invalid_response');

  const candidateMediaItems = mediaItems as Array<Record<string, unknown>>;
  const boundedMediaItems = candidateMediaItems.slice(0, MAX_REMOTE_MEDIA_ITEMS_PER_POST);
  const overLimitMediaItems = candidateMediaItems.slice(MAX_REMOTE_MEDIA_ITEMS_PER_POST);

  if (boundedMediaItems.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No media to download', downloaded: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({
      success: true,
      dry_run: true,
      would_download: boundedMediaItems.length,
      skipped_over_limit: overLimitMediaItems.length,
      media_ids: boundedMediaItems.map((media) => media.id),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let downloadedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const startedAt = Date.now();
  const hashes = [...new Set(boundedMediaItems
    .map((media) => typeof media.src_url_hash === 'string' ? media.src_url_hash : null)
    .filter(Boolean) as string[])];
  const existingByHash = new Map<string, string>();
  if (hashes.length > 0) {
    const { data: existingRows, error: existingRowsError } = await supabase
      .from('media')
      .select('src_url_hash, storage_path')
      .in('src_url_hash', hashes)
      .not('storage_path', 'is', null);
    if (existingRowsError) throw new Error('media_reuse_lookup_failed');
    if (!Array.isArray(existingRows)) throw new Error('media_reuse_lookup_invalid_response');
    for (const row of existingRows as Array<Record<string, unknown>>) {
      const hash = typeof row.src_url_hash === 'string' ? row.src_url_hash : null;
      const storagePath = typeof row.storage_path === 'string' ? row.storage_path : null;
      if (hash && storagePath && !existingByHash.has(hash)) existingByHash.set(hash, storagePath);
    }
  }

  for (const media of overLimitMediaItems) {
    failedCount++;
    await insertMediaDownloadEvent(supabase, media, 'failed', 'media_item_limit_exceeded', {
      media_download_ms: 0,
    });
  }

  await mapLimit(boundedMediaItems, 3, async (media) => {
    const itemStartedAt = Date.now();
    try {
      if (typeof media.src_url !== 'string' || media.src_url.includes('pic.twitter.com')) {
        failedCount++;
        await insertMediaDownloadEvent(supabase, media, 'failed', 'unsupported_or_placeholder_url', {
          media_download_ms: Date.now() - itemStartedAt,
        });
        return;
      }

      const sourceUrl = validateReviewedRemoteMediaUrl(media.src_url);
      const reusableStoragePath = typeof media.src_url_hash === 'string' ? existingByHash.get(media.src_url_hash) : null;
      if (reusableStoragePath) {
        const updated = await guardedMediaUpdate(supabase, media, {
          storage_path: reusableStoragePath,
          downloaded_at: new Date().toISOString(),
        });
        if (updated) {
          reusedCount++;
          await insertMediaDownloadEvent(supabase, media, 'completed', null, {
            reused: true,
            storage_path: reusableStoragePath,
            media_download_ms: Date.now() - itemStartedAt,
          });
        }
        return;
      }

      const remoteMedia = await fetchReviewedRemoteMedia(sourceUrl);
      const contentType = remoteMedia.contentType;
      const fileExtension = getFileExtension(contentType);
      const safeTweetId = String(media.tweet_id ?? 'media')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .slice(0, 128) || 'media';
      const ordering = typeof media.ordering === 'number' && Number.isFinite(media.ordering)
        ? Math.max(0, Math.floor(media.ordering))
        : 0;
      const fileName = `${safeTweetId}_${ordering}_${crypto.randomUUID()}${fileExtension}`;
      const storagePath = `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${fileName}`;

      const fileBuffer = remoteMedia.body;
      const fileSize = fileBuffer.byteLength;

      const { error: uploadError } = await supabase.storage
        .from('temp-media')
        .upload(storagePath, fileBuffer, { contentType, upsert: false });

      if (uploadError) throw new Error('media_upload_failed');

      const updated = await guardedMediaUpdate(supabase, media, {
        storage_path: storagePath, downloaded_at: new Date().toISOString(),
        file_size: fileSize, mime_type: contentType
      });

      if (updated) {
        downloadedCount++;
        await insertMediaDownloadEvent(supabase, media, 'completed', null, {
          reused: false,
          storage_path: storagePath,
          file_size: fileSize,
          mime_type: contentType,
          media_download_ms: Date.now() - itemStartedAt,
        });
      } else {
        await supabase.storage.from('temp-media').remove([storagePath]);
      }
    } catch (error) {
      const errorCode = safeMediaDownloadErrorCode(error);
      console.error(JSON.stringify({
        function: 'media-processor',
        action: 'download_fail',
        media_id: media.id,
        error_code: errorCode,
        ...safeMediaUrlTelemetry(media.src_url, media.src_url_hash),
      }));
      // Surface to pipeline_events so monitoring can see media download failures.
      await insertMediaDownloadEvent(supabase, media, 'failed', errorCode, {
        media_download_ms: Date.now() - itemStartedAt,
      });
      failedCount++;
    }
  });

  const downloadMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    function: 'media-processor',
    action: 'download_complete',
    downloaded: downloadedCount,
    reused: reusedCount,
    failed: failedCount,
    skipped_over_limit: overLimitMediaItems.length,
    download_ms: downloadMs,
  }));

  return new Response(JSON.stringify({
    success: true,
    downloaded: downloadedCount,
    reused: reusedCount,
    failed: failedCount,
    skipped_over_limit: overLimitMediaItems.length,
    total: candidateMediaItems.length,
    media_items_total: candidateMediaItems.length,
    media_downloaded: downloadedCount,
    media_reused: reusedCount,
    media_failed: failedCount,
    media_download_ms: downloadMs,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

async function insertMediaDownloadEvent(
  supabase: MediaProcessorSupabaseClient,
  media: Record<string, unknown>,
  status: 'completed' | 'failed',
  error: string | null,
  meta: MediaDownloadEventMeta,
): Promise<void> {
  try {
    const { error: pipelineEventError } = await supabase.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: media.tweet_id,
      step: 'download_media',
      status,
      error,
      meta: safeMediaDownloadEventMeta(
        meta,
        media.id,
        media.src_url,
        media.src_url_hash,
      ),
    });
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: 'media-processor',
        action: 'pipeline_event_insert_failed',
        error: 'media_pipeline_event_insert_failed',
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: 'media-processor',
      action: 'pipeline_event_insert_failed',
      error: 'media_pipeline_event_insert_failed',
    }));
  }
}

async function markStaleMediaDownloadIgnored(
  supabase: MediaProcessorSupabaseClient,
  media: Record<string, unknown>,
  expectedSrcUrlHash: unknown = null,
): Promise<void> {
  await insertMediaDownloadEvent(supabase, media, 'completed', null, {
    event: 'stale_media_download_ignored',
    expected_src_url_hash: safeMediaUrlHash(expectedSrcUrlHash),
  });
}

async function guardedMediaUpdate(
  supabase: MediaProcessorSupabaseClient,
  media: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<boolean> {
  let query = supabase
    .from('media')
    .update(values)
    .eq('id', media.id)
    .is('storage_path', null);

  const hash = typeof media.src_url_hash === 'string' && media.src_url_hash.length > 0
    ? media.src_url_hash
    : null;
  query = hash ? query.eq('src_url_hash', hash) : query.is('src_url_hash', null);

  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw new Error('media_row_update_failed');
  if (!data) {
    await markStaleMediaDownloadIgnored(supabase, media, hash);
    return false;
  }
  return true;
}

async function getMediaInfo(supabase: MediaProcessorSupabaseClient, mediaIds: string[]) {
  const { data: mediaInfo, error } = await supabase.from('media').select('*').in('id', mediaIds);
  if (error) throw new Error('media_info_read_failed');
  return new Response(JSON.stringify({ success: true, media: mediaInfo }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getFileExtension(contentType: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return typeMap[contentType] ?? '.bin';
}

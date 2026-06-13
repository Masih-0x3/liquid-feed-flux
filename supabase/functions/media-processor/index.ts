import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireInternalAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const authError = await requireInternalAuth(req, supabase, corsHeaders);
  if (authError) return authError;

  try {

    const body = await req.json().catch(() => ({}));
    const { action, tweet_id, media_ids, dry_run } = body;
    
    if (!action || typeof action !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid action parameter' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(JSON.stringify({ function: 'media-processor', action }));

    switch (action) {
      case 'download_media':
        if (!tweet_id || typeof tweet_id !== 'string') {
          return new Response(JSON.stringify({ error: 'tweet_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return await downloadMediaForTweet(supabase, tweet_id, dry_run === true);
      case 'cleanup_old_media': {
        const daysOld = typeof (body as Record<string, unknown>).days_old === 'number'
          ? Math.max(1, Math.min(365, Math.floor((body as Record<string, number>).days_old)))
          : 1;
        return await cleanupOldMedia(supabase, dry_run === true, daysOld);
      }
      case 'get_media_info':
        if (!media_ids || !Array.isArray(media_ids)) {
          return new Response(JSON.stringify({ error: 'media_ids array is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return await getMediaInfo(supabase, media_ids);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error(JSON.stringify({ function: 'media-processor', action: 'error', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function downloadMediaForTweet(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string, dryRun: boolean) {
  console.log(JSON.stringify({ function: 'media-processor', action: 'download_start', tweet_id: tweetId, dry_run: dryRun }));
  
  const { data: mediaItems, error: mediaError } = await supabase
    .from('media')
    .select('id, tweet_id, src_url, ordering, storage_path, src_url_hash')
    .eq('tweet_id', tweetId)
    .is('storage_path', null);

  if (mediaError) throw new Error(`Failed to fetch media: ${mediaError.message}`);

  if (!mediaItems || mediaItems.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No media to download', downloaded: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dry_run: true, would_download: mediaItems.length, media_ids: mediaItems.map((m: Record<string, unknown>) => m.id) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let downloadedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const startedAt = Date.now();
  const hashes = [...new Set((mediaItems as Array<Record<string, unknown>>)
    .map((media) => typeof media.src_url_hash === 'string' ? media.src_url_hash : null)
    .filter(Boolean) as string[])];
  const existingByHash = new Map<string, string>();
  if (hashes.length > 0) {
    const { data: existingRows } = await supabase
      .from('media')
      .select('src_url_hash, storage_path')
      .in('src_url_hash', hashes)
      .not('storage_path', 'is', null);
    for (const row of (existingRows ?? []) as Array<Record<string, unknown>>) {
      const hash = typeof row.src_url_hash === 'string' ? row.src_url_hash : null;
      const storagePath = typeof row.storage_path === 'string' ? row.storage_path : null;
      if (hash && storagePath && !existingByHash.has(hash)) existingByHash.set(hash, storagePath);
    }
  }

  await mapLimit(mediaItems as any[], 3, async (media) => {
    const itemStartedAt = Date.now();
    try {
      if (!media.src_url || media.src_url.includes('pic.twitter.com')) {
        failedCount++;
        await insertMediaDownloadEvent(supabase, media, 'failed', 'unsupported_or_placeholder_url', {
          media_download_ms: Date.now() - itemStartedAt,
        });
        return;
      }

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
      
      const response = await fetch(media.src_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const rawContentType = response.headers.get('content-type') || '';
      const contentType = normalizeMime(rawContentType, media.src_url);
      const fileExtension = getFileExtension(contentType, media.src_url);
      const fileName = `${media.tweet_id.replace(/[^a-zA-Z0-9]/g, '_')}_${media.ordering}${fileExtension}`;
      const storagePath = `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${fileName}`;

      const fileBuffer = await response.arrayBuffer();
      const fileSize = fileBuffer.byteLength;

      const { error: uploadError } = await supabase.storage
        .from('temp-media')
        .upload(storagePath, fileBuffer, { contentType, upsert: false });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

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
      console.error(JSON.stringify({ function: 'media-processor', action: 'download_fail', src_url: media.src_url, error: (error as Error).message }));
      // Surface to pipeline_events so monitoring can see media download failures.
      await insertMediaDownloadEvent(supabase, media, 'failed', (error as Error).message, {
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
    download_ms: downloadMs,
  }));

  return new Response(JSON.stringify({
    success: true,
    downloaded: downloadedCount,
    reused: reusedCount,
    failed: failedCount,
    total: mediaItems.length,
    media_items_total: mediaItems.length,
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

async function insertMediaDownloadEvent(// deno-lint-ignore no-explicit-any
  supabase: any,
  media: Record<string, unknown>,
  status: 'completed' | 'failed',
  error: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: media.tweet_id,
      step: 'download_media',
      status,
      error,
      meta: { src_url: media.src_url, media_id: media.id, ...meta },
    });
  } catch (_e) { /* best-effort */ }
}

async function markStaleMediaDownloadIgnored(// deno-lint-ignore no-explicit-any
  supabase: any,
  media: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await insertMediaDownloadEvent(supabase, media, 'completed', null, {
    event: 'stale_media_download_ignored',
    ...extra,
  });
}

async function guardedMediaUpdate(// deno-lint-ignore no-explicit-any
  supabase: any,
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
  if (error) throw new Error(`Media row update failed: ${error.message}`);
  if (!data) {
    await markStaleMediaDownloadIgnored(supabase, media, { expected_src_url_hash: hash });
    return false;
  }
  return true;
}

async function cleanupOldMedia(// deno-lint-ignore no-explicit-any
supabase: any, dryRun: boolean, daysOld = 1) {
  console.log(JSON.stringify({ function: 'media-processor', action: 'cleanup_start', dry_run: dryRun, days_old: daysOld }));

  const { data: oldMedia, error: queryError } = await supabase.rpc('get_old_media', { days_old: daysOld });
  const oldMediaArr: any[] = (oldMedia as any[]) ?? [];

  if (queryError) throw new Error(`Failed to query old media: ${queryError.message}`);

  const { data: expiredRenders, error: renderQueryError } = await supabase.rpc('get_expired_video_render_paths', { limit_count: 200 });
  if (renderQueryError) throw new Error(`Failed to query expired video renders: ${renderQueryError.message}`);
  const expiredRenderArr: any[] = (expiredRenders as any[]) ?? [];

  if ((!oldMediaArr || oldMediaArr.length === 0) && expiredRenderArr.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No old media to cleanup', deleted: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({
      success: true,
      dry_run: true,
      would_delete: oldMediaArr.length + expiredRenderArr.length,
      would_delete_original_media: oldMediaArr.length,
      would_delete_processed_video_renders: expiredRenderArr.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const BATCH_SIZE = 100;
  let deletedCount = 0;
  let deletedProcessedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < oldMediaArr.length; i += BATCH_SIZE) {
    const batch = oldMediaArr.slice(i, i + BATCH_SIZE);
    const paths = batch.map((m: Record<string, unknown>) => m.storage_path as string).filter(Boolean);
    
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from('temp-media').remove(paths);
      if (storageError) { failedCount += paths.length; } else { deletedCount += paths.length; }
    }

    const ids = batch.map((m: Record<string, unknown>) => m.id as string);
    await supabase.from('media').update({
      storage_path: null, downloaded_at: null, file_size: null, mime_type: null
    }).in('id', ids);
  }

  for (let i = 0; i < expiredRenderArr.length; i += BATCH_SIZE) {
    const batch = expiredRenderArr.slice(i, i + BATCH_SIZE);
    const paths = batch.map((m: Record<string, unknown>) => m.output_storage_path as string).filter(Boolean);
    const ids = batch.map((m: Record<string, unknown>) => m.id as string).filter(Boolean);

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from('temp-media').remove(paths);
      if (storageError) {
        failedCount += paths.length;
        continue;
      }
      deletedProcessedCount += paths.length;
    }
    if (ids.length > 0) {
      await supabase.rpc('mark_video_renders_expired', { render_ids: ids });
    }
  }

  console.log(JSON.stringify({
    function: 'media-processor',
    action: 'cleanup_complete',
    deleted: deletedCount,
    deleted_processed: deletedProcessedCount,
    failed: failedCount,
  }));

  return new Response(JSON.stringify({
    success: true,
    deleted: deletedCount + deletedProcessedCount,
    deleted_original_media: deletedCount,
    deleted_processed_video_renders: deletedProcessedCount,
    failed: failedCount,
    total: oldMediaArr.length + expiredRenderArr.length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getMediaInfo(// deno-lint-ignore no-explicit-any
supabase: any, mediaIds: string[]) {
  const { data: mediaInfo, error } = await supabase.from('media').select('*').in('id', mediaIds);
  if (error) throw new Error(`Failed to fetch media info: ${error.message}`);
  return new Response(JSON.stringify({ success: true, media: mediaInfo }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getFileExtension(contentType: string, url: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'video/mp4': '.mp4', 'video/webm': '.webm',
    'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg'
  };
  if (typeMap[contentType]) return typeMap[contentType];
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (urlMatch) return '.' + urlMatch[1].toLowerCase();
  if (contentType.startsWith('image/')) return '.jpg';
  if (contentType.startsWith('video/')) return '.mp4';
  if (contentType.startsWith('audio/')) return '.mp3';
  return '.bin';
}

// Normalize Content-Type. Some CDNs return application/octet-stream or empty
// values for video/image bytes. Without normalization, x-poster's tier
// selection would not see "video/" prefix and would post text-only.
function normalizeMime(rawCT: string, url: string): string {
  const ct = (rawCT || '').toLowerCase().split(';')[0].trim();
  const isUseful = ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/');
  if (isUseful) return ct;
  const m = (url || '').toLowerCase().match(/\.([a-z0-9]+)(\?|#|$)/);
  const ext = m ? m[1] : '';
  const extMap: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', mkv: 'video/x-matroska',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  };
  return extMap[ext] || ct || 'application/octet-stream';
}

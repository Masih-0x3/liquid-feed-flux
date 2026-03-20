import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authError = validateInternalToken(req);
  if (authError) return authError;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
      case 'cleanup_old_media':
        return await cleanupOldMedia(supabase, dry_run === true);
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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function downloadMediaForTweet(supabase: ReturnType<typeof createClient>, tweetId: string) {
  console.log(JSON.stringify({ function: 'media-processor', action: 'download_start', tweet_id: tweetId }));
  
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

  let downloadedCount = 0;
  let failedCount = 0;

  for (const media of mediaItems) {
    try {
      if (!media.src_url || media.src_url.includes('pic.twitter.com')) {
        failedCount++;
        continue;
      }

      // Dedup by src_url_hash: check if another media with same hash already has storage_path
      if (media.src_url_hash) {
        const { data: existing } = await supabase
          .from('media')
          .select('storage_path')
          .eq('src_url_hash', media.src_url_hash)
          .not('storage_path', 'is', null)
          .limit(1);
        if (existing && existing.length > 0) {
          // Reuse existing storage path
          await supabase.from('media').update({
            storage_path: existing[0].storage_path,
            downloaded_at: new Date().toISOString(),
          }).eq('id', media.id);
          downloadedCount++;
          continue;
        }
      }
      
      const response = await fetch(media.src_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const fileExtension = getFileExtension(contentType, media.src_url);
      const fileName = `${media.tweet_id.replace(/[^a-zA-Z0-9]/g, '_')}_${media.ordering}${fileExtension}`;
      const storagePath = `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${fileName}`;

      const fileBuffer = await response.arrayBuffer();
      const fileSize = fileBuffer.byteLength;

      const { error: uploadError } = await supabase.storage
        .from('temp-media')
        .upload(storagePath, fileBuffer, { contentType, upsert: false });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      await supabase.from('media').update({
        storage_path: storagePath, downloaded_at: new Date().toISOString(),
        file_size: fileSize, mime_type: contentType
      }).eq('id', media.id);

      downloadedCount++;
    } catch (error) {
      console.error(JSON.stringify({ function: 'media-processor', action: 'download_fail', src_url: media.src_url, error: (error as Error).message }));
      failedCount++;
    }
  }

  console.log(JSON.stringify({ function: 'media-processor', action: 'download_complete', downloaded: downloadedCount, failed: failedCount }));

  return new Response(JSON.stringify({ success: true, downloaded: downloadedCount, failed: failedCount, total: mediaItems.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function cleanupOldMedia(supabase: ReturnType<typeof createClient>, dryRun: boolean) {
  console.log(JSON.stringify({ function: 'media-processor', action: 'cleanup_start', dry_run: dryRun }));

  const { data: oldMedia, error: queryError } = await supabase.rpc('get_old_media', { days_old: 7 });

  if (queryError) throw new Error(`Failed to query old media: ${queryError.message}`);

  if (!oldMedia || oldMedia.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No old media to cleanup', deleted: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dry_run: true, would_delete: oldMedia.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const BATCH_SIZE = 100;
  let deletedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < oldMedia.length; i += BATCH_SIZE) {
    const batch = oldMedia.slice(i, i + BATCH_SIZE);
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

  console.log(JSON.stringify({ function: 'media-processor', action: 'cleanup_complete', deleted: deletedCount, failed: failedCount }));

  return new Response(JSON.stringify({ success: true, deleted: deletedCount, failed: failedCount, total: oldMedia.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getMediaInfo(supabase: ReturnType<typeof createClient>, mediaIds: string[]) {
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

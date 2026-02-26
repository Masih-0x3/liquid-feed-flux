import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, tweet_id, media_ids } = await req.json();
    console.log(`Media processor invoked - action: ${action}`);

    switch (action) {
      case 'download_media':
        return await downloadMediaForTweet(supabase, tweet_id);
      case 'cleanup_old_media':
        return await cleanupOldMedia(supabase);
      case 'get_media_info':
        return await getMediaInfo(supabase, media_ids);
      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    console.error('Media processor error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function downloadMediaForTweet(supabase: any, tweetId: string) {
  console.log(`Downloading media for tweet: ${tweetId}`);
  
  // Get media items that need to be downloaded
  const { data: mediaItems, error: mediaError } = await supabase
    .from('media')
    .select('*')
    .eq('tweet_id', tweetId)
    .is('storage_path', null);

  if (mediaError) {
    throw new Error(`Failed to fetch media: ${mediaError.message}`);
  }

  if (!mediaItems || mediaItems.length === 0) {
    console.log(`No media to download for tweet: ${tweetId}`);
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'No media to download',
      downloaded: 0 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let downloadedCount = 0;
  let failedCount = 0;

  for (const media of mediaItems) {
    try {
      console.log(`Downloading media: ${media.src_url}`);
      
      // Skip pic.twitter.com URLs as they are not direct media URLs
      if (media.src_url.includes('pic.twitter.com')) {
        console.log(`Skipping pic.twitter.com URL: ${media.src_url} - not a direct media URL`);
        failedCount++;
        continue;
      }
      
      // Download the media file
      const response = await fetch(media.src_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const fileExtension = getFileExtension(contentType, media.src_url);
      const fileName = `${media.tweet_id.replace(/[^a-zA-Z0-9]/g, '_')}_${media.ordering}${fileExtension}`;
      const storagePath = `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${fileName}`;

      const fileBlob = await response.blob();
      const fileBuffer = await fileBlob.arrayBuffer();
      const fileSize = fileBuffer.byteLength;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('temp-media')
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: false
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Update media record with storage info
      const { error: updateError } = await supabase
        .from('media')
        .update({
          storage_path: storagePath,
          downloaded_at: new Date().toISOString(),
          file_size: fileSize,
          mime_type: contentType
        })
        .eq('id', media.id);

      if (updateError) {
        console.error(`Failed to update media record: ${updateError.message}`);
        // Don't fail the whole operation, just log the error
      }

      downloadedCount++;
      console.log(`Successfully downloaded and stored: ${storagePath}`);

    } catch (error) {
      console.error(`Failed to download media ${media.src_url}:`, error);
      failedCount++;
    }
  }

  console.log(`Download complete: ${downloadedCount} successful, ${failedCount} failed`);

  return new Response(JSON.stringify({ 
    success: true,
    downloaded: downloadedCount,
    failed: failedCount,
    total: mediaItems.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function cleanupOldMedia(supabase: any) {
  console.log('Starting media cleanup process');

  // Get old media files (older than 7 days to stay within storage quota)
  // Limit batch size to avoid timeout
  const { data: oldMedia, error: queryError } = await supabase
    .rpc('get_old_media', { days_old: 7 });

  if (queryError) {
    throw new Error(`Failed to query old media: ${queryError.message}`);
  }

  if (!oldMedia || oldMedia.length === 0) {
    console.log('No old media to cleanup');
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'No old media to cleanup',
      deleted: 0 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`Found ${oldMedia.length} old media files to cleanup`);

  // Batch delete from storage (Supabase storage supports bulk remove)
  const BATCH_SIZE = 100;
  let deletedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < oldMedia.length; i += BATCH_SIZE) {
    const batch = oldMedia.slice(i, i + BATCH_SIZE);
    const paths = batch.map((m: any) => m.storage_path).filter(Boolean);
    
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('temp-media')
        .remove(paths);

      if (storageError) {
        console.error(`Batch storage delete failed:`, storageError.message);
        failedCount += paths.length;
      } else {
        deletedCount += paths.length;
        console.log(`Deleted batch ${Math.floor(i/BATCH_SIZE) + 1}: ${paths.length} files`);
      }
    }

    // Update DB records in batch
    const ids = batch.map((m: any) => m.id);
    const { error: updateError } = await supabase
      .from('media')
      .update({
        storage_path: null,
        downloaded_at: null,
        file_size: null,
        mime_type: null
      })
      .in('id', ids);

    if (updateError) {
      console.error(`Batch DB update failed:`, updateError.message);
    }
  }

  console.log(`Cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);

  return new Response(JSON.stringify({ 
    success: true,
    deleted: deletedCount,
    failed: failedCount,
    total: oldMedia.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getMediaInfo(supabase: any, mediaIds: string[]) {
  const { data: mediaInfo, error } = await supabase
    .from('media')
    .select('*')
    .in('id', mediaIds);

  if (error) {
    throw new Error(`Failed to fetch media info: ${error.message}`);
  }

  return new Response(JSON.stringify({ 
    success: true,
    media: mediaInfo 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getFileExtension(contentType: string, url: string): string {
  // Try to get extension from content type first
  const typeMap: { [key: string]: string } = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg'
  };

  if (typeMap[contentType]) {
    return typeMap[contentType];
  }

  // Fallback to URL extension
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (urlMatch) {
    return '.' + urlMatch[1].toLowerCase();
  }

  // Default extension based on content type category
  if (contentType.startsWith('image/')) return '.jpg';
  if (contentType.startsWith('video/')) return '.mp4';
  if (contentType.startsWith('audio/')) return '.mp3';
  
  return '.bin';
}
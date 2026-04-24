import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
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
async function isHydrationEnabled(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'twitter_hydration').maybeSingle();
    if (!data || !data.value || typeof data.value !== 'object') return true;
    const v = data.value as Record<string, unknown>;
    return v.enabled !== false;
  } catch { return true; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional shared-secret validation to protect the webhook when verify_jwt=false
    const urlObj = new URL(req.url);
    const providedToken = (urlObj.searchParams.get('token')
      || req.headers.get('x-webhook-token')
      || req.headers.get('x-rssapp-token')
      || '').trim();
    const expectedToken = (Deno.env.get('WEBHOOK_SHARED_SECRET')
      || Deno.env.get('RSSAPP_WEBHOOK_TOKEN')
      || Deno.env.get('RSSAPP_TOKEN')
      || '').trim();

    if (expectedToken) {
      if (!providedToken || providedToken !== expectedToken) {
        console.warn('Webhook token missing or invalid');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.warn('No webhook shared secret configured; allowing request. Set WEBHOOK_SHARED_SECRET to enforce.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(JSON.stringify({ function: 'webhooks-rssapp', action: 'received' }));
    
    let payload: unknown;
    try {
      payload = await req.json();
    } catch (_e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payload === null || payload === undefined) {
      return new Response(JSON.stringify({ error: 'Empty payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Payload keys:', typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload as Record<string, unknown>) : typeof payload);
    

    // Parse RSS items from the payload - handle RSS.app webhook structure
    let items = [];
    
    // RSS.app webhook structure: { data: { items_new: [...] } }
    if (payload.data && payload.data.items_new && Array.isArray(payload.data.items_new)) {
      items = payload.data.items_new;
    } else if (payload.data && payload.data.items && Array.isArray(payload.data.items)) {
      items = payload.data.items;
    } else if (payload.items && Array.isArray(payload.items)) {
      items = payload.items;
    } else if (payload.item) {
      items = Array.isArray(payload.item) ? payload.item : [payload.item];
    } else if (payload.entries && Array.isArray(payload.entries)) {
      items = payload.entries;
    } else if (payload.entry) {
      items = Array.isArray(payload.entry) ? payload.entry : [payload.entry];
    } else if (Array.isArray(payload)) {
      items = payload;
    } else {
      // Treat the entire payload as a single item
      items = [payload];
    }
    
    console.log(`Found ${items.length} items to process`);
    
    if (items.length === 0) {
      console.log('No items found in payload, treating as test notification');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Test notification received',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processedCount = 0;

    for (const item of items) {
      try {
        console.log('Processing item:', JSON.stringify(item, null, 2));
        
        // Extract item data with multiple fallbacks
        const tweetId = item.guid || item.id || item.link || item.url || `${Date.now()}-${Math.random()}`;
        
        // Extract content from RSS.app webhook structure
        let text = '';
        
        // RSS.app webhook structure: data.items_new[].title and description_text
        if (item.title && typeof item.title === 'string') {
          text = item.title.trim();
        } else if (item.description_text && typeof item.description_text === 'string') {
          text = item.description_text.trim();
        } else if (item.description && typeof item.description === 'string') {
          text = item.description.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
        } else if (item.content && typeof item.content === 'string') {
          text = item.content.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
        } else if (item.summary) {
          text = item.summary;
        } else {
          text = 'RSS Item - No content available';
        }
        
        // Clean up common patterns in RSS content
        if (text) {
          // Remove Twitter attribution at the end (— @username date)
          text = text.replace(/—\s*@\w+.*?(\d{4})?\s*$/, '').trim();
          // Remove excessive whitespace
          text = text.replace(/\s+/g, ' ').trim();
        }
        
        const url = item.link || item.url || '';
        
        // Extract author handle from tweet URL
        const authorHandle = extractAuthorFromUrl(url);
        
        const publishedAt = item.pubDate || item.published || item.date ? 
          new Date(item.pubDate || item.published || item.date) : new Date();

        console.log(`Extracted: tweetId=${tweetId}, text="${text.substring(0, 50)}...", url=${url}, author=${authorHandle || 'unknown'}`);

        // Parse media from RSS item
        const mediaItems = parseMediaFromRSSItem(item, text);
        console.log(`Found ${mediaItems.length} media items for item:`, JSON.stringify(item, null, 2).substring(0, 500));

        // Find or create a default account first
        let accountId = null;
        
        const { data: accounts } = await supabase
          .from('accounts')
          .select('*')
          .eq('enabled', true)
          .limit(1);

        if (accounts && accounts.length > 0) {
          accountId = accounts[0].id;
          console.log('Using existing account:', accountId);
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
            console.error('Error creating account:', accountError);
            continue;
          }

          if (newAccount) {
            accountId = newAccount.id;
            console.log('Created new account:', accountId);
          }
        }

        if (!accountId) {
          console.log('No account available, skipping item:', tweetId);
          continue;
        }

        // Detect truncation BEFORE upsert so we can persist the flag
        const isTruncated = detectTruncation(text);
        const hydrationEnabled = isTruncated ? await isHydrationEnabled(supabase) : false;
        const willHydrate = isTruncated && hydrationEnabled;

        // Upsert post to database
        const { data: post, error: postError } = await supabase
          .from('posts')
          .upsert({
            tweet_id: tweetId,
            account_id: accountId,
            text_original: text,
            lang_original: 'auto',
            url: url,
            tweeted_at: publishedAt,
            has_media: mediaItems.length > 0,
            author_handle: authorHandle,
            is_truncated: isTruncated,
          }, {
            onConflict: 'tweet_id'
          })
          .select()
          .single();

        if (postError) {
          console.error('Error upserting post:', postError);
          continue;
        }

        console.log(`Post upserted: ${tweetId} (truncated=${isTruncated}, willHydrate=${willHydrate})`);

        // Insert media items
        if (mediaItems.length > 0) {
          const mediaRows = await Promise.all(
            mediaItems.map(async (media, index) => ({
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
            console.error('Error inserting media:', mediaError);
          } else {
            console.log(`Inserted ${mediaItems.length} media items for ${tweetId}`);
          }
        }

        if (willHydrate) {
          // Queue hydration first; the hydrate job will create the translate job after success
          const { error: hydrateJobError } = await supabase
            .from('jobs')
            .upsert({
              type: 'hydrate_tweet',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 15,
              idempotency_key: `hydrate:${tweetId}`,
              next_run_at: new Date().toISOString()
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (hydrateJobError) {
            console.error('Error creating hydrate job:', hydrateJobError);
          } else {
            console.log('Hydrate job created for:', tweetId);
            try {
              await supabase
                .from('pipeline_events')
                .insert({
                  subject_type: 'post', subject_id: tweetId,
                  step: 'hydrate', status: 'queued',
                  started_at: new Date().toISOString(),
                  meta: { source: 'webhook', text_length: text.length }
                });
            } catch (_e) {}
          }
        } else {
          // Standard path: create translation job directly
          const { error: translationJobError } = await supabase
            .from('jobs')
            .upsert({
              type: 'translate',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 10,
              idempotency_key: `translate:${tweetId}`,
              next_run_at: new Date().toISOString()
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (translationJobError) {
            console.error('Error creating translation job:', translationJobError);
          } else {
            console.log('Translation job created for:', tweetId);
            try {
              await supabase
                .from('pipeline_events')
                .insert({
                  subject_type: 'post',
                  subject_id: tweetId,
                  step: 'translate',
                  status: 'queued',
                  started_at: new Date().toISOString(),
                  meta: { source: 'webhook' }
                });
            } catch (_e) {}
          }
        }

        // Create media download job for tweets with media
        if (mediaItems.length > 0) {
          const { error: downloadJobError } = await supabase
            .from('jobs')
            .upsert({
              type: 'download_media',
              payload: { tweet_id: tweetId },
              status: 'pending',
              idempotency_key: `download_media:${tweetId}`,
              next_run_at: new Date().toISOString()
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (downloadJobError) {
            console.error('Error creating media download job:', downloadJobError);
          } else {
            console.log('Media download job created for:', tweetId);
            try {
              await supabase
                .from('pipeline_events')
                .insert({
                  subject_type: 'post',
                  subject_id: tweetId,
                  step: 'media',
                  status: 'queued',
                  started_at: new Date().toISOString(),
                  meta: { source: 'webhook' }
                });
            } catch (_e) {}
          }
        }

        // Don't create delivery job here - let translation job complete first
        // The worker will handle sequencing: translate -> then deliver


        processedCount++;

      } catch (itemError) {
        console.error('Error processing item:', itemError);
        continue;
      }
    }

    console.log(`Successfully processed ${processedCount} out of ${items.length} items`);

    return new Response(JSON.stringify({ 
      success: true, 
      processed: processedCount,
      total: items.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Webhook error:', (error as Error).message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
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

function parseMediaFromRSSItem(item: any, text?: string): Array<{type: string, url: string, width?: number, height?: number, duration?: number}> {
  const mediaItems: Array<{type: string, url: string, width?: number, height?: number, duration?: number}> = [];
  
  try {
    // First, check for Twitter media URLs in the text content - skip pic.twitter.com as they're not usable
    if (text) {
      // Skip pic.twitter.com URLs as they are Twitter's short URLs that don't work for direct media access
      const twitterMediaRegex = /pic\.twitter\.com\/[a-zA-Z0-9]+/g;
      const twitterMatches = text.match(twitterMediaRegex);
      if (twitterMatches) {
        console.log(`Found ${twitterMatches.length} pic.twitter.com URLs in text, but skipping as they are not direct media URLs`);
        // Skip these URLs as they are not direct media URLs
      }
      
      // Extract direct media URLs (pbs.twimg.com, etc.)
      const directMediaRegex = /https?:\/\/pbs\.twimg\.com\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|mov)/gi;
      const directMatches = text.match(directMediaRegex);
      if (directMatches) {
        for (const match of directMatches) {
          console.log('Found direct media URL in text:', match);
          const isVideo = /\.(mp4|mov)$/i.test(match);
          mediaItems.push({
            type: isVideo ? 'video' : 'image',
            url: match
          });
        }
      }
    }
    // Parse thumbnail from RSS.app webhook (Twitter thumbnails)
    if (item.thumbnail && typeof item.thumbnail === 'string') {
      console.log('Found thumbnail:', item.thumbnail);
      mediaItems.push({
        type: 'image',
        url: item.thumbnail
      });
    }

    // Parse enclosures (RSS standard)
    if (item.enclosure) {
      const enclosures = Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure];
      for (const enc of enclosures) {
        if (enc.url && enc.type) {
          const mediaType = getMediaType(enc.type, enc.url);
          if (mediaType) {
            mediaItems.push({
              type: mediaType,
              url: enc.url,
              width: enc.width ? parseInt(enc.width) : undefined,
              height: enc.height ? parseInt(enc.height) : undefined,
              duration: enc.length ? parseInt(enc.length) : undefined
            });
          }
        }
      }
    }
    
    // Parse media:content (RSS extensions)
    if (item['media:content']) {
      const mediaContent = Array.isArray(item['media:content']) ? item['media:content'] : [item['media:content']];
      for (const media of mediaContent) {
        if (media.url) {
          const mediaType = getMediaType(media.type || '', media.url);
          if (mediaType) {
            mediaItems.push({
              type: mediaType,
              url: media.url,
              width: media.width ? parseInt(media.width) : undefined,
              height: media.height ? parseInt(media.height) : undefined,
              duration: media.duration ? parseInt(media.duration) : undefined
            });
          }
        }
      }
    }
    
    // Parse images from description HTML with better regex for Twitter media
    if (item.description_html || item.description || item.content) {
      const htmlContent = item.description_html || item.description || item.content;
      
      // Enhanced image parsing for Twitter media
      const imgRegex = /<img[^>]+src="([^"]+)"/gi;
      let match;
      
      while ((match = imgRegex.exec(htmlContent)) !== null) {
        const imgUrl = match[1];
        if (imgUrl && isImageUrl(imgUrl) && !mediaItems.some(m => m.url === imgUrl)) {
          mediaItems.push({
            type: 'image',
            url: imgUrl
          });
        }
      }
      
      // Parse video links
      const videoRegex = /<video[^>]+src="([^"]+)"|<source[^>]+src="([^"]+)"/gi;
      while ((match = videoRegex.exec(htmlContent)) !== null) {
        const videoUrl = match[1] || match[2];
        if (videoUrl && isVideoUrl(videoUrl) && !mediaItems.some(m => m.url === videoUrl)) {
          mediaItems.push({
            type: 'video',
            url: videoUrl
          });
        }
      }

      // Parse Twitter-specific media URLs from HTML
      const twitterMediaRegex = /https:\/\/pbs\.twimg\.com\/media\/[^"\s]+/g;
      const twitterMatches = htmlContent.match(twitterMediaRegex);
      if (twitterMatches) {
        for (const url of twitterMatches) {
          if (!mediaItems.some(m => m.url === url)) {
            mediaItems.push({
              type: 'image',
              url: url
            });
          }
        }
      }
    }
    
    // Parse audio files
    if (item.description_html || item.description || item.content) {
      const htmlContent = item.description_html || item.description || item.content;
      const audioRegex = /<audio[^>]+src="([^"]+)"|<source[^>]+src="([^"]+)"[^>]*type="audio/gi;
      let match;
      
      while ((match = audioRegex.exec(htmlContent)) !== null) {
        const audioUrl = match[1] || match[2];
        if (audioUrl && isAudioUrl(audioUrl) && !mediaItems.some(m => m.url === audioUrl)) {
          mediaItems.push({
            type: 'audio',
            url: audioUrl
          });
        }
      }
    }
    
  } catch (error) {
    console.error('Error parsing media from RSS item:', error);
  }
  
  return mediaItems;
}

function getMediaType(mimeType: string, url: string): string | null {
  mimeType = mimeType.toLowerCase();
  
  if (mimeType.startsWith('image/') || isImageUrl(url)) {
    return 'image';
  }
  
  if (mimeType.startsWith('video/') || isVideoUrl(url)) {
    return 'video';
  }

  if (mimeType.startsWith('audio/') || isAudioUrl(url)) {
    return 'audio';
  }
  
  return null;
}

function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)(\?|$)/i;
  return imageExtensions.test(url) || 
         url.includes('pbs.twimg.com/media') || 
         url.includes('pic.twitter.com');
}

function isVideoUrl(url: string): boolean {
  const videoExtensions = /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)(\?|$)/i;
  return videoExtensions.test(url);
}

function isAudioUrl(url: string): boolean {
  const audioExtensions = /\.(mp3|wav|ogg|aac|flac|m4a|wma)(\?|$)/i;
  return audioExtensions.test(url);
}
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

    console.log('RSS.app webhook received');
    
    const payload = await req.json();
    console.log('Full webhook payload:', JSON.stringify(payload, null, 2));
    console.log('Payload keys:', Object.keys(payload));
    console.log('Payload type:', typeof payload);

    // Parse RSS items from the payload - handle different possible formats
    let items = [];
    
    // Try different payload structures RSS.app might use
    if (payload.items && Array.isArray(payload.items)) {
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
        
        // Better text extraction with HTML content parsing
        let text = '';
        if (item.content && typeof item.content === 'string') {
          // Remove HTML tags and decode entities
          text = item.content.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
        } else if (item.description && typeof item.description === 'string') {
          text = item.description.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
        } else if (item.title) {
          text = item.title;
        } else if (item.summary) {
          text = item.summary;
        } else {
          text = 'RSS Item - No content available';
        }
        
        const url = item.link || item.url || '';
        const publishedAt = item.pubDate || item.published || item.date ? 
          new Date(item.pubDate || item.published || item.date) : new Date();

        console.log(`Extracted: tweetId=${tweetId}, text="${text.substring(0, 50)}...", url=${url}`);

        // Parse media from RSS item
        const mediaItems = parseMediaFromRSSItem(item);
        console.log(`Found ${mediaItems.length} media items`);

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
              handle: 'rss-feed',
              display_name: 'RSS Feed Account'
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
            has_media: mediaItems.length > 0
          }, {
            onConflict: 'tweet_id'
          })
          .select()
          .single();

        if (postError) {
          console.error('Error upserting post:', postError);
          continue;
        }

        console.log('Post upserted successfully:', tweetId);

        // Insert media items
        if (mediaItems.length > 0) {
          const { error: mediaError } = await supabase
            .from('media')
            .upsert(
              mediaItems.map((media, index) => ({
                tweet_id: tweetId,
                kind: media.type,
                src_url: media.url,
                width: media.width,
                height: media.height,
                duration_ms: media.duration,
                ordering: index
              })),
              { onConflict: 'tweet_id,ordering' }
            );

          if (mediaError) {
            console.error('Error inserting media:', mediaError);
          } else {
            console.log(`Inserted ${mediaItems.length} media items for ${tweetId}`);
          }
        }

        // Create translation job
        const { error: translationJobError } = await supabase
          .from('jobs')
          .insert({
            type: 'translate',
            payload: {
              tweet_id: tweetId,
              text: text,
              target_lang: 'en'
            },
            status: 'pending'
          });

        if (translationJobError) {
          console.error('Error creating translation job:', translationJobError);
        } else {
          console.log('Translation job created for:', tweetId);
        }

        // Create delivery job
        const { error: deliveryJobError } = await supabase
          .from('jobs')
          .insert({
            type: 'deliver',
            payload: {
              tweet_id: tweetId,
              account_id: accountId
            },
            status: 'pending'
          });

        if (deliveryJobError) {
          console.error('Error creating delivery job:', deliveryJobError);
        } else {
          console.log('Delivery job created for:', tweetId);
        }

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
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parseMediaFromRSSItem(item: any): Array<{type: string, url: string, width?: number, height?: number, duration?: number}> {
  const mediaItems: Array<{type: string, url: string, width?: number, height?: number, duration?: number}> = [];
  
  try {
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
    
    // Parse images from description HTML
    if (item.description || item.content) {
      const htmlContent = item.description || item.content;
      const imgRegex = /<img[^>]+src="([^"]+)"/gi;
      let match;
      
      while ((match = imgRegex.exec(htmlContent)) !== null) {
        const imgUrl = match[1];
        if (imgUrl && isImageUrl(imgUrl)) {
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
        if (videoUrl && isVideoUrl(videoUrl)) {
          mediaItems.push({
            type: 'video',
            url: videoUrl
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
  
  return null;
}

function isImageUrl(url: string): boolean {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)(\?|$)/i;
  return imageExtensions.test(url);
}

function isVideoUrl(url: string): boolean {
  const videoExtensions = /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)(\?|$)/i;
  return videoExtensions.test(url);
}
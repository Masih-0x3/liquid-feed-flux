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
        const text = item.title || item.description || item.content || item.summary || 'RSS Item';
        const url = item.link || item.url || '';
        const publishedAt = item.pubDate || item.published || item.date ? 
          new Date(item.pubDate || item.published || item.date) : new Date();

        console.log(`Extracted: tweetId=${tweetId}, text="${text.substring(0, 50)}...", url=${url}`);

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
            has_media: false
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
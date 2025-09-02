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
    console.log('Webhook payload:', payload);

    // Parse RSS items from the payload
    const items = payload.items || [];
    console.log(`Processing ${items.length} RSS items`);

    for (const item of items) {
      try {
        // Extract item data
        const tweetId = item.guid || item.link || `${Date.now()}-${Math.random()}`;
        const text = item.title || item.description || '';
        const url = item.link || '';
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();

        // Find the associated account (assuming RSS.app provides feed info)
        const feedId = payload.feed?.id || payload.feedId;
        let accountId = null;

        if (feedId) {
          const { data: feed } = await supabase
            .from('feeds')
            .select('*')
            .eq('rssapp_feed_id', feedId)
            .single();

          if (feed) {
            // Get the first enabled account or create a default one
            const { data: accounts } = await supabase
              .from('accounts')
              .select('*')
              .eq('enabled', true)
              .limit(1);

            if (accounts && accounts.length > 0) {
              accountId = accounts[0].id;
            } else {
              // Create a default account if none exists
              const { data: newAccount } = await supabase
                .from('accounts')
                .insert({
                  handle: 'default',
                  display_name: 'Default Account'
                })
                .select()
                .single();

              if (newAccount) {
                accountId = newAccount.id;
              }
            }
          }
        }

        if (!accountId) {
          console.log('No account found, skipping item:', tweetId);
          continue;
        }

        // Upsert post to database
        const { error: postError } = await supabase
          .from('posts')
          .upsert({
            tweet_id: tweetId,
            account_id: accountId,
            text_original: text,
            lang_original: 'auto', // Will be detected during translation
            url: url,
            tweeted_at: publishedAt,
            has_media: false // Will be updated if media is detected
          }, {
            onConflict: 'tweet_id'
          });

        if (postError) {
          console.error('Error upserting post:', postError);
          continue;
        }

        console.log('Post upserted:', tweetId);

        // Create translation job
        const { error: translationJobError } = await supabase
          .from('jobs')
          .insert({
            type: 'translate',
            payload: {
              tweet_id: tweetId,
              text: text,
              target_lang: 'en' // Default target language
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

      } catch (itemError) {
        console.error('Error processing item:', itemError);
        continue;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: items.length 
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
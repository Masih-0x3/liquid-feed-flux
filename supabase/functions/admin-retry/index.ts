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

    const body = await req.json();
    const { delivery_id, action, tweet_id, post, template, settings } = body;

    // Handle resend delivery action
    if (action === 'resend_delivery') {
      if (!tweet_id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'tweet_id is required for resend_delivery action' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      // Get account ID for the tweet
      const { data: post, error: postError } = await supabase
        .from('posts')
        .select('account_id')
        .eq('tweet_id', tweet_id)
        .single();

      if (postError || !post) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Post not found' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        });
      }

      // Create a new delivery job
      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          type: 'deliver',
          payload: { 
            tweet_id: tweet_id,
            account_id: post.account_id
          },
          status: 'pending',
          next_run_at: new Date().toISOString()
        });

      if (jobError) {
        console.error('Error creating delivery job:', jobError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to create delivery job' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Delivery job created successfully',
        tweet_id: tweet_id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle retry failed deliveries action
    if (action === 'retry_failed_deliveries') {
      // Get all failed deliveries
      const { data: failedDeliveries, error: deliveryError } = await supabase
        .from('deliveries')
        .select('*')
        .eq('status', 'failed');

      if (deliveryError) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch failed deliveries' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }

      // Create retry jobs for each failed delivery
      const retryJobs = (failedDeliveries || []).map(delivery => ({
        type: 'deliver',
        payload: {
          tweet_id: delivery.subject_id,
        },
        status: 'pending',
        next_run_at: new Date().toISOString()
      }));

      if (retryJobs.length > 0) {
        const { error: jobError } = await supabase
          .from('jobs')
          .insert(retryJobs);

        if (jobError) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'Failed to create retry jobs' 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
          });
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Created ${retryJobs.length} retry jobs for failed deliveries`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle test template action
    if (action === 'test_template') {
      if (!post || !template) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'post and template are required for test_template action' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      console.log('Testing template with post:', post.tweet_id);

      // Get Telegram settings
      const { data: telegramConfig } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'telegram_config')
        .single();

      if (!telegramConfig?.value || !telegramConfig.value.bot_token || !telegramConfig.value.chat_id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Telegram not configured properly. Please set bot_token and chat_id in Settings.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      const telegramSettings = telegramConfig.value as any;

      console.log('Telegram settings:', {
        bot_token: telegramSettings.bot_token ? `${telegramSettings.bot_token.substring(0, 10)}...` : 'missing',
        chat_id: telegramSettings.chat_id,
        parse_mode: telegramSettings.parse_mode
      });

      // Format message using template
      const message = template
        .replace(/{translated_text}/g, post.text_translated || 'Sample translated text')
        .replace(/{original_text}/g, post.text_original || 'Sample original text')
        .replace(/{author_handle}/g, post.accounts?.handle || '@sample_handle')
        .replace(/{author_name}/g, post.accounts?.display_name || 'Sample Author')
        .replace(/{source_link}/g, settings?.include_source_links ? `<a href="${post.url || 'https://example.com'}">مشاهده اصل</a>` : '')
        .replace(/{published_date}/g, post.tweeted_at ? new Date(post.tweeted_at).toLocaleDateString('fa-IR') : '۱۴۰۴/۶/۱۲')
        .replace(/{published_time}/g, post.tweeted_at ? new Date(post.tweeted_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '۲۱:۳۵')
        .replace(/{hashtags}/g, settings?.custom_hashtags || '#تست')
        .replace(/{media_info}/g, post.has_media ? '📸 تصویر' : '');

      console.log('Formatted test message:', message);

      // Send test message to Telegram
      const telegramUrl = `https://api.telegram.org/bot${telegramSettings.bot_token}/sendMessage`;
      console.log('Sending to Telegram API URL:', telegramUrl.replace(telegramSettings.bot_token, 'HIDDEN_TOKEN'));
      
      const telegramResponse = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: telegramSettings.chat_id,
          text: `🧪 TEST MESSAGE 🧪\n\n${message}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      console.log('Telegram response status:', telegramResponse.status);
      
      if (!telegramResponse.ok) {
        const errorData = await telegramResponse.json();
        console.error('Telegram API error details:', errorData);
        throw new Error(`Telegram API error: ${errorData.description || 'Unknown error'}`);
      }

      const responseData = await telegramResponse.json();
      console.log('Telegram response success:', responseData);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Test message sent successfully to Telegram' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle test webhook action
    if (action === 'test_webhook') {
      const testRSSItem = {
        guid: `test-tweet-${Date.now()}`,
        title: 'Breaking: Major tech announcement today',
        description: '<p>Exciting news from the tech world as <strong>Company XYZ</strong> announces revolutionary new product that will change everything. This is a significant development in the industry.</p>',
        content: 'Exciting news from the tech world as Company XYZ announces revolutionary new product that will change everything. This is a significant development in the industry. #TechNews #Innovation',
        link: 'https://twitter.com/example/status/123456789',
        pubDate: new Date().toISOString()
      };

      console.log('Testing webhook with sample data:', testRSSItem);

      const webhookResponse = await supabase.functions.invoke('webhooks-rssapp', {
        body: { 
          items_new: [testRSSItem],
          test: true 
        }
      });

      if (webhookResponse.error) {
        throw new Error(`Webhook test failed: ${webhookResponse.error.message}`);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Test webhook completed',
        data: webhookResponse.data 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Original retry logic
    if (!delivery_id) {
      throw new Error('delivery_id is required');
    }

    console.log('Retrying delivery:', delivery_id);

    // Get the delivery
    const { data: delivery, error: deliveryError } = await supabase
      .from('deliveries')
      .select('*')
      .eq('id', delivery_id)
      .single();

    if (deliveryError || !delivery) {
      throw new Error('Delivery not found');
    }

    // Create a new delivery job
    const { error: jobError } = await supabase
      .from('jobs')
      .insert([{
        type: 'deliver',
        payload: {
          subject_type: delivery.subject_type,
          subject_id: delivery.subject_id
        },
        status: 'pending',
        next_run_at: new Date().toISOString()
      }]);

    if (jobError) {
      throw jobError;
    }

    // Reset delivery status
    const { error: updateError } = await supabase
      .from('deliveries')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null
      })
      .eq('id', delivery_id);

    if (updateError) {
      throw updateError;
    }

    console.log('Delivery retry scheduled:', delivery_id);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Delivery retry scheduled' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Retry error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
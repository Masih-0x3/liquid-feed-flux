import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: validate JWT and check admin role
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: missing token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAuth = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check admin role using service client (bypasses RLS)
  const serviceClient = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: roleData } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require admin auth for all actions
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { delivery_id, action, tweet_id, post, template, settings } = body;

    console.log(JSON.stringify({ function: 'admin-retry', action: action || 'retry_delivery', admin_user: authResult.userId }));

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

      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('account_id')
        .eq('tweet_id', tweet_id)
        .single();

      if (postError || !postData) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Post not found' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        });
      }

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          type: 'deliver',
          payload: { 
            tweet_id: tweet_id,
            account_id: postData.account_id
          },
          status: 'pending',
          next_run_at: new Date().toISOString()
        })
        .select()
        .single();

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

      try {
        await supabase
          .from('pipeline_events')
          .insert({
            subject_type: 'post',
            subject_id: tweet_id,
            step: 'deliver',
            status: 'queued',
            started_at: new Date().toISOString(),
            meta: { source: 'admin-retry', admin_user: authResult.userId }
          });
      } catch (_e) {}

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

      const retryJobs = (failedDeliveries || []).map(delivery => ({
        type: 'deliver',
        payload: { tweet_id: delivery.subject_id },
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

        try {
          const uniqueSubjects = Array.from(new Set((failedDeliveries || []).map(d => d.subject_id)));
          if (uniqueSubjects.length > 0) {
            const rows = uniqueSubjects.map(sid => ({
              subject_type: 'post',
              subject_id: sid,
              step: 'deliver',
              status: 'queued',
              started_at: new Date().toISOString(),
              meta: { source: 'admin-retry', admin_user: authResult.userId }
            }));
            await supabase.from('pipeline_events').insert(rows);
          }
        } catch (_e) {}
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

      // Use secrets for Telegram config instead of DB settings
      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

      if (!botToken || !chatId) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Telegram secrets not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Supabase secrets.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

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

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      
      const telegramResponse = await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🧪 TEST MESSAGE 🧪\n\n${message}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      
      if (!telegramResponse.ok) {
        const errorData = await telegramResponse.json();
        throw new Error(`Telegram API error: ${errorData.description || 'Unknown error'}`);
      }

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
        description: '<p>Exciting news from the tech world.</p>',
        content: 'Exciting news from the tech world. #TechNews #Innovation',
        link: 'https://twitter.com/example/status/123456789',
        pubDate: new Date().toISOString()
      };

      const webhookResponse = await supabase.functions.invoke('webhooks-rssapp', {
        body: { items_new: [testRSSItem], test: true }
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

    const { data: delivery, error: deliveryError } = await supabase
      .from('deliveries')
      .select('*')
      .eq('id', delivery_id)
      .single();

    if (deliveryError || !delivery) {
      throw new Error('Delivery not found');
    }

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

    if (jobError) throw jobError;

    const { error: updateError } = await supabase
      .from('deliveries')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null
      })
      .eq('id', delivery_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Delivery retry scheduled' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'admin-retry', action: 'error', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

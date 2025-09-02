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

    console.log('Worker function invoked - processing pending jobs');

    // Fetch multiple pending jobs for batch processing
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('next_run_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    if (jobError) {
      console.error('Error fetching jobs:', jobError);
      throw jobError;
    }

    if (!jobs || jobs.length === 0) {
      console.log('No pending jobs found');
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No pending jobs',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${jobs.length} jobs`);
    let processedCount = 0;
    let failedCount = 0;

    for (const job of jobs) {
      try {
        console.log(`Processing job ${job.id} of type ${job.type}`);

        // Mark job as processing
        await supabase
          .from('jobs')
          .update({ 
            status: 'processing',
            attempts: job.attempts + 1
          })
          .eq('id', job.id);

        let success = false;
        try {
          switch (job.type) {
            case 'translate':
              success = await handleTranslateJob(job, supabase);
              break;
            case 'moderate':
              success = await handleModerateJob(job, supabase);
              break;
            case 'deliver':
              success = await handleDeliverJob(job, supabase);
              break;
            default:
              console.error(`Unknown job type: ${job.type}`);
              success = false;
          }

          if (success) {
            // Mark job as completed
            await supabase
              .from('jobs')
              .update({ 
                status: 'completed',
                last_error: null
              })
              .eq('id', job.id);
            
            processedCount++;
            console.log(`Job ${job.id} completed successfully`);
          } else {
            await handleJobFailure(supabase, job);
            failedCount++;
          }

        } catch (error) {
          console.error(`Job ${job.id} failed:`, error);
          await handleJobFailure(supabase, job, error.message);
          failedCount++;
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        await handleJobFailure(supabase, job, error.message);
        failedCount++;
      }
    }

    console.log(`Worker completed: ${processedCount} successful, ${failedCount} failed`);

    return new Response(JSON.stringify({ 
      success: true, 
      processed: processedCount,
      failed: failedCount,
      total: jobs.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleTranslateJob(job: any, supabase: any): Promise<boolean> {
  try {
    console.log('Handling translate job for:', job.payload.tweet_id);
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Get the post to translate
    const { data: post, error } = await supabase
      .from('posts')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .single();

    if (error || !post) {
      throw new Error('Post not found');
    }

    if (!post.text_original) {
      throw new Error('No original text to translate');
    }

    // Call OpenAI for translation
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the given text to ${job.payload.target_lang || 'English'}. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only translate the actual content, not the special elements. If the text is already in ${job.payload.target_lang || 'English'}, return it unchanged.`
          },
          {
            role: 'user',
            content: post.text_original
          }
        ],
        temperature: 0,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorData}`);
    }

    const data = await response.json();
    const translatedText = data.choices[0].message.content;

    // Update post with translation
    const { error: updateError } = await supabase
      .from('posts')
      .update({ 
        text_translated: translatedText,
        lang_original: detectLanguage(post.text_original)
      })
      .eq('tweet_id', job.payload.tweet_id);

    if (updateError) {
      throw updateError;
    }

    console.log('Translation completed for:', job.payload.tweet_id);
    return true;
  } catch (error) {
    console.error('Translation failed:', error);
    return false;
  }
}

async function handleModerateJob(job: any, supabase: any): Promise<boolean> {
  try {
    console.log('Handling moderate job for:', job.payload.subject_id);
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Get content to moderate
    let content = '';
    if (job.payload.subject_type === 'post') {
      const { data: post } = await supabase
        .from('posts')
        .select('text_translated, text_original')
        .eq('tweet_id', job.payload.subject_id)
        .single();
      
      content = post?.text_translated || post?.text_original || '';
    }

    if (!content) {
      throw new Error('No content to moderate');
    }

    // Call OpenAI moderation API
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: content
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI Moderation API error: ${response.statusText}`);
    }

    const data = await response.json();
    const moderation = data.results[0];

    // Store moderation result
    const { error } = await supabase
      .from('moderation_events')
      .insert([{
        subject_type: job.payload.subject_type,
        subject_id: job.payload.subject_id,
        verdict: moderation.flagged ? null : 'allow', // null means needs manual review
        categories: moderation.categories
      }]);

    if (error) {
      throw error;
    }

    console.log('Moderation completed for:', job.payload.subject_id, 'flagged:', moderation.flagged);
    return true;
  } catch (error) {
    console.error('Moderation failed:', error);
    return false;
  }
}

async function handleDeliverJob(job: any, supabase: any): Promise<boolean> {
  try {
    console.log('Handling deliver job for:', job.payload.tweet_id);
    
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const telegramChatId = Deno.env.get('TELEGRAM_CHAT_ID');
    
    if (!telegramBotToken || !telegramChatId) {
      throw new Error('Telegram configuration not set');
    }

    // Get the post data
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .single();

    if (postError || !post) {
      throw new Error(`Post not found: ${job.payload.tweet_id}`);
    }

    // Get account info
    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', job.payload.account_id)
      .single();

    // Get media if available
    const { data: media } = await supabase
      .from('media')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .order('ordering');

    // Prepare message text
    const textToSend = post.text_translated || post.text_original;
    const accountInfo = account?.display_name || account?.handle || 'RSS Feed';
    
    let message = `<b>${accountInfo}</b>\n\n${textToSend}`;
    
    if (post.url) {
      message += `\n\n<a href="${post.url}">View original</a>`;
    }

    let telegramMessageIds: string[] = [];

    // Send media if available
    if (media && media.length > 0) {
      const images = media.filter(m => m.kind === 'image');
      const videos = media.filter(m => m.kind === 'video');

      // Handle images
      if (images.length > 0) {
        if (images.length === 1) {
          // Single image
          const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              photo: images[0].src_url,
              caption: message,
              parse_mode: 'HTML'
            })
          });
          
          const result = await response.json();
          if (result.ok) {
            telegramMessageIds.push(result.result.message_id.toString());
          } else {
            throw new Error(`Telegram sendPhoto failed: ${result.description}`);
          }
        } else {
          // Multiple images - use media group
          const mediaGroup = images.slice(0, 10).map((img, index) => ({
            type: 'photo',
            media: img.src_url,
            caption: index === 0 ? message : undefined,
            parse_mode: index === 0 ? 'HTML' : undefined
          }));

          const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              media: mediaGroup
            })
          });
          
          const result = await response.json();
          if (result.ok) {
            telegramMessageIds = result.result.map((msg: any) => msg.message_id.toString());
          } else {
            throw new Error(`Telegram sendMediaGroup failed: ${result.description}`);
          }
        }
      }

      // Handle videos separately
      for (const video of videos) {
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendVideo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            video: video.src_url,
            caption: images.length === 0 ? message : `Video from ${accountInfo}`,
            parse_mode: 'HTML'
          })
        });
        
        const result = await response.json();
        if (result.ok) {
          telegramMessageIds.push(result.result.message_id.toString());
        } else {
          console.warn(`Failed to send video: ${result.description}`);
        }
      }
    } else {
      // No media, send text only
      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        })
      });
      
      const result = await response.json();
      if (result.ok) {
        telegramMessageIds.push(result.result.message_id.toString());
      } else {
        throw new Error(`Telegram sendMessage failed: ${result.description}`);
      }
    }

    // Record successful delivery
    const { error: deliveryError } = await supabase
      .from('deliveries')
      .insert({
        subject_type: 'post',
        subject_id: job.payload.tweet_id,
        telegram_chat_id: telegramChatId,
        telegram_message_ids: telegramMessageIds,
        status: 'posted'
      });

    if (deliveryError) {
      console.warn('Failed to record delivery:', deliveryError);
    }

    console.log(`Successfully delivered tweet ${job.payload.tweet_id} to Telegram`);
    return true;

  } catch (error) {
    console.error('Delivery failed:', error);
    return false;
  }
}

async function handleJobFailure(supabase: any, job: any, errorMessage?: string) {
  const maxAttempts = 5;
  const baseDelay = 60; // 1 minute base delay
  
  if (job.attempts >= maxAttempts) {
    // Mark as failed permanently
    await supabase
      .from('jobs')
      .update({ 
        status: 'failed',
        last_error: errorMessage || 'Max attempts reached'
      })
      .eq('id', job.id);
    
    console.log(`Job ${job.id} marked as permanently failed after ${job.attempts} attempts`);
  } else {
    // Schedule retry with exponential backoff
    const delayMinutes = baseDelay * Math.pow(2, job.attempts);
    const nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    
    await supabase
      .from('jobs')
      .update({ 
        status: 'pending',
        last_error: errorMessage || 'Processing failed',
        next_run_at: nextRunAt.toISOString()
      })
      .eq('id', job.id);
    
    console.log(`Job ${job.id} scheduled for retry in ${delayMinutes} minutes`);
  }
}

function detectLanguage(text: string): string {
  // Simple language detection based on common patterns
  const latinChars = text.match(/[a-zA-Z]/g)?.length || 0;
  const totalChars = text.replace(/\s/g, '').length;
  
  if (totalChars === 0) return 'unknown';
  
  const latinRatio = latinChars / totalChars;
  
  if (latinRatio > 0.7) {
    // Likely Latin-based language, default to English
    return 'en';
  } else {
    // Non-Latin script
    return 'auto';
  }
}
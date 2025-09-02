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
            case 'download_media':
              success = await handleDownloadMediaJob(job, supabase);
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

    // Get translation settings from database
    const { data: translationSettings, error: settingsError } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'translation_prompt')
      .single();

    if (settingsError) {
      console.warn('Could not load translation settings, using fallback');
    }

    const settings = translationSettings?.value || {
      system_prompt: "You are a professional translator. Translate the given text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly.",
      user_prompt_template: "{content}",
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_completion_tokens: 1000
    };

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

    // Prepare the user prompt with content substitution
    const userPrompt = settings.user_prompt_template.replace('{content}', post.text_original);

    console.log('Translating with OpenAI:', {
      model: settings.model,
      temperature: settings.temperature,
      max_completion_tokens: settings.max_completion_tokens
    });

    // Call OpenAI for translation using configured settings
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: 'system',
            content: settings.system_prompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: settings.temperature,
        max_completion_tokens: settings.max_completion_tokens
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

    // Get message template settings
    const { data: messageSettings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'message_template')
      .single();

    const messageTemplate = messageSettings?.value || {
      template: '{translated_text}\n\n📰 #اخبار',
      include_source_link: true,
      source_link_text: 'View original',
      custom_hashtags: '#اخبار'
    };

    // Get media if available
    const { data: media } = await supabase
      .from('media')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .order('ordering');

    // Prepare message using template
    const message = formatMessageWithTemplate(post, account, messageTemplate);

    let telegramMessageIds: string[] = [];

    // Send media if available
    if (media && media.length > 0) {
      const images = media.filter(m => m.kind === 'image');
      const videos = media.filter(m => m.kind === 'video');
      const audios = media.filter(m => m.kind === 'audio');

      // Handle images
      if (images.length > 0) {
        if (images.length === 1) {
          // Single image
          const image = images[0];
          const imageUrl = await getMediaUrl(supabase, image);
          
          const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              photo: imageUrl,
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
          const mediaGroup = [];
          for (let i = 0; i < Math.min(images.length, 10); i++) {
            const image = images[i];
            const imageUrl = await getMediaUrl(supabase, image);
            mediaGroup.push({
              type: 'photo',
              media: imageUrl,
              caption: i === 0 ? message : undefined,
              parse_mode: i === 0 ? 'HTML' : undefined
            });
          }

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
        const videoUrl = await getMediaUrl(supabase, video);
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendVideo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            video: videoUrl,
            caption: images.length === 0 ? message : message,
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

      // Handle audio files
      for (const audio of audios) {
        const audioUrl = await getMediaUrl(supabase, audio);
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendAudio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            audio: audioUrl,
            caption: images.length === 0 && videos.length === 0 ? message : `Audio from tweet`,
            parse_mode: 'HTML'
          })
        });
        
        const result = await response.json();
        if (result.ok) {
          telegramMessageIds.push(result.result.message_id.toString());
        } else {
          console.warn(`Failed to send audio: ${result.description}`);
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

// Helper function to format message using template
function formatMessageWithTemplate(post: any, account: any, messageTemplate: any): string {
  const placeholders = {
    '{translated_text}': post.text_translated || post.text_original,
    '{original_text}': post.text_original,
    '{author_handle}': account?.handle || '',
    '{author_name}': account?.display_name || '',
    '{source_link}': messageTemplate.include_source_link && post.url ? 
      `<a href="${post.url}">${messageTemplate.source_link_text}</a>` : '',
    '{published_date}': post.tweeted_at ? 
      new Date(post.tweeted_at).toLocaleDateString('fa-IR') : '',
    '{published_time}': post.tweeted_at ? 
      new Date(post.tweeted_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '',
    '{hashtags}': messageTemplate.custom_hashtags || '',
    '{media_info}': post.has_media ? '📸 تصویر' : ''
  };

  return Object.entries(placeholders).reduce((template, [key, value]) => {
    return template.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  }, messageTemplate.template);
}

// Helper function to get media URL (storage or external)
async function getMediaUrl(supabase: any, media: any): Promise<string> {
  // If media is stored locally, get signed URL
  if (media.storage_path) {
    try {
      const { data } = await supabase.storage
        .from('temp-media')
        .createSignedUrl(media.storage_path, 3600); // 1 hour expiry
      
      if (data?.signedUrl) {
        console.log(`Using stored media: ${media.storage_path}`);
        return data.signedUrl;
      }
    } catch (error) {
      console.warn(`Failed to get signed URL for ${media.storage_path}:`, error);
    }
  }
  
  // Fallback to external URL
  console.log(`Using external URL: ${media.src_url}`);
  return media.src_url;
}

async function handleDownloadMediaJob(job: any, supabase: any): Promise<boolean> {
  try {
    console.log('Handling download media job for:', job.payload.tweet_id);
    
    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: {
        action: 'download_media',
        tweet_id: job.payload.tweet_id
      }
    });

    if (error) {
      throw new Error(`Media processor error: ${error.message}`);
    }

    console.log('Media download completed for:', job.payload.tweet_id, data);
    return true;
  } catch (error) {
    console.error('Media download failed:', error);
    return false;
  }
}
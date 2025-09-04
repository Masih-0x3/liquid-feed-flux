import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

    console.log('Worker function invoked - processing pending jobs, trigger:', req.url);

    // Fetch more pending jobs for batch processing (increased from 10 to 20)
    // This reduces function invocations while maintaining efficiency
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .or(`next_run_at.lte.${new Date().toISOString()},next_run_at.is.null`)
      .order('created_at', { ascending: true })
      .limit(20);

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

    // Shape queue per chat and adapt spacing based on recent 429s
    const deliverJobs = (jobs || []).filter(j => j.type === 'deliver');
    const otherJobs = (jobs || []).filter(j => j.type !== 'deliver');

    const spacingMs = await computeAdaptiveSpacing(supabase);

    // Group deliver jobs by chat id (currently env-based; extendable later)
    const groups: Record<string, any[]> = {};
    for (const j of deliverJobs) {
      const key = await getChatIdForJob(j, supabase) || 'default';
      if (!groups[key]) groups[key] = [];
      groups[key].push(j);
    }

    const deliverJobsToRun: any[] = [];
    const nowMs = Date.now();
    for (const key of Object.keys(groups)) {
      const groupJobs = groups[key];
      if (groupJobs.length === 0) continue;
      // Sort by created_at to preserve order
      groupJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const [first, ...rest] = groupJobs;
      deliverJobsToRun.push(first);
      if (rest.length > 0) {
        const baseTime = nowMs + spacingMs; // first deferred after spacing
        for (let i = 0; i < rest.length; i++) {
          const job = rest[i];
          const plannedTime = new Date(baseTime + i * spacingMs);
          const currentNext = job.next_run_at ? new Date(job.next_run_at) : null;
          const shouldUpdate = !currentNext || currentNext.getTime() < plannedTime.getTime();
          if (shouldUpdate) {
            try {
              await supabase
                .from('jobs')
                .update({ next_run_at: plannedTime.toISOString() })
                .eq('id', job.id);
            } catch (_e) {}
          }
        }
      }
    }

    const toRunJobs = [...otherJobs, ...deliverJobsToRun];

    console.log(`Processing ${toRunJobs.length} jobs now (others deferred with spacing)`);

    // Mark only selected jobs as running
    const jobIds = toRunJobs.map(job => job.id);
    if (jobIds.length > 0) {
      await supabase
        .from('jobs')
        .update({ status: 'running' })
        .in('id', jobIds);
    }

    // Process selected jobs in parallel (deliver is at most 1)
    const jobPromises = toRunJobs.map(async (job) => {
      try {
        console.log(`Processing job ${job.id} of type ${job.type}`);

        // Initialize started_at and attempts
        if (!job.started_at) {
          try {
            await supabase
              .from('jobs')
              .update({ started_at: new Date().toISOString() })
              .eq('id', job.id);
          } catch (_e) {
            // best-effort
          }
        }

        // Emit pipeline_events: running
        await recordPipelineEvent(supabase, job, 'running');

        // Update attempt count for this specific job
        await supabase
          .from('jobs')
          .update({ attempts: job.attempts + 1 })
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
            case 'reprocess':
              success = await handleReprocessJob(job, supabase);
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
                last_error: null,
                completed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            await recordPipelineEvent(supabase, job, 'completed');

            console.log(`Job ${job.id} completed successfully`);
            return { success: true, jobId: job.id };
          } else {
            await handleJobFailure(supabase, job);
            await recordPipelineEvent(supabase, job, 'failed');
            return { success: false, jobId: job.id };
          }

        } catch (error) {
          console.error(`Job ${job.id} failed:`, error);
          await handleJobFailure(supabase, job, error as any);
          await recordPipelineEvent(supabase, job, 'failed', (error as any)?.message ?? 'Failed');
          return { success: false, jobId: job.id, error: (error as any)?.message };
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        await handleJobFailure(supabase, job, error as any);
        await recordPipelineEvent(supabase, job, 'failed', (error as any)?.message ?? 'Failed');
        return { success: false, jobId: job.id, error: (error as any)?.message };
      }
    });

    // Wait for all jobs to complete
    const results = await Promise.allSettled(jobPromises);
    
    let processedCount = 0;
    let failedCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        processedCount++;
      } else {
        failedCount++;
        if (result.status === 'rejected') {
          console.error(`Job promise rejected:`, result.reason);
        }
      }
    });

    console.log(`Worker completed: ${processedCount} successful, ${failedCount} failed`);

    // Auto-chain: if next deliver job is due within ~1.5s, invoke worker again
    try {
      const THRESHOLD_MS = 1500;
      const { data: nextDeliver } = await supabase
        .from('jobs')
        .select('next_run_at')
        .eq('status', 'pending')
        .eq('type', 'deliver')
        .not('next_run_at', 'is', null)
        .order('next_run_at', { ascending: true })
        .limit(1)
        .single();
      if (nextDeliver?.next_run_at) {
        const nextAt = new Date(nextDeliver.next_run_at).getTime();
        const delta = nextAt - Date.now();
        if (delta <= THRESHOLD_MS) {
          console.log(`Auto-chaining worker; next deliver due in ${delta}ms`);
          await supabase.functions.invoke('worker', { body: { trigger: 'autochain' } });
        }
      }
    } catch (_e) {
      // best-effort
    }

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

    // Get the post to translate - simplified logic
    const { data: post, error } = await supabase
      .from('posts')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .single();

    if (error || !post) {
      throw new Error(`Post not found: ${job.payload.tweet_id}`);
    }

    if (!post.text_original) {
      throw new Error('No original text to translate');
    }

    console.log('Translating text:', post.text_original);

    // Simple translation prompt for English to Persian
    const systemPrompt = "You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.";
    
    // Use GPT-4o-mini for consistent translation
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: post.text_original }
        ],
        temperature: 0.2,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} ${errorData}`);
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content ?? '';

    console.log('Translation completed:', translatedText);

    // Update job with result_meta (model, tokens, timings)
    const nowIso = new Date().toISOString();
    const resultMeta: any = {
      model: 'gpt-4o-mini',
      usage: data.usage ?? null,
      finished_at: nowIso
    };
    try {
      await supabase
        .from('jobs')
        .update({ result_meta: resultMeta })
        .eq('id', job.id);
    } catch (_e) {
      // best-effort
    }

    // Update post with translation and provenance
    const { error: updateError } = await supabase
      .from('posts')
      .update({ 
        text_translated: translatedText,
        lang_original: 'en',
        translated_at: nowIso,
        translation_model: 'gpt-4o-mini',
        translation_tokens: data?.usage?.total_tokens ?? null,
        translation_duration_ms: job.started_at ? (Date.now() - new Date(job.started_at).getTime()) : null
      })
      .eq('tweet_id', job.payload.tweet_id);

    if (updateError) {
      console.error('Error updating post:', updateError);
      throw updateError;
    }

    console.log('Translation completed for:', job.payload.tweet_id);
    
    // After successful translation, create a delivery job
    const { data: newDeliverJob, error: deliveryJobError } = await supabase
      .from('jobs')
      .insert({
        type: 'deliver',
        payload: {
          tweet_id: job.payload.tweet_id
        },
        status: 'pending'
      })
      .select()
      .single();

    if (deliveryJobError) {
      console.warn('Failed to create delivery job after translation:', deliveryJobError);
    } else {
      console.log('Delivery job created after translation for:', job.payload.tweet_id);
      // Queue delivery pipeline event
      await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'deliver', 'queued', null, null, null, { source: 'worker' });
      // Ensure a pending delivery row exists (for Queue Delivery step visibility)
      try {
        const { data: existingDel } = await supabase
          .from('deliveries')
          .select('id')
          .eq('subject_type', 'post')
          .eq('subject_id', job.payload.tweet_id)
          .eq('status', 'pending')
          .limit(1);
        if (!existingDel || existingDel.length === 0) {
          await supabase
            .from('deliveries')
            .insert({
              subject_type: 'post',
              subject_id: job.payload.tweet_id,
              status: 'pending',
              last_error: null,
              attempts: 0,
              telegram_chat_id: null
            });
        }
      } catch (_e) {
        // best-effort
      }
    }
    
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

    // Get account info from the post (simplified - no need for account_id in payload)
    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', post.account_id)
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

    // Idempotency: skip if already posted for this subject/chat
    try {
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('id')
        .eq('subject_type', 'post')
        .eq('subject_id', job.payload.tweet_id)
        .eq('status', 'posted')
        .eq('telegram_chat_id', telegramChatId)
        .limit(1);
      if (existingDelivery && existingDelivery.length > 0) {
        console.log('Skipping duplicate delivery (same subject already posted):', job.payload.tweet_id);
        await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'deliver', 'completed', null, new Date().toISOString(), null, { skipped: 'duplicate_subject' });
        return true;
      }
    } catch (_e) {}

    // Cross-subject dedupe by canonical URL (same link tweeted/retweeted)
    if (post.url) {
      try {
        const { data: siblingPosts } = await supabase
          .from('posts')
          .select('tweet_id')
          .eq('url', post.url);
        const siblingIds = (siblingPosts || []).map((p: any) => p.tweet_id);
        if (siblingIds.length > 0) {
          const { data: siblingDeliveries } = await supabase
            .from('deliveries')
            .select('id')
            .eq('status', 'posted')
            .eq('subject_type', 'post')
            .in('subject_id', siblingIds)
            .eq('telegram_chat_id', telegramChatId)
            .limit(1);
          if (siblingDeliveries && siblingDeliveries.length > 0) {
            console.log('Skipping duplicate delivery (same URL already posted):', post.url);
            await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'deliver', 'completed', null, new Date().toISOString(), null, { skipped: 'duplicate_url', url: post.url });
            return true;
          }
        }
      } catch (_e) {}
    }

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
              parse_mode: 'Markdown'
            })
          });
          
          const result = await response.json();
          if (result.ok) {
            telegramMessageIds.push(result.result.message_id.toString());
          } else {
            // Retry once without Markdown on parse errors
            if (isTelegramParseError(result?.description ?? '')) {
              const retryPayload = {
                chat_id: telegramChatId,
                photo: imageUrl,
                caption: stripMarkdownToPlain(message)
              } as any;
              const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryPayload)
              });
              const retryRes = await retryResp.json();
              if (retryRes?.ok) {
                telegramMessageIds.push(retryRes.result.message_id.toString());
              } else {
                const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
                if (retryAfter != null) {
                  throw new TelegramRateLimitError(`Telegram sendPhoto failed: ${result.description}`, retryAfter);
                }
                throw new Error(`Telegram sendPhoto failed: ${result.description}`);
              }
            } else {
            const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
            if (retryAfter != null) {
              throw new TelegramRateLimitError(`Telegram sendPhoto failed: ${result.description}`, retryAfter);
            }
            throw new Error(`Telegram sendPhoto failed: ${result.description}`);
            }
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
              parse_mode: i === 0 ? 'Markdown' : undefined
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
            if (isTelegramParseError(result?.description ?? '')) {
              // Retry without parse_mode on caption
              const retryGroup = mediaGroup.map((m: any, idx: number) => ({
                type: m.type,
                media: m.media,
                caption: idx === 0 && m.caption ? stripMarkdownToPlain(m.caption) : undefined
              }));
              const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: telegramChatId, media: retryGroup })
              });
              const retryRes = await retryResp.json();
              if (retryRes?.ok) {
                telegramMessageIds = retryRes.result.map((msg: any) => msg.message_id.toString());
              } else {
                const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
                if (retryAfter != null) {
                  throw new TelegramRateLimitError(`Telegram sendMediaGroup failed: ${result.description}`, retryAfter);
                }
                throw new Error(`Telegram sendMediaGroup failed: ${result.description}`);
              }
            } else {
              const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
              if (retryAfter != null) {
                throw new TelegramRateLimitError(`Telegram sendMediaGroup failed: ${result.description}`, retryAfter);
              }
              throw new Error(`Telegram sendMediaGroup failed: ${result.description}`);
            }
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
            parse_mode: 'Markdown'
          })
        });
        
        const result = await response.json();
        if (result.ok) {
          telegramMessageIds.push(result.result.message_id.toString());
        } else {
          if (isTelegramParseError(result?.description ?? '')) {
            const retryPayload = { chat_id: telegramChatId, video: videoUrl, caption: stripMarkdownToPlain(message) } as any;
            const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendVideo`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryPayload)
            });
            const retryRes = await retryResp.json();
            if (retryRes?.ok) {
              telegramMessageIds.push(retryRes.result.message_id.toString());
            } else {
              const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
              if (retryAfter != null) {
                throw new TelegramRateLimitError(`Telegram sendVideo failed: ${result.description}`, retryAfter);
              }
              console.warn(`Failed to send video: ${result.description}`);
            }
          } else {
            const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
            if (retryAfter != null) {
              throw new TelegramRateLimitError(`Telegram sendVideo failed: ${result.description}`, retryAfter);
            }
            console.warn(`Failed to send video: ${result.description}`);
          }
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
            parse_mode: 'Markdown'
          })
        });
        
        const result = await response.json();
        if (result.ok) {
          telegramMessageIds.push(result.result.message_id.toString());
        } else {
          if (isTelegramParseError(result?.description ?? '')) {
            const retryPayload = { chat_id: telegramChatId, audio: audioUrl, caption: images.length === 0 && videos.length === 0 ? stripMarkdownToPlain(message) : 'Audio from tweet' } as any;
            const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendAudio`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryPayload)
            });
            const retryRes = await retryResp.json();
            if (retryRes?.ok) {
              telegramMessageIds.push(retryRes.result.message_id.toString());
            } else {
              const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
              if (retryAfter != null) {
                throw new TelegramRateLimitError(`Telegram sendAudio failed: ${result.description}`, retryAfter);
              }
              console.warn(`Failed to send audio: ${result.description}`);
            }
          } else {
            const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
            if (retryAfter != null) {
              throw new TelegramRateLimitError(`Telegram sendAudio failed: ${result.description}`, retryAfter);
            }
            console.warn(`Failed to send audio: ${result.description}`);
          }
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
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      });
      
      const result = await response.json();
      if (result.ok) {
        telegramMessageIds.push(result.result.message_id.toString());
      } else {
        if (isTelegramParseError(result?.description ?? '')) {
          const retryPayload = { chat_id: telegramChatId, text: stripMarkdownToPlain(message), disable_web_page_preview: false } as any;
          const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryPayload)
          });
          const retryRes = await retryResp.json();
          if (retryRes?.ok) {
            telegramMessageIds.push(retryRes.result.message_id.toString());
          } else {
            const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
            if (retryAfter != null) {
              throw new TelegramRateLimitError(`Telegram sendMessage failed: ${result.description}`, retryAfter);
            }
            throw new Error(`Telegram sendMessage failed: ${result.description}`);
          }
        } else {
          const retryAfter = extractTelegramRetryAfter(result, result?.description ?? '', response.status);
          if (retryAfter != null) {
            throw new TelegramRateLimitError(`Telegram sendMessage failed: ${result.description}`, retryAfter);
          }
          throw new Error(`Telegram sendMessage failed: ${result.description}`);
        }
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
        status: 'posted',
        posted_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        attempts: 1
      });

    if (deliveryError) {
      console.warn('Failed to record delivery:', deliveryError);
    }

    console.log(`Successfully delivered tweet ${job.payload.tweet_id} to Telegram`);
    // Emit delivery completed pipeline event
    await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'deliver', 'completed', null, new Date().toISOString(), null, { message_ids: telegramMessageIds });
    return true;

  } catch (error) {
    console.error('Delivery failed:', error);
    await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'deliver', 'failed', null, null, (error as any)?.message ?? 'Delivery failed');
    return false;
  }
}

async function handleJobFailure(supabase: any, job: any, errorOrMessage?: any) {
  const maxAttempts = 5;
  const baseDelay = 60; // 1 minute base delay
  
  if (job.attempts >= maxAttempts) {
    // Mark as failed permanently
    await supabase
      .from('jobs')
      .update({ 
        status: 'failed',
        last_error: (typeof errorOrMessage === 'string' ? errorOrMessage : (errorOrMessage?.message || 'Max attempts reached'))
      })
      .eq('id', job.id);
    
    console.log(`Job ${job.id} marked as permanently failed after ${job.attempts} attempts`);
  } else {
    // Telegram-aware backoff: honor retry_after if available, else exponential backoff
    let retryAfterSeconds: number | null = null;
    if (errorOrMessage && typeof errorOrMessage === 'object' && typeof errorOrMessage.retryAfterSeconds === 'number') {
      retryAfterSeconds = Math.max(1, Math.floor(errorOrMessage.retryAfterSeconds));
    } else if (typeof errorOrMessage === 'string') {
      retryAfterSeconds = parseRetryAfterFromMessage(errorOrMessage);
    } else if (errorOrMessage?.message) {
      retryAfterSeconds = parseRetryAfterFromMessage(errorOrMessage.message);
    }

    let nextRunAt: Date;
    if (retryAfterSeconds != null) {
      // add small jitter up to +20%
      const jitter = Math.floor(retryAfterSeconds * (Math.random() * 0.2));
      const delayMs = (retryAfterSeconds + jitter) * 1000;
      nextRunAt = new Date(Date.now() + delayMs);
      console.log(`Job ${job.id} hit Telegram rate limit. Scheduling retry after ~${retryAfterSeconds + jitter}s`);
    } else {
      const delayMinutes = baseDelay * Math.pow(2, job.attempts);
      nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000);
      console.log(`Job ${job.id} scheduled for retry in ${delayMinutes} minutes`);
    }

    await supabase
      .from('jobs')
      .update({ 
        status: 'pending',
        last_error: (typeof errorOrMessage === 'string' ? errorOrMessage : (errorOrMessage?.message || 'Processing failed')),
        next_run_at: nextRunAt.toISOString()
      })
      .eq('id', job.id);
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
      `[${messageTemplate.source_link_text}](${post.url})` : '',
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
    await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'media', 'running', new Date().toISOString());
    
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
    await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'media', 'completed', null, new Date().toISOString());
    return true;
  } catch (error) {
    console.error('Media download failed:', error);
    await insertPipelineEvent(supabase, 'post', job.payload.tweet_id, 'media', 'failed', null, null, (error as any)?.message ?? 'Download failed');
    return false;
  }
}

async function handleReprocessJob(job: any, supabase: any): Promise<boolean> {
  try {
    console.log('Handling reprocess job for:', job.payload.tweet_id);
    
    // Get the post data
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('*')
      .eq('tweet_id', job.payload.tweet_id)
      .single();

    if (postError || !post) {
      throw new Error(`Post not found: ${job.payload.tweet_id}`);
    }

    // Re-extract media from the text content using the same logic as webhook
    const mediaItems = extractMediaFromText(post.text_original);
    console.log(`Re-extracted ${mediaItems.length} media items from text:`, post.text_original);

    // Delete existing media records for this tweet to avoid conflicts
    await supabase
      .from('media')
      .delete()
      .eq('tweet_id', job.payload.tweet_id);

    // Insert new media items if found
    if (mediaItems.length > 0) {
      const { error: mediaError } = await supabase
        .from('media')
        .insert(
          mediaItems.map((media, index) => ({
            tweet_id: job.payload.tweet_id,
            kind: media.type,
            src_url: media.url,
            width: media.width,
            height: media.height,
            duration_ms: media.duration,
            ordering: index
          }))
        );

      if (mediaError) {
        console.error('Error inserting media:', mediaError);
      } else {
        console.log(`Inserted ${mediaItems.length} media items for ${job.payload.tweet_id}`);
        
        // Update post to mark it as having media
        await supabase
          .from('posts')
          .update({ has_media: true })
          .eq('tweet_id', job.payload.tweet_id);

        // Create media download job
        await supabase
          .from('jobs')
          .insert({
            type: 'download_media',
            payload: { tweet_id: job.payload.tweet_id },
            status: 'pending'
          });
      }
    } else {
      // Update post to mark it as not having media
      await supabase
        .from('posts')
        .update({ has_media: false })
        .eq('tweet_id', job.payload.tweet_id);
    }

    // Create translation job
    await supabase
      .from('jobs')
      .insert({
        type: 'translate',
        payload: { tweet_id: job.payload.tweet_id },
        status: 'pending'
      });

    console.log('Reprocess completed for:', job.payload.tweet_id);
    return true;
  } catch (error) {
    console.error('Reprocess failed:', error);
    return false;
  }
}

function extractMediaFromText(text: string): Array<{type: string, url: string, width?: number, height?: number, duration?: number}> {
  const mediaItems: Array<{type: string, url: string, width?: number, height?: number, duration?: number}> = [];
  
  if (text) {
    // Extract Twitter media URLs from text content - but skip pic.twitter.com as they're not direct media URLs
    const twitterMediaRegex = /pic\.twitter\.com\/[a-zA-Z0-9]+/g;
    const twitterMatches = text.match(twitterMediaRegex);
    if (twitterMatches) {
      console.log(`Found ${twitterMatches.length} pic.twitter.com URLs in text, but skipping as they are not direct media URLs`);
      // Skip pic.twitter.com URLs as they are Twitter's short URLs that don't work for direct media access
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
  
  return mediaItems;
}

// Pipeline events helpers
async function recordPipelineEvent(supabase: any, job: any, state: 'running' | 'completed' | 'failed', error?: string) {
  try {
    const subjectType = job.payload?.subject_type ?? 'post';
    const subjectId = job.payload?.tweet_id ?? job.payload?.subject_id ?? null;
    if (!subjectId) return;
    const step = normalizeStep(job.type);
    const now = new Date().toISOString();
    const startedAt = state === 'running' ? now : null;
    const endedAt = state === 'completed' ? now : null;
    await insertPipelineEvent(supabase, subjectType, subjectId, step, state, startedAt, endedAt, error);
  } catch (_e) {
    // best-effort
  }
}

function normalizeStep(type: string): string {
  switch (type) {
    case 'translate':
      return 'translate';
    case 'deliver':
      return 'deliver';
    case 'download_media':
      return 'media';
    case 'moderate':
      return 'moderate';
    default:
      return type;
  }
}

async function insertPipelineEvent(
  supabase: any,
  subjectType: string,
  subjectId: string,
  step: string,
  status: string,
  startedAt?: string | null,
  endedAt?: string | null,
  error?: string | null,
  meta?: any
) {
  try {
    await supabase
      .from('pipeline_events' as any)
      .insert({
        subject_type: subjectType,
        subject_id: subjectId,
        step,
        status,
        started_at: startedAt ?? null,
        ended_at: endedAt ?? null,
        error: error ?? null,
        meta: meta ?? null
      });
  } catch (_e) {
    // best-effort
  }
}

// Telegram rate limit helpers
class TelegramRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'TelegramRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function extractTelegramRetryAfter(result: any, description: string, statusCode: number): number | null {
  try {
    if (statusCode === 429) {
      const apiParam = result?.parameters?.retry_after;
      if (typeof apiParam === 'number' && isFinite(apiParam)) {
        return Math.max(1, Math.floor(apiParam));
      }
    }
    const parsed = parseRetryAfterFromMessage(description);
    if (parsed != null) return parsed;
  } catch (_e) {}
  return null;
}

function parseRetryAfterFromMessage(message: string): number | null {
  if (!message) return null;
  const m = message.match(/retry\s+after\s+(\d+)/i);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    return isFinite(n) ? Math.max(1, n) : null;
  }
  return null;
}

function isTelegramParseError(description: string): boolean {
  if (!description) return false;
  return /can't parse entities/i.test(description) || /parse_mode/i.test(description);
}

function stripMarkdownToPlain(text: string): string {
  if (!text) return text;
  // Remove common Markdown special characters that trigger Telegram parser
  return text
    .replace(/[\\*_`\[\]()~>#+=|{}.!-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Adaptive spacing: tighten when no recent 429s; loosen on recent 429s
async function computeAdaptiveSpacing(supabase: any): Promise<number> {
  try {
    // Look back 2 minutes for Too Many Requests
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('pipeline_events' as any)
      .select('id', { count: 'exact', head: true })
      .eq('step', 'deliver')
      .eq('status', 'failed')
      .gte('started_at', twoMinutesAgo)
      .ilike('error', '%Too Many Requests%');
    if ((count ?? 0) === 0) {
      return 800; // 0.8s spacing if clear
    }
  } catch (_e) {}
  return 1500; // 1.5s spacing when throttling observed or unknown
}

// Resolve chat id per job (extendable: map account->chat); default env chat id
async function getChatIdForJob(_job: any, _supabase: any): Promise<string | null> {
  try {
    const chat = (Deno as any).env.get('TELEGRAM_CHAT_ID');
    return chat || null;
  } catch (_e) {
    return null;
  }
}
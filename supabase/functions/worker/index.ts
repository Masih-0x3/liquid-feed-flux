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

    console.log('Worker function invoked');

    // Fetch next pending job
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('next_run_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1);

    if (jobError) {
      console.error('Error fetching jobs:', jobError);
      throw jobError;
    }

    if (!jobs || jobs.length === 0) {
      console.log('No pending jobs found');
      return new Response(JSON.stringify({ message: 'No pending jobs' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const job = jobs[0];
    console.log('Processing job:', job.id, 'type:', job.type);

    // Mark job as running
    await supabase
      .from('jobs')
      .update({ status: 'running' })
      .eq('id', job.id);

    let result;
    try {
      switch (job.type) {
        case 'translate':
          result = await handleTranslateJob(job, supabase);
          break;
        case 'moderate':
          result = await handleModerateJob(job, supabase);
          break;
        case 'deliver':
          result = await handleDeliverJob(job, supabase);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Mark job as completed
      await supabase
        .from('jobs')
        .update({ status: 'completed' })
        .eq('id', job.id);

      console.log('Job completed successfully:', job.id);

    } catch (error) {
      console.error('Job failed:', job.id, error);
      
      // Update job with error and increment attempts
      await supabase
        .from('jobs')
        .update({
          status: 'failed',
          last_error: error.message,
          attempts: job.attempts + 1,
          // Retry in 5 minutes for failed jobs
          next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        })
        .eq('id', job.id);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      jobId: job.id, 
      jobType: job.type 
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

async function handleTranslateJob(job: any, supabase: any) {
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
          content: `Translate the following text to ${job.payload.target_language || 'English'}. Maintain the original tone and style.`
        },
        {
          role: 'user',
          content: post.text_original
        }
      ],
      max_tokens: 1000,
      temperature: 0
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  const translatedText = data.choices[0].message.content;

  // Update post with translation
  const { error: updateError } = await supabase
    .from('posts')
    .update({ text_translated: translatedText })
    .eq('tweet_id', job.payload.tweet_id);

  if (updateError) {
    throw updateError;
  }

  console.log('Translation completed for:', job.payload.tweet_id);
}

async function handleModerateJob(job: any, supabase: any) {
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
}

async function handleDeliverJob(job: any, supabase: any) {
  console.log('Handling deliver job for:', job.payload.subject_id);
  
  const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const telegramChatId = Deno.env.get('TELEGRAM_CHAT_ID');
  
  if (!telegramBotToken || !telegramChatId) {
    throw new Error('Telegram configuration not set');
  }

  let message = '';
  if (job.payload.subject_type === 'post') {
    const { data: post } = await supabase
      .from('posts')
      .select('text_translated, text_original, url')
      .eq('tweet_id', job.payload.subject_id)
      .single();
    
    message = post?.text_translated || post?.text_original || '';
    if (post?.url) {
      message += `\n\nSource: ${post.url}`;
    }
  }

  if (!message) {
    throw new Error('No content to deliver');
  }

  // Send to Telegram
  const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      parse_mode: 'HTML'
    }),
  });

  if (!telegramResponse.ok) {
    throw new Error(`Telegram API error: ${telegramResponse.statusText}`);
  }

  const telegramData = await telegramResponse.json();

  // Record delivery
  const { error } = await supabase
    .from('deliveries')
    .insert([{
      subject_type: job.payload.subject_type,
      subject_id: job.payload.subject_id,
      telegram_chat_id: telegramChatId,
      telegram_message_ids: [telegramData.result.message_id.toString()],
      status: 'posted'
    }]);

  if (error) {
    throw error;
  }

  console.log('Delivery completed for:', job.payload.subject_id, 'message_id:', telegramData.result.message_id);
}
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

    const { retention_days = 7, batch_limit = 5000, dry_run = false } = await req.json().catch(() => ({}));
    console.log(JSON.stringify({ function: 'db-cleanup', action: 'start', retention_days, batch_limit, dry_run }));

    if (dry_run) {
      // Return counts of what would be deleted without actually deleting
      const cutoff = new Date(Date.now() - retention_days * 86400000).toISOString();

      const [peCount, jobsCount] = await Promise.all([
        supabase.from('pipeline_events').select('id', { count: 'exact', head: true }).lt('created_at', cutoff),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['completed', 'failed']).lt('created_at', cutoff),
      ]);

      const result = {
        dry_run: true,
        would_delete: {
          pipeline_events: peCount.count || 0,
          completed_failed_jobs: jobsCount.count || 0,
        },
        retention_days,
        cutoff_date: cutoff,
      };

      console.log(JSON.stringify({ function: 'db-cleanup', action: 'dry_run_complete', ...result }));
      return new Response(JSON.stringify({ success: true, results: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Actual cleanup via RPC
    const { data, error } = await supabase.rpc('cleanup_old_data', { retention_days, batch_limit });
    if (error) {
      console.error(JSON.stringify({ function: 'db-cleanup', action: 'rpc_error', error: error.message }));
      throw error;
    }

    console.log(JSON.stringify({ function: 'db-cleanup', action: 'cleanup_complete', results: data }));

    // Also trigger media storage cleanup
    let mediaResult = null;
    try {
      const { data: mediaData, error: mediaError } = await supabase.functions.invoke('media-processor', {
        body: { action: 'cleanup_old_media' },
      });
      if (mediaError) {
        console.error(JSON.stringify({ function: 'db-cleanup', action: 'media_cleanup_error', error: mediaError.message }));
      } else {
        mediaResult = mediaData;
        console.log(JSON.stringify({ function: 'db-cleanup', action: 'media_cleanup_complete', results: mediaData }));
      }
    } catch (e) {
      console.error(JSON.stringify({ function: 'db-cleanup', action: 'media_invoke_failed', error: (e as Error).message }));
    }

    return new Response(JSON.stringify({ success: true, results: data, media_cleanup: mediaResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(JSON.stringify({ function: 'db-cleanup', action: 'error', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

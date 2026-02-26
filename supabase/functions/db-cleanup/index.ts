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

    const { retention_days = 7, batch_size = 5000, table } = await req.json().catch(() => ({}));

    const cutoff = new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000).toISOString();
    console.log(`Cleanup: retention=${retention_days}d, batch=${batch_size}, cutoff=${cutoff}, table=${table || 'all'}`);

    const results: Record<string, number> = {};

    // Delete in batches to avoid timeouts
    async function batchDelete(tableName: string, dateCol: string, extraFilter?: string) {
      let totalDeleted = 0;
      let deleted = 0;
      do {
        const filter = extraFilter ? `AND ${extraFilter}` : '';
        const sql = `DELETE FROM ${tableName} WHERE ctid IN (
          SELECT ctid FROM ${tableName} WHERE ${dateCol} < '${cutoff}' ${filter} LIMIT ${batch_size}
        )`;
        
        // Use raw SQL via supabase-js isn't possible, so use rpc
        // Instead, delete via the supabase client in chunks
        const { count, error } = await supabase
          .from(tableName.replace('public.', ''))
          .delete({ count: 'exact' })
          .lt(dateCol, cutoff)
          .limit(batch_size);
        
        if (error) {
          console.error(`Error deleting from ${tableName}:`, error);
          break;
        }
        deleted = count || 0;
        totalDeleted += deleted;
        console.log(`Deleted ${deleted} from ${tableName} (total: ${totalDeleted})`);
      } while (deleted >= batch_size);
      
      return totalDeleted;
    }

    // Clean tables based on request or all
    if (!table || table === 'pipeline_events') {
      results.pipeline_events = await batchDelete('pipeline_events', 'created_at');
    }

    if (!table || table === 'jobs') {
      // Only delete completed/failed jobs
      let totalDeleted = 0;
      let deleted = 0;
      do {
        const { count, error } = await supabase
          .from('jobs')
          .delete({ count: 'exact' })
          .lt('created_at', cutoff)
          .in('status', ['completed', 'failed'])
          .limit(batch_size);
        if (error) { console.error('Error deleting jobs:', error); break; }
        deleted = count || 0;
        totalDeleted += deleted;
        console.log(`Deleted ${deleted} jobs (total: ${totalDeleted})`);
      } while (deleted >= batch_size);
      results.jobs = totalDeleted;
    }

    // For cron and net tables, use the rpc function (they're not in public schema)
    if (!table || table === 'cron') {
      try {
        const { data } = await supabase.rpc('cleanup_old_data', { retention_days });
        if (data) {
          results.cron_logs = data.deleted_cron_logs || 0;
          results.http_responses = data.deleted_http_responses || 0;
        }
      } catch (e) {
        console.error('RPC cleanup error (cron/net):', e);
      }
    }

    console.log('Final results:', JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

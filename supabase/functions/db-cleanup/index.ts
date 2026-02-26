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

    const { retention_days = 7, batch_limit = 5000 } = await req.json().catch(() => ({}));
    console.log(`Running cleanup: retention=${retention_days}d, batch=${batch_limit}`);

    // Use the DB function directly which has its own 120s timeout
    const { data, error } = await supabase.rpc('cleanup_old_data', { retention_days, batch_limit });
    
    if (error) {
      console.error('RPC error:', error);
      throw error;
    }

    console.log('Cleanup results:', JSON.stringify(data));

    return new Response(JSON.stringify({ success: true, results: data }), {
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

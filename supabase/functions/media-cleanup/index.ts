import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function validateInternalToken(req: Request): Response | null {
  const token = req.headers.get('x-internal-token') || '';
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET') || '';
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (expected && token === expected) return null;
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;
  if (anonKey && authHeader === `Bearer ${anonKey}`) return null;
  if (!expected) return null;

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authError = validateInternalToken(req);
  if (authError) return authError;

  try {
    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(JSON.stringify({ function: 'media-cleanup', action: 'start' }));

    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: { action: 'cleanup_old_media' },
      headers: { 'x-internal-token': Deno.env.get('WEBHOOK_SHARED_SECRET') || '' }
    } as Record<string, unknown>);

    if (error) {
      console.error(JSON.stringify({ function: 'media-cleanup', action: 'invoke_error', error: error.message }));
      throw new Error(`Media cleanup error: ${error.message}`);
    }

    console.log(JSON.stringify({ function: 'media-cleanup', action: 'complete', deleted: data?.deleted ?? 0, failed: data?.failed ?? 0 }));

    return new Response(JSON.stringify({ success: true, message: 'Media cleanup completed', result: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'media-cleanup', action: 'error', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

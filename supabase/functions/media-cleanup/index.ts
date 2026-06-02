import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireInternalAuth, serviceRoleBearerHeader } from "../_shared/internalAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const authError = await requireInternalAuth(req, supabase, corsHeaders);
  if (authError) return authError;

  try {

    console.log(JSON.stringify({ function: 'media-cleanup', action: 'start' }));

    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const daysOld = typeof reqBody.days_old === 'number' ? Math.max(1, Math.min(365, Math.floor(reqBody.days_old))) : 1;
    const dryRun = reqBody.dry_run === true;
    console.log(JSON.stringify({ function: 'media-cleanup', action: 'invoke_processor', days_old: daysOld, dry_run: dryRun }));

    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: { action: 'cleanup_old_media', days_old: daysOld, dry_run: dryRun },
      headers: serviceRoleBearerHeader()
    } as Record<string, unknown>);

    if (error) {
      console.error(JSON.stringify({ function: 'media-cleanup', action: 'invoke_error', error: error.message }));
      throw new Error(`Media cleanup error: ${error.message}`);
    }

    console.log(JSON.stringify({ function: 'media-cleanup', action: 'complete', dry_run: dryRun, deleted: data?.deleted ?? 0, failed: data?.failed ?? 0, would_delete: data?.would_delete ?? 0 }));

    return new Response(JSON.stringify({ success: true, dry_run: dryRun, message: dryRun ? 'Media cleanup dry run completed' : 'Media cleanup completed', result: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'media-cleanup', action: 'error', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

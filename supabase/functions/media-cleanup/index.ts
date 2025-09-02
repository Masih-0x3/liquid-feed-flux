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

    console.log('Media cleanup scheduled job started');

    // Call the media processor to clean up old media
    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: {
        action: 'cleanup_old_media'
      }
    });

    if (error) {
      throw new Error(`Media cleanup error: ${error.message}`);
    }

    console.log('Media cleanup completed:', data);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Media cleanup completed',
      result: data
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Media cleanup failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
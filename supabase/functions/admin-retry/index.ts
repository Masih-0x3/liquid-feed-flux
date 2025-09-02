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

    const { delivery_id } = await req.json();
    
    if (!delivery_id) {
      throw new Error('delivery_id is required');
    }

    console.log('Retrying delivery:', delivery_id);

    // Get the delivery
    const { data: delivery, error: deliveryError } = await supabase
      .from('deliveries')
      .select('*')
      .eq('id', delivery_id)
      .single();

    if (deliveryError || !delivery) {
      throw new Error('Delivery not found');
    }

    // Create a new delivery job
    const { error: jobError } = await supabase
      .from('jobs')
      .insert([{
        type: 'deliver',
        payload: {
          subject_type: delivery.subject_type,
          subject_id: delivery.subject_id
        },
        status: 'pending',
        next_run_at: new Date().toISOString()
      }]);

    if (jobError) {
      throw jobError;
    }

    // Reset delivery status
    const { error: updateError } = await supabase
      .from('deliveries')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null
      })
      .eq('id', delivery_id);

    if (updateError) {
      throw updateError;
    }

    console.log('Delivery retry scheduled:', delivery_id);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Delivery retry scheduled' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Retry error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
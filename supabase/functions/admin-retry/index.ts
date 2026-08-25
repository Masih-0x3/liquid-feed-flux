import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";
import {
  evaluateExternalPosting,
  externalPostingBlockedResponse,
} from "../_shared/externalPostingGuard.ts";
import { requireDeliveryCutover } from "../_shared/deliveryCutover.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
initSentryEdge();

// Helper: validate JWT and check admin role
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: missing token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAuth = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check admin role using service client (bypasses RLS)
  const serviceClient = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: roleData } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require admin auth for all actions
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { delivery_id, action, tweet_id } = body;

    if (action === 'test_template' || action === 'test_webhook') {
      return new Response(JSON.stringify({
        success: false,
        code: 'delivery_cutover_blocked',
        error: action === 'test_template'
          ? 'Synthetic Telegram template tests are disabled during the immutable delivery cutover'
          : 'Synthetic webhook tests are disabled during the immutable delivery cutover',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      });
    }

    const postingDecision = await evaluateExternalPosting(supabase);
    if (!postingDecision.allowed) {
      return externalPostingBlockedResponse(postingDecision.reason, corsHeaders);
    }

    console.log(JSON.stringify({ function: 'admin-retry', action: action || 'retry_delivery', admin_user: authResult.userId }));

    // Handle resend delivery action
    if (action === 'resend_delivery') {
      if (!tweet_id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'tweet_id is required for resend_delivery action' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      // Reject historical or ambiguous lineage before inserting any retry
      // job. The database trigger remains the final bypass-resistant guard.
      try {
        await requireDeliveryCutover(supabase, String(tweet_id));
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          code: "delivery_cutover_blocked",
          error: error instanceof Error ? error.message : String(error),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        });
      }

      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('account_id')
        .eq('tweet_id', tweet_id)
        .single();

      if (postError || !postData) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Post not found' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        });
      }

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          type: 'deliver',
          payload: { 
            tweet_id: tweet_id,
            account_id: postData.account_id
          },
          status: 'pending',
          next_run_at: new Date().toISOString()
        })
        .select()
        .single();

      if (jobError) {
        console.error('Error creating delivery job:', jobError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to create delivery job' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }

      try {
        await supabase
          .from('pipeline_events')
          .insert({
            subject_type: 'post',
            subject_id: tweet_id,
            step: 'deliver',
            status: 'queued',
            started_at: new Date().toISOString(),
            meta: { source: 'admin-retry', admin_user: authResult.userId }
          });
      } catch (_e) {}

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Delivery job created successfully',
        tweet_id: tweet_id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle retry failed deliveries action
    if (action === 'retry_failed_deliveries') {
      const { data: failedDeliveries, error: deliveryError } = await supabase
        .from('deliveries')
        .select('*')
        .eq('status', 'failed');

      if (deliveryError) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch failed deliveries' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }

      const failedRows = failedDeliveries || [];
      const failedTweetIds = Array.from(new Set(
        failedRows.map((delivery) => String(delivery.subject_id ?? '')).filter(Boolean),
      ));
      const { data: cutoverAt, error: cutoverError } = await supabase.rpc(
        'get_delivery_cutover',
      );
      if (cutoverError || typeof cutoverAt !== 'string') {
        return new Response(JSON.stringify({
          success: false,
          code: 'delivery_cutover_unavailable',
          error: cutoverError?.message ?? 'delivery cutover is not initialized',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503,
        });
      }
      const { data: lineageRows, error: lineageError } = await supabase
        .from('posts')
        .select('tweet_id, created_at')
        .in('tweet_id', failedTweetIds);
      if (lineageError) {
        return new Response(JSON.stringify({
          success: false,
          code: 'delivery_cutover_lineage_unavailable',
          error: lineageError.message,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503,
        });
      }
      const eligibleIds = new Set(
        (lineageRows || [])
          .filter((row) => new Date(String(row.created_at)).getTime() > new Date(cutoverAt).getTime())
          .map((row) => String(row.tweet_id)),
      );
      const eligibleFailedRows = failedRows.filter((delivery) =>
        eligibleIds.has(String(delivery.subject_id ?? '')) &&
        new Date(String(delivery.created_at)).getTime() > new Date(cutoverAt).getTime()
      );
      const historicalCount = failedRows.filter(
        (delivery) => !eligibleFailedRows.includes(delivery),
      ).length;
      const retryJobs = eligibleFailedRows.map(delivery => ({
        type: 'deliver',
        payload: { tweet_id: delivery.subject_id },
        status: 'pending',
        next_run_at: new Date().toISOString()
      }));

      if (retryJobs.length > 0) {
        const { error: jobError } = await supabase
          .from('jobs')
          .insert(retryJobs);

        if (jobError) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'Failed to create retry jobs' 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
          });
        }

        try {
          const uniqueSubjects = Array.from(
            new Set(retryJobs.map((job) => job.payload.tweet_id)),
          );
          if (uniqueSubjects.length > 0) {
            const rows = uniqueSubjects.map(sid => ({
              subject_type: 'post',
              subject_id: sid,
              step: 'deliver',
              status: 'queued',
              started_at: new Date().toISOString(),
              meta: { source: 'admin-retry', admin_user: authResult.userId }
            }));
            await supabase.from('pipeline_events').insert(rows);
          }
        } catch (_e) {}
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Created ${retryJobs.length} retry jobs for eligible deliveries`,
        historical_skipped: historicalCount,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Original retry logic
    if (!delivery_id) {
      throw new Error('delivery_id is required');
    }

    const { data: delivery, error: deliveryError } = await supabase
      .from('deliveries')
      .select('*')
      .eq('id', delivery_id)
      .single();

    if (deliveryError || !delivery) {
      throw new Error('Delivery not found');
    }

    // The original delivery_id retry path is a second admin bypass. Require
    // one real post-T post lineage and keep the delivery row itself post-T;
    // otherwise neither the old row nor a replacement job may be mutated.
    const deliveryTweetId = delivery.subject_type === 'post' &&
        typeof delivery.subject_id === 'string'
      ? delivery.subject_id
      : '';
    if (!deliveryTweetId) {
      return new Response(JSON.stringify({
        success: false,
        code: 'delivery_cutover_blocked',
        error: 'v1 delivery retry supports post deliveries only; non-post lineage is unsupported',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      });
    }
    try {
      await requireDeliveryCutover(supabase, deliveryTweetId);
      const { data: cutoverAt, error: cutoverError } = await supabase.rpc(
        'get_delivery_cutover',
      );
      if (
        cutoverError || typeof cutoverAt !== 'string' ||
        typeof delivery.created_at !== 'string' ||
        new Date(delivery.created_at).getTime() <= new Date(cutoverAt).getTime()
      ) {
        throw new Error('delivery_cutover_blocked:historical_delivery');
      }
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        code: 'delivery_cutover_blocked',
        error: error instanceof Error ? error.message : String(error),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      });
    }

    const { error: jobError } = await supabase
      .from('jobs')
      .insert([{
        type: 'deliver',
        payload: {
          tweet_id: deliveryTweetId,
        },
        status: 'pending',
        next_run_at: new Date().toISOString()
      }]);

    if (jobError) throw jobError;

    const { error: updateError } = await supabase
      .from('deliveries')
      .update({
        status: 'pending',
        last_error: null
      })
      .eq('id', delivery_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Delivery retry scheduled' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'admin-retry', action: 'error', error: (error as Error).message }));
    await captureEdgeException(error, {
      functionName: "admin-retry",
      action: "error",
      request: req,
    });
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

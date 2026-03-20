import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validate JWT and check admin role
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: missing token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createClient(
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
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (!action) {
      return jsonResponse({ error: 'Missing action parameter' }, 400);
    }

    switch (action) {
      // ===== Settings =====
      case 'save_settings': {
        const { key, value } = body;
        if (!key || value === undefined) {
          return jsonResponse({ error: 'key and value are required' }, 400);
        }
        // Only allow non-secret settings keys
        const allowedKeys = ['translation_prompt', 'openai_config', 'telegram_config', 'message_template'];
        if (!allowedKeys.includes(key)) {
          return jsonResponse({ error: `Setting key "${key}" is not allowed` }, 400);
        }
        const { error } = await supabase
          .from('settings')
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        return jsonResponse({ success: true, message: `Settings "${key}" saved` });
      }

      // ===== Edit translation =====
      case 'edit_translation': {
        const { tweet_id, text_translated } = body;
        if (!tweet_id || text_translated === undefined) {
          return jsonResponse({ error: 'tweet_id and text_translated are required' }, 400);
        }
        const { error } = await supabase
          .from('posts')
          .update({ text_translated })
          .eq('tweet_id', tweet_id);
        if (error) throw error;
        return jsonResponse({ success: true, message: 'Translation updated' });
      }

      // ===== Retry step (translate/deliver/media) =====
      case 'retry_step': {
        const { tweet_id, step } = body;
        if (!tweet_id || !step) {
          return jsonResponse({ error: 'tweet_id and step are required' }, 400);
        }
        const { data: result, error } = await supabase.rpc('retry_step', { tweet_id, step });
        if (error) throw error;
        return jsonResponse({ success: true, message: `${step} retry queued` });
      }

      // ===== Reprocess (full re-run) =====
      case 'reprocess': {
        const { tweet_id } = body;
        if (!tweet_id) {
          return jsonResponse({ error: 'tweet_id is required' }, 400);
        }
        const idempotencyKey = `reprocess:${tweet_id}`;
        const { error } = await supabase
          .from('jobs')
          .upsert({
            type: 'reprocess',
            payload: { tweet_id },
            status: 'pending',
            idempotency_key: idempotencyKey,
            next_run_at: new Date().toISOString()
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        if (error) throw error;
        return jsonResponse({ success: true, message: 'Reprocess job queued' });
      }

      // ===== Bulk reprocess =====
      case 'bulk_reprocess': {
        const { tweet_ids } = body;
        if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
          return jsonResponse({ error: 'tweet_ids array is required' }, 400);
        }
        const jobs = tweet_ids.map((tid: string) => ({
          type: 'reprocess',
          payload: { tweet_id: tid },
          status: 'pending',
          idempotency_key: `reprocess:${tid}`,
          next_run_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('jobs').upsert(jobs, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        if (error) throw error;
        return jsonResponse({ success: true, message: `${tweet_ids.length} reprocess jobs queued` });
      }

      // ===== Post thread =====
      case 'post_thread': {
        const { thread_id } = body;
        if (!thread_id) {
          return jsonResponse({ error: 'thread_id is required' }, 400);
        }
        const { error } = await supabase
          .from('deliveries')
          .insert({ subject_type: 'thread', subject_id: thread_id, status: 'pending' });
        if (error) throw error;
        return jsonResponse({ success: true, message: 'Thread queued for delivery' });
      }

      // ===== System health =====
      case 'get_health': {
        const { data, error } = await supabase.rpc('get_system_health');
        if (error) throw error;
        return jsonResponse({ success: true, health: data });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin action error:', message);
    return jsonResponse({ error: message }, 500);
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

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

  const supabaseAuth = createClient<any, any>(
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

// ─── X API OAuth 1.0a helpers (mirrors worker/index.ts) ──────────────
const X_TEXT_ENCODER = new TextEncoder();
function xPercentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function xHmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', X_TEXT_ENCODER.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, X_TEXT_ENCODER.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function xOauthHeader(method: string, baseUrl: string, queryParams: Record<string, string>, ck: string, cs: string, at: string, ats: string): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort().map((k) => `${xPercentEncode(k)}=${xPercentEncode(allParams[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${xPercentEncode(baseUrl)}&${xPercentEncode(paramString)}`;
  const signingKey = `${xPercentEncode(cs)}&${xPercentEncode(ats)}`;
  oauthParams.oauth_signature = await xHmacSha1(signingKey, baseString);
  return `OAuth ${Object.keys(oauthParams).sort().map((k) => `${xPercentEncode(k)}="${xPercentEncode(oauthParams[k])}"`).join(', ')}`;
}
function getXCreds(): { ck: string; cs: string; at: string; ats: string } | null {
  const ck = Deno.env.get('TWITTER_CONSUMER_KEY');
  const cs = Deno.env.get('TWITTER_CONSUMER_SECRET');
  const at = Deno.env.get('TWITTER_ACCESS_TOKEN');
  const ats = Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET');
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}
// deno-lint-ignore no-explicit-any
async function recordXApiCall(supabase: any, error?: string) {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'x_api_usage').maybeSingle();
    const current = (data?.value as { total?: number; calls_24h?: string[] } | null) ?? { total: 0, calls_24h: [] };
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const trimmed = (current.calls_24h ?? []).filter((ts) => { try { return new Date(ts).getTime() > cutoff; } catch { return false; } });
    trimmed.push(new Date().toISOString());
    const next = { total: (current.total ?? 0) + 1, calls_24h: trimmed, last_call_at: new Date().toISOString(), last_error: error ?? null };
    await supabase.from('settings').upsert({ key: 'x_api_usage', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch (e) { console.error('recordXApiCall failed', e); }
}


function validateSettingsValue(key: string, value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `Value for "${key}" must be a JSON object`;
  }
  const v = value as Record<string, unknown>;

  switch (key) {
    case 'translation_prompt': {
      const stringFields: Array<[string, number]> = [
        ['system_prompt', 20000],
        ['user_prompt_template', 10000],
        ['model', 100],
        ['scoring_system_prompt', 20000],
        ['classifier_tool_schema', 20000],
      ];
      for (const [field, max] of stringFields) {
        if (v[field] !== undefined && typeof v[field] !== 'string') {
          return `translation_prompt.${field} must be a string`;
        }
        if (typeof v[field] === 'string' && (v[field] as string).length > max) {
          return `translation_prompt.${field} must be ≤${max} characters`;
        }
      }
      const numFields = ['temperature', 'max_completion_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'];
      for (const f of numFields) {
        if (v[f] !== undefined && v[f] !== null && typeof v[f] !== 'number') {
          return `translation_prompt.${f} must be a number`;
        }
      }
      if (v.reasoning_effort !== undefined && !['minimal', 'low', 'medium', 'high'].includes(v.reasoning_effort as string)) {
        return 'translation_prompt.reasoning_effort must be one of minimal|low|medium|high';
      }
      if (v.verbosity !== undefined && !['low', 'medium', 'high'].includes(v.verbosity as string)) {
        return 'translation_prompt.verbosity must be one of low|medium|high';
      }
      if (v.service_tier !== undefined && !['auto', 'default', 'flex', 'priority'].includes(v.service_tier as string)) {
        return 'translation_prompt.service_tier must be one of auto|default|flex|priority';
      }
      if (v.parallel_tool_calls !== undefined && typeof v.parallel_tool_calls !== 'boolean') {
        return 'translation_prompt.parallel_tool_calls must be a boolean';
      }
      break;
    }
    case 'openai_config': {
      if (v.model !== undefined && typeof v.model !== 'string') {
        return 'openai_config.model must be a string';
      }
      if (v.model && !/^[a-zA-Z0-9._-]{1,100}$/.test(v.model as string)) {
        return 'openai_config.model contains invalid characters';
      }
      if (v.temperature !== undefined) {
        if (typeof v.temperature !== 'number' || v.temperature < 0 || v.temperature > 2) {
          return 'openai_config.temperature must be a number between 0 and 2';
        }
      }
      if (v.max_tokens !== undefined) {
        if (typeof v.max_tokens !== 'number' || v.max_tokens < 1 || v.max_tokens > 16000) {
          return 'openai_config.max_tokens must be between 1 and 16000';
        }
      }
      break;
    }
    case 'telegram_config': {
      if (v.parse_mode !== undefined && !['Markdown', 'MarkdownV2', 'HTML', ''].includes(v.parse_mode as string)) {
        return 'telegram_config.parse_mode must be Markdown, MarkdownV2, HTML, or empty';
      }
      break;
    }
    case 'message_template': {
      if (v.template !== undefined && typeof v.template !== 'string') {
        return 'message_template.template must be a string';
      }
      if (v.template && (v.template as string).length > 2000) {
        return 'message_template.template must be ≤2000 characters';
      }
      if (v.include_source_link !== undefined && typeof v.include_source_link !== 'boolean') {
        return 'message_template.include_source_link must be a boolean';
      }
      if (v.source_link_text !== undefined && typeof v.source_link_text !== 'string') {
        return 'message_template.source_link_text must be a string';
      }
      if (v.custom_hashtags !== undefined && typeof v.custom_hashtags !== 'string') {
        return 'message_template.custom_hashtags must be a string';
      }
      break;
    }
    case 'digest_config': {
      if (v.twitter_consumer_key !== undefined && typeof v.twitter_consumer_key !== 'string') return 'digest_config.twitter_consumer_key must be a string';
      if (v.twitter_consumer_secret !== undefined && typeof v.twitter_consumer_secret !== 'string') return 'digest_config.twitter_consumer_secret must be a string';
      if (v.twitter_access_token !== undefined && typeof v.twitter_access_token !== 'string') return 'digest_config.twitter_access_token must be a string';
      if (v.twitter_access_token_secret !== undefined && typeof v.twitter_access_token_secret !== 'string') return 'digest_config.twitter_access_token_secret must be a string';
      if (v.frequency_minutes !== undefined && (typeof v.frequency_minutes !== 'number' || ![30, 60, 120, 240].includes(v.frequency_minutes))) return 'digest_config.frequency_minutes must be 30, 60, 120, or 240';
      if (v.max_bullets !== undefined && (typeof v.max_bullets !== 'number' || v.max_bullets < 1 || v.max_bullets > 20)) return 'digest_config.max_bullets must be 1-20';
      if (v.min_posts !== undefined && (typeof v.min_posts !== 'number' || v.min_posts < 1 || v.min_posts > 50)) return 'digest_config.min_posts must be 1-50';
      break;
    }
      case 'twitter_hydration': {
        if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'twitter_hydration.enabled must be a boolean';
        if (v.max_attempts !== undefined && (typeof v.max_attempts !== 'number' || v.max_attempts < 1 || v.max_attempts > 10)) return 'twitter_hydration.max_attempts must be 1-10';
        break;
      }
      case 'x_posting_config': {
        const bools = ['enabled', 'require_media', 'post_only_decision_deliver'];
        for (const f of bools) if (v[f] !== undefined && typeof v[f] !== 'boolean') return `x_posting_config.${f} must be a boolean`;
        if (v.min_score !== undefined && (typeof v.min_score !== 'number' || v.min_score < 1 || v.min_score > 20)) return 'x_posting_config.min_score must be 1-20';
        if (v.max_chars !== undefined && (typeof v.max_chars !== 'number' || v.max_chars < 50 || v.max_chars > 4000)) return 'x_posting_config.max_chars must be 50-4000';
        if (v.dedupe_window_hours !== undefined && (typeof v.dedupe_window_hours !== 'number' || v.dedupe_window_hours < 1 || v.dedupe_window_hours > 720)) return 'x_posting_config.dedupe_window_hours must be 1-720';
        const strs: Array<[string, number]> = [['post_template', 1000], ['leading_emoji', 32], ['hashtags', 500]];
        for (const [f, max] of strs) {
          if (v[f] !== undefined && typeof v[f] !== 'string') return `x_posting_config.${f} must be a string`;
          if (typeof v[f] === 'string' && (v[f] as string).length > max) return `x_posting_config.${f} must be ≤${max} characters`;
        }
        break;
      }
      case 'x_rate_limits': {
        const nums: Array<[string, number, number]> = [
          ['posts_per_hour', 1, 1000],
          ['posts_per_day', 1, 10000],
          ['monthly_post_budget', 1, 1000000],
          ['media_uploads_per_day', 1, 10000],
        ];
        for (const [f, min, max] of nums) {
          if (v[f] !== undefined && (typeof v[f] !== 'number' || (v[f] as number) < min || (v[f] as number) > max)) {
            return `x_rate_limits.${f} must be ${min}-${max}`;
          }
        }
        break;
      }
    }
    return null;
  }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const rawText = await req.text();
    let body: any = {};
    try { body = rawText ? JSON.parse(rawText) : {}; } catch (e) {
      console.error('[admin-actions] body parse failed', { rawText: rawText.slice(0, 200), err: (e as Error).message });
    }
    const { action } = body;

    if (!action) {
      console.error('[admin-actions] missing action', { rawText: rawText.slice(0, 200), contentType: req.headers.get('content-type') });
      return jsonResponse({ error: 'Missing action parameter', received: rawText.slice(0, 200) }, 400);
    }

    switch (action) {
      // ===== Settings =====
      case 'save_settings': {
        const { key, value } = body;
        if (!key || value === undefined) {
          return jsonResponse({ error: 'key and value are required' }, 400);
        }
        // Only allow non-secret settings keys
        const allowedKeys = ['translation_prompt', 'openai_config', 'telegram_config', 'message_template', 'content_filter', 'digest_config', 'twitter_hydration', 'x_posting_config', 'x_rate_limits'];
        if (!allowedKeys.includes(key)) {
          return jsonResponse({ error: `Setting key "${key}" is not allowed` }, 400);
        }

        // Validate value shape per key
        const validationError = validateSettingsValue(key, value);
        if (validationError) {
          return jsonResponse({ error: validationError }, 400);
        }

        // Auto-stamp `start_posting_from` to "now" on any change that could
        // make previously-ingested posts newly eligible (forward-only guarantee):
        //  - disabled → enabled
        //  - min_score lowered
        //  - require_media turned off
        //  - post_only_decision_deliver turned off
        // The user can still override by explicitly passing start_posting_from in the payload.
        let valueToSave = value;
        if (key === 'x_posting_config' && value && typeof value === 'object') {
          const { data: prev } = await supabase.from('settings').select('value').eq('key', 'x_posting_config').maybeSingle();
          const prevCfg = (prev?.value ?? {}) as Record<string, unknown>;
          const nextCfg = value as Record<string, unknown>;
          const userProvidedStart = typeof nextCfg.start_posting_from === 'string';

          const prevEnabled = !!prevCfg.enabled;
          const nextEnabled = !!nextCfg.enabled;
          const enableTransition = nextEnabled && !prevEnabled;

          const prevMin = typeof prevCfg.min_score === 'number' ? prevCfg.min_score as number : 14;
          const nextMin = typeof nextCfg.min_score === 'number' ? nextCfg.min_score as number : prevMin;
          const thresholdLowered = nextEnabled && nextMin < prevMin;

          const mediaLoosened = nextEnabled && prevCfg.require_media === true && nextCfg.require_media === false;
          const decisionGateLoosened = nextEnabled && prevCfg.post_only_decision_deliver === true && nextCfg.post_only_decision_deliver === false;

          if (!userProvidedStart && (enableTransition || thresholdLowered || mediaLoosened || decisionGateLoosened)) {
            valueToSave = { ...nextCfg, start_posting_from: new Date().toISOString() };
            console.log('[admin-actions] re-stamped x_posting_config.start_posting_from', {
              enableTransition, thresholdLowered, mediaLoosened, decisionGateLoosened, prevMin, nextMin,
            });
          }
        }

        const { error } = await supabase
          .from('settings')
          .upsert({ key, value: valueToSave, updated_at: new Date().toISOString() }, { onConflict: 'key' });
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

      // ===== X Posting: dry run / retry =====
      case 'dry_run_x_post':
      case 'retry_x_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : null;
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/x-poster`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dry_run: action === 'dry_run_x_post',
              ...(tweetId ? { tweet_id: tweetId } : {}),
            }),
          });
          const text = await resp.text();
          let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
          if (!resp.ok) return jsonResponse({ ok: false, error: `x-poster ${resp.status}: ${text.slice(0, 300)}`, raw: parsed }, 200);
          return jsonResponse({ ok: true, ...(parsed as Record<string, unknown>) });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message }, 200);
        }
      }


      // ===== X API: credential status =====
      case 'get_x_status': {
        return jsonResponse({
          success: true,
          status: {
            TWITTER_CONSUMER_KEY: !!Deno.env.get('TWITTER_CONSUMER_KEY'),
            TWITTER_CONSUMER_SECRET: !!Deno.env.get('TWITTER_CONSUMER_SECRET'),
            TWITTER_ACCESS_TOKEN: !!Deno.env.get('TWITTER_ACCESS_TOKEN'),
            TWITTER_ACCESS_TOKEN_SECRET: !!Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET'),
          },
        });
      }

      // ===== X API: verify credentials =====
      case 'x_verify_credentials': {
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const url = 'https://api.x.com/2/users/me';
        try {
          const auth = await xOauthHeader('GET', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
          const resp = await fetch(url, { headers: { Authorization: auth } });
          const text = await resp.text();
          let body: unknown;
          try { body = JSON.parse(text); } catch { body = text; }
          await recordXApiCall(supabase, resp.ok ? undefined : `verify: HTTP ${resp.status}`);
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}`, raw: body });
          const user = (body as { data?: { id?: string; username?: string; name?: string } })?.data;
          return jsonResponse({ ok: true, id: user?.id, handle: user?.username, name: user?.name, raw: body });
        } catch (e) {
          await recordXApiCall(supabase, `verify: ${(e as Error).message}`);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== X API: send test tweet =====
      case 'send_test_tweet': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const replyTo = typeof body.in_reply_to_tweet_id === 'string' ? body.in_reply_to_tweet_id.trim() : '';
        if (text.length === 0 || text.length > 280) {
          return jsonResponse({ ok: false, error: 'text must be 1-280 characters' }, 400);
        }
        if (replyTo && !/^\d{1,25}$/.test(replyTo)) {
          return jsonResponse({ ok: false, error: 'in_reply_to_tweet_id must be a numeric tweet ID' }, 400);
        }
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const url = 'https://api.x.com/2/tweets';
        const payload: Record<string, unknown> = { text };
        if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
        try {
          // Per X docs, POST body params are NOT included in OAuth signature for /2/tweets JSON body
          const auth = await xOauthHeader('POST', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
          const resp = await fetch(url, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const respText = await resp.text();
          let respBody: unknown;
          try { respBody = JSON.parse(respText); } catch { respBody = respText; }
          await recordXApiCall(supabase, resp.ok ? undefined : `send_test: HTTP ${resp.status}`);
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${respText.slice(0, 300)}`, response: respBody });
          const created = (respBody as { data?: { id?: string; text?: string } })?.data;
          return jsonResponse({ ok: true, tweet_id: created?.id, response: respBody });
        } catch (e) {
          await recordXApiCall(supabase, `send_test: ${(e as Error).message}`);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== X API: test hydration (no DB write) =====
      case 'test_hydrate_tweet': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!/^\d{1,25}$/.test(tweetId)) {
          return jsonResponse({ ok: false, error: 'tweet_id must be a numeric tweet ID' }, 400);
        }
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const baseUrl = `https://api.x.com/2/tweets/${tweetId}`;
        const queryParams = { 'tweet.fields': 'note_tweet,text,lang' };
        try {
          const auth = await xOauthHeader('GET', baseUrl, queryParams, creds.ck, creds.cs, creds.at, creds.ats);
          const url = `${baseUrl}?${Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
          const resp = await fetch(url, { headers: { Authorization: auth } });
          const respText = await resp.text();
          let respBody: unknown;
          try { respBody = JSON.parse(respText); } catch { respBody = respText; }
          await recordXApiCall(supabase, resp.ok ? undefined : `test_hydrate: HTTP ${resp.status}`);
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${respText.slice(0, 300)}`, raw: respBody });
          const data = (respBody as { data?: { text?: string; lang?: string; note_tweet?: { text?: string } } })?.data;
          return jsonResponse({
            ok: true,
            tweet_id: tweetId,
            text: data?.text,
            lang: data?.lang,
            note_tweet: data?.note_tweet?.text,
            raw: respBody,
          });
        } catch (e) {
          await recordXApiCall(supabase, `test_hydrate: ${(e as Error).message}`);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== Backfill: re-hydrate recent truncated tweets matching new heuristics =====
      case 'rehydrate_recent_truncated': {
        const hours = typeof body.hours === 'number' && body.hours > 0 && body.hours <= 168 ? body.hours : 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        // Pull recent posts that haven't been hydrated yet. Cap at 500 to stay safe.
        const { data: posts, error: fetchErr } = await supabase
          .from('posts')
          .select('tweet_id, text_original, url')
          .is('hydrated_at', null)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500);

        if (fetchErr) return jsonResponse({ ok: false, error: fetchErr.message }, 500);

        // Re-implement the same heuristics as webhooks-rssapp/detectTruncation
        const looksTruncated = (raw: string | null | undefined): boolean => {
          if (!raw) return false;
          const t = raw.trim();
          if (!t) return false;
          if (/(^|\s)(show\s+more|show\s+this\s+thread|read\s+more)\s*$/i.test(t)) return true;
          if (/(\u2026|\.{3}|\[\u2026\]|\[\.{3}\])\s*$/.test(t) && t.length >= 200) return true;
          if (t.length >= 270) {
            const last = t.charAt(t.length - 1);
            if (!['.', '!', '?', '\u061F', '"', ')', '\u201D', '\u300D'].includes(last)) return true;
          }
          if (/\b(pic\.?|pic\.t|pic\.tw(?:itter)?(?:\.c(?:om?)?)?\/?)\s*$/i.test(t)) return true;
          if (t.length >= 240 && /(\u2026|\[\u2026\]|\.{3}|\[\.{3}\])/.test(t)) {
            const last = t.charAt(t.length - 1);
            if (!['"', ')', '\u201D', '\u300D', ']', '}'].includes(last)) return true;
          }
          if (t.length >= 240) {
            const tokens = t.split(/\s+/);
            const lastToken = tokens[tokens.length - 1] || '';
            if (/^(a|an|the|to|of|in|on|for|and|or|but|with|by|at|as|is|was|are|were|has|have|had)\.?$/i.test(lastToken)) return true;
          }
          return false;
        };

        const matches = (posts ?? []).filter((p) => looksTruncated(p.text_original as string | null));
        let queued = 0;
        const errors: string[] = [];

        for (const p of matches) {
          const tweetId = p.tweet_id as string;
          // Mark as truncated so worker behavior is consistent
          const { error: upErr } = await supabase
            .from('posts')
            .update({ is_truncated: true })
            .eq('tweet_id', tweetId);
          if (upErr) { errors.push(`update ${tweetId}: ${upErr.message}`); continue; }

          const { error: jobErr } = await supabase
            .from('jobs')
            .upsert({
              type: 'hydrate_tweet',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 15,
              idempotency_key: `hydrate:backfill:${tweetId}`,
              next_run_at: new Date().toISOString(),
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (jobErr) { errors.push(`job ${tweetId}: ${jobErr.message}`); continue; }
          queued++;
        }

        return jsonResponse({
          ok: true,
          scanned: posts?.length ?? 0,
          matched: matches.length,
          queued,
          hours,
          errors: errors.slice(0, 10),
        });
      }

      // ===== Translation Playground (no DB writes) =====
      case 'preview_translation': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return jsonResponse({ ok: false, error: 'text is required' }, 400);
        if (text.length > 8000) return jsonResponse({ ok: false, error: 'text must be ≤8000 characters' }, 400);

        const ts = (body.translation_settings ?? {}) as Record<string, unknown>;
        const cf = (body.content_filter ?? {}) as Record<string, unknown>;
        const authorHandle = typeof body.author_handle === 'string' ? body.author_handle.trim() : '';

        const model = typeof ts.model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(ts.model) ? ts.model : 'gpt-4o-mini';
        const translationPrompt = typeof ts.system_prompt === 'string' && ts.system_prompt.trim()
          ? ts.system_prompt as string
          : 'You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.';
        const temperature = typeof ts.temperature === 'number' ? ts.temperature : 0.2;
        const maxTokens = typeof ts.max_completion_tokens === 'number' ? Math.min(8000, Math.max(1, ts.max_completion_tokens)) : 2000;
        // GPT-5.x, GPT-4.1, o-series and any modern model use `max_completion_tokens`.
        // Only legacy gpt-4o / gpt-4 / gpt-3.5 still accept `max_tokens`.
        const useMaxCompletion = !/^(gpt-4o($|-)|gpt-4($|-)|gpt-3\.5)/i.test(model);
        const tokenParam = useMaxCompletion ? 'max_completion_tokens' : 'max_tokens';
        const customScoringPrompt = typeof ts.scoring_system_prompt === 'string' && ts.scoring_system_prompt.trim() ? ts.scoring_system_prompt as string : null;
        const customToolSchema = typeof ts.classifier_tool_schema === 'string' && ts.classifier_tool_schema.trim() ? ts.classifier_tool_schema as string : null;

        const filterEnabled = cf.enabled === true || cf.score_only === true;

        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) return jsonResponse({ ok: false, error: 'OPENAI_API_KEY is not configured' }, 500);

        const startedAt = Date.now();
        let translatedText = '';
        let importanceScore: number | null = null;
        let importanceTags: string[] | null = null;
        let reasoning: string | null = null;
        let raw: Record<string, unknown> = {};

        try {
          if (filterEnabled) {
            const priorityTopics = Array.isArray(cf.priority_topics) ? (cf.priority_topics as string[]).join(', ') : 'none specified';
            const lowPriorityTopics = Array.isArray(cf.low_priority_topics) ? (cf.low_priority_topics as string[]).join(', ') : 'none specified';
            const guidelines = typeof cf.editorial_guidelines === 'string' ? cf.editorial_guidelines : '';
            const guidelinesBlock = guidelines.trim()
              ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
              : '';

            // Use editable scoring system prompt with placeholder substitution
            const scoringTemplate = customScoringPrompt ?? `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nYou are an editorial assistant. Score 1-20 based on importance to an Iran/Middle East news channel. Cap non-Iran content at 8.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nYou MUST call the "classify_importance" tool.`;
            const systemPrompt = scoringTemplate
              .replace('{translation_prompt}', translationPrompt)
              .replace('{priority_topics}', priorityTopics)
              .replace('{low_priority_topics}', lowPriorityTopics)
              .replace('{editorial_guidelines_block}', guidelinesBlock);

            // Parse tool schema (with safe fallback)
            let toolFunction: Record<string, unknown>;
            try {
              toolFunction = customToolSchema
                ? JSON.parse(customToolSchema)
                : {
                    name: 'classify_importance',
                    description: 'Provide the Persian translation and importance classification of this news item',
                    parameters: {
                      type: 'object',
                      properties: {
                        translated_text: { type: 'string' },
                        importance_score: { type: 'integer', minimum: 1, maximum: 20 },
                        tags: { type: 'array', items: { type: 'string' } },
                        reasoning: { type: 'string' },
                      },
                      required: ['translated_text', 'importance_score', 'tags', 'reasoning'],
                    },
                  };
            } catch (e) {
              return jsonResponse({ ok: false, error: `Invalid classifier_tool_schema JSON: ${(e as Error).message}` }, 400);
            }

            const userMessage = `Author: @${authorHandle || 'preview'}\nPublished: ${new Date().toISOString()}\nHas media: no\nURL: N/A\n\nContent:\n${text}`;

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userMessage },
                ],
                tools: [{ type: 'function', function: toolFunction }],
                tool_choice: { type: 'function', function: { name: (toolFunction.name as string) || 'classify_importance' } },
                [tokenParam]: maxTokens,
              }),
            });
            const respText = await resp.text();
            try { raw = JSON.parse(respText); } catch { raw = { raw_text: respText }; }
            if (!resp.ok) return jsonResponse({ ok: false, error: `OpenAI ${resp.status}: ${respText.slice(0, 500)}`, result: { raw } });

            const toolCall = (raw as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }>; content?: string } }> }).choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall?.function?.arguments) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                translatedText = args.translated_text || '';
                importanceScore = Math.max(1, Math.min(20, args.importance_score || 10));
                importanceTags = Array.isArray(args.tags) ? args.tags : [];
                reasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
              } catch (parseErr) {
                translatedText = (raw as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
                reasoning = `Tool-call parse error: ${(parseErr as Error).message}`;
              }
            } else {
              translatedText = (raw as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
            }
          } else {
            // Simple translation only
            const callBody: Record<string, unknown> = {
              model,
              messages: [
                { role: 'system', content: translationPrompt },
                { role: 'user', content: text },
              ],
              [tokenParam]: maxTokens,
            };
            // Only attach temperature for legacy models that support it (worker logic mirror)
            if (!/^gpt-(5|4\.1)|^o[34]/i.test(model)) callBody.temperature = temperature;

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(callBody),
            });
            const respText = await resp.text();
            try { raw = JSON.parse(respText); } catch { raw = { raw_text: respText }; }
            if (!resp.ok) return jsonResponse({ ok: false, error: `OpenAI ${resp.status}: ${respText.slice(0, 500)}`, result: { raw } });
            translatedText = (raw as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
          }

          const usage = (raw as { usage?: Record<string, number> }).usage ?? null;
          return jsonResponse({
            ok: true,
            result: {
              translated_text: translatedText,
              importance_score: importanceScore,
              importance_tags: importanceTags,
              reasoning,
              model,
              usage,
              duration_ms: Date.now() - startedAt,
              used_filter: filterEnabled,
              raw,
            },
          });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== Re-score an existing post using current settings =====
      case 'rescore_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!tweetId) return jsonResponse({ ok: false, error: 'tweet_id is required' }, 400);

        const { data: post, error: postErr } = await supabase
          .from('posts')
          .select('tweet_id, text_original, author_handle, tweeted_at, has_media, url')
          .eq('tweet_id', tweetId)
          .single();
        if (postErr || !post) return jsonResponse({ ok: false, error: `Post not found: ${tweetId}` }, 404);
        if (!post.text_original) return jsonResponse({ ok: false, error: 'Post has no original text to score' }, 400);

        // Load current settings
        const { data: settings } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['translation_prompt', 'openai_config', 'content_filter']);

        const settingsMap: Record<string, Record<string, unknown>> = {};
        for (const s of settings ?? []) {
          if (s.value && typeof s.value === 'object') settingsMap[s.key] = s.value as Record<string, unknown>;
        }
        const tp = settingsMap['translation_prompt'] || {};
        const oc = settingsMap['openai_config'] || {};
        const cf = settingsMap['content_filter'] || {};

        // translation_prompt.model is authoritative (matches the Settings UI); openai_config.model is legacy fallback.
        const model = typeof tp.model === 'string' && (tp.model as string).trim()
          ? tp.model as string
          : (typeof oc.model === 'string' ? oc.model as string : 'gpt-4o-mini');
        const translationPrompt = typeof tp.system_prompt === 'string' && (tp.system_prompt as string).trim()
          ? tp.system_prompt as string
          : 'You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.';
        const customScoringPrompt = typeof tp.scoring_system_prompt === 'string' && (tp.scoring_system_prompt as string).trim() ? tp.scoring_system_prompt as string : null;
        const customToolSchema = typeof tp.classifier_tool_schema === 'string' && (tp.classifier_tool_schema as string).trim() ? tp.classifier_tool_schema as string : null;
        const useMaxCompletion = !/^(gpt-4o($|-)|gpt-4($|-)|gpt-3\.5)/i.test(model);
        const tokenParam = useMaxCompletion ? 'max_completion_tokens' : 'max_tokens';

        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) return jsonResponse({ ok: false, error: 'OPENAI_API_KEY is not configured' }, 500);

        const priorityTopics = Array.isArray(cf.priority_topics) ? (cf.priority_topics as string[]).join(', ') : 'none specified';
        const lowPriorityTopics = Array.isArray(cf.low_priority_topics) ? (cf.low_priority_topics as string[]).join(', ') : 'none specified';
        const guidelines = typeof cf.editorial_guidelines === 'string' ? cf.editorial_guidelines as string : '';
        const guidelinesBlock = guidelines.trim()
          ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
          : '';

        const scoringTemplate = customScoringPrompt ?? `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nScore 1-20 with 3-level relevance: DIRECT (no cap), INDIRECT Iran-adjacent (cap 16), NO NEXUS (cap 8). Polls/leaks/analyst reports about Iran conflicts can score 13-16. Do NOT down-score because framing is Western. Prefer higher tier when in doubt.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nReasoning MUST state: relevance level, tier, any cap. Call "classify_importance".`;
        const systemPrompt = scoringTemplate
          .replace('{translation_prompt}', translationPrompt)
          .replace('{priority_topics}', priorityTopics)
          .replace('{low_priority_topics}', lowPriorityTopics)
          .replace('{editorial_guidelines_block}', guidelinesBlock);

        let toolFunction: Record<string, unknown>;
        try {
          toolFunction = customToolSchema ? JSON.parse(customToolSchema) : {
            name: 'classify_importance',
            parameters: {
              type: 'object',
              properties: {
                translated_text: { type: 'string' },
                importance_score: { type: 'integer', minimum: 1, maximum: 20 },
                tags: { type: 'array', items: { type: 'string' } },
                reasoning: { type: 'string' },
              },
              required: ['translated_text', 'importance_score', 'tags', 'reasoning'],
            },
          };
        } catch (e) {
          return jsonResponse({ ok: false, error: `Invalid classifier_tool_schema JSON: ${(e as Error).message}` }, 400);
        }

        const userMessage = `Author: @${post.author_handle || 'unknown'}\nPublished: ${post.tweeted_at ? new Date(post.tweeted_at as string).toISOString() : 'unknown'}\nHas media: ${post.has_media ? 'yes' : 'no'}\nURL: ${post.url || 'N/A'}\n\nContent:\n${post.text_original}`;

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            tools: [{ type: 'function', function: toolFunction }],
            tool_choice: { type: 'function', function: { name: (toolFunction.name as string) || 'classify_importance' } },
            [tokenParam]: 2000,
          }),
        });
        const respText = await resp.text();
        let raw: Record<string, unknown> = {};
        try { raw = JSON.parse(respText); } catch { raw = { raw_text: respText }; }
        if (!resp.ok) return jsonResponse({ ok: false, error: `OpenAI ${resp.status}: ${respText.slice(0, 500)}`, raw });

        const toolCall = (raw as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> }).choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) return jsonResponse({ ok: false, error: 'Model did not return a tool call', raw });

        let args: { translated_text?: string; importance_score?: number; tags?: string[]; reasoning?: string };
        try { args = JSON.parse(toolCall.function.arguments); }
        catch (e) { return jsonResponse({ ok: false, error: `Tool-call parse error: ${(e as Error).message}`, raw }); }

        const newScore = Math.max(1, Math.min(20, args.importance_score || 10));
        const newTags = Array.isArray(args.tags) ? args.tags : [];
        const newReasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
        const newTranslated = typeof args.translated_text === 'string' ? args.translated_text : null;

        // Determine new delivery decision
        const threshold = typeof cf.default_threshold === 'number' ? cf.default_threshold as number : 12;
        const newDecision = newScore >= threshold ? 'deliver' : 'skip';

        const updatePayload: Record<string, unknown> = {
          importance_score: newScore,
          importance_tags: newTags,
          importance_reasoning: newReasoning,
          delivery_decision: newDecision,
        };
        if (newTranslated) {
          updatePayload.text_translated = newTranslated;
          updatePayload.translated_at = new Date().toISOString();
          updatePayload.translation_model = model;
        }

        const { error: upErr } = await supabase.from('posts').update(updatePayload).eq('tweet_id', tweetId);
        if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

        return jsonResponse({
          ok: true,
          tweet_id: tweetId,
          score: newScore,
          tags: newTags,
          reasoning: newReasoning,
          decision: newDecision,
          threshold,
          model,
        });
      }

      // ===== Run X followers snapshot manually =====
      case 'run_followers_snapshot': {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/x-followers-snapshot`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger: 'manual' }),
          });
          const text = await resp.text();
          let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
          if (!resp.ok) return jsonResponse({ ok: false, error: `snapshot ${resp.status}: ${text.slice(0, 300)}`, raw: parsed }, 200);
          return jsonResponse({ ok: true, ...(parsed as Record<string, unknown>) });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message }, 200);
        }
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

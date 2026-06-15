/**
 * Internal Edge Function auth: WEBHOOK_SHARED_SECRET env, Bearer service role,
 * or x-internal-token matching Vault secret WEBHOOK_SHARED_SECRET (pg_cron path).
 */

import { recordCompatibilityUsage } from "./compatibilityTelemetry.ts";

// deno-lint-ignore no-explicit-any
export async function requireInternalAuth(
  req: Request,
  supabase: any,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const token = (req.headers.get('x-internal-token') || '').trim();
  const expected = (Deno.env.get('WEBHOOK_SHARED_SECRET') || '').trim();
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (expected && token === expected) return null;
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabase.rpc('verify_webhook_internal_token', { p_token: token });
  if (error) {
    console.error(JSON.stringify({ module: 'internalAuth', action: 'rpc_error', message: error.message }));
  }
  if (data === true) return null;

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Header map for supabase.functions.invoke from one Edge Function to another (same project). */
export function serviceRoleBearerHeader(): Record<string, string> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return { Authorization: `Bearer ${serviceKey}` };
}

export type RssWebhookToken = {
  provided: string;
  fromQuery: boolean;
  source: string | null;
};

export function readRssWebhookToken(req: Request): RssWebhookToken {
  const urlObj = new URL(req.url);
  const webhookHeader = req.headers.get('x-webhook-token')?.trim() || '';
  if (webhookHeader) return { provided: webhookHeader, fromQuery: false, source: 'header:x-webhook-token' };

  const rssHeader = req.headers.get('x-rssapp-token')?.trim() || '';
  if (rssHeader) return { provided: rssHeader, fromQuery: false, source: 'header:x-rssapp-token' };

  const tokenQuery = urlObj.searchParams.get('token')?.trim() || '';
  if (tokenQuery) return { provided: tokenQuery, fromQuery: true, source: 'query:token' };

  const webhookQuery = urlObj.searchParams.get('webhook_token')?.trim() || '';
  if (webhookQuery) return { provided: webhookQuery, fromQuery: true, source: 'query:webhook_token' };

  const rssQuery = urlObj.searchParams.get('rssapp_token')?.trim() || '';
  if (rssQuery) return { provided: rssQuery, fromQuery: true, source: 'query:rssapp_token' };

  return { provided: '', fromQuery: false, source: null };
}

export function parseRssQueryTokenAllowance(raw: string | null | undefined): boolean {
  const normalized = (raw || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

export function allowRssQueryToken(): boolean {
  let raw: string | null | undefined;
  try {
    raw = Deno.env.get('RSSAPP_ALLOW_QUERY_TOKEN') || Deno.env.get('ALLOW_RSS_QUERY_TOKEN');
  } catch (_e) {
    raw = undefined;
  }
  return parseRssQueryTokenAllowance(raw);
}

function readOptionalEnv(name: string): string {
  try {
    return Deno.env.get(name)?.trim() || '';
  } catch (_e) {
    return '';
  }
}

/**
 * RSS / webhook entry: token in x-webhook-token or x-rssapp-token.
 * When no env token is configured, falls back to Vault WEBHOOK_SHARED_SECRET (same as cron).
 */
// deno-lint-ignore no-explicit-any
export async function requireRssWebhookAuth(
  req: Request,
  supabase: any,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const { provided, fromQuery, source } = readRssWebhookToken(req);

  if (!provided) {
    console.warn('Webhook token missing');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (fromQuery) {
    if (!allowRssQueryToken()) {
      console.warn('Webhook query token rejected; use x-webhook-token or x-rssapp-token header');
      return new Response(JSON.stringify({ error: 'Webhook token must be sent in a header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.warn('Webhook query token accepted for RSS.app compatibility; prefer x-webhook-token or x-rssapp-token header when supported');
  }

  const expectedEnv = (
    readOptionalEnv('WEBHOOK_SHARED_SECRET')
      || readOptionalEnv('RSSAPP_WEBHOOK_TOKEN')
      || readOptionalEnv('RSSAPP_TOKEN')
  );

  if (expectedEnv) {
    if (provided === expectedEnv) {
      if (fromQuery) {
        await recordCompatibilityUsage(supabase, {
          source: 'webhooks-rssapp',
          feature: 'rss_query_token',
          legacyValue: source,
          canonicalValue: 'header:x-webhook-token',
          action: 'require_rss_webhook_auth',
          request: req,
          metadata: { token_source: source },
        });
      }
      return null;
    }
    console.warn('Webhook token invalid (env configured)');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabase.rpc('verify_webhook_internal_token', { p_token: provided });
  if (error) {
    console.error(JSON.stringify({ module: 'internalAuth', action: 'rss_vault_rpc', message: error.message }));
  }
  if (data === true) {
    if (fromQuery) {
      await recordCompatibilityUsage(supabase, {
        source: 'webhooks-rssapp',
        feature: 'rss_query_token',
        legacyValue: source,
        canonicalValue: 'header:x-webhook-token',
        action: 'require_rss_webhook_auth',
        request: req,
        metadata: { token_source: source, verifier: 'vault' },
      });
    }
    return null;
  }

  console.error('Webhook secret not configured in env and token did not match Vault');
  return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

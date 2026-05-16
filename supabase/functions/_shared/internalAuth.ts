/**
 * Internal Edge Function auth: WEBHOOK_SHARED_SECRET env, Bearer service role,
 * or x-internal-token matching Vault secret WEBHOOK_SHARED_SECRET (pg_cron path).
 */

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

export function readRssWebhookToken(req: Request): { provided: string; fromQuery: boolean } {
  const urlObj = new URL(req.url);
  const headerToken = (
    req.headers.get('x-webhook-token')?.trim()
      || req.headers.get('x-rssapp-token')?.trim()
      || ''
  );
  const queryToken = (
    urlObj.searchParams.get('token')?.trim()
      || urlObj.searchParams.get('webhook_token')?.trim()
      || urlObj.searchParams.get('rssapp_token')?.trim()
      || ''
  );
  return {
    provided: headerToken || queryToken,
    fromQuery: !headerToken && Boolean(queryToken),
  };
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
  const { provided, fromQuery } = readRssWebhookToken(req);

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
    Deno.env.get('WEBHOOK_SHARED_SECRET')?.trim()
      || Deno.env.get('RSSAPP_WEBHOOK_TOKEN')?.trim()
      || Deno.env.get('RSSAPP_TOKEN')?.trim()
      || ''
  );

  if (expectedEnv) {
    if (provided === expectedEnv) return null;
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
  if (data === true) return null;

  console.error('Webhook secret not configured in env and token did not match Vault');
  return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

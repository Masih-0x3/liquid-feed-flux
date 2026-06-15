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

export type RssAppWebhookSignatureOptions = {
  rawBody?: string;
  signingSecret?: string;
  nowMs?: () => number;
  toleranceSeconds?: number;
};

type ParsedRssAppSignature = {
  timestamp: number;
  signature: string;
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

function parseRssAppSignatureHeader(header: string): ParsedRssAppSignature | null {
  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (!key || valueParts.length === 0) continue;
    parts.set(key, valueParts.join('=').trim());
  }

  const timestampRaw = parts.get('t') || '';
  const signature = (parts.get('v1') || '').trim().toLowerCase();
  const timestamp = Number.parseInt(timestampRaw, 10);

  if (!Number.isFinite(timestamp) || timestamp <= 0 || String(timestamp) !== timestampRaw.trim()) return null;
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;

  return { timestamp, signature };
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  let mismatch = normalizedLeft.length === normalizedRight.length ? 0 : 1;

  for (let index = 0; index < maxLength; index++) {
    mismatch |= (normalizedLeft.charCodeAt(index) || 0) ^ (normalizedRight.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export async function verifyRssAppWebhookSignature({
  rawBody,
  header,
  signingSecret,
  nowMs,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  header: string;
  signingSecret: string;
  nowMs?: () => number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const parsed = parseRssAppSignatureHeader(header);
  if (!parsed || !signingSecret) return false;

  const currentTimestamp = Math.floor((nowMs ? nowMs() : Date.now()) / 1000);
  if (Math.abs(currentTimestamp - parsed.timestamp) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(signingSecret, `${parsed.timestamp}.${rawBody}`);
  return timingSafeHexEqual(parsed.signature, expected);
}

async function verifySignedRssAppRequest(
  req: Request,
  options: RssAppWebhookSignatureOptions,
): Promise<boolean> {
  const signatureHeader = req.headers.get('RSSApp-Signature')?.trim() || '';
  const signingSecret = (
    options.signingSecret?.trim()
    || readOptionalEnv('RSSAPP_SIGNING_SECRET')
    || readOptionalEnv('RSSAPP_WEBHOOK_SECRET')
  );

  if (!signatureHeader || !signingSecret) return false;

  const rawBody = options.rawBody ?? await req.clone().text();
  return verifyRssAppWebhookSignature({
    rawBody,
    header: signatureHeader,
    signingSecret,
    nowMs: options.nowMs,
    toleranceSeconds: options.toleranceSeconds,
  });
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
  signatureOptions: RssAppWebhookSignatureOptions = {},
): Promise<Response | null> {
  const signatureHeader = req.headers.get('RSSApp-Signature')?.trim() || '';
  const signingSecretConfigured = Boolean(
    signatureOptions.signingSecret?.trim()
    || readOptionalEnv('RSSAPP_SIGNING_SECRET')
    || readOptionalEnv('RSSAPP_WEBHOOK_SECRET')
  );
  if (signatureHeader && signingSecretConfigured) {
    if (await verifySignedRssAppRequest(req, signatureOptions)) {
      return null;
    }
    console.warn('RSS.app webhook signature invalid');
    return new Response(JSON.stringify({ error: 'Invalid RSS.app signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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
      console.warn('Webhook query token rejected; use RSS.app signing or x-webhook-token/x-rssapp-token header');
      return new Response(JSON.stringify({ error: 'Webhook auth must use RSS.app signing or a header token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.warn('Webhook query token accepted for RSS.app compatibility; prefer signed RSS.app webhooks or x-webhook-token/x-rssapp-token header fallback');
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
          canonicalValue: 'header:RSSApp-Signature',
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
        canonicalValue: 'header:RSSApp-Signature',
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

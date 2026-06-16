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

export type RssWebhookToken = {
  provided: string;
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
  const webhookHeader = req.headers.get('x-webhook-token')?.trim() || '';
  if (webhookHeader) return { provided: webhookHeader, source: 'header:x-webhook-token' };

  const rssHeader = req.headers.get('x-rssapp-token')?.trim() || '';
  if (rssHeader) return { provided: rssHeader, source: 'header:x-rssapp-token' };

  return { provided: '', source: null };
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
 * RSS / webhook entry: signed RSS.app request or token in x-webhook-token / x-rssapp-token.
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

  const { provided } = readRssWebhookToken(req);

  if (!provided) {
    console.warn('Webhook token missing');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const expectedEnv = (
    readOptionalEnv('WEBHOOK_SHARED_SECRET')
      || readOptionalEnv('RSSAPP_WEBHOOK_TOKEN')
      || readOptionalEnv('RSSAPP_TOKEN')
  );

  if (expectedEnv) {
    if (provided === expectedEnv) {
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
    return null;
  }

  console.error('Webhook secret not configured in env and token did not match Vault');
  return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

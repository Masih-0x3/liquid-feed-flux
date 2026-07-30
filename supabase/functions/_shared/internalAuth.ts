/**
 * Internal Edge Function auth is deliberately local and fail-closed.
 *
 * The previous Vault-RPC fallback required a service-role client before the
 * request had been authenticated. Cron and Edge callers must keep the Vault
 * and Edge WEBHOOK_SHARED_SECRET values aligned; an out-of-sync deployment
 * now rejects rather than performing privileged work to recover auth.
 */

import {
  buildRssWebhookSignatureInput,
  readBoundedRssWebhookBody,
} from './rssWebhookPayloadPolicy.ts';

export type InternalAuthOptions = {
  sharedSecret?: string;
  serviceRoleKey?: string;
};

export async function requireInternalAuth(
  req: Request,
  corsHeaders: Record<string, string>,
  options: InternalAuthOptions = {},
): Promise<Response | null> {
  const token = (req.headers.get('x-internal-token') || '').trim();
  const expected = typeof options.sharedSecret === 'string'
    ? options.sharedSecret.trim()
    : readOptionalEnv('WEBHOOK_SHARED_SECRET');
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = typeof options.serviceRoleKey === 'string'
    ? options.serviceRoleKey
    : readOptionalEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (expected && timingSafeStringEqual(token, expected)) return null;
  if (serviceKey && timingSafeStringEqual(authHeader, `Bearer ${serviceKey}`)) return null;

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
  rawBodyBytes?: Uint8Array;
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

function readRssWebhookExpectedToken(): string {
  return (
    readOptionalEnv('RSSAPP_WEBHOOK_TOKEN')
      || readOptionalEnv('RSSAPP_TOKEN')
  );
}

function readRssAppSigningSecret(options: RssAppWebhookSignatureOptions = {}): string {
  return (
    options.signingSecret?.trim()
    || readOptionalEnv('RSSAPP_SIGNING_SECRET')
    || readOptionalEnv('RSSAPP_WEBHOOK_SECRET')
  );
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

async function hmacSha256Hex(secret: string, value: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    typeof value === 'string' ? encoder.encode(value) : value,
  );
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

function timingSafeStringEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let index = 0; index < maxLength; index++) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export type RssWebhookAuthMode = 'signed' | 'token';

/**
 * Classifies the credential before body buffering. A syntactically invalid
 * configured signature is deliberately rejected instead of falling through to
 * a token, preserving the signature-first security contract.
 */
export function readRssWebhookAuthMode(
  req: Request,
  options: RssAppWebhookSignatureOptions = {},
): RssWebhookAuthMode | null {
  const signatureHeader = req.headers.get('RSSApp-Signature')?.trim() || '';
  if (signatureHeader && readRssAppSigningSecret(options)) {
    return parseRssAppSignatureHeader(signatureHeader) ? 'signed' : null;
  }
  return readRssWebhookToken(req).provided ? 'token' : null;
}

/**
 * Header map for the no-write admin validation invoke. Prefer the dedicated
 * RSS token; when signing is the only configured RSS credential, sign the
 * exact programmatic JSON string sent to the webhook.
 */
export async function rssWebhookInternalAuthHeaders(rawBody: string): Promise<Record<string, string>> {
  const token = readRssWebhookExpectedToken();
  if (token) return { 'x-webhook-token': token };

  const signingSecret = readRssAppSigningSecret();
  if (!signingSecret) return {};
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmacSha256Hex(signingSecret, `${timestamp}.${rawBody}`);
  return { 'RSSApp-Signature': `t=${timestamp},v1=${signature}` };
}

export async function verifyRssAppWebhookSignature({
  rawBody,
  rawBodyBytes,
  header,
  signingSecret,
  nowMs,
  toleranceSeconds = 300,
}: {
  rawBody: string;
  rawBodyBytes?: Uint8Array;
  header: string;
  signingSecret: string;
  nowMs?: () => number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const parsed = parseRssAppSignatureHeader(header);
  if (!parsed || !signingSecret) return false;

  const currentTimestamp = Math.floor((nowMs ? nowMs() : Date.now()) / 1000);
  if (Math.abs(currentTimestamp - parsed.timestamp) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(
    signingSecret,
    rawBodyBytes
      ? buildRssWebhookSignatureInput(parsed.timestamp, rawBodyBytes)
      : `${parsed.timestamp}.${rawBody}`,
  );
  return timingSafeHexEqual(parsed.signature, expected);
}

async function verifySignedRssAppRequest(
  req: Request,
  options: RssAppWebhookSignatureOptions,
): Promise<boolean> {
  const signatureHeader = req.headers.get('RSSApp-Signature')?.trim() || '';
  const signingSecret = readRssAppSigningSecret(options);

  if (!signatureHeader || !signingSecret) return false;

  // Production webhook handlers pass their one bounded body read here. The
  // fallback keeps direct helper callers bounded too without consuming req.
  let rawBody = options.rawBody;
  let rawBodyBytes = options.rawBodyBytes;
  if (rawBody === undefined) {
    const boundedBody = await readBoundedRssWebhookBody(req.clone());
    rawBody = boundedBody.text;
    rawBodyBytes ??= boundedBody.bytes;
  }
  return verifyRssAppWebhookSignature({
    rawBody,
    rawBodyBytes,
    header: signatureHeader,
    signingSecret,
    nowMs: options.nowMs,
    toleranceSeconds: options.toleranceSeconds,
  });
}

/**
 * RSS / webhook entry: signed RSS.app request or a dedicated token in
 * x-webhook-token / x-rssapp-token. It never falls back to the shared internal
 * WEBHOOK_SHARED_SECRET or Vault token verifier.
 */
export async function requireRssWebhookAuth(
  req: Request,
  _supabase: unknown,
  corsHeaders: Record<string, string>,
  signatureOptions: RssAppWebhookSignatureOptions = {},
): Promise<Response | null> {
  const signatureHeader = req.headers.get('RSSApp-Signature')?.trim() || '';
  const signingSecretConfigured = Boolean(readRssAppSigningSecret(signatureOptions));
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

  const expectedEnv = readRssWebhookExpectedToken();

  if (expectedEnv && timingSafeStringEqual(provided, expectedEnv)) {
    return null;
  }

  console.warn(expectedEnv ? 'Webhook token invalid' : 'Dedicated RSS webhook token not configured');
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

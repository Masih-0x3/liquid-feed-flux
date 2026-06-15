export interface XApiEventInput {
  source: string;
  sourceAction: string;
  endpoint: string;
  method?: string;
  tweetId?: string | null;
  userId?: string | null;
  status?: number | null;
  ok?: boolean;
  error?: string | null;
  estimatedBillableUnit?: string | null;
  requestCounted?: boolean;
  metadata?: Record<string, unknown>;
}

export interface XRateLimitHeaders {
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
}

function parseIntHeader(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function extractXRateLimitHeaders(headers: Headers): XRateLimitHeaders {
  const reset = parseIntHeader(headers.get('x-rate-limit-reset'));
  return {
    rateLimitLimit: parseIntHeader(headers.get('x-rate-limit-limit')),
    rateLimitRemaining: parseIntHeader(headers.get('x-rate-limit-remaining')),
    rateLimitResetAt: reset ? new Date(reset * 1000).toISOString() : null,
  };
}

export function summarizeEndpoint(rawEndpoint: string): string {
  try {
    const url = new URL(rawEndpoint);
    return url.pathname;
  } catch {
    return rawEndpoint.split('?')[0] || rawEndpoint;
  }
}

export function classifyXBillableUnit(endpoint: string, method = 'GET'): string {
  const normalized = summarizeEndpoint(endpoint);
  const upper = method.toUpperCase();
  if (normalized.includes('/usage/tweets')) return 'official_usage_lookup';
  if (normalized.includes('/media/upload')) return 'media_upload';
  if (normalized.includes('/2/tweets') && upper === 'POST') return 'post_write';
  if (normalized.includes('/2/tweets') && upper === 'GET') return 'post_read';
  if (normalized.includes('/followers') || normalized.includes('/following')) return 'user_list_read';
  if (normalized.includes('/2/users/me')) return 'credential_verify';
  return 'api_request';
}

// deno-lint-ignore no-explicit-any
export async function recordXApiEvent(supabase: any, input: XApiEventInput, response?: Response | null): Promise<void> {
  const headers = response ? extractXRateLimitHeaders(response.headers) : {
    rateLimitLimit: null,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
  };
  const status = input.status ?? response?.status ?? null;
  const ok = input.ok ?? response?.ok ?? false;

  try {
    await supabase.from('x_api_events').insert({
      source: input.source,
      source_action: input.sourceAction,
      endpoint: summarizeEndpoint(input.endpoint),
      method: (input.method ?? 'GET').toUpperCase(),
      tweet_id: input.tweetId ?? null,
      x_user_id: input.userId ?? null,
      http_status: status,
      ok,
      error: input.error ? String(input.error).slice(0, 1000) : null,
      rate_limit_limit: headers.rateLimitLimit,
      rate_limit_remaining: headers.rateLimitRemaining,
      rate_limit_reset_at: headers.rateLimitResetAt,
      estimated_billable_unit: input.estimatedBillableUnit ?? classifyXBillableUnit(input.endpoint, input.method),
      request_counted: input.requestCounted !== false,
      metadata: input.metadata ?? {},
    });
  } catch (e) {
    console.warn('recordXApiEvent failed:', e instanceof Error ? e.message : String(e));
  }
}

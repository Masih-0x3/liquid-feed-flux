import * as Sentry from "npm:@sentry/deno@10.58.0";

let initialized = false;
let enabled = false;

type CaptureContext = {
  functionName: string;
  action?: string;
  request?: Request;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

function readSampleRate(fallback: number): number {
  const raw = Deno.env.get("SENTRY_TRACES_SAMPLE_RATE")?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function requestContext(req?: Request): Record<string, unknown> | undefined {
  if (!req) return undefined;
  const url = new URL(req.url);
  return {
    method: req.method,
    path: url.pathname,
    user_agent: req.headers.get("user-agent") ?? undefined,
  };
}

export function initSentryEdge(): boolean {
  if (initialized) return enabled;

  initialized = true;
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  enabled = Boolean(dsn);
  if (!dsn) return false;

  Sentry.init({
    dsn,
    defaultIntegrations: false,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? Deno.env.get("ENVIRONMENT") ?? "production",
    release: Deno.env.get("SENTRY_RELEASE") ?? Deno.env.get("DEPLOY_GIT_SHA") ?? undefined,
    tracesSampleRate: readSampleRate(0.1),
  });

  return true;
}

export async function captureEdgeException(error: unknown, context: CaptureContext): Promise<void> {
  if (!initSentryEdge()) return;

  Sentry.withScope((scope) => {
    scope.setTag("service", "xot-edge");
    scope.setTag("function", context.functionName);
    if (context.action) scope.setTag("action", context.action);
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined) scope.setTag(key, String(value));
    }
    const request = requestContext(context.request);
    if (request) scope.setContext("request", request);
    if (context.extra) scope.setContext("xot", context.extra);
    Sentry.captureException(error);
  });

  await Sentry.flush(2000);
}

export function captureEdgeExceptionBackground(error: unknown, context: CaptureContext): void {
  const promise = captureEdgeException(error, context).catch((captureError) => {
    void captureError;
    console.error("sentry_capture_failed");
  });
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
  }
}

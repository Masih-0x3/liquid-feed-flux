import * as Sentry from "@sentry/node";

let initialized = false;
let enabled = false;

function readSampleRate(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function initSentryRenderer({ config = {}, runtime = {}, env = process.env } = {}) {
  if (initialized) return enabled;

  initialized = true;
  const dsn = String(env.SENTRY_DSN ?? "").trim();
  enabled = Boolean(dsn);
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "production",
    release: env.SENTRY_RELEASE || `xot-renderer@${runtime.version || env.npm_package_version || "0.1.0"}`,
    tracesSampleRate: readSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    sendDefaultPii: false,
    initialScope: {
      tags: {
        service: "xot-renderer",
        renderer_id: config.rendererId,
        render_version: config.renderVersion,
      },
    },
  });

  return true;
}

export function captureRendererException(error, context = {}) {
  if (!enabled && !initSentryRenderer()) return;

  Sentry.withScope((scope) => {
    scope.setTag("service", "xot-renderer");
    if (context.action) scope.setTag("action", context.action);
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined) scope.setTag(key, String(value));
    }
    if (context.extra) scope.setContext("xot", context.extra);
    Sentry.captureException(error);
  });
}

export async function flushSentryRenderer(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs);
}

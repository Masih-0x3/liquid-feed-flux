import {
  createSentryBootstrap,
  readSampleRate,
} from "@/lib/sentryBootstrap";

const releaseSha = typeof __APP_VERSION_SHA__ !== "undefined" ? __APP_VERSION_SHA__ : "dev";
export const SENTRY_ENVIRONMENT_FALLBACK = "unknown";

export function resolveSentryEnvironment(value: unknown): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : SENTRY_ENVIRONMENT_FALLBACK;
}

const sentryBootstrap = createSentryBootstrap(
  () => import("@sentry/react"),
  {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: resolveSentryEnvironment(import.meta.env.VITE_SENTRY_ENVIRONMENT),
    releaseSha,
    tracesSampleRate: readSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1),
    replaysSessionSampleRate: readSampleRate(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: readSampleRate(import.meta.env.VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE, 1),
  },
);

export function initializeSentry() {
  return sentryBootstrap.initialize();
}

export function captureAppReactException(
  error: unknown,
  context: { componentStack: string | null },
): void {
  sentryBootstrap.captureReactException(error, context);
}

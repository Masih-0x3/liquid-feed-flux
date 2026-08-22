import {
  createSentryBootstrap,
  readSampleRate,
} from "@/lib/sentryBootstrap";

const releaseSha = typeof __APP_VERSION_SHA__ !== "undefined" ? __APP_VERSION_SHA__ : "dev";
const sentryBootstrap = createSentryBootstrap(
  () => import("@sentry/react"),
  {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
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

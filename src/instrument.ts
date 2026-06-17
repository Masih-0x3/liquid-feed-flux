import * as Sentry from "@sentry/react";

function readSampleRate(name: string, fallback: number): number {
  const raw = import.meta.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();

if (sentryDsn) {
  const releaseSha = typeof __APP_VERSION_SHA__ !== "undefined" ? __APP_VERSION_SHA__ : "dev";

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: `xot-web@${releaseSha}`,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: readSampleRate("VITE_SENTRY_TRACES_SAMPLE_RATE", 0.1),
    replaysSessionSampleRate: readSampleRate("VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE", 0),
    replaysOnErrorSampleRate: readSampleRate("VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE", 1),
    sendDefaultPii: false,
    beforeSend(event) {
      event.tags = {
        ...event.tags,
        service: "xot-web",
      };
      return event;
    },
  });
}

export { Sentry };

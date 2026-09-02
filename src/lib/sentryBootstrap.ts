type SentrySdk = Pick<
  typeof import("@sentry/react"),
  "browserTracingIntegration" | "captureReactException" | "init" | "replayIntegration"
>;

export interface SentryEnvironment {
  dsn: string | undefined;
  environment: string;
  releaseSha: string;
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
}

export interface ReactErrorContext {
  componentStack: string | null;
}

export interface SentryBootstrap {
  initialize(): Promise<SentrySdk | null>;
  captureReactException(error: unknown, context: ReactErrorContext): void;
}

function scrubSentryUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [withoutQuery] = value.split(/[?#]/, 1);
  return withoutQuery.slice(0, 2048);
}

function scrubSentryEvent<T>(event: T): T {
  if (!event || typeof event !== "object") return event;
  const record = event as Record<string, unknown>;

  record.message = "react_render_error";
  delete record.user;
  delete record.breadcrumbs;
  delete record.extra;
  delete record.contexts;

  const request = record.request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const safeRequest = { ...(request as Record<string, unknown>) };
    safeRequest.url = scrubSentryUrl(safeRequest.url);
    delete safeRequest.headers;
    delete safeRequest.cookies;
    delete safeRequest.data;
    delete safeRequest.query_string;
    record.request = safeRequest;
  }

  const exception = record.exception;
  if (exception && typeof exception === "object" && !Array.isArray(exception)) {
    const exceptionRecord = { ...(exception as Record<string, unknown>) };
    const values = exceptionRecord.values;
    if (Array.isArray(values)) {
      exceptionRecord.values = values.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { type: "Error", value: "react_render_error" };
        }
        const safeValue = { ...(value as Record<string, unknown>) };
        safeValue.value = "react_render_error";
        delete safeValue.stacktrace;
        return safeValue;
      });
    }
    record.exception = exceptionRecord;
  }

  return event;
}

export function readSampleRate(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function createSentryBootstrap(
  loadSdk: () => Promise<SentrySdk>,
  environment: SentryEnvironment,
): SentryBootstrap {
  const dsn = environment.dsn?.trim();
  let initialization: Promise<SentrySdk | null> | null = null;

  const initialize = (): Promise<SentrySdk | null> => {
    if (!dsn) return Promise.resolve(null);
    if (initialization) return initialization;

    initialization = Promise.resolve()
      .then(loadSdk)
      .then((sdk) => {
        const integrations: Array<
          | ReturnType<SentrySdk["browserTracingIntegration"]>
          | ReturnType<SentrySdk["replayIntegration"]>
        > = [];
        if (environment.tracesSampleRate > 0) {
          integrations.push(sdk.browserTracingIntegration());
        }
        if (
          environment.replaysSessionSampleRate > 0 ||
          environment.replaysOnErrorSampleRate > 0
        ) {
          integrations.push(sdk.replayIntegration());
        }

        sdk.init({
          dsn,
          environment: environment.environment,
          release: `xot-web@${environment.releaseSha}`,
          integrations,
          tracesSampleRate: environment.tracesSampleRate,
          replaysSessionSampleRate: environment.replaysSessionSampleRate,
          replaysOnErrorSampleRate: environment.replaysOnErrorSampleRate,
          sendDefaultPii: false,
          beforeSend(event) {
            const safeEvent = scrubSentryEvent(event);
            safeEvent.tags = {
              ...safeEvent.tags,
              service: "xot-web",
            };
            return safeEvent;
          },
        });
        return sdk;
      })
      .catch(() => null);

    return initialization;
  };

  return {
    initialize,
    captureReactException(error, context) {
      void initialize()
        .then((sdk) => {
          if (sdk) sdk.captureReactException(error, context);
        })
        .catch(() => undefined);
    },
  };
}

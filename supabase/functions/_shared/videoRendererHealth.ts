export const VIDEO_RENDERER_HEARTBEAT_STALE_AFTER_MS = 90_000;

export type VideoRendererHealthState = "healthy" | "stale" | "unavailable" | "blocked" | "unknown";

export type VideoRendererHealth = {
  state: VideoRendererHealthState;
  server_observed_at: string;
  last_seen_at: string | null;
  age_ms: number | null;
  renderer_id: string | null;
  reported_status: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function observedTimestamp(observedAtMs: number): number {
  return Number.isFinite(observedAtMs) ? Math.max(0, observedAtMs) : Date.now();
}

export function classifyVideoRendererHealth(
  heartbeatRows: unknown,
  observedAtMs = Date.now(),
): VideoRendererHealth {
  const observedAt = observedTimestamp(observedAtMs);
  const serverObservedAt = new Date(observedAt).toISOString();
  const heartbeat = Array.isArray(heartbeatRows) ? asRecord(heartbeatRows[0]) : null;

  if (!heartbeat) {
    return {
      state: "unavailable",
      server_observed_at: serverObservedAt,
      last_seen_at: null,
      age_ms: null,
      renderer_id: null,
      reported_status: null,
    };
  }

  const lastSeenAt = asNonEmptyString(heartbeat.last_seen_at);
  const rendererId = asNonEmptyString(heartbeat.renderer_id);
  const reportedStatus = asNonEmptyString(heartbeat.status)?.toLowerCase() ?? null;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  if (!Number.isFinite(lastSeenMs)) {
    return {
      state: "unknown",
      server_observed_at: serverObservedAt,
      last_seen_at: lastSeenAt,
      age_ms: null,
      renderer_id: rendererId,
      reported_status: reportedStatus,
    };
  }

  const ageMs = Math.max(0, observedAt - lastSeenMs);
  let state: VideoRendererHealthState;
  if (ageMs >= VIDEO_RENDERER_HEARTBEAT_STALE_AFTER_MS) {
    state = "stale";
  } else if (reportedStatus === "online") {
    state = "healthy";
  } else if (reportedStatus === "draining" || reportedStatus === "paused") {
    state = "blocked";
  } else if (reportedStatus === "offline" || reportedStatus === "error") {
    state = "unavailable";
  } else {
    state = "unknown";
  }

  return {
    state,
    server_observed_at: serverObservedAt,
    last_seen_at: lastSeenAt,
    age_ms: ageMs,
    renderer_id: rendererId,
    reported_status: reportedStatus,
  };
}

export const VIDEO_RENDER_ACTIVE_POLL_INTERVAL_MS = 10_000;
export const VIDEO_RENDER_STALE_POLL_INTERVAL_MS = 30_000;
export const VIDEO_RENDER_MAX_POLL_INTERVAL_MS = 60_000;

export type VideoRendererHealthState = 'healthy' | 'stale' | 'unavailable' | 'blocked' | 'unknown';

export type VideoRenderPollingInput = {
  isVisible: boolean;
  hasActiveRender: boolean;
  rendererHealth?: VideoRendererHealthState | null;
  failureCount?: number;
};

export function isActiveVideoRenderStatus(status: unknown): boolean {
  return status === 'queued' || status === 'running';
}

export function hasActiveVideoRenderRows(rows: unknown): boolean {
  return Array.isArray(rows) && rows.some((row) =>
    Boolean(row) && typeof row === 'object' && isActiveVideoRenderStatus((row as { status?: unknown }).status),
  );
}

export function videoRenderStatusesMayContainActive(statuses?: readonly unknown[]): boolean {
  return !statuses || statuses.length === 0 || statuses.some(isActiveVideoRenderStatus);
}

function boundedFailureCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(Math.max(Math.floor(count), 0), 3) : 0;
}

function withBackoff(interval: number, failureCount: unknown): number {
  return Math.min(
    VIDEO_RENDER_MAX_POLL_INTERVAL_MS,
    interval * 2 ** boundedFailureCount(failureCount),
  );
}

export function videoRenderPollingInterval({
  isVisible,
  hasActiveRender,
  rendererHealth = null,
  failureCount = 0,
}: VideoRenderPollingInput): number | false {
  if (!isVisible) return false;
  if (hasActiveRender || rendererHealth === 'healthy') {
    return withBackoff(VIDEO_RENDER_ACTIVE_POLL_INTERVAL_MS, failureCount);
  }
  if (rendererHealth === 'stale' || rendererHealth === 'unknown') {
    return withBackoff(VIDEO_RENDER_STALE_POLL_INTERVAL_MS, failureCount);
  }
  return false;
}

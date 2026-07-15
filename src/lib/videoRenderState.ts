export type RendererState = 'checking' | 'online' | 'offline' | 'stale' | 'unknown';

function heartbeatFresh(lastSeenAt?: string | null): boolean {
  if (!lastSeenAt) return false;
  const timestamp = new Date(lastSeenAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 90_000;
}

export function rendererStateFor({
  isLoading,
  isError,
  hasOverview,
  heartbeat,
}: {
  isLoading: boolean;
  isError: boolean;
  hasOverview: boolean;
  heartbeat: { status?: string | null; last_seen_at?: string | null } | null;
}): RendererState {
  if (isLoading && !hasOverview) return 'checking';
  if (isError && hasOverview) return 'stale';
  if (isError || !heartbeat) return 'unknown';
  if (!heartbeatFresh(heartbeat.last_seen_at)) return 'stale';
  return heartbeat.status === 'online' ? 'online' : 'offline';
}

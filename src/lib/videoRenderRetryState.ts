export type VideoRenderRetryInput = {
  render_id?: string | null;
  tweet_id?: string | null;
};

export type PendingVideoRenderRetryKeys = ReadonlyMap<string, number>;

function keyPart(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function videoRenderRetryKey(
  input: VideoRenderRetryInput | null | undefined,
): string | null {
  const renderId = keyPart(input?.render_id);
  if (renderId) return `retry:render:${renderId}`;

  const tweetId = keyPart(input?.tweet_id);
  return tweetId ? `retry:tweet:${tweetId}` : null;
}

export function beginVideoRenderRetry(
  pending: PendingVideoRenderRetryKeys,
  input: VideoRenderRetryInput,
): Map<string, number> {
  const key = videoRenderRetryKey(input);
  const next = new Map(pending);
  if (key) next.set(key, (next.get(key) ?? 0) + 1);
  return next;
}

export function settleVideoRenderRetry(
  pending: PendingVideoRenderRetryKeys,
  input: VideoRenderRetryInput,
): Map<string, number> {
  const key = videoRenderRetryKey(input);
  const next = new Map(pending);
  if (!key) return next;

  const count = next.get(key) ?? 0;
  if (count <= 1) next.delete(key);
  else next.set(key, count - 1);
  return next;
}

export function isVideoRenderRetryPending(
  pending: PendingVideoRenderRetryKeys,
  input: VideoRenderRetryInput | null | undefined,
): boolean {
  const key = videoRenderRetryKey(input);
  return key !== null && (pending.get(key) ?? 0) > 0;
}

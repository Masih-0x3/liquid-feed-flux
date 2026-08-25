export type DeliveryCutoverRpcClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

export class DeliveryCutoverBlockedError extends Error {
  readonly code = "delivery_cutover_blocked";

  constructor(reason = "missing_or_historical_lineage") {
    super(`delivery_cutover_blocked:${reason}`);
    this.name = "DeliveryCutoverBlockedError";
  }
}

/** Strictly-after-T predicate used by unit tests and non-Supabase callers. */
export function deliveryCutoverAllowsPost(
  cutoverAt: string | Date | null | undefined,
  postCreatedAt: string | Date | null | undefined,
): boolean {
  if (!cutoverAt || !postCreatedAt) return false;
  const cutoverMs = new Date(cutoverAt).getTime();
  const postMs = new Date(postCreatedAt).getTime();
  return Number.isFinite(cutoverMs) && Number.isFinite(postMs) &&
    postMs > cutoverMs;
}

/**
 * Last-mile guard. The RPC owns the authoritative singleton and post
 * lineage check, so an unavailable database or ambiguous lineage fails
 * closed before a provider call.
 */
export async function requireDeliveryCutover(
  client: DeliveryCutoverRpcClient,
  tweetId: string,
): Promise<void> {
  const normalizedTweetId = tweetId.trim();
  if (!normalizedTweetId) {
    throw new DeliveryCutoverBlockedError("missing_tweet_id");
  }
  const { error } = await client.rpc("assert_delivery_cutover_post", {
    p_tweet_id: normalizedTweetId,
  });
  if (error) {
    throw new DeliveryCutoverBlockedError(error.message ?? "rpc_unavailable");
  }
}

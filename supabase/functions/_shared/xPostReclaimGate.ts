/**
 * Reclaim-gate decision for the x-poster candidate loop.
 *
 * The latest `x_deliveries` row for a post can be `posting` (another worker is
 * mid-flight) or `pending`. A `pending` row written by
 * `release_x_post_delivery_for_retry` carries
 * `claim_release_reason = 'pre_provider_retry'` and represents a claim that was
 * released after a pre-provider transient failure, awaiting the next normal
 * claim once next_retry_at is due. Such rows must fall through to `claimXPostDelivery` so the post is
 * re-attempted without `force_retry = true` (see migration
 * `20260908105000_reclaim_pre_provider_x_deliveries.sql`).
 */
export type XDeliveryReclaimState = {
  status?: string | null;
  claim_release_reason?: string | null;
  next_retry_at?: string | null;
  claim_token?: string | null;
  provider_started_at?: string | null;
  x_tweet_id?: string | null;
};

export function shouldDeferActiveXDelivery(
  latest: XDeliveryReclaimState | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (latest?.status !== "posting" && latest?.status !== "pending") return false;
  if (latest.status === "pending" && latest.claim_release_reason === "pre_provider_retry") {
    if (latest.claim_token != null || latest.provider_started_at != null || latest.x_tweet_id != null) return true;
    if (latest.next_retry_at == null) return false;
    const retryMs = Date.parse(latest.next_retry_at);
    return !Number.isFinite(retryMs) || retryMs > nowMs;
  }
  return true;
}

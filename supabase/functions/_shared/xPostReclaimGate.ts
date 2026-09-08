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
export function shouldDeferActiveXDelivery(
  latestStatus: string | null | undefined,
  claimReleaseReason: string | null | undefined,
  nextRetryAt?: string | null,
  nowMs = Date.now(),
): boolean {
  if (latestStatus !== "posting" && latestStatus !== "pending") return false;
  if (latestStatus === "pending" && claimReleaseReason === "pre_provider_retry") {
    if (nextRetryAt == null) return false;
    const retryMs = Date.parse(nextRetryAt);
    return !Number.isFinite(retryMs) || retryMs > nowMs;
  }
  return true;
}

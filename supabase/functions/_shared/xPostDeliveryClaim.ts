export type XPostDeliveryClaim = {
  claimed: boolean;
  deliveryId: string | null;
  claimToken: string | null;
  reason: string;
  existingStatus: string | null;
  existingXTweetId: string | null;
  claimExpiresAt: string | null;
};

export type XPostClaimRejection = {
  status: "deferred" | "skipped";
  reason: string;
  x_tweet_id?: string;
};

type RpcResult = {
  data?: unknown;
  error?: { message?: string } | null;
};

type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeXPostDeliveryClaim(data: unknown): XPostDeliveryClaim {
  const row = firstRecord(data);
  return {
    claimed: row.claimed === true,
    deliveryId: textOrNull(row.delivery_id),
    claimToken: textOrNull(row.claim_token),
    reason: textOrNull(row.reason) ?? "unknown",
    existingStatus: textOrNull(row.existing_status),
    existingXTweetId: textOrNull(row.existing_x_tweet_id),
    claimExpiresAt: textOrNull(row.claim_expires_at),
  };
}

export function xPostClaimRejection(claim: XPostDeliveryClaim): XPostClaimRejection {
  if (claim.reason === "already_posted") {
    return {
      status: "skipped",
      reason: claim.reason,
      ...(claim.existingXTweetId ? { x_tweet_id: claim.existingXTweetId } : {}),
    };
  }
  return {
    status: "deferred",
    reason: claim.reason || "claim_not_acquired",
  };
}

export async function claimXPostDelivery(
  sb: RpcClient,
  params: {
    postId: string;
    source: string;
    forceRetry?: boolean;
    ttlSeconds?: number;
  },
): Promise<XPostDeliveryClaim> {
  const { data, error } = await sb.rpc("claim_x_post_delivery", {
    p_post_id: params.postId,
    p_source: params.source,
    p_force_retry: params.forceRetry === true,
    p_claim_ttl_seconds: params.ttlSeconds ?? 1800,
  });
  if (error) throw new Error(`claim_x_post_delivery: ${error.message ?? "unknown error"}`);
  return normalizeXPostDeliveryClaim(data);
}

export async function completeXPostDelivery(
  sb: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    xTweetId: string;
    mediaCount: number;
    mediaBytes: number;
    mediaKind: string | null;
    postedAt: string;
    latencyMs: number;
    apiResponse: unknown;
    lastError: string | null;
  },
): Promise<boolean> {
  const { data, error } = await sb.rpc("complete_x_post_delivery", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_x_tweet_id: params.xTweetId,
    p_media_count: params.mediaCount,
    p_media_bytes: params.mediaBytes,
    p_media_kind: params.mediaKind,
    p_posted_at: params.postedAt,
    p_latency_ms: params.latencyMs,
    p_api_response: params.apiResponse,
    p_last_error: params.lastError,
  });
  if (error) throw new Error(`complete_x_post_delivery: ${error.message ?? "unknown error"}`);
  return data === true;
}

export async function failXPostDelivery(
  sb: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    status?: "failed" | "skipped";
    error: string;
    apiResponse?: unknown;
    nextRetryAt?: string | null;
    skipReason?: string | null;
    mediaCount?: number;
    mediaBytes?: number;
    mediaKind?: string | null;
  },
): Promise<boolean> {
  const { data, error: rpcError } = await sb.rpc("fail_x_post_delivery", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_status: params.status ?? "failed",
    p_error: params.error,
    p_api_response: params.apiResponse ?? null,
    p_next_retry_at: params.nextRetryAt ?? null,
    p_skip_reason: params.skipReason ?? null,
    p_media_count: params.mediaCount ?? 0,
    p_media_bytes: params.mediaBytes ?? 0,
    p_media_kind: params.mediaKind ?? null,
  });
  if (rpcError) throw new Error(`fail_x_post_delivery: ${rpcError.message ?? "unknown error"}`);
  return data === true;
}

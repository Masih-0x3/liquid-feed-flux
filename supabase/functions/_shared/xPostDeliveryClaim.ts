export type XPostDeliveryClaim = {
  claimed: boolean;
  deliveryId: string | null;
  claimToken: string | null;
  claimGeneration: number | null;
  claim_state: string | null;
  providerStartedAt: string | null;
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

function xPostDeliveryRpcErrorCode(name: string): string {
  return `${name}_failed`;
}

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

function generationInt(value: unknown): number | null {
  const raw = value;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export function normalizeXPostDeliveryClaim(data: unknown): XPostDeliveryClaim {
  const row = firstRecord(data);
  return {
    claimed: row.claimed === true,
    deliveryId: textOrNull(row.delivery_id),
    claimToken: textOrNull(row.claim_token),
    claimGeneration: generationInt(row.claim_generation) ?? 0,
    claim_state: textOrNull(row.claim_state),
    providerStartedAt: textOrNull(row.provider_started_at),
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
  if (error) throw new Error(xPostDeliveryRpcErrorCode("claim_x_post_delivery"));
  return normalizeXPostDeliveryClaim(data);
}

/**
 * markXPostDeliveryProviderStarted — the durable provider-start boundary.
 *
 * MUST be recorded (and return true) immediately before the first irreversible
 * X provider call. If the marker cannot be durably written, the caller MUST NOT
 * invoke the provider. Once the provider is allowed to accept, a later database
 * completion failure is ambiguous (non-success, no duplicate retry) — never
 * reported back as success.
 */
export async function markXPostDeliveryProviderStarted(
  sb: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    claimGeneration: number;
  },
): Promise<boolean> {
  if (!params.deliveryId || !params.claimToken || params.claimGeneration <= 0) {
    throw new Error(xPostDeliveryRpcErrorCode("mark_x_delivery_provider_started"));
  }
  const { data, error } = await sb.rpc("mark_x_delivery_provider_started", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_claim_generation: params.claimGeneration,
  });
  if (error) throw new Error(xPostDeliveryRpcErrorCode("mark_x_delivery_provider_started"));
  return data === true;
}

export async function completeXPostDelivery(
  sb: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    claimGeneration: number;
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
    p_claim_generation: params.claimGeneration,
    p_x_tweet_id: params.xTweetId,
    p_media_count: params.mediaCount,
    p_media_bytes: params.mediaBytes,
    p_media_kind: params.mediaKind,
    p_posted_at: params.postedAt,
    p_latency_ms: params.latencyMs,
    p_api_response: params.apiResponse,
    p_last_error: params.lastError,
  });
  if (error) throw new Error(xPostDeliveryRpcErrorCode("complete_x_post_delivery"));
  return data === true;
}

export async function failXPostDelivery(
  sb: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    claimGeneration: number;
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
    p_claim_generation: params.claimGeneration,
    p_status: params.status ?? "failed",
    p_error: params.error,
    p_api_response: params.apiResponse ?? null,
    p_next_retry_at: params.nextRetryAt ?? null,
    p_skip_reason: params.skipReason ?? null,
    p_media_count: params.mediaCount ?? 0,
    p_media_bytes: params.mediaBytes ?? 0,
    p_media_kind: params.mediaKind ?? null,
  });
  if (rpcError) throw new Error(xPostDeliveryRpcErrorCode("fail_x_post_delivery"));
  return data === true;
}

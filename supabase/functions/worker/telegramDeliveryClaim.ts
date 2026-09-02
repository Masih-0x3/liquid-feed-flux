type RpcResult = {
  data?: unknown;
  error?: unknown;
};

type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type TelegramDeliveryClaim = {
  claimed: boolean;
  deliveryId: string | null;
  claimToken: string | null;
  claimGeneration: number | null;
  reason: string;
  existingStatus: string | null;
  claimExpiresAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function safeGeneration(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function telegramDeliveryKey(tweetId: string, chatId: string): string {
  const subjectId = String(tweetId ?? "").trim();
  const targetChat = String(chatId ?? "").trim();
  if (!subjectId || subjectId.length > 256) {
    throw new Error("telegram_delivery_subject_invalid");
  }
  if (!targetChat || targetChat.length > 128) {
    throw new Error("telegram_delivery_chat_invalid");
  }
  return `telegram:${targetChat}:${subjectId}`;
}

export function normalizeTelegramDeliveryClaim(data: unknown): TelegramDeliveryClaim {
  const row = firstRecord(data);
  const reason = textOrNull(row.reason);
  if (typeof row.claimed !== "boolean" || !reason) {
    throw new Error("telegram_delivery_claim_invalid_response");
  }
  const claim: TelegramDeliveryClaim = {
    claimed: row.claimed,
    deliveryId: textOrNull(row.delivery_id),
    claimToken: textOrNull(row.claim_token),
    claimGeneration: safeGeneration(row.claim_generation),
    reason,
    existingStatus: textOrNull(row.existing_status),
    claimExpiresAt: textOrNull(row.claim_expires_at),
  };
  if (claim.claimed && (!claim.deliveryId || !claim.claimToken || !claim.claimGeneration)) {
    throw new Error("telegram_delivery_claim_invalid_response");
  }
  return claim;
}

export async function claimTelegramDelivery(
  supabase: RpcClient,
  params: {
    tweetId: string;
    chatId: string;
    source?: string;
    ttlSeconds?: number;
  },
): Promise<TelegramDeliveryClaim> {
  const deliveryKey = telegramDeliveryKey(params.tweetId, params.chatId);
  const { data, error } = await supabase.rpc("claim_telegram_delivery", {
    p_delivery_key: deliveryKey,
    p_subject_id: params.tweetId,
    p_chat_id: params.chatId,
    p_source: params.source ?? "worker:deliver",
    p_claim_ttl_seconds: params.ttlSeconds ?? 1800,
  });
  if (error) throw new Error("telegram_delivery_claim_failed");
  return normalizeTelegramDeliveryClaim(data);
}

export async function startTelegramDelivery(
  supabase: RpcClient,
  params: { deliveryId: string; claimToken: string; claimGeneration: number },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("start_telegram_delivery", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_claim_generation: params.claimGeneration,
  });
  if (error) throw new Error("telegram_delivery_claim_start_failed");
  return data === true;
}

export async function completeTelegramDelivery(
  supabase: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    claimGeneration: number;
    messageIds: string[];
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_telegram_delivery", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_claim_generation: params.claimGeneration,
    p_message_ids: params.messageIds,
  });
  if (error) throw new Error("telegram_delivery_completion_failed");
  return data === true;
}

export async function markTelegramDeliveryAmbiguous(
  supabase: RpcClient,
  params: {
    deliveryId: string;
    claimToken: string;
    claimGeneration: number;
    messageIds?: string[];
    error?: string;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_telegram_delivery_ambiguous", {
    p_delivery_id: params.deliveryId,
    p_claim_token: params.claimToken,
    p_claim_generation: params.claimGeneration,
    p_message_ids: params.messageIds ?? [],
    p_error: params.error ?? "telegram_delivery_provider_outcome_unknown",
  });
  if (error) throw new Error("telegram_delivery_ambiguity_persistence_failed");
  return data === true;
}

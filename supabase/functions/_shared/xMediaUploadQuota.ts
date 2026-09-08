import type { XPostDeliveryClaim } from './xPostDeliveryClaim.ts';

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type MediaQuotaReservation =
  | { reserved: true; usage: number }
  | { reserved: false; reason: 'rate_limit_media' | 'quota_unavailable' | 'claim_lost' };

export async function reserveXMediaUploads(
  client: RpcClient, claim: XPostDeliveryClaim, count: number,
): Promise<MediaQuotaReservation> {
  if (!claim.claimed || !claim.deliveryId || !claim.claimToken || !claim.claimGeneration ||
    !Number.isInteger(count) || count < 1 || count > 4) {
    return { reserved: false, reason: 'quota_unavailable' };
  }
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('reserve_x_media_uploads', {
      p_delivery_id: claim.deliveryId, p_claim_token: claim.claimToken,
      p_claim_generation: claim.claimGeneration, p_media_count: count,
    });
  } catch {
    return { reserved: false, reason: 'quota_unavailable' };
  }
  const { data, error } = result;
  if (error) return { reserved: false, reason: 'quota_unavailable' };
  const row = data as Record<string, unknown> | null;
  if (row?.reserved === true && typeof row.media_uploads_24h === 'number' &&
    Number.isSafeInteger(row.media_uploads_24h) && row.media_uploads_24h >= count) {
    return { reserved: true, usage: row.media_uploads_24h };
  }
  if (row?.reserved === false && (row.reason === 'rate_limit_media' || row.reason === 'claim_lost')) {
    return { reserved: false, reason: row.reason };
  }
  return { reserved: false, reason: 'quota_unavailable' };
}

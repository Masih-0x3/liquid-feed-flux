import { assertEquals } from 'jsr:@std/assert';
import { reserveXMediaUploads } from './xMediaUploadQuota.ts';
import type { XPostDeliveryClaim } from './xPostDeliveryClaim.ts';
const claim: XPostDeliveryClaim = { claimed: true, deliveryId: 'delivery', claimToken: 'token', claimGeneration: 1,
  claim_state: 'preparing', providerStartedAt: null, reason: 'claimed', existingStatus: null,
  existingXTweetId: null, claimExpiresAt: null };
Deno.test('media reservation submits the entire batch and returns authoritative usage', async () => {
  let requested: unknown;
  const client = { rpc: (_name: string, args: Record<string, unknown>) => {
    requested = args.p_media_count;
    return Promise.resolve({ data: { reserved: true, media_uploads_24h: 20 }, error: null });
  } };
  assertEquals(await reserveXMediaUploads(client, claim, 4), { reserved: true, usage: 20 });
  assertEquals(requested, 4);
});
Deno.test('media reservation fails closed for malformed responses and database failures', async () => {
  for (const data of [null, {}, { reserved: true }, { reserved: true, media_uploads_24h: 0 }, { reserved: true, media_uploads_24h: '4' }]) {
    assertEquals(await reserveXMediaUploads({ rpc: () => Promise.resolve({ data, error: null }) }, claim, 4), { reserved: false, reason: 'quota_unavailable' });
  }
  assertEquals(await reserveXMediaUploads({ rpc: () => Promise.reject(new Error('private failure')) }, claim, 4), { reserved: false, reason: 'quota_unavailable' });
});
Deno.test('media reservation preserves quota and claim denials', async () => {
  for (const reason of ['rate_limit_media', 'claim_lost'] as const) {
    assertEquals(await reserveXMediaUploads({ rpc: () => Promise.resolve({ data: { reserved: false, reason }, error: null }) }, claim, 4), { reserved: false, reason });
  }
});
Deno.test('invalid media batches never reach the database', async () => {
  let calls = 0;
  const client = { rpc: () => { calls++; return Promise.resolve({ data: null, error: null }); } };
  for (const count of [0, 5, 1.5, NaN]) await reserveXMediaUploads(client, claim, count);
  await reserveXMediaUploads(client, { ...claim, claimed: false }, 1);
  assertEquals(calls, 0);
});

import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { claimFollowerSnapshot, renewFollowerSnapshot, finishFollowerSnapshot } from './followerSnapshotClaim.ts';
const client = (data: unknown, error: unknown = null) => ({ rpc: () => Promise.resolve({ data, error }) });
Deno.test('follower admission distinguishes active/recent claims from a new lease', async () => {
  for (const reason of ['snapshot_in_progress', 'daily_cap', 'snapshot_recent']) {
    assertEquals(await claimFollowerSnapshot(client({ claimed: false, reason }), 'manual', true, 60), { claim: null, reason });
  }
  assertEquals(await claimFollowerSnapshot(client({ claimed: true, snapshot_id: 'id', claim_token: 'token' }), 'cron', false, 60), { claim: { snapshotId: 'id', token: 'token' }, reason: null });
});
Deno.test('follower admission rejects malformed or failed database responses', async () => {
  for (const data of [null, {}, { claimed: true }, { claimed: false, reason: 'unknown' }]) {
    await assertRejects(() => claimFollowerSnapshot(client(data), 'manual', false, 60));
  }
  await assertRejects(() => claimFollowerSnapshot(client(null, { message: 'private error' }), 'manual', false, 60), Error, 'follower_snapshot_claim_failed');
});
Deno.test('lost leases cannot renew or finalize', async () => {
  const claim = { snapshotId: 'id', token: 'token' };
  await assertRejects(() => renewFollowerSnapshot(client(false), claim), Error, 'follower_snapshot_claim_lost');
  await assertRejects(() => finishFollowerSnapshot(client(false), claim, 'complete', {}), Error, 'follower_snapshot_finish_failed');
  await renewFollowerSnapshot(client(true), claim);
  await finishFollowerSnapshot(client(true), claim, 'complete', {});
});

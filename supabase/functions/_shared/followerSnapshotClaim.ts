type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type FollowerSnapshotClaim = { snapshotId: string; token: string };

export async function claimFollowerSnapshot(
  client: RpcClient, trigger: 'manual' | 'cron', force: boolean, staleMinutes: number,
): Promise<{ claim: FollowerSnapshotClaim | null; reason: string | null }> {
  const { data, error } = await client.rpc('claim_follower_snapshot', {
    p_trigger: trigger, p_force: force, p_stale_minutes: staleMinutes,
  });
  if (error) throw new Error('follower_snapshot_claim_failed');
  const row = data as Record<string, unknown> | null;
  if (row?.claimed === false && ['snapshot_in_progress', 'daily_cap', 'snapshot_recent'].includes(String(row.reason))) {
    return { claim: null, reason: String(row.reason) };
  }
  if (row?.claimed !== true || typeof row.snapshot_id !== 'string' || !row.snapshot_id ||
    typeof row.claim_token !== 'string' || !row.claim_token) throw new Error('follower_snapshot_claim_invalid');
  return { claim: { snapshotId: row.snapshot_id, token: row.claim_token }, reason: null };
}

export async function renewFollowerSnapshot(client: RpcClient, claim: FollowerSnapshotClaim): Promise<void> {
  const { data, error } = await client.rpc('renew_follower_snapshot_claim', { p_id: claim.snapshotId, p_token: claim.token });
  if (error || data !== true) throw new Error('follower_snapshot_claim_lost');
}

export async function finishFollowerSnapshot(
  client: RpcClient, claim: FollowerSnapshotClaim, status: 'complete' | 'partial' | 'failed', values: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await client.rpc('finish_follower_snapshot_claim', {
    p_id: claim.snapshotId, p_token: claim.token, p_status: status, p_values: values,
  });
  if (error || data !== true) throw new Error('follower_snapshot_finish_failed');
}

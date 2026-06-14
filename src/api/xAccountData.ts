import { invokeAdminAction } from '@/api/adminActions';

export interface FollowersSnapshotResult {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  latest_age_minutes?: number;
  error?: string;
  follower_count?: number;
  api_calls_used?: number;
}

export interface RunFollowersSnapshotInput {
  force?: boolean;
  includeFollowing?: boolean;
}

export async function runFollowersSnapshot({
  force = false,
  includeFollowing = true,
}: RunFollowersSnapshotInput = {}): Promise<FollowersSnapshotResult> {
  const result = await invokeAdminAction<FollowersSnapshotResult>(
    { action: 'run_followers_snapshot', include_following: includeFollowing, force },
    { throwOnFailure: false },
  );
  if (!result?.ok) throw new Error(result?.error ?? 'Snapshot failed');
  return result;
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FollowerSnapshot {
  id: string;
  taken_at: string;
  trigger: string;
  follower_count: number;
  following_count: number;
  status: string;
  api_calls_used: number;
}

export interface MutualFollowUser {
  user_id: string;
  username: string | null;
  name: string | null;
  profile_image_url: string | null;
}

export interface NotFollowingBackUser extends MutualFollowUser {
  first_following_seen_at: string | null;
  first_following_approximate: boolean;
  latest_following_order: number;
}

export interface NotFollowingBackGroup {
  date_key: string;
  label: string;
  started_at: string | null;
  approximate: boolean;
  users: NotFollowingBackUser[];
}

export interface FollowerChange {
  id: string;
  detected_at: string;
  user_id: string;
  username: string | null;
  name: string | null;
  profile_image_url: string | null;
  change_type: string;
  reviewed: boolean;
  first_seen_at?: string | null;
}

export interface FollowerStats {
  currentCount: number;
  delta: number | null;
  pendingUnfollowers: number;
  totalUnfollowers: number;
  newFollowers7d: number;
  churnRate: number;
  growthVelocity: number;
}

export function useFollowerSnapshots() {
  return useQuery({
    queryKey: ['follower-snapshots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('x_follower_snapshots')
        .select('id, taken_at, trigger, follower_count, following_count, status, api_calls_used')
        .order('taken_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as FollowerSnapshot[];
    },
    staleTime: 60_000,
  });
}

export function useUnfollowers(showAll: boolean, search: string) {
  return useQuery({
    queryKey: ['unfollowers', showAll, search],
    queryFn: async () => {
      let query = supabase
        .from('x_follower_changes')
        .select('id, detected_at, user_id, username, name, profile_image_url, change_type, reviewed')
        .eq('change_type', 'unfollowed')
        .order('detected_at', { ascending: false })
        .limit(200);

      if (!showAll) {
        query = query.eq('reviewed', false);
      }
      if (search.trim()) {
        query = query.or(`username.ilike.%${search}%,name.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const changes = (data ?? []) as FollowerChange[];

      if (changes.length > 0) {
        const userIds = changes.map(c => c.user_id);
        const { data: cacheData } = await supabase
          .from('x_followers_cache')
          .select('user_id, first_seen_at')
          .in('user_id', userIds);

        if (cacheData) {
          const cacheMap = new Map(cacheData.map(c => [c.user_id, c.first_seen_at]));
          for (const change of changes) {
            change.first_seen_at = cacheMap.get(change.user_id) ?? null;
          }
        }
      }

      return changes;
    },
    staleTime: 30_000,
  });
}

export function useNewFollowers() {
  return useQuery({
    queryKey: ['new-followers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('x_follower_changes')
        .select('id, detected_at, user_id, username, name, profile_image_url, change_type, reviewed')
        .eq('change_type', 'followed')
        .order('detected_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as FollowerChange[];
    },
    staleTime: 60_000,
  });
}

export function useFollowerStats() {
  return useQuery({
    queryKey: ['follower-stats'],
    queryFn: async () => {
      const [snapsRes, pendingRes, unfollowed7dRes, followed7dRes] = await Promise.all([
        supabase.from('x_follower_snapshots')
          .select('follower_count, taken_at')
          .order('taken_at', { ascending: false })
          .limit(2),
        supabase.from('x_follower_changes')
          .select('id', { count: 'exact', head: true })
          .eq('change_type', 'unfollowed')
          .eq('reviewed', false),
        supabase.from('x_follower_changes')
          .select('id', { count: 'exact', head: true })
          .eq('change_type', 'unfollowed')
          .gte('detected_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
        supabase.from('x_follower_changes')
          .select('id', { count: 'exact', head: true })
          .eq('change_type', 'followed')
          .gte('detected_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
      ]);

      const snaps = (snapsRes.data ?? []) as { follower_count: number; taken_at: string }[];
      const currentCount = snaps[0]?.follower_count ?? 0;
      const prevCount = snaps[1]?.follower_count ?? null;
      const delta = prevCount !== null ? currentCount - prevCount : null;
      const newFollowers7d = followed7dRes.count ?? 0;
      const unfollowers7d = unfollowed7dRes.count ?? 0;
      const churnRate = currentCount > 0 ? (unfollowers7d / currentCount) * 100 : 0;
      const growthVelocity = newFollowers7d / 7;

      return {
        currentCount,
        delta,
        pendingUnfollowers: pendingRes.count ?? 0,
        totalUnfollowers: unfollowers7d,
        newFollowers7d,
        churnRate: Math.round(churnRate * 100) / 100,
        growthVelocity: Math.round(growthVelocity * 10) / 10,
      } as FollowerStats;
    },
    staleTime: 60_000,
  });
}

export function useMarkReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('x_follower_changes') as any)
        .update({ reviewed: true })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unfollowers'] });
      queryClient.invalidateQueries({ queryKey: ['follower-stats'] });
    },
  });
}

export function useMarkAllReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('x_follower_changes') as any)
        .update({ reviewed: true })
        .eq('change_type', 'unfollowed')
        .eq('reviewed', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unfollowers'] });
      queryClient.invalidateQueries({ queryKey: ['follower-stats'] });
    },
  });
}

interface SnapshotWithRelationshipIds {
  taken_at: string;
  follower_ids: string[];
  following_ids: string[];
}

function localDateKey(iso: string | null): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function localDateLabel(iso: string | null, approximate: boolean): string {
  if (!iso) return 'Unknown start day';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown start day';
  const label = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return approximate ? `On or before ${label}` : label;
}

function groupNotFollowingBack(users: NotFollowingBackUser[]): NotFollowingBackGroup[] {
  const groups = new Map<string, NotFollowingBackGroup>();

  for (const user of users) {
    const key = localDateKey(user.first_following_seen_at);
    const existing = groups.get(key);
    if (existing) {
      existing.users.push(user);
      existing.approximate = existing.approximate || user.first_following_approximate;
      continue;
    }

    groups.set(key, {
      date_key: key,
      label: localDateLabel(user.first_following_seen_at, user.first_following_approximate),
      started_at: user.first_following_seen_at,
      approximate: user.first_following_approximate,
      users: [user],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      users: group.users.sort((a, b) => a.latest_following_order - b.latest_following_order),
    }))
    .sort((a, b) => {
      if (!a.started_at && !b.started_at) return 0;
      if (!a.started_at) return 1;
      if (!b.started_at) return -1;
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    });
}

export function useMutualFollowData() {
  return useQuery({
    queryKey: ['mutual-follow-data'],
    queryFn: async () => {
      // Use complete snapshots to approximate when an account first entered
      // the following list. This is stored data only; it does not call X.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: snapshotRows, error } = await (supabase.from('x_follower_snapshots') as any)
        .select('taken_at, follower_ids, following_ids')
        .eq('status', 'complete')
        .order('taken_at', { ascending: true });

      if (error) throw error;
      const snapshots = ((snapshotRows ?? []) as SnapshotWithRelationshipIds[])
        .filter((snap) => Array.isArray(snap.following_ids) && snap.following_ids.length > 0);

      if (snapshots.length === 0) {
        return { dontFollowBack: [], notFollowingBack: [], notFollowingBackGroups: [], hasFollowingData: false, latestSnapshotAt: null };
      }

      const latestSnap = snapshots[snapshots.length - 1];
      const firstSnapshotAt = snapshots[0]?.taken_at ?? null;
      const followerIds: string[] = (latestSnap.follower_ids ?? []) as string[];
      const followingIds: string[] = (latestSnap.following_ids ?? []) as string[];

      // following_ids is only populated after a snapshot runs with the updated function
      if (followingIds.length === 0) {
        return { dontFollowBack: [], notFollowingBack: [], notFollowingBackGroups: [], hasFollowingData: false, latestSnapshotAt: latestSnap.taken_at };
      }

      const followerSet = new Set(followerIds);
      const followingSet = new Set(followingIds);
      const firstFollowingSeen = new Map<string, { seenAt: string; approximate: boolean }>();

      for (const snapshot of snapshots) {
        for (const id of snapshot.following_ids ?? []) {
          if (!firstFollowingSeen.has(id)) {
            firstFollowingSeen.set(id, {
              seenAt: snapshot.taken_at,
              approximate: snapshot.taken_at === firstSnapshotAt,
            });
          }
        }
      }

      // People who follow me but I don't follow back
      const dontFollowBackIds = followerIds.filter(id => !followingSet.has(id));
      // People I follow but they don't follow me back
      const notFollowingBackIds = followingIds.filter(id => !followerSet.has(id));

      // Fetch profile data for both lists from cache
      const allLookupIds = [...new Set([...dontFollowBackIds, ...notFollowingBackIds])];
      const profileMap = new Map<string, MutualFollowUser>();

      for (let i = 0; i < allLookupIds.length; i += 500) {
        const chunk = allLookupIds.slice(i, i + 500);
        const { data: profiles } = await supabase
          .from('x_followers_cache')
          .select('user_id, username, name, profile_image_url')
          .in('user_id', chunk);
        for (const p of (profiles ?? [])) {
          profileMap.set(p.user_id as string, {
            user_id: p.user_id as string,
            username: (p.username as string) ?? null,
            name: (p.name as string) ?? null,
            profile_image_url: (p.profile_image_url as string) ?? null,
          });
        }
      }

      const dontFollowBack: MutualFollowUser[] = dontFollowBackIds.map(id =>
        profileMap.get(id) ?? { user_id: id, username: null, name: null, profile_image_url: null }
      );
      const notFollowingBack: NotFollowingBackUser[] = notFollowingBackIds.map((id, index) => {
        const profile = profileMap.get(id) ?? { user_id: id, username: null, name: null, profile_image_url: null };
        const firstSeen = firstFollowingSeen.get(id);
        return {
          ...profile,
          first_following_seen_at: firstSeen?.seenAt ?? latestSnap.taken_at ?? null,
          first_following_approximate: firstSeen?.approximate ?? true,
          latest_following_order: index,
        };
      });

      return {
        dontFollowBack,
        notFollowingBack,
        notFollowingBackGroups: groupNotFollowingBack(notFollowingBack),
        hasFollowingData: true,
        latestSnapshotAt: latestSnap.taken_at,
      };
    },
    staleTime: 120_000,
  });
}

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

export function useMutualFollowData() {
  return useQuery({
    queryKey: ['mutual-follow-data'],
    queryFn: async () => {
      // Get the latest complete snapshot with follower_ids and following_ids
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: snap, error } = await (supabase.from('x_follower_snapshots') as any)
        .select('follower_ids, following_ids')
        .eq('status', 'complete')
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!snap) return { dontFollowBack: [], notFollowingBack: [], hasFollowingData: false };

      const followerIds: string[] = (snap.follower_ids ?? []) as string[];
      const followingIds: string[] = (snap.following_ids ?? []) as string[];

      // following_ids is only populated after a snapshot runs with the updated function
      if (followingIds.length === 0) {
        return { dontFollowBack: [], notFollowingBack: [], hasFollowingData: false };
      }

      const followerSet = new Set(followerIds);
      const followingSet = new Set(followingIds);

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
      const notFollowingBack: MutualFollowUser[] = notFollowingBackIds.map(id =>
        profileMap.get(id) ?? { user_id: id, username: null, name: null, profile_image_url: null }
      );

      return { dontFollowBack, notFollowingBack, hasFollowingData: true };
    },
    staleTime: 120_000,
  });
}

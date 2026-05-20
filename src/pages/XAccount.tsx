import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftRight, CalendarDays, ChevronDown, CheckCheck, ExternalLink, Loader2, RefreshCw, Search, TrendingUp, UserMinus, UserPlus, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useFollowerSnapshots, useUnfollowers, useNewFollowers,
  useFollowerStats, useMarkReviewed, useMarkAllReviewed, useMutualFollowData,
  type FollowerChange, type MutualFollowUser, type NotFollowingBackGroup, type NotFollowingBackUser,
} from "@/hooks/useFollowerData";

const FollowerGrowthChart = lazy(() => import("@/components/x/FollowerGrowthChart"));
const NON_FOLLOWBACK_REVIEWED_KEY = "xot:not-following-back-reviewed:v1";
const NON_FOLLOWBACK_OPEN_BATCH_SIZE = 30;

function openInBackground(url: string): boolean {
  const w = window.open(url, '_blank', 'noopener');
  if (!w) return false;
  w.blur();
  window.focus();
  return true;
}

function loadReviewedNonFollowbacks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NON_FOLLOWBACK_REVIEWED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveReviewedNonFollowbacks(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NON_FOLLOWBACK_REVIEWED_KEY, JSON.stringify([...ids]));
}

export default function XAccount() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [showAllUnfollowers, setShowAllUnfollowers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mutualSearch, setMutualSearch] = useState("");
  const [collapsedNonFollowbackDays, setCollapsedNonFollowbackDays] = useState<Set<string>>(() => new Set());
  const [reviewedNonFollowbacks, setReviewedNonFollowbacks] = useState<Set<string>>(() => loadReviewedNonFollowbacks());

  const { data: snapshots, isLoading: snapsLoading } = useFollowerSnapshots();
  const { data: unfollowers, isLoading: unfLoading } = useUnfollowers(showAllUnfollowers, searchQuery);
  const { data: newFollowers } = useNewFollowers();
  const { data: stats, isLoading: statsLoading } = useFollowerStats();
  const { data: mutualData, isLoading: mutualLoading } = useMutualFollowData();
  const markReviewed = useMarkReviewed();
  const markAllReviewed = useMarkAllReviewed();

  const runManual = async (force = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-actions", {
        body: { action: "run_followers_snapshot", include_following: true, force },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; skipped?: boolean; reason?: string; latest_age_minutes?: number; error?: string; follower_count?: number; api_calls_used?: number; estimated_api_calls?: number };
      if (!result?.ok) throw new Error(result?.error ?? "Snapshot failed");
      if (result.skipped) {
        toast({
          title: "Snapshot skipped",
          description: result.latest_age_minutes != null
            ? `Latest snapshot is ${result.latest_age_minutes} minutes old. Force refresh if you need a new X API pull.`
            : result.reason,
        });
        return;
      }
      toast({
        title: "Snapshot complete",
        description: `${result.follower_count ?? 0} followers · ${result.api_calls_used ?? 0} API calls used`,
      });
    } catch (e) {
      toast({ title: "Snapshot failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const handleOpenAllPending = () => {
    const pending = (unfollowers ?? []).filter(c => !c.reviewed && c.username);
    if (pending.length === 0) {
      toast({ title: "No pending unfollowers", description: "All caught up!" });
      return;
    }
    if (pending.length > 15) {
      toast({ title: "Opening first 15", description: `${pending.length} pending -- opening first 15 to avoid browser blocking.` });
    }
    const toOpen = pending.slice(0, 15);
    for (const c of toOpen) {
      openInBackground(`https://x.com/${c.username}`);
    }
  };

  const handleMarkAllReviewed = () => {
    markAllReviewed.mutate(undefined, {
      onSuccess: () => toast({ title: "Done", description: "All unfollowers marked as reviewed." }),
      onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const handleOpenAndMark = (change: FollowerChange) => {
    if (change.username) openInBackground(`https://x.com/${change.username}`);
    if (!change.reviewed) {
      markReviewed.mutate([change.id]);
    }
  };

  const toggleNonFollowbackDay = (dateKey: string) => {
    setCollapsedNonFollowbackDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const markNonFollowbacksReviewed = useCallback((userIds: string[]) => {
    if (userIds.length === 0) return;
    setReviewedNonFollowbacks((prev) => {
      const next = new Set(prev);
      for (const id of userIds) next.add(id);
      saveReviewedNonFollowbacks(next);
      return next;
    });
  }, []);

  const handleOpenSingleNonFollowback = (user: NotFollowingBackUser) => {
    if (!user.username) {
      toast({ title: "No username to open", description: "This account only has an X user ID in the cache." });
      return;
    }
    const opened = openInBackground(`https://x.com/${user.username}`);
    if (opened) {
      markNonFollowbacksReviewed([user.user_id]);
      return;
    }
    toast({
      title: "Chrome blocked the profile tab",
      description: "Allow pop-ups for xot.iraneyes.com, then click again.",
      variant: "destructive",
    });
  };

  const handleOpenProfilesForDay = (group: NotFollowingBackGroup) => {
    const unreviewedOpenable = group.users
      .filter((user) => user.username && !reviewedNonFollowbacks.has(user.user_id));
    const batch = unreviewedOpenable.slice(0, NON_FOLLOWBACK_OPEN_BATCH_SIZE);
    const skippedNoUsername = group.users.filter((user) => !user.username).length;

    if (batch.length === 0) {
      const reviewedOpenable = group.users.filter((user) => user.username && reviewedNonFollowbacks.has(user.user_id)).length;
      if (reviewedOpenable > 0) {
        toast({ title: "Day already reviewed", description: "All cached profiles for this day have already been opened from this browser." });
        return;
      }
      toast({ title: "No usernames to open", description: "This group only has X user IDs in the cache." });
      return;
    }

    const openedIds: string[] = [];
    for (const user of batch) {
      if (openInBackground(`https://x.com/${user.username}`)) {
        openedIds.push(user.user_id);
      }
    }
    markNonFollowbacksReviewed(openedIds);

    const blocked = batch.length - openedIds.length;
    const remainingAfterOpen = unreviewedOpenable.length - openedIds.length;

    toast({
      title: openedIds.length > 0
        ? `Opened ${openedIds.length} profile${openedIds.length === 1 ? "" : "s"}`
        : "Chrome blocked the profile tabs",
      description: blocked > 0
        ? `Chrome blocked ${blocked} tab${blocked === 1 ? "" : "s"}. Allow pop-ups for xot.iraneyes.com and click again.`
        : `${remainingAfterOpen} unreviewed profile${remainingAfterOpen === 1 ? "" : "s"} remain for this day.${skippedNoUsername > 0 ? ` ${skippedNoUsername} account${skippedNoUsername === 1 ? "" : "s"} have no cached username.` : ""}`,
      variant: openedIds.length === 0 ? "destructive" : undefined,
    });
  };

  const latestSnapshot = snapshots?.[snapshots.length - 1] ?? null;
  const latestSnapshotAgeMs = latestSnapshot ? Date.now() - new Date(latestSnapshot.taken_at).getTime() : null;
  const latestSnapshotAgeMinutes = latestSnapshotAgeMs === null ? null : Math.max(0, Math.round(latestSnapshotAgeMs / 60000));
  const snapshotLooksFresh = latestSnapshotAgeMinutes !== null && latestSnapshotAgeMinutes < 60;
  const estimatedFollowerPages = stats ? Math.max(1, Math.ceil(stats.currentCount / 1000)) : 1;
  const estimatedFollowingPages = latestSnapshot?.following_count ? Math.max(1, Math.ceil(latestSnapshot.following_count / 1000)) : 1;
  const estimatedCalls = estimatedFollowerPages + estimatedFollowingPages;

  const chartData = (snapshots ?? []).map(s => ({
    date: new Date(s.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    followers: s.follower_count,
  }));

  const matchesMutualSearch = useCallback((user: MutualFollowUser) => {
    const term = mutualSearch.trim().toLowerCase();
    if (!term) return true;
    return Boolean(
      user.username?.toLowerCase().includes(term)
      || user.name?.toLowerCase().includes(term)
    );
  }, [mutualSearch]);

  const filteredDontFollowBack = (mutualData?.dontFollowBack ?? []).filter(matchesMutualSearch);
  const filteredNotFollowingBackGroups = useMemo(() => {
    return (mutualData?.notFollowingBackGroups ?? [])
      .map((group) => ({
        ...group,
        users: group.users.filter(matchesMutualSearch),
      }))
      .filter((group) => group.users.length > 0);
  }, [matchesMutualSearch, mutualData?.notFollowingBackGroups]);
  const filteredNotFollowingBack = filteredNotFollowingBackGroups.flatMap((group) => group.users);

  const loading = snapsLoading || statsLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-0">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-glass-foreground">My X Account</h1>
          <p className="text-muted-foreground text-sm">Follower growth, unfollower review, mutual follows</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={running} variant="outline">
              {running ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Run snapshot
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run a manual snapshot?</AlertDialogTitle>
              <AlertDialogDescription>
                Estimated X API calls: <strong>{estimatedCalls}</strong> for followers + following lists.
                {latestSnapshotAgeMinutes !== null && (
                  <span className="block mt-2">
                    Latest snapshot: {latestSnapshotAgeMinutes} minute{latestSnapshotAgeMinutes === 1 ? "" : "s"} ago{snapshotLooksFresh ? " (fresh)" : ""}.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="outline" onClick={() => runManual(true)} disabled={running}>Force refresh</Button>
              <AlertDialogAction onClick={() => runManual(false)}>Run if stale</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> Followers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.currentCount.toLocaleString()}</div>
              {stats.delta !== null && (
                <p className={`text-xs mt-0.5 ${stats.delta > 0 ? "text-green-500" : stats.delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                  {stats.delta > 0 ? "+" : ""}{stats.delta} last snapshot
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <UserMinus className="w-3.5 h-3.5" /> Pending Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pendingUnfollowers}</div>
              <p className="text-xs mt-0.5 text-muted-foreground">unreviewed unfollowers</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Growth (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">+{stats.newFollowers7d}</div>
              <p className="text-xs mt-0.5 text-muted-foreground">{stats.growthVelocity}/day avg</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <UserMinus className="w-3.5 h-3.5" /> Churn (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUnfollowers}</div>
              <p className="text-xs mt-0.5 text-muted-foreground">{stats.churnRate}% of total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <UserPlus className="w-3.5 h-3.5" /> Net (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(stats.newFollowers7d - stats.totalUnfollowers) >= 0 ? "text-green-500" : "text-red-500"}`}>
                {(stats.newFollowers7d - stats.totalUnfollowers) >= 0 ? "+" : ""}{stats.newFollowers7d - stats.totalUnfollowers}
              </div>
              <p className="text-xs mt-0.5 text-muted-foreground">net growth</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Growth Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Follower Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <Suspense fallback={<div className="h-full animate-pulse rounded bg-muted/50" />}>
                <FollowerGrowthChart data={chartData} />
              </Suspense>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue="unfollowers" className="space-y-4">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto p-1">
          <TabsTrigger value="unfollowers" className="shrink-0 whitespace-nowrap gap-1.5">
            <UserMinus className="w-4 h-4" /> Unfollowers
          </TabsTrigger>
          <TabsTrigger value="mutual" className="shrink-0 whitespace-nowrap gap-1.5">
            <ArrowLeftRight className="w-4 h-4" /> Mutual Follow
          </TabsTrigger>
          <TabsTrigger value="new-followers" className="shrink-0 whitespace-nowrap gap-1.5">
            <UserPlus className="w-4 h-4" /> New Followers
          </TabsTrigger>
          <TabsTrigger value="history" className="shrink-0 whitespace-nowrap gap-1.5">
            <RefreshCw className="w-4 h-4" /> Snapshots
          </TabsTrigger>
        </TabsList>

        {/* Unfollowers Tab */}
        <TabsContent value="unfollowers">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <CardTitle className="flex items-center gap-2">
                  <UserMinus className="w-5 h-5 text-red-500" /> Unfollower Review
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch id="show-all" checked={showAllUnfollowers} onCheckedChange={setShowAllUnfollowers} />
                    <Label htmlFor="show-all" className="text-xs">Show all</Label>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleOpenAllPending} disabled={!unfollowers?.some(c => !c.reviewed)}>
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Open All Pending
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleMarkAllReviewed} disabled={markAllReviewed.isPending || !unfollowers?.some(c => !c.reviewed)}>
                    <CheckCheck className="w-3.5 h-3.5 mr-1.5" />Mark All Reviewed
                  </Button>
                </div>
              </div>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by username or name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-9" />
              </div>
            </CardHeader>
            <CardContent>
              {unfLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : !unfollowers || unfollowers.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-6">
                  {showAllUnfollowers ? "No unfollowers recorded yet." : "No pending unfollowers. You're all caught up!"}
                </p>
              ) : (
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {unfollowers.map((c) => (
                    <UnfollowerRow key={c.id} change={c} onOpenAndMark={handleOpenAndMark} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mutual Follow Tab */}
        <TabsContent value="mutual">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-blue-500" /> Mutual Follow Analysis
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Based on your latest snapshot. Run a new snapshot to refresh this data.
              </p>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by username or name..." value={mutualSearch} onChange={(e) => setMutualSearch(e.target.value)} className="pl-9 h-9" />
              </div>
            </CardHeader>
            <CardContent>
              {mutualLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : !mutualData || !mutualData.hasFollowingData ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-muted-foreground text-sm">No mutual follow data available yet.</p>
                  <p className="text-xs text-muted-foreground">Run a snapshot (button above) to capture your "following" list. The next snapshot will fetch both who follows you AND who you follow, then this tab will compute the differences.</p>
                </div>
              ) : (
                <Tabs defaultValue="dont-follow-back" className="space-y-3">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="dont-follow-back" className="text-xs">
                      I don't follow back ({filteredDontFollowBack.length})
                    </TabsTrigger>
                    <TabsTrigger value="not-following-me" className="text-xs">
                      They don't follow me ({filteredNotFollowingBack.length})
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="dont-follow-back">
                    <p className="text-xs text-muted-foreground mb-3">These people follow you, but you don't follow them back.</p>
                    {filteredDontFollowBack.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-4">None found.</p>
                    ) : (
                      <div className="space-y-1 max-h-[500px] overflow-y-auto">
                        {filteredDontFollowBack.map(u => (
                          <MutualFollowRow key={u.user_id} user={u} />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="not-following-me">
                    <div className="mb-3 space-y-1">
                      <p className="text-xs text-muted-foreground">You follow these people, but they don't follow you back.</p>
                      <p className="text-xs text-muted-foreground">
                        Grouped by the first snapshot day where they appeared in your following list. "On or before" means they were already present in the first captured following snapshot.
                      </p>
                      {mutualData?.latestSnapshotAt && (
                        <p className="text-xs text-muted-foreground">
                          Latest snapshot: {formatDistanceToNow(new Date(mutualData.latestSnapshotAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                    {filteredNotFollowingBack.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-4">None found.</p>
                    ) : (
                      <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                        {filteredNotFollowingBackGroups.map((group) => (
                          <NotFollowingBackDayGroup
                            key={group.date_key}
                            group={group}
                            collapsed={collapsedNonFollowbackDays.has(group.date_key)}
                            onToggle={() => toggleNonFollowbackDay(group.date_key)}
                            onOpenAll={() => handleOpenProfilesForDay(group)}
                            onOpenProfile={handleOpenSingleNonFollowback}
                            reviewedUserIds={reviewedNonFollowbacks}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* New Followers Tab */}
        <TabsContent value="new-followers">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-green-500" /> Recent New Followers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!newFollowers || newFollowers.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-6">No new followers detected yet.</p>
              ) : (
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {newFollowers.map((c) => (
                    <ProfileRow key={c.id} userId={c.user_id} username={c.username} name={c.name} profileImageUrl={c.profile_image_url} subtitle={formatDistanceToNow(new Date(c.detected_at), { addSuffix: true })} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Snapshot History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Snapshot History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0.5">
                {(snapshots ?? []).slice().reverse().map((s, i, arr) => {
                  const prev = arr[i + 1];
                  const d = prev ? s.follower_count - prev.follower_count : null;
                  return (
                    <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.status === 'complete' ? 'bg-green-500' : 'bg-amber-500'}`} />
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {new Date(s.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5">{s.trigger}</Badge>
                      </div>
                      <div className="flex items-center gap-4 tabular-nums text-xs">
                        <span className="font-medium">{s.follower_count.toLocaleString()}</span>
                        {d !== null && (
                          <span className={`min-w-[3ch] text-right ${d > 0 ? "text-green-500" : d < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                            {d > 0 ? "+" : ""}{d}
                          </span>
                        )}
                        <span className="text-muted-foreground w-16 text-right">{s.api_calls_used} call{s.api_calls_used === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UnfollowerRow({ change, onOpenAndMark }: { change: FollowerChange; onOpenAndMark: (c: FollowerChange) => void }) {
  const followDuration = change.first_seen_at
    ? formatDistanceToNow(new Date(change.first_seen_at))
    : null;

  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/30 ${change.reviewed ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        {change.profile_image_url ? (
          <img src={change.profile_image_url} alt="" className="w-9 h-9 rounded-full" loading="lazy" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{change.name ?? change.username ?? change.user_id}</div>
          <div className="text-xs text-muted-foreground truncate">
            {change.username ? `@${change.username}` : `id:${change.user_id}`}
            {" · "}
            {formatDistanceToNow(new Date(change.detected_at), { addSuffix: true })}
            {followDuration && <span className="opacity-70"> · followed {followDuration}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {change.reviewed && <Badge variant="secondary" className="text-[10px] px-1.5">reviewed</Badge>}
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => onOpenAndMark(change)}>
          <ExternalLink className="w-3.5 h-3.5 mr-1" />
          {change.reviewed ? "Open" : "Open & Review"}
        </Button>
      </div>
    </div>
  );
}

function MutualFollowRow({ user, subtitle }: { user: MutualFollowUser; subtitle?: string }) {
  return (
    <ProfileRow userId={user.user_id} username={user.username} name={user.name} profileImageUrl={user.profile_image_url} subtitle={subtitle} />
  );
}

function NotFollowingBackRow({
  user,
  subtitle,
  reviewed,
  onOpen,
}: {
  user: NotFollowingBackUser;
  subtitle?: string;
  reviewed: boolean;
  onOpen: () => void;
}) {
  return (
    <ProfileRow
      userId={user.user_id}
      username={user.username}
      name={user.name}
      profileImageUrl={user.profile_image_url}
      subtitle={subtitle}
      reviewed={reviewed}
      onOpen={onOpen}
    />
  );
}

function NotFollowingBackDayGroup({
  group,
  collapsed,
  onToggle,
  onOpenAll,
  onOpenProfile,
  reviewedUserIds,
}: {
  group: NotFollowingBackGroup;
  collapsed: boolean;
  onToggle: () => void;
  onOpenAll: () => void;
  onOpenProfile: (user: NotFollowingBackUser) => void;
  reviewedUserIds: Set<string>;
}) {
  const openableCount = group.users.filter((user) => user.username).length;
  const unreviewedOpenableCount = group.users.filter((user) => user.username && !reviewedUserIds.has(user.user_id)).length;
  const reviewedCount = group.users.filter((user) => reviewedUserIds.has(user.user_id)).length;
  const nextBatchCount = Math.min(NON_FOLLOWBACK_OPEN_BATCH_SIZE, unreviewedOpenableCount);
  const newestUser = group.users[0];
  const startedLabel = group.started_at
    ? formatDistanceToNow(new Date(group.started_at), { addSuffix: true })
    : "unknown";
  const openButtonLabel = openableCount === 0
    ? "No usernames"
    : nextBatchCount > 0
      ? `Open next ${nextBatchCount}`
      : "All reviewed";

  return (
    <div className="rounded-lg border border-border/70 bg-card/40">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{group.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5">{group.users.length}</Badge>
              {reviewedCount > 0 && <Badge variant="outline" className="text-[10px] px-1.5">{reviewedCount} reviewed</Badge>}
              {group.approximate && <Badge variant="outline" className="text-[10px] px-1.5">approx</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Still not following you back as of the latest snapshot
              {group.started_at ? ` · first seen ${startedLabel}` : ""}
              {newestUser?.username ? ` · includes @${newestUser.username}` : ""}
              {openableCount > 0 ? ` · ${unreviewedOpenableCount} left to open` : ""}.
            </p>
          </div>
        </button>
        <Button size="sm" variant="outline" onClick={onOpenAll} disabled={unreviewedOpenableCount === 0} className="shrink-0">
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          {openButtonLabel}
        </Button>
      </div>
      {!collapsed && (
        <div className="border-t border-border/60 px-2 py-2">
          {group.users.map((user) => (
            <NotFollowingBackRow
              key={user.user_id}
              user={user}
              reviewed={reviewedUserIds.has(user.user_id)}
              onOpen={() => onOpenProfile(user)}
              subtitle={user.first_following_approximate ? "Already in first captured following snapshot" : "First seen in following snapshot"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileRow({
  userId,
  username,
  name,
  profileImageUrl,
  subtitle,
  reviewed = false,
  onOpen,
}: {
  userId: string;
  username: string | null;
  name: string | null;
  profileImageUrl: string | null;
  subtitle?: string;
  reviewed?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/30 ${reviewed ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        {profileImageUrl ? (
          <img src={profileImageUrl} alt="" className="w-9 h-9 rounded-full" loading="lazy" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{name ?? username ?? userId}</div>
          <div className="text-xs text-muted-foreground truncate">
            {username ? `@${username}` : `id:${userId}`}
            {subtitle && <span> · {subtitle}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {reviewed && <Badge variant="secondary" className="text-[10px] px-1.5">reviewed</Badge>}
        {username && (
          <button
            onClick={() => (onOpen ? onOpen() : openInBackground(`https://x.com/${username}`))}
            className="text-muted-foreground hover:text-primary shrink-0 p-2"
            aria-label={`Open @${username} on X`}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

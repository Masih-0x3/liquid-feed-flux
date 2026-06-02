import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight, CalendarDays, CheckCheck, ChevronDown, ExternalLink, Loader2,
  RefreshCw, Search, UserCheck, UserMinus, UserPlus, Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useFollowerSnapshots, useUnfollowers, useNewFollowers,
  useFollowerStats, useMarkReviewed, useMarkAllReviewed, useMutualFollowData,
  useNonFollowbackReviews, useUpsertNonFollowbackReviews,
  type FollowerChange, type MutualFollowUser, type NonFollowbackReviewStatus,
  type NotFollowingBackGroup, type NotFollowingBackUser,
} from "@/hooks/useFollowerData";

const FollowerGrowthChart = lazy(() => import("@/components/x/FollowerGrowthChart"));

const NON_FOLLOWBACK_REVIEWED_KEY = "xot:not-following-back-reviewed:v1";
const NON_FOLLOWBACK_OPEN_BATCH_SIZE = 30;

type MainTab = "unfollowers" | "mutual" | "new-followers" | "history";
type MutualTab = "dont-follow-back" | "not-following-me";
type ReviewFilter = "pending" | "opened" | "kept" | "unfollowed_manually" | "whitelisted" | "skipped" | "all";

type PreparedBatch = {
  dateKey: string;
  label: string;
  users: NotFollowingBackUser[];
};

type DayCounts = Record<Exclude<ReviewFilter, "all"> | "total", number>;

const MAIN_TABS = new Set<MainTab>(["unfollowers", "mutual", "new-followers", "history"]);
const MUTUAL_TABS = new Set<MutualTab>(["dont-follow-back", "not-following-me"]);

const REVIEW_FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "opened", label: "Opened" },
  { value: "kept", label: "Kept" },
  { value: "unfollowed_manually", label: "Unfollowed" },
  { value: "whitelisted", label: "Whitelisted" },
  { value: "skipped", label: "Skipped" },
  { value: "all", label: "All" },
];

const REVIEW_LABELS: Record<NonFollowbackReviewStatus, string> = {
  opened: "Opened",
  kept: "Kept",
  unfollowed_manually: "Unfollowed manually",
  skipped: "Skipped",
  whitelisted: "Whitelisted",
};

function isMainTab(value: string | null): value is MainTab {
  return Boolean(value && MAIN_TABS.has(value as MainTab));
}

function isMutualTab(value: string | null): value is MutualTab {
  return Boolean(value && MUTUAL_TABS.has(value as MutualTab));
}

function xProfileUrl(username: string) {
  return `https://x.com/${encodeURIComponent(username)}`;
}

function openProfileTab(username: string): boolean {
  const w = window.open(xProfileUrl(username), "_blank");
  if (!w) return false;
  try {
    w.opener = null;
  } catch {
    // Some browsers block opener access for cross-origin tabs.
  }
  return true;
}

function getBrowserLabel() {
  if (typeof navigator === "undefined") return "your browser";
  const ua = navigator.userAgent;
  if (/Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Opera)/i.test(ua)) return "Safari";
  if (/(Chrome|Chromium|CriOS)/i.test(ua) && !/Edg/i.test(ua)) return "Chrome";
  if (/Edg/i.test(ua)) return "Edge";
  if (/(Firefox|FxiOS)/i.test(ua)) return "Firefox";
  return "your browser";
}

function popupHelpText(browserLabel: string) {
  if (browserLabel === "Safari") {
    return "In Safari, open Safari > Settings > Websites > Pop-up Windows, then choose Allow for xot.iraneyes.com.";
  }
  return `Allow pop-ups for xot.iraneyes.com in ${browserLabel}, then try again.`;
}

function testPopupWindow() {
  const w = window.open("", "_blank");
  if (!w) return false;
  try {
    w.document.write("<!doctype html><title>XOT pop-up test</title><body style=\"font-family:system-ui;padding:24px;background:#09090b;color:#fafafa\"><h1>Pop-ups are allowed for XOT.</h1><p>You can close this tab.</p></body>");
    w.document.close();
  } catch {
    // Cross-browser popup checks only need the WindowProxy result.
  }
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

function hasReview(user: NotFollowingBackUser, fallbackReviewed: Set<string>) {
  return Boolean(user.review?.status || fallbackReviewed.has(user.user_id));
}

function effectiveStatus(user: NotFollowingBackUser, fallbackReviewed: Set<string>): NonFollowbackReviewStatus | null {
  return user.review?.status ?? (fallbackReviewed.has(user.user_id) ? "opened" : null);
}

function reviewOpenedCount(user: NotFollowingBackUser, fallbackReviewed: Set<string>) {
  return user.review?.opened_count ?? (fallbackReviewed.has(user.user_id) ? 1 : 0);
}

function countUsers(users: NotFollowingBackUser[], fallbackReviewed: Set<string>): DayCounts {
  const counts: DayCounts = {
    total: users.length,
    pending: 0,
    opened: 0,
    kept: 0,
    unfollowed_manually: 0,
    whitelisted: 0,
    skipped: 0,
  };

  for (const user of users) {
    const status = effectiveStatus(user, fallbackReviewed);
    if (!status) counts.pending += 1;
    else counts[status] += 1;
  }

  return counts;
}

function isToday(iso: string | null | undefined) {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export default function XAccount() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [running, setRunning] = useState(false);
  const [showAllUnfollowers, setShowAllUnfollowers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mutualSearch, setMutualSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("pending");
  const [collapsedNonFollowbackDays, setCollapsedNonFollowbackDays] = useState<Set<string>>(() => new Set());
  const [fallbackReviewedIds, setFallbackReviewedIds] = useState<Set<string>>(() => loadReviewedNonFollowbacks());
  const [preparedBatch, setPreparedBatch] = useState<PreparedBatch | null>(null);

  const mainTab: MainTab = isMainTab(searchParams.get("tab")) ? searchParams.get("tab") as MainTab : "unfollowers";
  const mutualTab: MutualTab = mainTab === "mutual"
    ? (isMutualTab(searchParams.get("mutual")) ? searchParams.get("mutual") as MutualTab : "not-following-me")
    : "dont-follow-back";
  const browserLabel = getBrowserLabel();

  const { data: snapshots, isLoading: snapsLoading } = useFollowerSnapshots();
  const { data: unfollowers, isLoading: unfLoading } = useUnfollowers(showAllUnfollowers, searchQuery);
  const { data: newFollowers } = useNewFollowers();
  const { data: stats, isLoading: statsLoading } = useFollowerStats();
  const { data: mutualData, isLoading: mutualLoading } = useMutualFollowData();
  const nonFollowbackIds = useMemo(() => (mutualData?.notFollowingBack ?? []).map((user) => user.user_id), [mutualData?.notFollowingBack]);
  const { data: reviewRows } = useNonFollowbackReviews(nonFollowbackIds);
  const markReviewed = useMarkReviewed();
  const markAllReviewed = useMarkAllReviewed();
  const upsertNonFollowbackReviews = useUpsertNonFollowbackReviews();

  const reviewMap = useMemo(() => new Map((reviewRows ?? []).map((review) => [review.user_id, review])), [reviewRows]);

  const setMainTab = useCallback((value: string) => {
    if (!MAIN_TABS.has(value as MainTab)) return;
    const tab = value as MainTab;
    const next = new URLSearchParams(searchParams);
    if (tab === "unfollowers") {
      next.delete("tab");
      next.delete("mutual");
    } else {
      next.set("tab", tab);
      if (tab !== "mutual") next.delete("mutual");
      if (tab === "mutual" && !isMutualTab(next.get("mutual"))) next.set("mutual", "not-following-me");
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setMutualTab = useCallback((value: string) => {
    if (!MUTUAL_TABS.has(value as MutualTab)) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", "mutual");
    next.set("mutual", value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const rememberFallbackReviewed = useCallback((userIds: string[]) => {
    if (userIds.length === 0) return;
    setFallbackReviewedIds((prev) => {
      const next = new Set(prev);
      for (const id of userIds) next.add(id);
      saveReviewedNonFollowbacks(next);
      return next;
    });
  }, []);

  const persistNonFollowbackStatus = useCallback(async (
    users: NotFollowingBackUser[],
    status: NonFollowbackReviewStatus,
  ) => {
    if (users.length === 0) return;
    const now = new Date().toISOString();
    rememberFallbackReviewed(users.map((user) => user.user_id));
    try {
      await upsertNonFollowbackReviews.mutateAsync(users.map((user) => ({
        user,
        status,
        opened_count: status === "opened"
          ? reviewOpenedCount(user, fallbackReviewedIds) + 1
          : reviewOpenedCount(user, fallbackReviewedIds),
        first_opened_at: user.review?.first_opened_at ?? (fallbackReviewedIds.has(user.user_id) || status === "opened" ? now : null),
        last_opened_at: status === "opened" ? now : user.review?.last_opened_at ?? null,
      })));
    } catch (e) {
      toast({
        title: "Review state saved only in this browser",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [fallbackReviewedIds, rememberFallbackReviewed, toast, upsertNonFollowbackReviews]);

  const runManual = async (force = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-actions", {
        body: { action: "run_followers_snapshot", include_following: true, force },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; skipped?: boolean; reason?: string; latest_age_minutes?: number; error?: string; follower_count?: number; api_calls_used?: number };
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
        description: `${result.follower_count ?? 0} followers - ${result.api_calls_used ?? 0} API calls used`,
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
      toast({ title: "Opening first 15", description: `${pending.length} pending - opening first 15 to avoid browser blocking.` });
    }
    for (const c of pending.slice(0, 15)) {
      if (c.username) openProfileTab(c.username);
    }
  };

  const handleMarkAllReviewed = () => {
    markAllReviewed.mutate(undefined, {
      onSuccess: () => toast({ title: "Done", description: "All unfollowers marked as reviewed." }),
      onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const handleOpenAndMark = (change: FollowerChange) => {
    if (change.username) openProfileTab(change.username);
    if (!change.reviewed) markReviewed.mutate([change.id]);
  };

  const handleOpenNonFollowback = async (user: NotFollowingBackUser) => {
    if (!user.username) {
      toast({ title: "No username to open", description: "This account only has an X user ID in the cache." });
      return false;
    }
    const opened = openProfileTab(user.username);
    if (opened) {
      await persistNonFollowbackStatus([user], "opened");
      return true;
    }
    toast({
      title: "Browser blocked the profile tab",
      description: `${popupHelpText(browserLabel)} You can also use the visible profile link.`,
      variant: "destructive",
    });
    return false;
  };

  const handleProfileLinkClick = (user: NotFollowingBackUser) => {
    void persistNonFollowbackStatus([user], "opened");
  };

  const toggleNonFollowbackDay = (dateKey: string) => {
    setCollapsedNonFollowbackDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const prepareProfilesForDay = (group: NotFollowingBackGroup) => {
    const users = group.users
      .filter((user) => user.username && !hasReview(user, fallbackReviewedIds))
      .slice(0, NON_FOLLOWBACK_OPEN_BATCH_SIZE);

    if (users.length === 0) {
      toast({
        title: "No pending profiles for this day",
        description: "All cached profiles with usernames are already opened or reviewed.",
      });
      return;
    }

    setCollapsedNonFollowbackDays((prev) => {
      if (!prev.has(group.date_key)) return prev;
      const next = new Set(prev);
      next.delete(group.date_key);
      return next;
    });
    setPreparedBatch({ dateKey: group.date_key, label: group.label, users });
  };

  const openPreparedBatch = async () => {
    if (!preparedBatch) return;
    const openedUsers: NotFollowingBackUser[] = [];

    for (const user of preparedBatch.users) {
      if (user.username && !hasReview(user, fallbackReviewedIds) && openProfileTab(user.username)) {
        openedUsers.push(user);
      }
    }

    if (openedUsers.length > 0) await persistNonFollowbackStatus(openedUsers, "opened");

    const blocked = preparedBatch.users.length - openedUsers.length;
    toast({
      title: openedUsers.length > 0
        ? `Opened ${openedUsers.length} profile${openedUsers.length === 1 ? "" : "s"}`
        : "Browser blocked the batch",
      description: blocked > 0
        ? `${blocked} profile${blocked === 1 ? "" : "s"} did not open. ${popupHelpText(browserLabel)} Or click the visible links one by one.`
        : "Batch opened and marked as opened.",
      variant: openedUsers.length === 0 ? "destructive" : undefined,
    });

    if (blocked === 0) setPreparedBatch(null);
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

  const nonFollowbackGroups = useMemo(() => {
    return (mutualData?.notFollowingBackGroups ?? []).map((group) => ({
      ...group,
      users: group.users.map((user) => ({
        ...user,
        review: reviewMap.get(user.user_id) ?? null,
      })),
    }));
  }, [mutualData?.notFollowingBackGroups, reviewMap]);

  const nonFollowbackSummary = useMemo(() => {
    const users = nonFollowbackGroups.flatMap((group) => group.users);
    const counts = countUsers(users, fallbackReviewedIds);
    const openedToday = users.filter((user) => {
      if (fallbackReviewedIds.has(user.user_id)) return false;
      return isToday(user.review?.last_opened_at);
    }).length;
    return { ...counts, openedToday };
  }, [fallbackReviewedIds, nonFollowbackGroups]);

  const filteredDontFollowBack = (mutualData?.dontFollowBack ?? []).filter(matchesMutualSearch);
  const filteredNotFollowingBackGroups = useMemo(() => {
    return nonFollowbackGroups
      .map((group) => {
        const counts = countUsers(group.users, fallbackReviewedIds);
        const users = group.users
          .filter(matchesMutualSearch)
          .filter((user) => {
            const status = effectiveStatus(user, fallbackReviewedIds);
            if (reviewFilter === "all") return true;
            if (reviewFilter === "pending") return !status;
            return status === reviewFilter;
          });
        return { ...group, counts, users };
      })
      .filter((group) => group.users.length > 0);
  }, [fallbackReviewedIds, matchesMutualSearch, nonFollowbackGroups, reviewFilter]);
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryTile label="Followers" value={(stats?.currentCount ?? 0).toLocaleString()} helper={stats?.delta != null ? `${stats.delta > 0 ? "+" : ""}${stats.delta} last snapshot` : "latest snapshot"} />
        <SummaryTile label="Following" value={(latestSnapshot?.following_count ?? 0).toLocaleString()} helper="stored snapshot" />
        <SummaryTile label="Latest snapshot" value={latestSnapshotAgeMinutes != null ? `${latestSnapshotAgeMinutes}m` : "-"} helper={latestSnapshot ? "ago" : "not captured"} />
        <SummaryTile label="They don't follow me" value={nonFollowbackSummary.pending.toLocaleString()} helper="pending review" tone={nonFollowbackSummary.pending > 0 ? "warn" : "normal"} />
        <SummaryTile label="Opened today" value={nonFollowbackSummary.openedToday.toLocaleString()} helper="non-followbacks" />
        <SummaryTile label="Unfollowers" value={(stats?.pendingUnfollowers ?? 0).toLocaleString()} helper="pending review" />
      </div>

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

      <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4">
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

        <TabsContent value="mutual">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-blue-500" /> Mutual Follow
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Stored snapshot data only. Review actions open X profiles and never call the X API.
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
                  <p className="text-xs text-muted-foreground">Run a snapshot to capture your following list. The page will then compute the differences locally from stored data.</p>
                </div>
              ) : (
                <Tabs value={mutualTab} onValueChange={setMutualTab} className="space-y-3">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="dont-follow-back" className="text-xs">
                      I don't follow back ({filteredDontFollowBack.length})
                    </TabsTrigger>
                    <TabsTrigger value="not-following-me" className="text-xs">
                      They don't follow me ({nonFollowbackSummary.pending}/{nonFollowbackSummary.total})
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
                    <div className="mb-3 space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">You follow these people, but they don't follow you back.</p>
                        <p className="text-xs text-muted-foreground">
                          Grouped by the first snapshot day where they appeared in your following list. "On or before" means they were already present in the first captured following snapshot.
                        </p>
                        {mutualData.latestSnapshotAt && (
                          <p className="text-xs text-muted-foreground">
                            Latest snapshot: {formatDistanceToNow(new Date(mutualData.latestSnapshotAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {REVIEW_FILTERS.map((filter) => (
                          <Button
                            key={filter.value}
                            size="sm"
                            variant={reviewFilter === filter.value ? "default" : "outline"}
                            onClick={() => setReviewFilter(filter.value)}
                            className="h-8 text-xs"
                          >
                            {filter.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {filteredNotFollowingBack.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-4">None found for this filter.</p>
                    ) : (
                      <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                        {filteredNotFollowingBackGroups.map((group) => (
                          <NotFollowingBackDayGroup
                            key={group.date_key}
                            group={group}
                            counts={group.counts}
                            collapsed={collapsedNonFollowbackDays.has(group.date_key)}
                            fallbackReviewedIds={fallbackReviewedIds}
                            onToggle={() => toggleNonFollowbackDay(group.date_key)}
                            onPrepareBatch={() => prepareProfilesForDay(group)}
                            onOpenProfile={handleOpenNonFollowback}
                            onSetStatus={(user, status) => persistNonFollowbackStatus([user], status)}
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
                        <span className={`w-2 h-2 rounded-full ${s.status === "complete" ? "bg-green-500" : "bg-amber-500"}`} />
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

      <BatchReviewDialog
        batch={preparedBatch}
        fallbackReviewedIds={fallbackReviewedIds}
        onOpenChange={(open) => {
          if (!open) setPreparedBatch(null);
        }}
        onOpenBatch={openPreparedBatch}
        onOpenProfile={handleOpenNonFollowback}
        onProfileLinkClick={handleProfileLinkClick}
        onTestPopups={() => {
          const allowed = testPopupWindow();
          toast({
            title: allowed ? "Pop-up test opened" : "Pop-up test blocked",
            description: allowed ? "The browser opened a test tab. Batch opening has permission, subject to browser tab limits." : popupHelpText(browserLabel),
            variant: allowed ? undefined : "destructive",
          });
        }}
        browserLabel={browserLabel}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  helper,
  tone = "normal",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "normal" | "warn";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${tone === "warn" ? "text-amber-500" : ""}`}>{value}</div>
        <p className="text-xs mt-0.5 text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}

function UnfollowerRow({ change, onOpenAndMark }: { change: FollowerChange; onOpenAndMark: (c: FollowerChange) => void }) {
  const followDuration = change.first_seen_at
    ? formatDistanceToNow(new Date(change.first_seen_at))
    : null;

  return (
    <div className={`flex items-center justify-between gap-3 py-2 px-3 rounded-md hover:bg-muted/30 ${change.reviewed ? "opacity-50" : ""}`}>
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
            {" - "}
            {formatDistanceToNow(new Date(change.detected_at), { addSuffix: true })}
            {followDuration && <span className="opacity-70"> - followed {followDuration}</span>}
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

function NotFollowingBackDayGroup({
  group,
  counts,
  collapsed,
  fallbackReviewedIds,
  onToggle,
  onPrepareBatch,
  onOpenProfile,
  onSetStatus,
}: {
  group: NotFollowingBackGroup & { counts: DayCounts };
  counts: DayCounts;
  collapsed: boolean;
  fallbackReviewedIds: Set<string>;
  onToggle: () => void;
  onPrepareBatch: () => void;
  onOpenProfile: (user: NotFollowingBackUser) => Promise<boolean>;
  onSetStatus: (user: NotFollowingBackUser, status: NonFollowbackReviewStatus) => void;
}) {
  const pendingOpenableCount = group.users.filter((user) => user.username && !hasReview(user, fallbackReviewedIds)).length;
  const nextBatchCount = Math.min(NON_FOLLOWBACK_OPEN_BATCH_SIZE, pendingOpenableCount);
  const newestUser = group.users[0];
  const startedLabel = group.started_at
    ? formatDistanceToNow(new Date(group.started_at), { addSuffix: true })
    : "unknown";
  const openButtonLabel = pendingOpenableCount === 0
    ? "No usernames"
    : nextBatchCount > 0
      ? `Prepare next ${nextBatchCount}`
      : "All reviewed";

  return (
    <div className="rounded-lg border border-border/70 bg-card/40">
      <div className="flex flex-col gap-3 p-3 xl:flex-row xl:items-start xl:justify-between">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{group.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5">{counts.total} total</Badge>
              {counts.pending > 0 && <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500/50 text-amber-500">{counts.pending} pending</Badge>}
              {counts.opened > 0 && <Badge variant="outline" className="text-[10px] px-1.5">{counts.opened} opened</Badge>}
              {counts.kept > 0 && <Badge variant="outline" className="text-[10px] px-1.5">{counts.kept} kept</Badge>}
              {counts.unfollowed_manually > 0 && <Badge variant="outline" className="text-[10px] px-1.5">{counts.unfollowed_manually} unfollowed</Badge>}
              {counts.whitelisted > 0 && <Badge variant="outline" className="text-[10px] px-1.5">{counts.whitelisted} whitelisted</Badge>}
              {group.approximate && <Badge variant="outline" className="text-[10px] px-1.5">approx</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Still not following you back as of the latest snapshot
              {group.started_at ? ` - first seen ${startedLabel}` : ""}
              {newestUser?.username ? ` - includes @${newestUser.username}` : ""}.
            </p>
          </div>
        </button>
        <Button size="sm" variant="outline" onClick={onPrepareBatch} disabled={nextBatchCount === 0} className="shrink-0">
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
              fallbackReviewed={fallbackReviewedIds.has(user.user_id)}
              onOpen={() => onOpenProfile(user)}
              onSetStatus={(status) => onSetStatus(user, status)}
              subtitle={user.first_following_approximate ? "Already in first captured following snapshot" : "First seen in following snapshot"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotFollowingBackRow({
  user,
  subtitle,
  fallbackReviewed,
  onOpen,
  onSetStatus,
}: {
  user: NotFollowingBackUser;
  subtitle?: string;
  fallbackReviewed: boolean;
  onOpen: () => void;
  onSetStatus: (status: NonFollowbackReviewStatus) => void;
}) {
  const status = user.review?.status ?? (fallbackReviewed ? "opened" : null);
  const openedCount = user.review?.opened_count ?? (fallbackReviewed ? 1 : 0);

  return (
    <div className={`flex flex-col gap-3 py-3 px-3 rounded-md hover:bg-muted/30 lg:flex-row lg:items-center lg:justify-between ${status ? "opacity-65" : "border border-amber-500/20 bg-amber-500/5"}`}>
      <div className="flex items-center gap-3 min-w-0">
        {user.profile_image_url ? (
          <img src={user.profile_image_url} alt="" className="w-9 h-9 rounded-full" loading="lazy" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{user.name ?? user.username ?? user.user_id}</div>
          <div className="text-xs text-muted-foreground truncate">
            {user.username ? `@${user.username}` : `id:${user.user_id}`}
            {subtitle && <span> - {subtitle}</span>}
            {openedCount > 1 && <span> - opened {openedCount}x</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {status ? (
          <Badge variant="secondary" className="text-[10px] px-1.5">{REVIEW_LABELS[status]}</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/50 text-amber-500 text-[10px] px-1.5">Pending</Badge>
        )}
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={onOpen} disabled={!user.username}>
          <ExternalLink className="w-3.5 h-3.5 mr-1" />
          Open
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onSetStatus("kept")}>
          <UserCheck className="w-3.5 h-3.5 mr-1" />
          Keep
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onSetStatus("unfollowed_manually")}>
          Unfollowed
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onSetStatus("whitelisted")}>
          Whitelist
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => onSetStatus("skipped")}>
          Skip
        </Button>
      </div>
    </div>
  );
}

function BatchReviewDialog({
  batch,
  fallbackReviewedIds,
  onOpenChange,
  onOpenBatch,
  onOpenProfile,
  onProfileLinkClick,
  onTestPopups,
  browserLabel,
}: {
  batch: PreparedBatch | null;
  fallbackReviewedIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onOpenBatch: () => void;
  onOpenProfile: (user: NotFollowingBackUser) => Promise<boolean>;
  onProfileLinkClick: (user: NotFollowingBackUser) => void;
  onTestPopups: () => void;
  browserLabel: string;
}) {
  const users = batch?.users ?? [];
  const pending = users.filter((user) => !hasReview(user, fallbackReviewedIds));

  return (
    <Dialog open={Boolean(batch)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prepare review batch</DialogTitle>
          <DialogDescription>
            {batch?.label ?? "Selected day"} - {users.length} profiles. {popupHelpText(browserLabel)}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          The batch button marks only profiles the browser reports as opened. If {browserLabel} still blocks the batch, use the visible profile links below; each click opens one profile and records it as opened.
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {users.map((user) => {
            const reviewed = hasReview(user, fallbackReviewedIds);
            return (
              <div
                key={user.user_id}
                className={`min-w-0 rounded-md border px-3 py-2 text-xs ${reviewed ? "border-border/60 bg-muted/30 opacity-60" : "border-amber-500/30 bg-background/60"}`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-medium">{user.username ? `@${user.username}` : `id:${user.user_id}`}</span>
                  {reviewed ? <Badge variant="secondary" className="text-[10px] px-1.5">opened</Badge> : null}
                </div>
                {user.name && <div className="mt-0.5 truncate text-muted-foreground">{user.name}</div>}
                <div className="mt-2 flex gap-2">
                  {user.username ? (
                    <a
                      href={xProfileUrl(user.username)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => onProfileLinkClick(user)}
                      className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs hover:bg-accent hover:text-accent-foreground"
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Open link
                    </a>
                  ) : null}
                  <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" disabled={!user.username} onClick={() => onOpenProfile(user)}>
                    Open
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onTestPopups}>Test pop-ups</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onOpenBatch} disabled={pending.length === 0}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open {pending.length} in {browserLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className={`flex items-center justify-between gap-3 py-2 px-3 rounded-md hover:bg-muted/30 ${reviewed ? "opacity-60" : ""}`}>
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
            {subtitle && <span> - {subtitle}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {reviewed && <Badge variant="secondary" className="text-[10px] px-1.5">reviewed</Badge>}
        {username && (
          <button
            onClick={() => (onOpen ? onOpen() : openProfileTab(username))}
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

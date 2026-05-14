import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, UserMinus, UserPlus, Users, ExternalLink, Check, CheckCheck, TrendingUp, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  useFollowerSnapshots, useUnfollowers, useNewFollowers,
  useFollowerStats, useMarkReviewed, useMarkAllReviewed,
  type FollowerChange, type FollowerSnapshot,
} from "@/hooks/useFollowerData";

export default function XAccount() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [showAllUnfollowers, setShowAllUnfollowers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: snapshots, isLoading: snapsLoading } = useFollowerSnapshots();
  const { data: unfollowers, isLoading: unfLoading } = useUnfollowers(showAllUnfollowers, searchQuery);
  const { data: newFollowers } = useNewFollowers();
  const { data: stats, isLoading: statsLoading } = useFollowerStats();
  const markReviewed = useMarkReviewed();
  const markAllReviewed = useMarkAllReviewed();

  const runManual = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-actions", {
        body: { action: "run_followers_snapshot" },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string; follower_count?: number; api_calls_used?: number };
      if (!result?.ok) throw new Error(result?.error ?? "Snapshot failed");
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
      window.open(`https://x.com/${c.username}`, "_blank", "noopener");
    }
  };

  const handleMarkAllReviewed = () => {
    markAllReviewed.mutate(undefined, {
      onSuccess: () => toast({ title: "Done", description: "All unfollowers marked as reviewed." }),
      onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const handleOpenAndMark = (change: FollowerChange) => {
    if (change.username) window.open(`https://x.com/${change.username}`, "_blank", "noopener");
    if (!change.reviewed) {
      markReviewed.mutate([change.id]);
    }
  };

  const estimatedCalls = stats ? Math.max(1, Math.ceil(stats.currentCount / 1000)) : 1;

  const chartData = (snapshots ?? []).map(s => ({
    date: new Date(s.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    followers: s.follower_count,
  }));

  const loading = snapsLoading || statsLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-semibold text-glass-foreground">My X Account</h1>
          <p className="text-muted-foreground text-sm">Follower growth, unfollower review, daily snapshots</p>
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
                This will use approximately <strong>{estimatedCalls}</strong> X API call{estimatedCalls === 1 ? "" : "s"} (1 per 1,000 followers).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runManual}>Run snapshot</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="followerGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={['dataMin - 20', 'dataMax + 20']} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="followers" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#followerGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unfollower Review Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserMinus className="w-5 h-5 text-red-500" /> Unfollower Review
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="show-all"
                  checked={showAllUnfollowers}
                  onCheckedChange={setShowAllUnfollowers}
                />
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
            <Input
              placeholder="Search by username or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
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
            <div className="space-y-1">
              {unfollowers.map((c) => (
                <UnfollowerRow key={c.id} change={c} onOpenAndMark={handleOpenAndMark} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Followers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-green-500" /> Recent New Followers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!newFollowers || newFollowers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No new followers detected yet.</p>
          ) : (
            <div className="space-y-1">
              {newFollowers.slice(0, 30).map((c) => (
                <FollowerRow key={c.id} change={c} />
              ))}
              {newFollowers.length > 30 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{newFollowers.length - 30} more
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snapshot History */}
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

function FollowerRow({ change }: { change: FollowerChange }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/30">
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
          </div>
        </div>
      </div>
      {change.username && (
        <a href={`https://x.com/${change.username}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

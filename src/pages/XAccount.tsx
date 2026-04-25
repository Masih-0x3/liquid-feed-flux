import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, UserMinus, UserPlus, Users, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Snapshot {
  id: string;
  taken_at: string;
  trigger: string;
  follower_count: number;
  status: string;
  api_calls_used: number;
}
interface Change {
  id: string;
  detected_at: string;
  user_id: string;
  username: string | null;
  name: string | null;
  profile_image_url: string | null;
  change_type: string;
}

export default function XAccount() {
  const { toast } = useToast();
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [unfollowed, setUnfollowed] = useState<Change[]>([]);
  const [followed, setFollowed] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const [snapsRes, unfRes, folRes] = await Promise.all([
      supabase.from("x_follower_snapshots").select("*").order("taken_at", { ascending: false }).limit(30),
      supabase.from("x_follower_changes").select("*").eq("change_type", "unfollowed").order("detected_at", { ascending: false }).limit(100),
      supabase.from("x_follower_changes").select("*").eq("change_type", "followed").order("detected_at", { ascending: false }).limit(100),
    ]);
    const snaps = (snapsRes.data ?? []) as Snapshot[];
    setHistory(snaps);
    setLatest(snaps[0] ?? null);
    setPrevious(snaps[1] ?? null);
    setUnfollowed((unfRes.data ?? []) as Change[]);
    setFollowed((folRes.data ?? []) as Change[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
      await load();
    } catch (e) {
      toast({ title: "Snapshot failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const estimatedCalls = latest ? Math.max(1, Math.ceil(latest.follower_count / 1000)) : 1;

  const delta = latest && previous ? latest.follower_count - previous.follower_count : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-semibold text-glass-foreground">My X Account</h1>
          <p className="text-muted-foreground text-sm">Daily follower snapshots & unfollower tracking</p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={running}>
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Run snapshot now
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run a manual snapshot?</AlertDialogTitle>
              <AlertDialogDescription>
                This will use approximately <strong>{estimatedCalls}</strong> X API call{estimatedCalls === 1 ? "" : "s"} (1 per 1,000 followers).
                Manual runs bypass the once-per-day automated cap.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runManual}>Run snapshot</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {!latest && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              No snapshots yet. The first one will run automatically tonight at 03:00 UTC, or click "Run snapshot now" to take a baseline immediately.
              Unfollowers will appear after the second snapshot.
            </p>
          </CardContent>
        </Card>
      )}

      {latest && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" /> Followers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{latest.follower_count.toLocaleString()}</div>
              {delta !== null && (
                <p className={`text-sm mt-1 ${delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                  {delta > 0 ? "+" : ""}{delta} since last snapshot
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <UserMinus className="w-4 h-4" /> Recent unfollowers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{unfollowed.length}</div>
              <p className="text-sm mt-1 text-muted-foreground">last 100 events</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Recent new followers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{followed.length}</div>
              <p className="text-sm mt-1 text-muted-foreground">last 100 events</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Last snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-base font-medium">{formatDistanceToNow(new Date(latest.taken_at), { addSuffix: true })}</div>
              <p className="text-xs mt-1 text-muted-foreground">
                {latest.trigger} · {latest.api_calls_used} API call{latest.api_calls_used === 1 ? "" : "s"} · {latest.status}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserMinus className="w-5 h-5 text-red-500" /> Unfollowers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unfollowed.length === 0 ? (
            <p className="text-muted-foreground text-sm">No unfollowers detected yet.</p>
          ) : (
            <div className="space-y-2">
              {unfollowed.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-green-500" /> New followers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {followed.length === 0 ? (
            <p className="text-muted-foreground text-sm">No new followers detected yet.</p>
          ) : (
            <div className="space-y-2">
              {followed.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Snapshot history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {history.map((s, i) => {
              const prev = history[i + 1];
              const d = prev ? s.follower_count - prev.follower_count : null;
              return (
                <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground tabular-nums">{new Date(s.taken_at).toLocaleString()}</span>
                    <Badge variant="outline">{s.trigger}</Badge>
                    <Badge variant={s.status === "complete" ? "secondary" : "outline"}>{s.status}</Badge>
                  </div>
                  <div className="flex items-center gap-4 tabular-nums">
                    <span>{s.follower_count.toLocaleString()}</span>
                    {d !== null && (
                      <span className={d > 0 ? "text-green-500" : d < 0 ? "text-red-500" : "text-muted-foreground"}>
                        {d > 0 ? "+" : ""}{d}
                      </span>
                    )}
                    <span className="text-muted-foreground">{s.api_calls_used} call{s.api_calls_used === 1 ? "" : "s"}</span>
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

function ChangeRow({ change }: { change: Change }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/30">
      <div className="flex items-center gap-3 min-w-0">
        {change.profile_image_url ? (
          <img src={change.profile_image_url} alt="" className="w-10 h-10 rounded-full" loading="lazy" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted" />
        )}
        <div className="min-w-0">
          <div className="font-medium truncate">{change.name ?? change.username ?? change.user_id}</div>
          <div className="text-xs text-muted-foreground truncate">
            {change.username ? `@${change.username}` : `id:${change.user_id}`}
            {" · "}
            {formatDistanceToNow(new Date(change.detected_at), { addSuffix: true })}
          </div>
        </div>
      </div>
      {change.username && (
        <a
          href={`https://x.com/${change.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

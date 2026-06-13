import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  Gauge,
  HardDrive,
  Languages,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  TimerReset,
  Twitter,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useDashboardData, type DashboardSeverity } from '@/hooks/useDashboardData';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardHealth } from '@/components/dashboard/DashboardHealth';
import { IngestHeartbeatAlert } from '@/components/dashboard/IngestHeartbeatAlert';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

function compactNumber(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function severityClasses(severity: DashboardSeverity): string {
  if (severity === 'critical') return 'border-destructive/40 bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-500';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';
}

function statusDot(severity: DashboardSeverity): string {
  if (severity === 'critical') return 'bg-destructive';
  if (severity === 'warning') return 'bg-amber-500';
  return 'bg-emerald-500';
}

function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1_000_000;
  if (mb < 1000) return `${Math.round(mb)} MB`;
  return `${(mb / 1000).toFixed(2)} GB`;
}

function quotaTone(value: number | null | undefined): string {
  if (value == null) return 'text-muted-foreground';
  if (value >= 85) return 'text-destructive';
  if (value >= 70) return 'text-warning';
  return 'text-success';
}

const EMPTY_SCORING_TUNING = {
  regionalAuto24h: 0,
  globalPilotReview24h: 0,
  globalTunedAuto24h: 0,
  manualScoreOverrides24h: 0,
  manualFeedback24h: 0,
  projectedAddedPostsMonth: 0,
  error: null as string | null,
};

export default function Dashboard() {
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching } = useDashboardData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in-up">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 animate-spin text-primary" />
          <h1 className="text-2xl font-display font-bold text-glass-foreground sm:text-3xl">Loading Dashboard...</h1>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="mt-3 h-8 w-1/2 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Monitor your RSS - OpenAI - Telegram pipeline</p>
        </div>
        <Card className="glass-card border-destructive/40">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <h2 className="font-semibold text-glass-foreground">Dashboard failed to load</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(error as Error | null)?.message || 'The dashboard summary is unavailable.'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { metrics, health, activities, heartbeat, opsStatus, pipelineCounts, queueBreakdown, xLocalUsage, systemPerformance } = data;
  const scoringTuning = data.scoringTuning ?? EMPTY_SCORING_TUNING;
  const maxPipeline = Math.max(
    pipelineCounts.ingested,
    pipelineCounts.duplicateGateChecked ?? 0,
    pipelineCounts.scored,
    pipelineCounts.translated,
    pipelineCounts.telegramDelivered,
    pipelineCounts.xPosted,
    1,
  );

  const triageCards = [
    { label: 'Needs attention', value: pipelineCounts.needsAttention, icon: AlertTriangle, route: '/monitoring?filter=needs_attention', tone: 'text-amber-500' },
    { label: 'Failed/stuck', value: pipelineCounts.failedStuck, icon: XCircle, route: '/monitoring?filter=failed_stuck', tone: 'text-destructive' },
    { label: 'Ready to deliver', value: pipelineCounts.readyToDeliver, icon: Send, route: '/monitoring?filter=ready_to_deliver', tone: 'text-primary' },
    { label: 'Translation queue', value: pipelineCounts.translationQueue, icon: MessageSquare, route: '/monitoring?filter=translation_queue', tone: 'text-blue-500' },
    { label: 'X failed', value: pipelineCounts.xFailed, icon: Twitter, route: '/monitoring?filter=x_failed', tone: 'text-destructive' },
    { label: 'Stale jobs', value: pipelineCounts.staleJobs, icon: TimerReset, route: '/monitoring?filter=failed_stuck', tone: 'text-amber-500' },
  ];

  const funnel = [
    { label: 'Ingested', value: pipelineCounts.ingested, icon: Activity, note: 'RSS intake' },
    {
      label: 'Duplicate gate',
      value: pipelineCounts.duplicateGateAvailable ? pipelineCounts.duplicateGateChecked : null,
      icon: ShieldCheck,
      note: pipelineCounts.duplicateGateAvailable ? `${compactNumber(pipelineCounts.duplicates)} blocked` : 'Schema pending',
    },
    { label: 'Scored', value: pipelineCounts.scored, icon: Star, note: `${compactNumber(pipelineCounts.needsScore)} need score` },
    { label: 'Translated', value: pipelineCounts.translated, icon: MessageSquare, note: `${compactNumber(pipelineCounts.translationQueue)} queued` },
    { label: 'Telegram', value: pipelineCounts.telegramDelivered, icon: Send, note: 'Delivered locally' },
    { label: 'X posted', value: pipelineCounts.xPosted, icon: Twitter, note: 'Local posts only' },
  ];

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="sticky top-0 z-20 -mx-2 rounded-b-xl border-b border-border/60 bg-background/95 px-2 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-glass-foreground sm:text-3xl">Dashboard</h1>
            <p className="text-sm text-muted-foreground sm:text-base">Ops triage for RSS, scoring, Telegram, and X automation</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
              {health.isOnline ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-destructive" />}
              <span>{health.isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <div className="text-xs text-muted-foreground">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</div>
          </div>
        </div>
      </div>

      <Card className={`glass-card border ${severityClasses(opsStatus.severity)}`}>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${statusDot(opsStatus.severity)}`} />
            <div>
              <p className="text-sm font-semibold text-glass-foreground">{opsStatus.primaryIssue}</p>
              <p className="text-xs text-muted-foreground">
                Last ingest {formatAge(opsStatus.lastIngestAgeSeconds)} ago - {opsStatus.staleJobCount} stale running jobs
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(opsStatus.recommendedRoute)}>
            Open recommended view
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card border-primary/20">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-glass-foreground">V2 scoring tuning</p>
              <p className="text-sm text-muted-foreground">
                Regional auto-promotions, global pilot reviews, and manual scoring feedback over the last 24h.
              </p>
            </div>
            <Badge variant="outline">{compactNumber(scoringTuning.manualFeedback24h)} feedback events</Badge>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-border/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span>Regional auto 24h</span>
              </div>
              <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.regionalAuto24h)}</p>
            </div>
            <div className="rounded border border-border/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Star className="h-3.5 w-3.5 text-primary" />
                <span>Global pilot review</span>
              </div>
              <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.globalPilotReview24h)}</p>
            </div>
            <div className="rounded border border-border/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                <span>Manual overrides</span>
              </div>
              <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.manualScoreOverrides24h)}</p>
            </div>
            <div className="rounded border border-border/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                <span>Projected added/month</span>
              </div>
              <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.projectedAddedPostsMonth)}</p>
            </div>
          </div>
          {scoringTuning.error && <p className="mt-2 text-xs text-warning">Scoring tuning diagnostics partial: {scoringTuning.error}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {triageCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => navigate(card.route)}
            className="rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <card.icon className={`h-4 w-4 ${card.tone}`} />
            </div>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${card.tone}`}>{compactNumber(card.value)}</p>
          </button>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-display text-glass-foreground">
                <Gauge className="h-5 w-5 text-primary" />
                System Speed + Quota
              </CardTitle>
              <CardDescription>Supabase-local timing and quota signals. No X requests are made here.</CardDescription>
            </div>
            {!systemPerformance.success && (
              <Badge variant="outline" className="border-warning/40 text-warning">Diagnostics partial</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Send className="h-4 w-4 text-primary" />
              Telegram p95
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {formatSeconds(systemPerformance.windows.sixHours.stages.telegramEndToEnd.p95Seconds)}
            </p>
            <p className="text-xs text-muted-foreground">6h end-to-end</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Twitter className="h-4 w-4 text-primary" />
              X p95
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {formatSeconds(systemPerformance.windows.sixHours.stages.xEndToEnd.p95Seconds)}
            </p>
            <p className="text-xs text-muted-foreground">6h end-to-end</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Gauge className="h-4 w-4 text-primary" />
              Score p95
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {formatSeconds(systemPerformance.windows.sixHours.stages.ingestToScore.p95Seconds)}
            </p>
            <p className="text-xs text-muted-foreground">ingest to score</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Languages className="h-4 w-4 text-primary" />
              Translate p95
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {formatSeconds(systemPerformance.windows.sixHours.stages.scoreToTranslation.p95Seconds)}
            </p>
            <p className="text-xs text-muted-foreground">score to translated</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-4 w-4 text-primary" />
              Scheduler wait
            </div>
            <p className={systemPerformance.queue.schedulerWaitSeconds != null && systemPerformance.queue.schedulerWaitSeconds > 60 ? 'mt-2 text-xl font-semibold tabular-nums text-warning' : 'mt-2 text-xl font-semibold tabular-nums text-glass-foreground'}>
              {formatAge(systemPerformance.queue.schedulerWaitSeconds)}
            </p>
            <p className="text-xs text-muted-foreground">{compactNumber(systemPerformance.queue.pending)} pending jobs</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" />
              Worker cron
            </div>
            <p className={systemPerformance.resources.workerCadenceWarning ? 'mt-2 text-xl font-semibold tabular-nums text-warning' : 'mt-2 text-xl font-semibold tabular-nums text-glass-foreground'}>
              {systemPerformance.resources.workerCadenceSeconds ? `${systemPerformance.resources.workerCadenceSeconds}s` : 'unknown'}
            </p>
            <p className="text-xs text-muted-foreground">{systemPerformance.resources.workerDispatchMode}</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-4 w-4 text-primary" />
              Database
            </div>
            <p className={`mt-2 text-xl font-semibold tabular-nums ${quotaTone(systemPerformance.resources.dbUsedPct)}`}>
              {systemPerformance.resources.dbUsedPct == null ? '-' : `${systemPerformance.resources.dbUsedPct}%`}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(systemPerformance.resources.dbBytes)}</p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HardDrive className="h-4 w-4 text-primary" />
              Temp media
            </div>
            <p className={`mt-2 text-xl font-semibold tabular-nums ${quotaTone(systemPerformance.resources.storageUsedPct)}`}>
              {systemPerformance.resources.storageUsedPct == null ? '-' : `${systemPerformance.resources.storageUsedPct}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(systemPerformance.resources.tempMediaBytes)} / {compactNumber(systemPerformance.resources.tempMediaObjects)} objects
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3 sm:col-span-2 xl:col-span-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span>Projected cron invocations: {compactNumber(systemPerformance.resources.projectedCronInvocationsMonthly)} / {compactNumber(systemPerformance.resources.edgeMonthlyLimit)} monthly</span>
              </div>
              <span className={`text-sm font-semibold ${quotaTone(systemPerformance.resources.edgeCronUsedPct)}`}>
                {systemPerformance.resources.edgeCronUsedPct == null ? 'Estimate unavailable' : `${systemPerformance.resources.edgeCronUsedPct}% of Edge quota`}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {systemPerformance.queue.lanePressure.map((lane) => (
                <div key={lane.lane} className="rounded border border-border/50 px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize">{lane.lane}</span>
                    <span className="text-muted-foreground">{lane.pending} pending / {lane.running} running</span>
                  </div>
                  <p className={lane.maxQueueWaitP95Seconds != null && lane.maxQueueWaitP95Seconds > 60 ? 'mt-1 text-warning' : 'mt-1 text-muted-foreground'}>
                    wait p95 {formatSeconds(lane.maxQueueWaitP95Seconds)}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Duplicate translate jobs: {compactNumber(systemPerformance.resources.duplicateTranslateJobs24h)} in 24h
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display text-glass-foreground">Pipeline Funnel</CardTitle>
            <CardDescription>Local database counts only. No X requests are made from this dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {funnel.map((step) => (
                <div key={step.label} className="rounded-md border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <step.icon className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-glass-foreground">{step.label}</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">{compactNumber(step.value)}</p>
                  </div>
                  <Progress value={step.value == null ? 0 : percent(step.value, maxPipeline)} className="mt-3 h-2" />
                  <p className="mt-2 text-xs text-muted-foreground">{step.note}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-display text-glass-foreground">X Cost Guard</CardTitle>
                <CardDescription>Latest local estimate</CardDescription>
              </div>
              <Badge variant="outline">{xLocalUsage.available ? 'Ledger' : 'Fallback'}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Configured budget</span>
                <span className={xLocalUsage.budgetUsedPct >= 90 ? 'font-semibold text-destructive' : xLocalUsage.budgetUsedPct >= 70 ? 'font-semibold text-warning' : 'font-semibold text-success'}>
                  {xLocalUsage.budgetUsedPct}%
                </span>
              </div>
              <Progress value={Math.min(100, xLocalUsage.budgetUsedPct)} className="mt-2 h-2" />
              <p className="mt-1 text-xs text-muted-foreground">{compactNumber(xLocalUsage.monthlyPosts)} of {compactNumber(xLocalUsage.monthlyBudget)} configured posts</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Local posts 24h</p>
                <p className="font-semibold">{compactNumber(xLocalUsage.posts24h)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed posts 24h</p>
                <p className={xLocalUsage.failedPosts24h > 0 ? 'font-semibold text-destructive' : 'font-semibold text-success'}>{compactNumber(xLocalUsage.failedPosts24h)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Media uploads</p>
                <p className="font-semibold">{compactNumber(xLocalUsage.mediaUploads24h)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hydration reads</p>
                <p className="font-semibold">{compactNumber(xLocalUsage.hydrations24h)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed attempts</p>
                <p className={xLocalUsage.failedAttempts24h > 0 ? 'font-semibold text-warning' : 'font-semibold text-success'}>{compactNumber(xLocalUsage.failedAttempts24h)}</p>
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              Official X usage is not synced from Dashboard. My X follower/following reads are paused; use Settings for X automation controls.
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="activity" className="space-y-3">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="x">X usage</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <DashboardActivity activities={activities} />
        </TabsContent>

        <TabsContent value="pipeline">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg font-display text-glass-foreground">Queue Breakdown</CardTitle>
                <CardDescription>Current queue pressure by job type</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {[
                    ['Pending', queueBreakdown.pending],
                    ['Running', queueBreakdown.running],
                    ['Failed 24h', queueBreakdown.failed24h],
                    ['Resolved 24h', queueBreakdown.resolvedFailed24h],
                    ['Stale running', queueBreakdown.staleRunning],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-md border border-border/60 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-xl font-semibold tabular-nums">{compactNumber(value as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {queueBreakdown.byType.length > 0 ? queueBreakdown.byType.map((row) => (
                    <div key={row.type} className="grid gap-2 rounded-md border border-border/60 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center">
                      <span className="truncate font-medium">{row.type} <span className="text-xs font-normal text-muted-foreground">({row.lane})</span></span>
                      <span className="text-muted-foreground">{row.pending} pending</span>
                      <span className="text-muted-foreground">{row.running} running</span>
                      <span className="text-muted-foreground">wait p95 {formatSeconds(row.queueWaitP95Seconds)}</span>
                      <span className={row.failed > 0 ? 'text-destructive' : 'text-muted-foreground'}>{row.failed} failed{row.resolvedFailed > 0 ? ` / ${row.resolvedFailed} resolved` : ''}</span>
                    </div>
                  )) : (
                    <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">No active queue pressure.</div>
                  )}
                </div>
              </CardContent>
            </Card>
            <IngestHeartbeatAlert heartbeat={heartbeat} />
          </div>
        </TabsContent>

        <TabsContent value="x">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-display text-glass-foreground">X Usage Details</CardTitle>
              <CardDescription>Supabase-derived local usage only</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Attempts', xLocalUsage.attempts24h],
                ['Counted attempts', xLocalUsage.countedAttempts24h],
                ['Failed attempts', xLocalUsage.failedAttempts24h],
                ['Skipped no media', metrics.xSkippedNoMedia24h],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold tabular-nums">{compactNumber(value as number)}</p>
                </div>
              ))}
              <div className="rounded-md border border-border/60 p-3 sm:col-span-2 lg:col-span-4">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span>No dashboard load calls X, hydrates tweets, syncs official usage, or snapshots followers.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controls">
          <DashboardHealth health={health} queue={queueBreakdown} xUsage={xLocalUsage} systemPerformance={systemPerformance} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

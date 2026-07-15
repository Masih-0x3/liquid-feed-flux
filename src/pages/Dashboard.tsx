import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  DollarSign,
  Gauge,
  HardDrive,
  Info,
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
import {
  useDashboardData,
  type DashboardSeverity,
  type OpenAIUsage,
  type PipelineCounts,
  type ProcessObservabilitySummary,
  type SystemPerformanceSummary,
} from '@/hooks/useDashboardData';
import { useDashboardProcessHudData } from '@/hooks/useDashboardProcessHudData';
import { fullDate, useDeploymentVersionStatus } from '@/hooks/useDeploymentVersionStatus';
import { DashboardHealth } from '@/components/dashboard/DashboardHealth';
import { IngestHeartbeatAlert } from '@/components/dashboard/IngestHeartbeatAlert';
import { MonitoringProcessHud } from '@/components/monitoring/MonitoringProcessHud';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

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

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${compactNumber(value)} ${value === 1 ? singular : pluralLabel}`;
}

function nonNegativeDelta(from: number | null | undefined, to: number | null | undefined): number {
  if (typeof from !== 'number' || typeof to !== 'number') return 0;
  return Math.max(0, from - to);
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' - ');
}

const STORAGE_WARNING_PCT = 85;
const STORAGE_CRITICAL_PCT = 90;
const DASHBOARD_TAB_IDS = ['pipeline', 'x', 'controls'] as const;

type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number];

type AlertSummary = {
  severity: DashboardSeverity;
  title: string;
  detail: string;
  route: string;
  ctaLabel: string;
};

function getOpsCtaLabel(opsStatus: { recommendedRoute: string }, pipelineCounts: PipelineCounts): string {
  if (opsStatus.recommendedRoute.includes('x_failed')) return 'Open X failures';
  if (opsStatus.recommendedRoute.includes('ready_to_deliver')) return 'Open ready queue';
  if (opsStatus.recommendedRoute.includes('failed_stuck')) {
    const count = Math.max(pipelineCounts.failedStuck, pipelineCounts.staleJobs);
    return `Review ${plural(count || 1, 'failed job')}`;
  }
  if (opsStatus.recommendedRoute.includes('needs_attention')) return 'Review needs attention';
  return 'Open monitoring';
}

function getStorageAlert(resources: SystemPerformanceSummary['resources']): AlertSummary | null {
  const storagePct = resources.storageUsedPct;
  if (storagePct == null || storagePct < STORAGE_WARNING_PCT) return null;

  const severity: DashboardSeverity = storagePct >= STORAGE_CRITICAL_PCT ? 'critical' : 'warning';
  return {
    severity,
    title: severity === 'critical' ? 'Temp media storage critical' : 'Temp media storage high',
    detail: `${storagePct}% used - ${formatBytes(resources.tempMediaBytes)} of ${formatBytes(resources.storageLimitBytes)} across ${compactNumber(resources.tempMediaObjects)} objects`,
    route: '/?tab=controls',
    ctaLabel: 'Review media cleanup',
  };
}

function getPrimaryAlert(
  opsStatus: AlertSummary,
  storageAlert: AlertSummary | null,
): AlertSummary {
  if (!storageAlert) return opsStatus;
  if (storageAlert.severity === 'critical' && opsStatus.severity !== 'critical') return storageAlert;
  if (opsStatus.severity === 'ok') return storageAlert;
  return opsStatus;
}

function MetricHelp({ children, description }: { children: ReactNode; description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1">
          {children}
          <Info className="h-3 w-3 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        {description}
      </TooltipContent>
    </Tooltip>
  );
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

const EMPTY_OPENAI_USAGE: OpenAIUsage = {
  available: false,
  error: null,
  windowHours: 24,
  measuredJobs: 0,
  translateJobs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  scoringTokens: 0,
  adjudicationTokens: 0,
  translationTokens: 0,
  reasoningTokens: 0,
  quotaFailedJobs: 0,
  retryAttempts: 0,
};

const EMPTY_PROCESS_OBSERVABILITY: ProcessObservabilitySummary = {
  available: false,
  error: null,
  windowHours: 24,
  activeRuns: 0,
  completedRuns24h: 0,
  failedRuns24h: 0,
  aiCalls24h: 0,
  failedAiCalls24h: 0,
  totalTokens24h: 0,
  reasoningTokens24h: 0,
  aiCallP95Seconds: null,
  latestRun: null,
  recentRuns: [],
  foglamp: {
    hostedExportEnabled: false,
    hasApiKey: false,
    monthlySpanLimit: 10_000,
    monthlySpanCap: 8_000,
    monthlySpanWarn: 6_000,
    estimatedSpansUsed: 0,
    estimatedSpansSkipped: 0,
    capUsedPct: null,
    warning: false,
    stopped: false,
  },
  openAiTokensMonthToDate: 0,
};

export default function Dashboard() {
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching } = useDashboardData();
  const processHudQuery = useDashboardProcessHudData();
  const deploymentVersion = useDeploymentVersionStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    processHudQuery.refetch();
    void deploymentVersion.refetch();
  };

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

  const { metrics, health, heartbeat, opsStatus, pipelineCounts, queueBreakdown, xLocalUsage, systemPerformance } = data;
  const openAiUsage = data.openAiUsage ?? EMPTY_OPENAI_USAGE;
  const processObservability = data.processObservability ?? EMPTY_PROCESS_OBSERVABILITY;
  const requestedTab = searchParams.get('tab');
  const activeTab = DASHBOARD_TAB_IDS.includes(requestedTab as DashboardTabId) ? requestedTab as DashboardTabId : 'pipeline';
  const setDashboardTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'pipeline') {
      next.delete('tab');
    } else {
      next.set('tab', value);
    }
    setSearchParams(next, { replace: true });
  };
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
  const storageAlert = getStorageAlert(systemPerformance.resources);
  const opsAlert: AlertSummary = {
    severity: opsStatus.severity,
    title: opsStatus.primaryIssue,
    detail: `Last ingest ${formatAge(opsStatus.lastIngestAgeSeconds)} ago - ${opsStatus.staleJobCount} stale running jobs`,
    route: opsStatus.recommendedRoute,
    ctaLabel: getOpsCtaLabel(opsStatus, pipelineCounts),
  };
  const primaryAlert = getPrimaryAlert(opsAlert, storageAlert);
  const deploymentAlert = deploymentVersion.error
    ? {
        title: 'Backend deployment revision cannot be verified',
        impact: 'The dashboard cannot confirm whether its controls and the deployed Edge Functions are aligned.',
        remediation: 'Check the admin-actions version response, then deploy the reviewed Edge Function revision with release metadata and recheck here.',
      }
    : deploymentVersion.backend && !deploymentVersion.backendMetadataAvailable
      ? {
          title: 'Backend deployment metadata is unavailable',
          impact: 'The dashboard cannot safely compare this build with the deployed Edge Functions until the backend reports an explicit revision and deploy time.',
          remediation: 'Deploy the reviewed Edge Function revision through the release script, then recheck both revisions here.',
        }
      : deploymentVersion.mismatch === 'frontend_behind'
        ? {
        title: 'Dashboard deployment is behind the backend',
        impact: 'The browser can show controls or status logic that no longer match the deployed Edge Functions.',
        remediation: 'Deploy the latest reviewed Git commit to Vercel, then recheck both revisions here.',
      }
        : deploymentVersion.mismatch === 'backend_behind'
          ? {
          title: 'Backend deployment is behind the dashboard',
          impact: 'The dashboard can expose controls or expectations that the deployed Edge Functions have not received yet.',
          remediation: 'Deploy the reviewed Edge Function revision, then recheck both revisions here.',
        }
          : deploymentVersion.mismatch === 'revision_mismatch'
            ? {
                title: 'Dashboard and backend revisions differ',
                impact: 'Both sides reported release metadata, but not the same Git revision. Release order is unclear until the intended deployment is confirmed.',
                remediation: 'Confirm the intended release, deploy the missing reviewed surface, then recheck both revisions here.',
              }
            : null;
  const oldestPendingSeconds = systemPerformance.queue.oldestPendingAgeSeconds ?? queueBreakdown.oldestPendingAgeSeconds;
  const storagePct = systemPerformance.resources.storageUsedPct;

  const triageCards = [
    {
      label: 'Needs attention',
      value: pipelineCounts.needsAttention,
      icon: AlertTriangle,
      route: '/monitoring?filter=needs_attention',
      tone: pipelineCounts.needsAttention > 0 ? 'text-amber-500' : 'text-muted-foreground',
      context: joinParts([
        pipelineCounts.failedStuck > 0 ? `${compactNumber(pipelineCounts.failedStuck)} failed` : null,
        pipelineCounts.readyToDeliver > 0 ? `${compactNumber(pipelineCounts.readyToDeliver)} ready` : null,
      ]) || 'No active triage',
    },
    {
      label: 'Failed/stuck',
      value: pipelineCounts.failedStuck,
      icon: XCircle,
      route: '/monitoring?filter=failed_stuck',
      tone: pipelineCounts.failedStuck > 0 ? 'text-destructive' : 'text-muted-foreground',
      context: `${compactNumber(queueBreakdown.failed24h)} failed 24h - ${compactNumber(queueBreakdown.staleRunning)} stale`,
    },
    {
      label: 'Ready to deliver',
      value: pipelineCounts.readyToDeliver,
      icon: Send,
      route: '/monitoring?filter=ready_to_deliver',
      tone: 'text-primary',
      context: `${compactNumber(pipelineCounts.readyToDeliver)} route-ready`,
    },
    {
      label: 'Translation queue',
      value: pipelineCounts.translationQueue,
      icon: MessageSquare,
      route: '/monitoring?filter=translation_queue',
      tone: pipelineCounts.translationQueue > 0 ? 'text-amber-500' : 'text-primary',
      context: `${compactNumber(pipelineCounts.translationQueue)} queued`,
    },
    {
      label: 'X failed',
      value: pipelineCounts.xFailed,
      icon: Twitter,
      route: '/monitoring?filter=x_failed',
      tone: pipelineCounts.xFailed > 0 ? 'text-destructive' : 'text-muted-foreground',
      context: `${compactNumber(xLocalUsage.failedPosts24h)} posts - ${compactNumber(xLocalUsage.failedAttempts24h)} attempts`,
    },
    {
      label: 'Stale jobs',
      value: pipelineCounts.staleJobs,
      icon: TimerReset,
      route: '/monitoring?filter=failed_stuck',
      tone: pipelineCounts.staleJobs > 0 ? 'text-amber-500' : 'text-muted-foreground',
      context: oldestPendingSeconds == null ? `${compactNumber(queueBreakdown.staleRunning)} stale running` : `oldest pending ${formatAge(oldestPendingSeconds)}`,
    },
  ];

  const funnel = [
    { label: 'Ingested', value: pipelineCounts.ingested, icon: Activity, note: 'RSS intake', noteTone: 'text-muted-foreground' },
    {
      label: 'Duplicate gate',
      value: pipelineCounts.duplicateGateAvailable ? pipelineCounts.duplicateGateChecked : null,
      icon: ShieldCheck,
      note: pipelineCounts.duplicateGateAvailable ? `${compactNumber(pipelineCounts.duplicates)} blocked` : 'Schema pending',
      noteTone: 'text-muted-foreground',
    },
    {
      label: 'Scored',
      value: pipelineCounts.scored,
      icon: Star,
      note: `${compactNumber(nonNegativeDelta(pipelineCounts.duplicateGateChecked ?? pipelineCounts.ingested, pipelineCounts.scored))} not scored`,
      noteTone: nonNegativeDelta(pipelineCounts.duplicateGateChecked ?? pipelineCounts.ingested, pipelineCounts.scored) > 0 ? 'text-warning' : 'text-muted-foreground',
    },
    {
      label: 'Translated',
      value: pipelineCounts.translated,
      icon: MessageSquare,
      note: `${compactNumber(nonNegativeDelta(pipelineCounts.scored, pipelineCounts.translated))} not translated`,
      noteTone: nonNegativeDelta(pipelineCounts.scored, pipelineCounts.translated) > 0 ? 'text-warning' : 'text-muted-foreground',
    },
    {
      label: 'Telegram',
      value: pipelineCounts.telegramDelivered,
      icon: Send,
      note: `${compactNumber(nonNegativeDelta(pipelineCounts.translated, pipelineCounts.telegramDelivered))} awaiting Telegram`,
      noteTone: nonNegativeDelta(pipelineCounts.translated, pipelineCounts.telegramDelivered) > 0 ? 'text-warning' : 'text-muted-foreground',
    },
    {
      label: 'X posted',
      value: pipelineCounts.xPosted,
      icon: Twitter,
      note: `${compactNumber(nonNegativeDelta(pipelineCounts.telegramDelivered, pipelineCounts.xPosted))} not X posted`,
      noteTone: nonNegativeDelta(pipelineCounts.telegramDelivered, pipelineCounts.xPosted) > 0 ? 'text-warning' : 'text-muted-foreground',
    },
  ];

  const statusItems = [
    pipelineCounts.failedStuck > 0
      ? { label: `${compactNumber(pipelineCounts.failedStuck)} failed/stuck`, className: 'border-destructive/30 text-destructive' }
      : null,
    storagePct != null && storagePct >= STORAGE_WARNING_PCT
      ? { label: `Temp media ${storagePct}%`, className: storagePct >= STORAGE_CRITICAL_PCT ? 'border-destructive/30 text-destructive' : 'border-warning/30 text-warning' }
      : null,
    { label: health.isOnline ? 'Online' : 'Offline', className: health.isOnline ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive' },
    { label: `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}`, className: 'border-border/60 text-muted-foreground' },
  ].filter(Boolean) as Array<{ label: string; className: string }>;

  const provenanceCopy = 'Supabase-local telemetry only; dashboard loads do not call X, hydrate tweets, sync official usage, or snapshot followers.';

  const speedMetrics = [
    { label: 'Telegram p95', icon: Send, value: formatSeconds(systemPerformance.windows.sixHours.stages.telegramEndToEnd.p95Seconds), note: '6h end-to-end', tone: 'text-glass-foreground' },
    { label: 'X p95', icon: Twitter, value: formatSeconds(systemPerformance.windows.sixHours.stages.xEndToEnd.p95Seconds), note: '6h end-to-end', tone: 'text-glass-foreground' },
    { label: 'Score p95', icon: Gauge, value: formatSeconds(systemPerformance.windows.sixHours.stages.ingestToScore.p95Seconds), note: 'ingest to score', tone: 'text-glass-foreground' },
    { label: 'Translate p95', icon: Languages, value: formatSeconds(systemPerformance.windows.sixHours.stages.scoreToTranslation.p95Seconds), note: 'score to translated', tone: 'text-glass-foreground' },
    {
      label: 'Scheduler wait',
      icon: Clock,
      value: formatAge(systemPerformance.queue.schedulerWaitSeconds),
      note: `${compactNumber(systemPerformance.queue.pending)} pending jobs`,
      tone: systemPerformance.queue.schedulerWaitSeconds != null && systemPerformance.queue.schedulerWaitSeconds > 60 ? 'text-warning' : 'text-glass-foreground',
      help: 'Oldest scheduler wait for pending queue work.',
    },
    {
      label: 'Worker cron',
      icon: Activity,
      value: systemPerformance.resources.workerCadenceSeconds ? `${systemPerformance.resources.workerCadenceSeconds}s` : 'unknown',
      note: systemPerformance.resources.workerDispatchMode,
      tone: systemPerformance.resources.workerCadenceWarning ? 'text-warning' : 'text-glass-foreground',
    },
  ];

  const openAiTokenMetrics = [
    ['Total tokens', openAiUsage.totalTokens],
    ['Output tokens', openAiUsage.outputTokens],
    ['Reasoning tokens', openAiUsage.reasoningTokens],
    ['Quota failures', openAiUsage.quotaFailedJobs],
  ];
  const foglampPct = processObservability.foglamp.capUsedPct ?? percent(
    processObservability.foglamp.estimatedSpansUsed,
    processObservability.foglamp.monthlySpanCap,
  );
  const foglampTone = processObservability.foglamp.stopped
    ? 'text-destructive'
    : processObservability.foglamp.warning
      ? 'text-warning'
      : 'text-success';
  const latestProcessRun = processObservability.latestRun;
  const processHudError = processHudQuery.isError
    ? processHudQuery.error as Error
    : processHudQuery.data?.available === false && processHudQuery.data.error
      ? new Error(processHudQuery.data.error)
      : null;
  const processHudEmptyReason = processHudQuery.data?.available === false
    ? processHudQuery.data.partialReason?.replaceAll('_', ' ') ?? 'Process feed unavailable.'
    : processHudQuery.data?.truncated
      ? 'Showing latest 30 process runs.'
      : 'Waiting for post processes.';

  const resourceMetrics = [
    {
      label: 'Database',
      icon: Database,
      value: systemPerformance.resources.dbUsedPct == null ? '-' : `${systemPerformance.resources.dbUsedPct}%`,
      note: formatBytes(systemPerformance.resources.dbBytes),
      tone: quotaTone(systemPerformance.resources.dbUsedPct),
    },
    {
      label: 'Temp media',
      icon: HardDrive,
      value: systemPerformance.resources.storageUsedPct == null ? '-' : `${systemPerformance.resources.storageUsedPct}%`,
      note: `${formatBytes(systemPerformance.resources.tempMediaBytes)} / ${compactNumber(systemPerformance.resources.tempMediaObjects)} objects`,
      tone: quotaTone(systemPerformance.resources.storageUsedPct),
    },
    {
      label: 'Edge quota',
      icon: BarChart3,
      value: systemPerformance.resources.edgeCronUsedPct == null ? '-' : `${systemPerformance.resources.edgeCronUsedPct}%`,
      note: `${compactNumber(systemPerformance.resources.projectedCronInvocationsMonthly)} / ${compactNumber(systemPerformance.resources.edgeMonthlyLimit)} monthly`,
      tone: quotaTone(systemPerformance.resources.edgeCronUsedPct),
    },
    {
      label: 'Duplicate translate jobs',
      icon: AlertTriangle,
      value: compactNumber(systemPerformance.resources.duplicateTranslateJobs24h),
      note: 'last 24h',
      tone: systemPerformance.resources.duplicateTranslateJobs24h > 0 ? 'text-warning' : 'text-success',
      help: 'Duplicate translate jobs created in the last 24 hours.',
    },
  ];

  return (
    <div className="space-y-3 animate-fade-in-up">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-glass-foreground sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground sm:text-base">Ops triage for RSS, scoring, Telegram, and X automation</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{provenanceCopy}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching || processHudQuery.isFetching}>
            {isFetching || processHudQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
            {health.isOnline ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-destructive" />}
            <span>{health.isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className="text-xs text-muted-foreground">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</div>
        </div>
      </div>

      <div aria-label="Dashboard status" className="rounded-lg border border-border/60 bg-background/70 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {statusItems.map((item) => (
            <span key={item.label} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', item.className)}>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <Card className={`glass-card border ${severityClasses(primaryAlert.severity)}`}>
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${statusDot(primaryAlert.severity)}`} />
            <div>
              <p className="text-sm font-semibold text-glass-foreground">{primaryAlert.title}</p>
              <p className="text-xs text-muted-foreground">{primaryAlert.detail}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(primaryAlert.route)}>
            {primaryAlert.ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {deploymentAlert && (
        <Card className="border-amber-500/40 bg-amber-500/10" role="alert">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-glass-foreground">{deploymentAlert.title}</p>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-500">Recheck before changing behavior</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{deploymentAlert.impact}</p>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <p className="rounded-md border border-border/60 bg-background/30 p-2">
                    <span className="block font-medium text-glass-foreground">Dashboard</span>
                    <code className="break-all">{deploymentVersion.frontendSha}</code>
                    <span className="mt-1 block">Built {fullDate(deploymentVersion.frontendTime)}</span>
                  </p>
                  <p className="rounded-md border border-border/60 bg-background/30 p-2">
                    <span className="block font-medium text-glass-foreground">Backend API</span>
                    <code className="break-all">{deploymentVersion.backend?.sha ?? 'unknown'}</code>
                    <span className="mt-1 block">Deployed {fullDate(deploymentVersion.backend?.deployed_at ?? '')}</span>
                  </p>
                </div>
                <p className="mt-3 text-sm text-glass-foreground"><span className="font-medium">Remediation handoff:</span> {deploymentAlert.remediation}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void deploymentVersion.refetch()} disabled={deploymentVersion.isFetching}>
              {deploymentVersion.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Recheck revisions
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {triageCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => navigate(card.route)}
            className="rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 sm:p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <card.icon className={`h-4 w-4 ${card.tone}`} />
            </div>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${card.tone}`}>{compactNumber(card.value)}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{card.context}</p>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <MonitoringProcessHud
          entries={processHudQuery.entries}
          isLoading={processHudQuery.isLoading}
          error={processHudError}
          emptyReason={processHudEmptyReason}
          mode="dashboard"
          maxEntries={30}
          onRetry={() => processHudQuery.refetch()}
          onOpenPost={(tweetId) => navigate(`/monitoring?search=${encodeURIComponent(tweetId)}`)}
        />

        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-display text-glass-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Limits & Trace Guard
            </CardTitle>
            <CardDescription>Cost, hosted export cap, and pipeline posture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">OpenAI 24h</p>
                <p className="text-lg font-semibold tabular-nums">{compactNumber(openAiUsage.totalTokens)}</p>
                <p className="truncate text-xs text-muted-foreground">{compactNumber(openAiUsage.measuredJobs)} jobs</p>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">AI calls</p>
                <p className={processObservability.failedAiCalls24h > 0 ? 'text-lg font-semibold text-destructive tabular-nums' : 'text-lg font-semibold tabular-nums'}>
                  {compactNumber(processObservability.aiCalls24h)}
                </p>
                <p className="truncate text-xs text-muted-foreground">{compactNumber(processObservability.failedAiCalls24h)} failed</p>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">X budget</p>
                <p className={xLocalUsage.budgetUsedPct >= 90 ? 'text-lg font-semibold text-destructive tabular-nums' : xLocalUsage.budgetUsedPct >= 70 ? 'text-lg font-semibold text-warning tabular-nums' : 'text-lg font-semibold text-success tabular-nums'}>
                  {xLocalUsage.budgetUsedPct}%
                </p>
                <p className="truncate text-xs text-muted-foreground">{compactNumber(xLocalUsage.monthlyPosts)} / {compactNumber(xLocalUsage.monthlyBudget)}</p>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Ingest</p>
                <p className={heartbeat.state === 'critical' ? 'text-lg font-semibold text-destructive' : heartbeat.state === 'warning' ? 'text-lg font-semibold text-warning' : 'text-lg font-semibold text-success'}>
                  {heartbeat.state}
                </p>
                <p className="truncate text-xs text-muted-foreground">{formatAge(heartbeat.ageSeconds)} ago</p>
              </div>
            </div>

            <div className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Hosted Foglamp cap</span>
                <span className={`font-medium tabular-nums ${foglampTone}`}>
                  {compactNumber(processObservability.foglamp.estimatedSpansUsed)} / {compactNumber(processObservability.foglamp.monthlySpanCap)}
                </span>
              </div>
              <Progress value={foglampPct} className="mt-2 h-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                Native HUD remains local when hosted export is capped or off.
              </p>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
              {latestProcessRun ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-glass-foreground">{latestProcessRun.workflowName}</span>
                    <Badge variant="secondary" className="shrink-0">{latestProcessRun.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {joinParts([
                      latestProcessRun.sourceFunction,
                      latestProcessRun.durationSeconds == null ? null : formatSeconds(latestProcessRun.durationSeconds),
                    ]) || 'Latest workflow run'}
                  </p>
                </div>
              ) : (
                <span className="text-muted-foreground">No observed workflow runs in the window.</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-display text-glass-foreground">
                  <Gauge className="h-5 w-5 text-primary" />
                  Pipeline Speed
                </CardTitle>
                <CardDescription>Six-hour latency and worker timing.</CardDescription>
              </div>
              {!systemPerformance.success && (
                <Badge variant="outline" className="border-warning/40 text-warning">Diagnostics partial</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {speedMetrics.map((metric) => (
              <div key={metric.label} className="rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <metric.icon className="h-4 w-4 text-primary" />
                  {metric.help ? (
                    <MetricHelp description={metric.help}>{metric.label}</MetricHelp>
                  ) : metric.label}
                </div>
                <p className={cn('mt-2 text-xl font-semibold tabular-nums', metric.tone)}>{metric.value}</p>
                <p className="truncate text-xs text-muted-foreground">{metric.note}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-display text-glass-foreground">
              <HardDrive className="h-5 w-5 text-primary" />
              Resource Risk
            </CardTitle>
            <CardDescription>Quota pressure, duplicate work, and tuning counters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {resourceMetrics.map((metric) => (
                <div key={metric.label} className="rounded-md border border-border/60 p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <metric.icon className="h-4 w-4 text-primary" />
                    {metric.help ? (
                      <MetricHelp description={metric.help}>{metric.label}</MetricHelp>
                    ) : metric.label}
                  </div>
                  <p className={cn('mt-2 text-xl font-semibold tabular-nums', metric.tone)}>{metric.value}</p>
                  <p className="truncate text-xs text-muted-foreground">{metric.note}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-glass-foreground">Lane pressure</p>
                <span className={cn('text-sm font-semibold', quotaTone(systemPerformance.resources.edgeCronUsedPct))}>
                  {systemPerformance.resources.edgeCronUsedPct == null ? 'Estimate unavailable' : `${systemPerformance.resources.edgeCronUsedPct}% of Edge quota`}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
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
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium text-glass-foreground">Scoring Tuning</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-border/50 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    <MetricHelp description="Posts auto-approved by the regional escalation policy in the last 24 hours.">Regional auto 24h</MetricHelp>
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.regionalAuto24h)}</p>
                </div>
                <div className="rounded border border-border/50 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Star className="h-3.5 w-3.5 text-primary" />
                    <MetricHelp description="Global stories kept in review by pilot scoring policy in the last 24 hours.">Global pilot review</MetricHelp>
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.globalPilotReview24h)}</p>
                </div>
                <div className="rounded border border-border/50 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                    <MetricHelp description="Manual scoring changes recorded in the last 24 hours.">Manual overrides</MetricHelp>
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.manualScoreOverrides24h)}</p>
                </div>
                <div className="rounded border border-border/50 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <BarChart3 className="h-3.5 w-3.5 text-primary" />
                    <MetricHelp description="Projected monthly post lift from current scoring tuning.">Projected added/month</MetricHelp>
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums text-glass-foreground">{compactNumber(scoringTuning.projectedAddedPostsMonth)}</p>
                </div>
              </div>
              {scoringTuning.error && <p className="mt-2 text-xs text-warning">Scoring tuning diagnostics partial: {scoringTuning.error}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display text-glass-foreground">Pipeline Funnel</CardTitle>
            <CardDescription>Local stage counts with derived drop-off.</CardDescription>
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
                  <p className={cn('mt-2 text-xs', step.noteTone)}>{step.note}</p>
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

      <Tabs value={activeTab} onValueChange={setDashboardTab} className="space-y-3">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="x">X usage</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
        </TabsList>

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
            <div className="space-y-4">
              <IngestHeartbeatAlert heartbeat={heartbeat} />
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-display text-glass-foreground">
                    <DollarSign className="h-4 w-4 text-primary" />
                    OpenAI Usage
                  </CardTitle>
                  <CardDescription>Last {openAiUsage.windowHours}h from completed job metadata</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {openAiUsage.available ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {openAiTokenMetrics.map(([label, value]) => (
                          <div key={label as string} className="rounded-md border border-border/60 p-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className={(label === 'Quota failures' && (value as number) > 0) ? 'text-lg font-semibold text-destructive tabular-nums' : 'text-lg font-semibold tabular-nums'}>
                              {compactNumber(value as number)}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                        {compactNumber(openAiUsage.measuredJobs)} measured jobs - {compactNumber(openAiUsage.retryAttempts)} retry attempts
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
                      OpenAI usage unavailable{openAiUsage.error ? `: ${openAiUsage.error}` : '.'}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
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

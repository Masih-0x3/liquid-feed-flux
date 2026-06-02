import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DashboardMetrics {
  postsIngested: number;
  postsTranslated: number;
  postsDelivered: number;
  failedJobs: number;
  postsTruncated24h: number;
  postsHydrated24h: number;
  xApiCalls24h: number;
  xPosts24h: number;
  xFailed24h: number;
  xSkippedNoMedia24h: number;
  xMediaUploads24h: number;
}

export interface PipelineHealth {
  successRate: number;
  avgLatency: number;
  activeFeeds: number;
  queueSize: number;
  queueRunning: number;
  staleRunning30m: number;
  lastReconcileAt: string | null;
  isOnline: boolean;
  xSuccessRate: number;
  xMonthlyPosts: number;
  xMonthlyBudget: number;
  xBudgetUsedPct: number;
}

export type DashboardSeverity = 'ok' | 'warning' | 'critical';

export interface OpsStatus {
  severity: DashboardSeverity;
  primaryIssue: string;
  recommendedRoute: string;
  lastIngestAgeSeconds: number | null;
  staleJobCount: number;
}

export interface PipelineCounts {
  ingested: number;
  duplicateGateChecked: number | null;
  duplicateGateAvailable: boolean;
  duplicates: number | null;
  scored: number;
  needsScore: number;
  translated: number;
  telegramDelivered: number;
  xPosted: number;
  needsAttention: number;
  failedStuck: number;
  readyToDeliver: number;
  translationQueue: number;
  xFailed: number;
  staleJobs: number;
}

export interface QueueBreakdown {
  pending: number;
  running: number;
  failed24h: number;
  staleRunning: number;
  oldestPendingAgeSeconds: number | null;
  byType: Array<{
    type: string;
    lane: string;
    pending: number;
    running: number;
    failed: number;
    queueWaitP50Seconds: number | null;
    queueWaitP95Seconds: number | null;
    runP50Seconds: number | null;
    runP95Seconds: number | null;
  }>;
}

export interface XLocalUsage {
  available: boolean;
  source: 'x_api_events' | 'x_deliveries_fallback';
  attempts24h: number;
  countedAttempts24h: number;
  failedAttempts24h: number;
  posts24h: number;
  failedPosts24h: number;
  mediaUploads24h: number;
  hydrations24h: number;
  monthlyPosts: number;
  monthlyBudget: number;
  budgetUsedPct: number;
  officialUsageSynced: boolean;
}

export interface IngestHeartbeat {
  state: 'ok' | 'warning' | 'critical';
  lastPostAt: string | null;
  ageSeconds: number | null;
  warnMinutes: number;
  criticalMinutes: number;
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed' | 'warning';
  kind?: 'post' | 'job' | 'delivery' | 'x' | 'system';
  route?: string;
}

export interface StageTiming {
  count: number;
  avgSeconds: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
  p95Seconds: number | null;
}

export interface SystemPerformanceWindow {
  windowHours: number;
  sampledPosts: number;
  stages: {
    ingestToDedupe: StageTiming;
    ingestToScore: StageTiming;
    dedupeToTranslation: StageTiming;
    scoreToTranslation: StageTiming;
    ingestToTranslation: StageTiming;
    translationToTelegram: StageTiming;
    translationToX: StageTiming;
    telegramEndToEnd: StageTiming;
    xEndToEnd: StageTiming;
  };
}

export interface SystemResources {
  available: boolean;
  error: string | null;
  dbBytes: number;
  dbLimitBytes: number;
  dbUsedPct: number | null;
  tempMediaBytes: number;
  tempMediaObjects: number;
  storageLimitBytes: number;
  storageUsedPct: number | null;
  edgeMonthlyLimit: number;
  projectedCronInvocationsMonthly: number;
  edgeCronUsedPct: number | null;
  cronFailures24h: number | null;
  cronJobs: Array<Record<string, unknown>>;
  workerDispatchMode: string;
  workerCron: Record<string, unknown> | null;
  workerCadenceSeconds: number | null;
  workerCadenceWarning: boolean;
  duplicateTranslateJobs24h: number;
}

export interface SystemPerformanceSummary {
  success: boolean;
  error: string | null;
  generatedAt: string | null;
  windows: {
    sixHours: SystemPerformanceWindow;
    twentyFourHours: SystemPerformanceWindow;
  };
  queue: {
    pending: number;
    running: number;
    staleRunning: number;
    failed24h: number;
    oldestPendingAgeSeconds: number | null;
    schedulerWaitSeconds: number | null;
    byType: QueueBreakdown['byType'];
    lanePressure: Array<{
      lane: string;
      pending: number;
      running: number;
      failed: number;
      maxQueueWaitP95Seconds: number | null;
    }>;
  };
  resources: SystemResources;
}

interface RpcResult {
  metrics: {
    posts_ingested: number;
    posts_translated: number;
    posts_delivered: number;
    failed_jobs: number;
    posts_truncated_24h?: number;
    posts_hydrated_24h?: number;
    x_api_calls_24h?: number;
    x_posts_24h?: number;
    x_failed_24h?: number;
    x_skipped_no_media_24h?: number;
    x_media_uploads_24h?: number;
  };
  health: {
    success_rate: number;
    avg_latency: number;
    active_feeds: number;
    queue_size: number;
    queue_running?: number;
    queue_stale_running_30m?: number;
    last_reconcile?: {
      ran_at?: string;
      expired_leases_released?: number;
      stale_running_released?: number;
    };
    is_online: boolean;
    x_success_rate?: number;
    x_monthly_posts?: number;
    x_monthly_budget?: number;
    x_budget_used_pct?: number;
  };
  recent_posts: Array<{
    tweet_id: string;
    text_original: string | null;
    created_at: string;
    text_translated: string | null;
    account_handle: string;
  }>;
  ingest_heartbeat?: {
    state: 'ok' | 'warning' | 'critical';
    last_post_at: string | null;
    age_seconds: number | null;
    warn_minutes: number;
    critical_minutes: number;
  };
  ops_status?: {
    severity?: DashboardSeverity;
    primary_issue?: string;
    primaryIssue?: string;
    recommended_route?: string;
    recommendedRoute?: string;
    last_ingest_age_seconds?: number | null;
    lastIngestAgeSeconds?: number | null;
    stale_job_count?: number;
    staleJobCount?: number;
  };
  pipeline_counts?: Record<string, unknown>;
  queue_breakdown?: {
    pending?: number;
    running?: number;
    failed_24h?: number;
    failed24h?: number;
    stale_running?: number;
    staleRunning?: number;
    oldest_pending_age_seconds?: number | null;
    oldestPendingAgeSeconds?: number | null;
    by_type?: Array<Record<string, unknown>>;
    byType?: Array<Record<string, unknown>>;
  };
  x_local_usage?: Record<string, unknown>;
  system_performance?: Record<string, unknown>;
  activity?: Array<Record<string, unknown>>;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asSeverity(value: unknown): DashboardSeverity | null {
  return value === 'ok' || value === 'warning' || value === 'critical' ? value : null;
}

function deriveOpsStatus(metrics: DashboardMetrics, health: PipelineHealth, heartbeat: IngestHeartbeat): OpsStatus {
  if (health.staleRunning30m > 0) {
    return {
      severity: 'critical',
      primaryIssue: `${health.staleRunning30m} stale running job${health.staleRunning30m === 1 ? '' : 's'}`,
      recommendedRoute: '/monitoring?filter=failed_stuck',
      lastIngestAgeSeconds: heartbeat.ageSeconds,
      staleJobCount: health.staleRunning30m,
    };
  }
  if (metrics.xFailed24h > 0) {
    return {
      severity: 'critical',
      primaryIssue: `${metrics.xFailed24h} X failure${metrics.xFailed24h === 1 ? '' : 's'} in 24h`,
      recommendedRoute: '/monitoring?filter=x_failed',
      lastIngestAgeSeconds: heartbeat.ageSeconds,
      staleJobCount: health.staleRunning30m,
    };
  }
  if (metrics.failedJobs > 0) {
    return {
      severity: 'warning',
      primaryIssue: `${metrics.failedJobs} failed job${metrics.failedJobs === 1 ? '' : 's'} in 24h`,
      recommendedRoute: '/monitoring?filter=failed_stuck',
      lastIngestAgeSeconds: heartbeat.ageSeconds,
      staleJobCount: health.staleRunning30m,
    };
  }
  if (health.xBudgetUsedPct >= 90) {
    return {
      severity: 'warning',
      primaryIssue: `X budget estimate is at ${health.xBudgetUsedPct}%`,
      recommendedRoute: '/settings?section=x-automation',
      lastIngestAgeSeconds: heartbeat.ageSeconds,
      staleJobCount: health.staleRunning30m,
    };
  }
  if (heartbeat.state !== 'ok') {
    return {
      severity: heartbeat.state === 'critical' ? 'critical' : 'warning',
      primaryIssue: `Ingest ${heartbeat.state}`,
      recommendedRoute: '/settings',
      lastIngestAgeSeconds: heartbeat.ageSeconds,
      staleJobCount: health.staleRunning30m,
    };
  }
  return {
    severity: 'ok',
    primaryIssue: 'Pipeline is operating normally',
    recommendedRoute: '/monitoring',
    lastIngestAgeSeconds: heartbeat.ageSeconds,
    staleJobCount: health.staleRunning30m,
  };
}

function normalizeOpsStatus(input: RpcResult['ops_status'], fallback: OpsStatus): OpsStatus {
  if (!input) return fallback;
  return {
    severity: asSeverity(input.severity) ?? fallback.severity,
    primaryIssue: String(input.primary_issue ?? input.primaryIssue ?? fallback.primaryIssue),
    recommendedRoute: String(input.recommended_route ?? input.recommendedRoute ?? fallback.recommendedRoute),
    lastIngestAgeSeconds: asNullableNumber(input.last_ingest_age_seconds ?? input.lastIngestAgeSeconds) ?? fallback.lastIngestAgeSeconds,
    staleJobCount: asNumber(input.stale_job_count ?? input.staleJobCount, fallback.staleJobCount),
  };
}

function normalizePipelineCounts(input: RpcResult['pipeline_counts'], metrics: DashboardMetrics, health: PipelineHealth): PipelineCounts {
  return {
    ingested: asNumber(input?.ingested, metrics.postsIngested),
    duplicateGateChecked: input && 'duplicate_gate_checked' in input ? asNullableNumber(input.duplicate_gate_checked) : null,
    duplicateGateAvailable: Boolean(input?.duplicate_gate_available),
    duplicates: input && 'duplicates' in input ? asNullableNumber(input.duplicates) : null,
    scored: asNumber(input?.scored, Math.max(metrics.postsTranslated, metrics.postsDelivered, metrics.xPosts24h)),
    needsScore: asNumber(input?.needs_score, 0),
    translated: asNumber(input?.translated, metrics.postsTranslated),
    telegramDelivered: asNumber(input?.telegram_delivered, metrics.postsDelivered),
    xPosted: asNumber(input?.x_posted, metrics.xPosts24h),
    needsAttention: asNumber(input?.needs_attention, metrics.failedJobs + metrics.xFailed24h + health.staleRunning30m),
    failedStuck: asNumber(input?.failed_stuck, metrics.failedJobs + health.staleRunning30m),
    readyToDeliver: asNumber(input?.ready_to_deliver, 0),
    translationQueue: asNumber(input?.translation_queue, health.queueSize),
    xFailed: asNumber(input?.x_failed, metrics.xFailed24h),
    staleJobs: asNumber(input?.stale_jobs, health.staleRunning30m),
  };
}

function normalizeTiming(input: unknown): StageTiming {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    count: asNumber(row.count),
    avgSeconds: asNullableNumber(row.avg_seconds),
    p50Seconds: asNullableNumber(row.p50_seconds),
    p90Seconds: asNullableNumber(row.p90_seconds),
    p95Seconds: asNullableNumber(row.p95_seconds),
  };
}

function emptyTiming(): StageTiming {
  return { count: 0, avgSeconds: null, p50Seconds: null, p90Seconds: null, p95Seconds: null };
}

function normalizePerformanceWindow(input: unknown, windowHours: number): SystemPerformanceWindow {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const stages = row.stages && typeof row.stages === 'object' ? row.stages as Record<string, unknown> : {};
  return {
    windowHours: asNumber(row.window_hours, windowHours),
    sampledPosts: asNumber(row.sampled_posts),
    stages: {
      ingestToDedupe: normalizeTiming(stages.ingest_to_dedupe ?? emptyTiming()),
      ingestToScore: normalizeTiming(stages.ingest_to_score ?? emptyTiming()),
      dedupeToTranslation: normalizeTiming(stages.dedupe_to_translation ?? emptyTiming()),
      scoreToTranslation: normalizeTiming(stages.score_to_translation ?? emptyTiming()),
      ingestToTranslation: normalizeTiming(stages.ingest_to_translation ?? emptyTiming()),
      translationToTelegram: normalizeTiming(stages.translation_to_telegram ?? emptyTiming()),
      translationToX: normalizeTiming(stages.translation_to_x ?? emptyTiming()),
      telegramEndToEnd: normalizeTiming(stages.telegram_end_to_end ?? emptyTiming()),
      xEndToEnd: normalizeTiming(stages.x_end_to_end ?? emptyTiming()),
    },
  };
}

function normalizeSystemPerformance(input: RpcResult['system_performance']): SystemPerformanceSummary {
  const row = input && typeof input === 'object' ? input : {};
  const windows = row.windows && typeof row.windows === 'object' ? row.windows as Record<string, unknown> : {};
  const queue = row.queue && typeof row.queue === 'object' ? row.queue as Record<string, unknown> : {};
  const resources = row.resources && typeof row.resources === 'object' ? row.resources as Record<string, unknown> : {};
  const byTypeRows = Array.isArray(queue.by_type) ? queue.by_type as Array<Record<string, unknown>> : [];
  const laneRows = Array.isArray(queue.lane_pressure) ? queue.lane_pressure as Array<Record<string, unknown>> : [];
  return {
    success: row.success !== false,
    error: typeof row.error === 'string' ? row.error : null,
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
    windows: {
      sixHours: normalizePerformanceWindow(windows['6h'], 6),
      twentyFourHours: normalizePerformanceWindow(windows['24h'], 24),
    },
    queue: {
      pending: asNumber(queue.pending),
      running: asNumber(queue.running),
      staleRunning: asNumber(queue.stale_running),
      failed24h: asNumber(queue.failed_24h),
      oldestPendingAgeSeconds: asNullableNumber(queue.oldest_pending_age_seconds),
      schedulerWaitSeconds: asNullableNumber(queue.scheduler_wait_seconds),
      byType: byTypeRows.map((item) => ({
        type: String(item.type ?? 'unknown'),
        lane: String(item.lane ?? 'fast'),
        pending: asNumber(item.pending),
        running: asNumber(item.running),
        failed: asNumber(item.failed),
        queueWaitP50Seconds: asNullableNumber(item.queue_wait_p50_seconds),
        queueWaitP95Seconds: asNullableNumber(item.queue_wait_p95_seconds),
        runP50Seconds: asNullableNumber(item.run_p50_seconds),
        runP95Seconds: asNullableNumber(item.run_p95_seconds),
      })),
      lanePressure: laneRows.map((item) => ({
        lane: String(item.lane ?? 'fast'),
        pending: asNumber(item.pending),
        running: asNumber(item.running),
        failed: asNumber(item.failed),
        maxQueueWaitP95Seconds: asNullableNumber(item.max_queue_wait_p95_seconds),
      })),
    },
    resources: {
      available: resources.available !== false,
      error: typeof resources.error === 'string' ? resources.error : null,
      dbBytes: asNumber(resources.db_bytes),
      dbLimitBytes: asNumber(resources.db_limit_bytes, 500_000_000),
      dbUsedPct: asNullableNumber(resources.db_used_pct),
      tempMediaBytes: asNumber(resources.temp_media_bytes),
      tempMediaObjects: asNumber(resources.temp_media_objects),
      storageLimitBytes: asNumber(resources.storage_limit_bytes, 1_000_000_000),
      storageUsedPct: asNullableNumber(resources.storage_used_pct),
      edgeMonthlyLimit: asNumber(resources.edge_monthly_limit, 500_000),
      projectedCronInvocationsMonthly: asNumber(resources.projected_cron_invocations_monthly),
      edgeCronUsedPct: asNullableNumber(resources.edge_cron_used_pct),
      cronFailures24h: asNullableNumber(resources.cron_failures_24h),
      cronJobs: Array.isArray(resources.cron_jobs) ? resources.cron_jobs as Array<Record<string, unknown>> : [],
      workerDispatchMode: String(resources.worker_dispatch_mode ?? 'event-driven + cron fallback'),
      workerCron: resources.worker_cron && typeof resources.worker_cron === 'object' ? resources.worker_cron as Record<string, unknown> : null,
      workerCadenceSeconds: asNullableNumber(resources.worker_cadence_seconds),
      workerCadenceWarning: resources.worker_cadence_warning === true,
      duplicateTranslateJobs24h: asNumber(resources.duplicate_translate_jobs_24h),
    },
  };
}

function normalizeQueueBreakdown(input: RpcResult['queue_breakdown'], metrics: DashboardMetrics, health: PipelineHealth): QueueBreakdown {
  const rows = input?.by_type ?? input?.byType ?? [];
  return {
    pending: asNumber(input?.pending, health.queueSize),
    running: asNumber(input?.running, health.queueRunning),
    failed24h: asNumber(input?.failed_24h ?? input?.failed24h, metrics.failedJobs),
    staleRunning: asNumber(input?.stale_running ?? input?.staleRunning, health.staleRunning30m),
    oldestPendingAgeSeconds: asNullableNumber(input?.oldest_pending_age_seconds ?? input?.oldestPendingAgeSeconds),
    byType: rows.map((row) => ({
      type: String(row.type ?? 'unknown'),
      lane: String(row.lane ?? 'fast'),
      pending: asNumber(row.pending),
      running: asNumber(row.running),
      failed: asNumber(row.failed),
      queueWaitP50Seconds: asNullableNumber(row.queue_wait_p50_seconds),
      queueWaitP95Seconds: asNullableNumber(row.queue_wait_p95_seconds),
      runP50Seconds: asNullableNumber(row.run_p50_seconds),
      runP95Seconds: asNullableNumber(row.run_p95_seconds),
    })),
  };
}

function normalizeXLocalUsage(input: RpcResult['x_local_usage'], metrics: DashboardMetrics, health: PipelineHealth): XLocalUsage {
  const source = input?.source === 'x_api_events' ? 'x_api_events' : 'x_deliveries_fallback';
  return {
    available: input?.available === true,
    source,
    attempts24h: asNumber(input?.attempts_24h, metrics.xApiCalls24h),
    countedAttempts24h: asNumber(input?.counted_attempts_24h, metrics.xApiCalls24h),
    failedAttempts24h: asNumber(input?.failed_attempts_24h, metrics.xFailed24h),
    posts24h: asNumber(input?.posts_24h, metrics.xPosts24h),
    failedPosts24h: asNumber(input?.failed_posts_24h, metrics.xFailed24h),
    mediaUploads24h: asNumber(input?.media_uploads_24h, metrics.xMediaUploads24h),
    hydrations24h: asNumber(input?.hydrations_24h, metrics.postsHydrated24h),
    monthlyPosts: asNumber(input?.monthly_posts, health.xMonthlyPosts),
    monthlyBudget: asNumber(input?.monthly_budget, health.xMonthlyBudget),
    budgetUsedPct: asNumber(input?.budget_used_pct, health.xBudgetUsedPct),
    officialUsageSynced: input?.official_usage_synced === true,
  };
}

function normalizeActivity(rpc: RpcResult): ActivityItem[] {
  if (Array.isArray(rpc.activity) && rpc.activity.length > 0) {
    return rpc.activity.map((item, index) => ({
      id: String(item.id ?? `${item.kind ?? 'activity'}-${index}`),
      title: String(item.title ?? 'Pipeline event'),
      description: String(item.description ?? ''),
      timestamp: String(item.timestamp ?? new Date().toISOString()),
      status: item.status === 'failed' || item.status === 'warning' || item.status === 'success' || item.status === 'pending' ? item.status : 'pending',
      kind: item.kind === 'job' || item.kind === 'delivery' || item.kind === 'x' || item.kind === 'system' ? item.kind : 'post',
      route: typeof item.route === 'string' ? item.route : undefined,
    }));
  }

  return (rpc.recent_posts || []).map(post => ({
    id: post.tweet_id,
    title: `New post from @${post.account_handle || 'unknown'}`,
    description: (post.text_original?.substring(0, 100) || 'No content') + '...',
    timestamp: post.created_at,
    status: post.text_translated ? 'success' as const : 'pending' as const,
    kind: 'post' as const,
    route: `/monitoring?search=${encodeURIComponent(post.tweet_id)}`,
  }));
}

async function fetchDashboard() {
  let rpc: RpcResult;

  try {
    const { data, error } = await supabase.functions.invoke('admin-actions', {
      body: { action: 'get_dashboard_summary' },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Failed to load dashboard summary');
    rpc = data.dashboard as unknown as RpcResult;
  } catch (edgeError) {
    // Local UI can run ahead of the deployed admin-actions function. The direct
    // RPC is the older, read-only dashboard path and keeps the dashboard usable.
    const { data, error } = await supabase.rpc('get_dashboard_summary');
    if (error) {
      const edgeMessage = edgeError instanceof Error ? edgeError.message : String(edgeError);
      throw new Error(`Dashboard summary unavailable. Admin action failed: ${edgeMessage}; RPC fallback failed: ${error.message}`);
    }
    rpc = data as unknown as RpcResult;
  }

  const metrics: DashboardMetrics = {
    postsIngested: rpc.metrics.posts_ingested,
    postsTranslated: rpc.metrics.posts_translated,
    postsDelivered: rpc.metrics.posts_delivered,
    failedJobs: rpc.metrics.failed_jobs,
    postsTruncated24h: rpc.metrics.posts_truncated_24h ?? 0,
    postsHydrated24h: rpc.metrics.posts_hydrated_24h ?? 0,
    xApiCalls24h: rpc.metrics.x_api_calls_24h ?? 0,
    xPosts24h: rpc.metrics.x_posts_24h ?? 0,
    xFailed24h: rpc.metrics.x_failed_24h ?? 0,
    xSkippedNoMedia24h: rpc.metrics.x_skipped_no_media_24h ?? 0,
    xMediaUploads24h: rpc.metrics.x_media_uploads_24h ?? 0,
  };

  const health: PipelineHealth = {
    successRate: rpc.health.success_rate,
    avgLatency: rpc.health.avg_latency,
    activeFeeds: rpc.health.active_feeds,
    queueSize: rpc.health.queue_size,
    queueRunning: rpc.health.queue_running ?? 0,
    staleRunning30m: rpc.health.queue_stale_running_30m ?? 0,
    lastReconcileAt: rpc.health.last_reconcile?.ran_at ?? null,
    isOnline: rpc.health.is_online,
    xSuccessRate: rpc.health.x_success_rate ?? 100,
    xMonthlyPosts: rpc.health.x_monthly_posts ?? 0,
    xMonthlyBudget: rpc.health.x_monthly_budget ?? 2500,
    xBudgetUsedPct: rpc.health.x_budget_used_pct ?? 0,
  };

  const hb = rpc.ingest_heartbeat;
  const heartbeat: IngestHeartbeat = {
    state: hb?.state ?? 'ok',
    lastPostAt: hb?.last_post_at ?? null,
    ageSeconds: hb?.age_seconds ?? null,
    warnMinutes: hb?.warn_minutes ?? 120,
    criticalMinutes: hb?.critical_minutes ?? 360,
  };

  const fallbackOps = deriveOpsStatus(metrics, health, heartbeat);
  const opsStatus = normalizeOpsStatus(rpc.ops_status, fallbackOps);
  const pipelineCounts = normalizePipelineCounts(rpc.pipeline_counts, metrics, health);
  const queueBreakdown = normalizeQueueBreakdown(rpc.queue_breakdown, metrics, health);
  const xLocalUsage = normalizeXLocalUsage(rpc.x_local_usage, metrics, health);
  const systemPerformance = normalizeSystemPerformance(rpc.system_performance);
  const activities = normalizeActivity(rpc);

  return { metrics, health, activities, heartbeat, opsStatus, pipelineCounts, queueBreakdown, xLocalUsage, systemPerformance };
}

export function useDashboardData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }, 2000);
  }, [queryClient]);

  useEffect(() => {
    // Only subscribe to posts to reduce realtime I/O. Jobs/deliveries churn too fast
    // and the dashboard refetches on the posts signal anyway.
    const ch1 = supabase.channel('dash-posts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe();
    return () => {
      supabase.removeChannel(ch1);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return query;
}

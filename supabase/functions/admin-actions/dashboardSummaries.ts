import {
  getPayloadTweetId,
  isFailedJobActionable,
  isMissingSchemaError,
  loadPostsByJobReferences,
  monitoringPolicyRuleKind,
  postForJob,
} from "./readHelpers.ts";
import { getFoglampBudgetSettings } from "../_shared/observability.ts";
import {
  cronCadenceSeconds,
  estimateMonthlyRuns,
  percentUsed,
} from "./dashboardResourceMetrics.ts";
export { cronCadenceSeconds, estimateMonthlyRuns, percentUsed };

const DEFAULT_STORAGE_LIMIT_BYTES = 100_000_000_000;

type DashboardRowsResult = {
  data: Array<Record<string, unknown>> | null;
  error: unknown | null;
};

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function errorMessage(_error: unknown): string {
  return "dashboard_query_failed";
}

function checkedDashboardRows(
  value: unknown,
  section: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((row) =>
    !row || typeof row !== "object" || Array.isArray(row)
  )) {
    throw new Error(`${section}_invalid_response`);
  }
  return value as Array<Record<string, unknown>>;
}

function logDashboardFallback(section: string, error: unknown) {
  console.error("[admin-actions] dashboard section failed", {
    section,
    error: errorMessage(error),
  });
}

export async function withDashboardFallback<T>(
  section: string,
  value: Promise<T>,
  fallback: T | ((error: unknown) => T),
): Promise<T> {
  try {
    return await value;
  } catch (error) {
    logDashboardFallback(section, error);
    return typeof fallback === "function"
      ? (fallback as (error: unknown) => T)(error)
      : fallback;
  }
}

export async function checkedDashboardRowsQuery(
  value: Promise<DashboardRowsResult>,
): Promise<DashboardRowsResult> {
  const result = await value;
  if (result.error) throw result.error;
  return { data: checkedDashboardRows(result.data, "dashboard_rows"), error: null };
}

function emptyDashboardRowsResult(): DashboardRowsResult {
  return { data: [], error: null };
}

function degradedDashboardBase(error: unknown): Record<string, unknown> {
  return {
    metrics: {
      posts_ingested: 0,
      posts_translated: 0,
      posts_delivered: 0,
      failed_jobs: 0,
      posts_truncated_24h: 0,
      posts_hydrated_24h: 0,
      x_api_calls_24h: 0,
      x_posts_24h: 0,
      x_failed_24h: 0,
      x_skipped_no_media_24h: 0,
      x_media_uploads_24h: 0,
    },
    health: {
      success_rate: 0,
      avg_latency: 0,
      active_feeds: 0,
      queue_size: 0,
      queue_running: 0,
      queue_stale_running_30m: 0,
      is_online: false,
      x_success_rate: 0,
      x_monthly_posts: 0,
      x_monthly_budget: 2500,
      x_budget_used_pct: 0,
    },
    recent_posts: [],
    ingest_heartbeat: {
      state: "critical",
      last_post_at: null,
      age_seconds: null,
      warn_minutes: 120,
      critical_minutes: 360,
    },
    dashboard_error: errorMessage(error),
  };
}

function intervalAgeSeconds(timestamp: unknown): number | null {
  if (typeof timestamp !== "string") return null;
  const ms = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

async function hasDedupePostColumns(supabase: any): Promise<boolean> {
  const { error } = await supabase.from("posts").select("dedupe_status", {
    head: true,
    count: "exact",
  }).limit(1);
  if (error && isMissingSchemaError(error)) return false;
  if (error) throw error;
  return true;
}

async function loadDashboardPosts(
  supabase: any,
  since: string,
  dedupeAvailable: boolean,
) {
  const select = [
    "tweet_id",
    "text_original",
    "text_translated",
    "created_at",
    "delivery_decision",
    "final_score",
    "importance_score",
    "dup_of_tweet_id",
    "is_truncated",
    "hydrated_at",
    ...(dedupeAvailable ? ["dedupe_status"] : []),
  ].join(", ");
  const { data, error } = await supabase
    .from("posts")
    .select(select)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) throw error;
  return checkedDashboardRows(data, "dashboard_posts");
}

export function queueLaneForType(type: string): "fast" | "model" | "delivery" {
  if (["translate", "enrich"].includes(type)) return "model";
  if (type === "deliver") return "delivery";
  return "fast";
}

export function summarizeLanePressure(
  byType: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const lanes = new Map<
    string,
    {
      lane: string;
      pending: number;
      running: number;
      failed: number;
      queueWaitP95: Array<number | null>;
    }
  >();
  for (const row of byType) {
    const lane = typeof row.lane === "string"
      ? row.lane
      : queueLaneForType(String(row.type ?? "unknown"));
    if (!lanes.has(lane)) {
      lanes.set(lane, {
        lane,
        pending: 0,
        running: 0,
        failed: 0,
        queueWaitP95: [],
      });
    }
    const item = lanes.get(lane)!;
    item.pending += num(row.pending);
    item.running += num(row.running);
    item.failed += num(row.failed);
    item.queueWaitP95.push(
      typeof row.queue_wait_p95_seconds === "number"
        ? row.queue_wait_p95_seconds
        : null,
    );
  }
  return [...lanes.values()].map((lane) => ({
    lane: lane.lane,
    pending: lane.pending,
    running: lane.running,
    failed: lane.failed,
    max_queue_wait_p95_seconds: Math.max(
      0,
      ...lane.queueWaitP95.filter((value): value is number =>
        typeof value === "number" && Number.isFinite(value)
      ),
    ),
  }));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nestedNumber(row: Record<string, unknown>, path: string[]): number {
  let current: unknown = row;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return 0;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

function hasOpenAiUsage(meta: Record<string, unknown>): boolean {
  return Boolean(
    meta.translation_usage || meta.scoring_usage || meta.scoring_v2_usage ||
      meta.usage,
  );
}

export function summarizeOpenAiUsageJobs(
  rows: Array<Record<string, unknown>>,
  windowHours = 24,
): Record<string, unknown> {
  let measuredJobs = 0;
  let translateJobs = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let scoringTokens = 0;
  let adjudicationTokens = 0;
  let translationTokens = 0;
  let reasoningTokens = 0;
  let retryAttempts = 0;
  let quotaFailedJobs = 0;

  for (const row of rows) {
    const meta = recordValue(row.result_meta);
    if (hasOpenAiUsage(meta)) measuredJobs += 1;
    if (row.type === "translate" && row.status === "completed") {
      translateJobs += 1;
    }
    retryAttempts += Math.max(0, num(row.attempts) - 1);
    const errorText = `${String(row.last_error ?? "")} ${
      String(meta.error ?? "")
    }`.toLowerCase();
    if (
      errorText.includes("insufficient_quota") ||
      errorText.includes("exceeded your current quota")
    ) quotaFailedJobs += 1;

    const scoring = recordValue(recordValue(meta.scoring_v2_usage).scoring);
    const adjudication = recordValue(
      recordValue(meta.scoring_v2_usage).adjudication,
    );
    const translation = recordValue(meta.translation_usage);
    const legacyScoring = recordValue(meta.scoring_usage);
    const legacyUsage = recordValue(meta.usage);

    const scoringTotal = num(scoring.total_tokens) ||
      num(legacyScoring.total_tokens);
    const adjudicationTotal = num(adjudication.total_tokens);
    const translationTotal = num(translation.total_tokens);
    const legacyTotal = !translationTotal && !scoringTotal && !adjudicationTotal
      ? num(legacyUsage.total_tokens)
      : 0;

    scoringTokens += scoringTotal;
    adjudicationTokens += adjudicationTotal;
    translationTokens += translationTotal;
    totalTokens += scoringTotal + adjudicationTotal + translationTotal +
      legacyTotal;
    inputTokens += num(scoring.prompt_tokens) +
      num(adjudication.prompt_tokens) + num(translation.input_tokens) +
      num(legacyScoring.prompt_tokens) + num(legacyUsage.prompt_tokens);
    outputTokens += num(scoring.completion_tokens) +
      num(adjudication.completion_tokens) + num(translation.output_tokens) +
      num(legacyScoring.completion_tokens) + num(legacyUsage.completion_tokens);
    reasoningTokens += nestedNumber(translation, [
      "output_tokens_details",
      "reasoning_tokens",
    ]);
  }

  return {
    available: true,
    window_hours: windowHours,
    measured_jobs: measuredJobs,
    translate_jobs: translateJobs,
    total_tokens: Math.round(totalTokens),
    input_tokens: Math.round(inputTokens),
    output_tokens: Math.round(outputTokens),
    scoring_tokens: Math.round(scoringTokens),
    adjudication_tokens: Math.round(adjudicationTokens),
    translation_tokens: Math.round(translationTokens),
    reasoning_tokens: Math.round(reasoningTokens),
    quota_failed_jobs: quotaFailedJobs,
    retry_attempts: retryAttempts,
  };
}

async function loadOpenAiUsageSummary(supabase: any, since: string) {
  const { data, error } = await supabase
    .from("jobs")
    .select("type, status, attempts, last_error, result_meta, created_at")
    .in("type", ["translate", "enrich"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return summarizeOpenAiUsageJobs(
    checkedDashboardRows(data, "dashboard_openai_usage"),
    24,
  );
}

function currentPeriodKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function pct(value: number, max: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapRecentWorkflowRun(row: Record<string, unknown>) {
  const metadata = recordValue(row.metadata);
  return {
    run_key: String(row.run_key ?? ""),
    workflow_name: String(row.workflow_name ?? "unknown"),
    workflow_run_id: typeof row.workflow_run_id === "string"
      ? row.workflow_run_id
      : null,
    status: String(row.status ?? "unknown"),
    source: typeof row.source === "string" ? row.source : null,
    source_function: typeof row.source_function === "string"
      ? row.source_function
      : null,
    subject_type: typeof row.subject_type === "string"
      ? row.subject_type
      : null,
    subject_id: typeof row.subject_id === "string" ? row.subject_id : null,
    started_at: typeof row.started_at === "string" ? row.started_at : null,
    ended_at: typeof row.ended_at === "string" ? row.ended_at : null,
    duration_seconds: durationSeconds(row.started_at, row.ended_at),
    last_error: typeof row.last_error === "string" ? row.last_error : null,
    used_filter: metadata.used_filter === true ||
      metadata.content_filter_enabled === true,
  };
}

async function loadProcessObservabilitySummary(
  supabase: any,
  since: string,
): Promise<Record<string, unknown>> {
  const periodKey = currentPeriodKey();
  const [
    { data: runRows, error: runError },
    { data: callRows, error: callError },
    { data: budgetRows, error: budgetError },
  ] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select(
        "run_key, workflow_name, workflow_run_id, status, source, source_function, subject_type, subject_id, started_at, ended_at, last_error, metadata",
      )
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(25),
    supabase
      .from("ai_call_ledger")
      .select(
        "workflow_run_key, trace_name, operation_name, agent_name, model, endpoint, status, total_tokens, reasoning_tokens, duration_ms, started_at, ended_at, foglamp_exported, foglamp_span_estimate, foglamp_skip_reason, error_message",
      )
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500),
    supabase
      .from("budget_ledger")
      .select("provider, unit, quantity, period_key, metadata, created_at")
      .eq("period_key", periodKey)
      .in("provider", ["foglamp", "openai"])
      .limit(10000),
  ]);

  if (runError) throw runError;
  if (callError) throw callError;
  if (budgetError) throw budgetError;

  const runs = checkedDashboardRows(runRows, "dashboard_workflow_runs");
  const calls = checkedDashboardRows(callRows, "dashboard_ai_call_ledger");
  const budgets = checkedDashboardRows(budgetRows, "dashboard_budget_ledger");
  const settings = getFoglampBudgetSettings();
  const durationSummary = summarizeDurations(
    calls.map((row) => {
      const ms = num(row.duration_ms, Number.NaN);
      return Number.isFinite(ms) ? ms / 1000 : null;
    }),
  );

  const activeRuns =
    runs.filter((row) => row.status === "running" || row.status === "pending")
      .length;
  const failedRuns = runs.filter((row) => row.status === "failed").length;
  const completedRuns = runs.filter((row) => row.status === "completed").length;
  const failedCalls = calls.filter((row) => row.status === "failed").length;
  const totalTokens = calls.reduce(
    (sum, row) => sum + num(row.total_tokens),
    0,
  );
  const reasoningTokens = calls.reduce(
    (sum, row) => sum + num(row.reasoning_tokens),
    0,
  );
  const foglampSpansUsed = budgets
    .filter((row) =>
      row.provider === "foglamp" && row.unit === "estimated_span"
    )
    .reduce((sum, row) => sum + numeric(row.quantity), 0);
  const foglampSpansSkipped = budgets
    .filter((row) =>
      row.provider === "foglamp" && row.unit === "estimated_span_skipped"
    )
    .reduce((sum, row) => sum + numeric(row.quantity), 0);
  const openAiTokensThisMonth = budgets
    .filter((row) => row.provider === "openai" && row.unit === "token")
    .reduce((sum, row) => sum + numeric(row.quantity), 0);

  return {
    available: true,
    window_hours: 24,
    active_runs: activeRuns,
    completed_runs_24h: completedRuns,
    failed_runs_24h: failedRuns,
    ai_calls_24h: calls.length,
    failed_ai_calls_24h: failedCalls,
    total_tokens_24h: Math.round(totalTokens),
    reasoning_tokens_24h: Math.round(reasoningTokens),
    ai_call_p95_seconds: durationSummary.p95_seconds,
    latest_run: runs[0] ? mapRecentWorkflowRun(runs[0]) : null,
    recent_runs: runs.slice(0, 8).map(mapRecentWorkflowRun),
    foglamp: {
      hosted_export_enabled: settings.enabled && settings.hasApiKey,
      has_api_key: settings.hasApiKey,
      monthly_span_limit: settings.monthlySpanLimit,
      monthly_span_cap: settings.monthlySpanCap,
      monthly_span_warn: settings.monthlySpanWarn,
      estimated_spans_used: Math.round(foglampSpansUsed),
      estimated_spans_skipped: Math.round(foglampSpansSkipped),
      cap_used_pct: pct(foglampSpansUsed, settings.monthlySpanCap),
      warning: settings.monthlySpanCap > 0 &&
        foglampSpansUsed >= settings.monthlySpanWarn,
      stopped: settings.monthlySpanCap > 0 &&
        foglampSpansUsed >= settings.monthlySpanCap,
    },
    openai_tokens_month_to_date: Math.round(openAiTokensThisMonth),
  };
}

async function loadDashboardQueueBreakdown(
  supabase: any,
  since: string,
  staleCutoff: string,
) {
  const [{ data: jobs, error }, { data: activeJobs, error: activeError }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "type, status, created_at, started_at, locked_at, completed_at, lease_expires_at, payload, result_meta, idempotency_key",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("jobs")
        .select("type, status, created_at, locked_at, lease_expires_at")
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: true })
        .limit(5000),
    ]);
  if (error) throw error;
  if (activeError) throw activeError;

  const rows = checkedDashboardRows(jobs, "dashboard_jobs");
  const activeRows = checkedDashboardRows(activeJobs, "dashboard_active_jobs");
  const postByRef = await loadPostsByJobReferences(
    supabase,
    rows.filter((row) => row.status === "failed"),
  );
  const byType = new Map<string, {
    type: string;
    lane: string;
    pending: number;
    running: number;
    failed: number;
    resolvedFailed: number;
    queueWaits: number[];
    runs: number[];
  }>();
  const ensure = (type: unknown) => {
    const key = typeof type === "string" && type ? type : "unknown";
    if (!byType.has(key)) {
      byType.set(key, {
        type: key,
        lane: queueLaneForType(key),
        pending: 0,
        running: 0,
        failed: 0,
        resolvedFailed: 0,
        queueWaits: [],
        runs: [],
      });
    }
    return byType.get(key)!;
  };

  let failed24h = 0;
  let resolvedFailed24h = 0;
  for (const row of rows) {
    const item = ensure(row.type);
    const meta = row.result_meta && typeof row.result_meta === "object"
      ? row.result_meta as Record<string, unknown>
      : {};
    const queueWaitMs = typeof meta.queue_wait_ms === "number"
      ? meta.queue_wait_ms
      : durationSeconds(row.created_at, row.started_at ?? row.locked_at) != null
      ? Number(
        durationSeconds(row.created_at, row.started_at ?? row.locked_at),
      ) * 1000
      : null;
    const runMs = typeof meta.worker_run_ms === "number"
      ? meta.worker_run_ms
      : durationSeconds(row.started_at ?? row.locked_at, row.completed_at) !=
          null
      ? Number(
        durationSeconds(row.started_at ?? row.locked_at, row.completed_at),
      ) * 1000
      : null;
    if (queueWaitMs != null && Number.isFinite(queueWaitMs)) {
      item.queueWaits.push(queueWaitMs / 1000);
    }
    if (runMs != null && Number.isFinite(runMs)) item.runs.push(runMs / 1000);
    if (
      row.status === "failed" &&
      isFailedJobActionable(row, postForJob(row, postByRef))
    ) {
      item.failed += 1;
      failed24h += 1;
    } else if (row.status === "failed") {
      item.resolvedFailed += 1;
      resolvedFailed24h += 1;
    }
  }

  let pending = 0;
  let running = 0;
  let staleRunning = 0;
  let oldestPendingAgeSeconds: number | null = null;
  for (const row of activeRows) {
    const item = ensure(row.type);
    if (row.status === "pending") {
      pending += 1;
      item.pending += 1;
      const age = intervalAgeSeconds(row.created_at);
      if (age != null) {
        oldestPendingAgeSeconds = Math.max(oldestPendingAgeSeconds ?? 0, age);
      }
    }
    if (row.status === "running") {
      running += 1;
      item.running += 1;
      const leaseExpired = typeof row.lease_expires_at === "string" &&
        row.lease_expires_at < new Date().toISOString();
      const lockedStale = typeof row.lease_expires_at !== "string" &&
        typeof row.locked_at === "string" &&
        row.locked_at < staleCutoff;
      if (leaseExpired || lockedStale) staleRunning += 1;
    }
  }

  return {
    pending,
    running,
    failed_24h: failed24h,
    resolved_failed_24h: resolvedFailed24h,
    stale_running: staleRunning,
    oldest_pending_age_seconds: oldestPendingAgeSeconds,
    by_type: [...byType.values()]
      .map((item) => {
        const queueSummary = summarizeDurations(item.queueWaits);
        const runSummary = summarizeDurations(item.runs);
        return {
          type: item.type,
          lane: item.lane,
          pending: item.pending,
          running: item.running,
          failed: item.failed,
          resolved_failed: item.resolvedFailed,
          queue_wait_p50_seconds: queueSummary.p50_seconds,
          queue_wait_p95_seconds: queueSummary.p95_seconds,
          run_p50_seconds: runSummary.p50_seconds,
          run_p95_seconds: runSummary.p95_seconds,
        };
      })
      .sort((a, b) =>
        (b.pending + b.running + b.failed) - (a.pending + a.running + a.failed)
      )
      .slice(0, 8),
  };
}

function xDeliveryTime(row: Record<string, unknown>): number {
  const raw = typeof row.posted_at === "string"
    ? row.posted_at
    : row.created_at;
  const time = typeof raw === "string" ? new Date(raw).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

export function latestXDeliveriesByPost(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const postId = String(row.post_id ?? "");
    if (!postId) continue;
    const existing = latest.get(postId);
    if (!existing || xDeliveryTime(row) > xDeliveryTime(existing)) {
      latest.set(postId, row);
    }
  }
  return [...latest.values()];
}

async function loadDashboardXLocalUsage(
  supabase: any,
  base: Record<string, unknown>,
  since: string,
) {
  const xPosting =
    (base.x_posting && typeof base.x_posting === "object"
      ? base.x_posting
      : {}) as Record<string, unknown>;
  const metrics =
    (base.metrics && typeof base.metrics === "object"
      ? base.metrics
      : {}) as Record<string, unknown>;
  const health =
    (base.health && typeof base.health === "object"
      ? base.health
      : {}) as Record<string, unknown>;

  const [
    { data: xRows, error: xError },
    { data: eventRows, error: eventError },
  ] = await Promise.all([
    supabase
      .from("x_deliveries")
      .select("post_id, status, media_count, created_at, posted_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("x_api_events")
      .select(
        "endpoint, ok, request_counted, estimated_billable_unit, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (xError) throw xError;

  const deliveries = checkedDashboardRows(xRows, "dashboard_x_deliveries");
  const latestDeliveries = latestXDeliveriesByPost(deliveries);
  const posts24h = new Set(
    deliveries.filter((row) => row.status === "posted").map((row) =>
      row.post_id
    ).filter(Boolean),
  ).size;
  const failedDeliveryRows24h =
    deliveries.filter((row) => row.status === "failed").length;
  const failedPosts24h =
    latestDeliveries.filter((row) => row.status === "failed").length;
  const mediaUploads24h = deliveries.reduce(
    (sum, row) => sum + num(row.media_count),
    0,
  );

  if (eventError && !isMissingSchemaError(eventError)) throw eventError;
  const eventsAvailable = !eventError;
  const events = eventsAvailable
    ? checkedDashboardRows(eventRows, "dashboard_x_api_events")
    : [];
  const attempts = events.length;
  const counted = events.filter((row) => row.request_counted !== false).length;
  const failedAttempts = events.filter((row) => row.ok === false).length;
  const hydrations = events.filter((row) => {
    const endpoint = String(row.endpoint ?? "");
    const unit = String(row.estimated_billable_unit ?? "");
    return unit === "read" || endpoint.includes("/2/tweets");
  }).length;

  return {
    available: eventsAvailable,
    source: eventsAvailable ? "x_api_events" : "x_deliveries_fallback",
    attempts_24h: eventsAvailable ? attempts : num(metrics.x_api_calls_24h),
    counted_attempts_24h: eventsAvailable
      ? counted
      : num(metrics.x_api_calls_24h),
    failed_attempts_24h: eventsAvailable
      ? failedAttempts
      : failedDeliveryRows24h,
    posts_24h: posts24h || num(xPosting.posted_24h),
    failed_posts_24h: failedPosts24h,
    media_uploads_24h: mediaUploads24h || num(xPosting.media_uploads_24h),
    hydrations_24h: eventsAvailable
      ? hydrations
      : num(metrics.posts_hydrated_24h),
    monthly_posts: num(xPosting.monthly_posts, num(health.x_monthly_posts)),
    monthly_budget: num(
      xPosting.monthly_budget,
      num(health.x_monthly_budget, 2500),
    ),
    budget_used_pct: num(
      xPosting.budget_used_pct,
      num(health.x_budget_used_pct),
    ),
    official_usage_synced: false,
  };
}

function toTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function durationSeconds(start: unknown, end: unknown): number | null {
  const startMs = toTimeMs(start);
  const endMs = toTimeMs(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 100) / 10;
}

export function summarizeDurations(
  values: Array<number | null>,
): Record<string, unknown> {
  const sorted = values
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value)
    )
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      count: 0,
      avg_seconds: null,
      p50_seconds: null,
      p90_seconds: null,
      p95_seconds: null,
    };
  }
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    avg_seconds: Math.round(avg * 10) / 10,
    p50_seconds: Math.round(percentile(0.5) * 10) / 10,
    p90_seconds: Math.round(percentile(0.9) * 10) / 10,
    p95_seconds: Math.round(percentile(0.95) * 10) / 10,
  };
}

function latestTimestampBySubject(
  rows: Array<Record<string, unknown>>,
  idKey: string,
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const id = String(row[idKey] ?? "");
    const timestamp = String(row.posted_at ?? row.created_at ?? "");
    if (!id || !timestamp) continue;
    const existing = latest.get(id);
    if (
      !existing || new Date(timestamp).getTime() > new Date(existing).getTime()
    ) latest.set(id, timestamp);
  }
  return latest;
}

function latestEventTimestampBySubject(
  rows: Array<Record<string, unknown>>,
  idKey: string,
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const id = String(row[idKey] ?? "");
    const timestamp = String(
      row.ended_at ?? row.started_at ?? row.created_at ?? "",
    );
    if (!id || !timestamp) continue;
    const existing = latest.get(id);
    if (
      !existing || new Date(timestamp).getTime() > new Date(existing).getTime()
    ) latest.set(id, timestamp);
  }
  return latest;
}

async function loadPerformanceWindow(supabase: any, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
    .toISOString();
  const postsRes = await supabase
    .from("posts")
    .select("tweet_id, created_at, dedupe_checked_at, translated_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (postsRes.error && !isMissingSchemaError(postsRes.error)) {
    throw postsRes.error;
  }

  const posts = postsRes.error
    ? []
    : checkedDashboardRows(postsRes.data, "dashboard_performance_posts");
  const [
    { data: deliveries, error: deliveryError },
    { data: xDeliveries, error: xError },
    { data: scoreEvents, error: scoreError },
  ] = await Promise.all([
    supabase
      .from("deliveries")
      .select("subject_id, status, created_at, posted_at")
      .eq("subject_type", "post")
      .eq("status", "posted")
      .gte("created_at", since)
      .limit(10000),
    supabase
      .from("x_deliveries")
      .select("post_id, status, created_at, posted_at")
      .eq("status", "posted")
      .gte("created_at", since)
      .limit(10000),
    supabase
      .from("pipeline_events")
      .select("subject_id, status, created_at, started_at, ended_at")
      .eq("subject_type", "post")
      .eq("step", "score")
      .in("status", ["completed", "skipped"])
      .gte("created_at", since)
      .limit(10000),
  ]);
  if (deliveryError) throw deliveryError;
  if (xError) throw xError;
  if (scoreError) throw scoreError;
  const deliveryRows = checkedDashboardRows(deliveries, "dashboard_performance_deliveries");
  const xDeliveryRows = checkedDashboardRows(xDeliveries, "dashboard_performance_x_deliveries");
  const scoreEventRows = checkedDashboardRows(scoreEvents, "dashboard_performance_score_events");

  const telegramByTweet = latestTimestampBySubject(
    deliveryRows,
    "subject_id",
  );
  const xByTweet = latestTimestampBySubject(
    xDeliveryRows,
    "post_id",
  );
  const scoreByTweet = latestEventTimestampBySubject(
    scoreEventRows,
    "subject_id",
  );

  const ingestToDedupe: Array<number | null> = [];
  const ingestToScore: Array<number | null> = [];
  const dedupeToTranslation: Array<number | null> = [];
  const scoreToTranslation: Array<number | null> = [];
  const ingestToTranslation: Array<number | null> = [];
  const translationToTelegram: Array<number | null> = [];
  const translationToX: Array<number | null> = [];
  const telegramEndToEnd: Array<number | null> = [];
  const xEndToEnd: Array<number | null> = [];

  for (const post of posts) {
    const tweetId = String(post.tweet_id ?? "");
    const scoreAt = scoreByTweet.get(tweetId);
    ingestToDedupe.push(
      durationSeconds(post.created_at, post.dedupe_checked_at),
    );
    ingestToScore.push(durationSeconds(post.created_at, scoreAt));
    dedupeToTranslation.push(
      durationSeconds(post.dedupe_checked_at, post.translated_at),
    );
    scoreToTranslation.push(durationSeconds(scoreAt, post.translated_at));
    ingestToTranslation.push(
      durationSeconds(post.created_at, post.translated_at),
    );
    const telegramAt = telegramByTweet.get(tweetId);
    const xAt = xByTweet.get(tweetId);
    translationToTelegram.push(durationSeconds(post.translated_at, telegramAt));
    translationToX.push(durationSeconds(post.translated_at, xAt));
    telegramEndToEnd.push(durationSeconds(post.created_at, telegramAt));
    xEndToEnd.push(durationSeconds(post.created_at, xAt));
  }

  return {
    window_hours: windowHours,
    sampled_posts: posts.length,
    stages: {
      ingest_to_dedupe: summarizeDurations(ingestToDedupe),
      ingest_to_score: summarizeDurations(ingestToScore),
      dedupe_to_translation: summarizeDurations(dedupeToTranslation),
      score_to_translation: summarizeDurations(scoreToTranslation),
      ingest_to_translation: summarizeDurations(ingestToTranslation),
      translation_to_telegram: summarizeDurations(translationToTelegram),
      translation_to_x: summarizeDurations(translationToX),
      telegram_end_to_end: summarizeDurations(telegramEndToEnd),
      x_end_to_end: summarizeDurations(xEndToEnd),
    },
  };
}

export function normalizeResourceUsage(raw: unknown): Record<string, unknown> {
  const value = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const dbBytes = num(value.db_bytes);
  const dbLimit = num(value.db_limit_bytes, 500_000_000);
  const storageBytes = num(value.temp_media_bytes);
  const storageLimit = num(
    value.storage_limit_bytes,
    DEFAULT_STORAGE_LIMIT_BYTES,
  );
  const edgeLimit = num(value.edge_monthly_limit, 500_000);
  const cronJobs = Array.isArray(value.cron_jobs)
    ? value.cron_jobs as Array<Record<string, unknown>>
    : [];
  const projectedCronMonthly = cronJobs.reduce(
    (sum, job) =>
      sum + (job.active === false ? 0 : estimateMonthlyRuns(job.schedule)),
    0,
  );
  const workerCron = cronJobs.find((job) =>
    job.active !== false &&
    String(job.jobname ?? "").startsWith("invoke-worker-every")
  ) ?? null;
  const workerCadenceSeconds = workerCron
    ? cronCadenceSeconds(workerCron.schedule)
    : null;

  return {
    available: value.available !== false,
    error: typeof value.error === "string" ? value.error : null,
    db_bytes: dbBytes,
    db_limit_bytes: dbLimit,
    db_used_pct: percentUsed(dbBytes, dbLimit),
    temp_media_bytes: storageBytes,
    temp_media_objects: num(value.temp_media_objects),
    storage_limit_bytes: storageLimit,
    storage_used_pct: percentUsed(storageBytes, storageLimit),
    edge_monthly_limit: edgeLimit,
    projected_cron_invocations_monthly: projectedCronMonthly,
    edge_cron_used_pct: percentUsed(projectedCronMonthly, edgeLimit),
    cron_failures_24h: typeof value.cron_failures_24h === "number"
      ? value.cron_failures_24h
      : null,
    cron_jobs: cronJobs,
    worker_dispatch_mode: "event-driven + cron fallback",
    worker_cron: workerCron,
    worker_cadence_seconds: workerCadenceSeconds,
    worker_cadence_warning: workerCadenceSeconds != null &&
      workerCadenceSeconds > 60,
    duplicate_translate_jobs_24h: num(value.duplicate_translate_jobs_24h),
  };
}

export async function getSystemPerformanceSummary(supabase: any) {
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [window6h, window24h, resourceRes, queueBreakdown] = await Promise.all([
    loadPerformanceWindow(supabase, 6),
    loadPerformanceWindow(supabase, 24),
    supabase.rpc("get_system_resource_usage"),
    loadDashboardQueueBreakdown(supabase, since24h, staleCutoff),
  ]);
  const byType = Array.isArray(queueBreakdown.by_type)
    ? queueBreakdown.by_type as Array<Record<string, unknown>>
    : [];

  return {
    success: true,
    generated_at: new Date().toISOString(),
    windows: {
      "6h": window6h,
      "24h": window24h,
    },
    queue: {
      pending: queueBreakdown.pending,
      running: queueBreakdown.running,
      stale_running: queueBreakdown.stale_running,
      failed_24h: queueBreakdown.failed_24h,
      oldest_pending_age_seconds: queueBreakdown.oldest_pending_age_seconds,
      scheduler_wait_seconds: queueBreakdown.oldest_pending_age_seconds,
      by_type: byType,
      lane_pressure: summarizeLanePressure(byType),
    },
    resources: resourceRes.error && isMissingSchemaError(resourceRes.error)
      ? normalizeResourceUsage({
        available: false,
        error: "system_resource_usage_unavailable",
      })
      : normalizeResourceUsage(resourceRes.data),
  };
}

async function loadScoringTuningSummary(supabase: any) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [scoreEventsRes, feedbackRes] = await Promise.all([
    supabase
      .from("pipeline_events")
      .select("meta, created_at, started_at, ended_at")
      .eq("step", "score")
      .eq("status", "completed")
      .gte("created_at", since24h)
      .limit(5000),
    supabase
      .from("feedback_events")
      .select("action, created_at")
      .gte("created_at", since24h)
      .in("action", [
        "manual_score",
        "should_pass_audience",
        "should_skip_audience",
        "wrong_relevance_class",
        "global_exception_worth_covering",
        "not_global_exception",
      ])
      .limit(5000),
  ]);
  if (scoreEventsRes.error) throw scoreEventsRes.error;
  if (feedbackRes.error) throw feedbackRes.error;

  let regionalAuto24h = 0;
  let globalPilotReview24h = 0;
  let globalTunedAuto24h = 0;
  for (const event of checkedDashboardRows(scoreEventsRes.data, "dashboard_scoring_events")) {
    const meta = event.meta && typeof event.meta === "object"
      ? event.meta as Record<string, unknown>
      : {};
    const rule = monitoringPolicyRuleKind(meta);
    if (rule === "regional_escalation_auto") regionalAuto24h += 1;
    if (
      rule === "global_mega_event_review" ||
      (meta.global_exception_class === "global_mega_event" &&
        meta.review_status === "needs_review")
    ) globalPilotReview24h += 1;
    const score = typeof meta.final_score === "number"
      ? meta.final_score
      : Number(meta.final_score);
    const threshold = typeof meta.threshold === "number"
      ? meta.threshold
      : Number(meta.threshold);
    if (
      meta.audience_class === "global_exception" &&
      meta.decision === "deliver" &&
      threshold === 14 &&
      score >= 14 &&
      score < 15 &&
      (meta.global_exception_class === "oil_energy" ||
        meta.global_exception_class === "major_leader_statement")
    ) {
      globalTunedAuto24h += 1;
    }
  }

  const feedbackRows = checkedDashboardRows(feedbackRes.data, "dashboard_feedback_events");
  const manualScoreOverrides24h =
    feedbackRows.filter((row: Record<string, unknown>) =>
      row.action === "manual_score"
    ).length;
  const manualFeedback24h = feedbackRows.length;
  return {
    regional_auto_24h: regionalAuto24h,
    global_pilot_review_24h: globalPilotReview24h,
    global_tuned_auto_24h: globalTunedAuto24h,
    manual_score_overrides_24h: manualScoreOverrides24h,
    manual_feedback_24h: manualFeedback24h,
    projected_added_posts_month: Math.round(
      (regionalAuto24h + globalTunedAuto24h) * 30,
    ),
  };
}

export async function getEnhancedDashboardSummary(supabase: any) {
  const { data: base, error } = await supabase.rpc("get_dashboard_summary");
  if (error) logDashboardFallback("base_summary", error);

  if (base && (typeof base !== "object" || Array.isArray(base))) {
    logDashboardFallback("base_summary", new Error("dashboard_base_invalid_response"));
  }
  const dashboard =
    (base && typeof base === "object" && !Array.isArray(base)
      ? base
      : degradedDashboardBase(error)) as Record<string, unknown>;
  const metrics =
    (dashboard.metrics && typeof dashboard.metrics === "object"
      ? dashboard.metrics
      : {}) as Record<string, unknown>;
  const health =
    (dashboard.health && typeof dashboard.health === "object"
      ? dashboard.health
      : {}) as Record<string, unknown>;
  const heartbeat = (dashboard.ingest_heartbeat &&
      typeof dashboard.ingest_heartbeat === "object"
    ? dashboard.ingest_heartbeat
    : {}) as Record<string, unknown>;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const dedupeAvailable = await withDashboardFallback(
    "dedupe_columns",
    hasDedupePostColumns(supabase),
    false,
  );
  const [
    posts,
    deliveriesRes,
    xDeliveriesRes,
    queueBreakdown,
    xLocalUsage,
    openAiUsage,
    processObservability,
    systemPerformance,
    scoringTuning,
  ] = await Promise.all([
    withDashboardFallback(
      "posts",
      loadDashboardPosts(supabase, since, dedupeAvailable),
      [] as Array<Record<string, unknown>>,
    ),
    withDashboardFallback(
      "telegram_deliveries",
      checkedDashboardRowsQuery(
        supabase.from("deliveries").select(
          "subject_id, status, posted_at, created_at",
        ).eq("subject_type", "post").gte("created_at", since).limit(10000),
      ),
      emptyDashboardRowsResult(),
    ),
    withDashboardFallback(
      "x_deliveries",
      checkedDashboardRowsQuery(
        supabase.from("x_deliveries").select(
          "post_id, status, posted_at, created_at",
        ).gte("created_at", since).order("created_at", { ascending: false })
          .limit(10000),
      ),
      emptyDashboardRowsResult(),
    ),
    withDashboardFallback(
      "queue_breakdown",
      loadDashboardQueueBreakdown(supabase, since, staleCutoff),
      {
        pending: num(health.queue_size),
        running: num(health.queue_running),
        failed_24h: 0,
        resolved_failed_24h: 0,
        stale_running: 0,
        oldest_pending_age_seconds: null,
        by_type: [],
      },
    ),
    withDashboardFallback(
      "x_local_usage",
      loadDashboardXLocalUsage(supabase, dashboard, since),
      (error) => ({
        available: false,
        error: "dashboard_x_local_usage_unavailable",
        source: "dashboard_fallback",
        attempts_24h: num(metrics.x_api_calls_24h),
        counted_attempts_24h: num(metrics.x_api_calls_24h),
        failed_attempts_24h: num(metrics.x_failed_24h),
        posts_24h: num(metrics.x_posts_24h),
        failed_posts_24h: num(metrics.x_failed_24h),
        media_uploads_24h: num(metrics.x_media_uploads_24h),
        hydrations_24h: num(metrics.posts_hydrated_24h),
        monthly_posts: num(health.x_monthly_posts),
        monthly_budget: num(health.x_monthly_budget, 2500),
        budget_used_pct: num(health.x_budget_used_pct),
        official_usage_synced: false,
      }),
    ),
    withDashboardFallback(
      "openai_usage",
      loadOpenAiUsageSummary(supabase, since),
      (error) => ({
        available: false,
        error: "dashboard_openai_usage_unavailable",
      }),
    ),
    withDashboardFallback(
      "process_observability",
      loadProcessObservabilitySummary(supabase, since),
      (error) => ({
        available: false,
        error: errorMessage(error),
      }),
    ),
    getSystemPerformanceSummary(supabase).catch(() => ({
      success: false,
      error: "dashboard_system_performance_unavailable",
    })),
    loadScoringTuningSummary(supabase).catch(() => ({
      error: "dashboard_scoring_tuning_unavailable",
      regional_auto_24h: 0,
      global_pilot_review_24h: 0,
      global_tuned_auto_24h: 0,
      manual_score_overrides_24h: 0,
      manual_feedback_24h: 0,
      projected_added_posts_month: 0,
    })),
  ]);

  const telegramPosted = new Set(
    (deliveriesRes.data ?? []).filter((row: Record<string, unknown>) =>
      row.status === "posted"
    ).map((row: Record<string, unknown>) => row.subject_id),
  );
  const xByTweet = new Map<string, Record<string, unknown>>();
  for (
    const row of latestXDeliveriesByPost(
      (xDeliveriesRes.data ?? []) as Array<Record<string, unknown>>,
    )
  ) {
    const postId = String(row.post_id ?? "");
    if (postId && !xByTweet.has(postId)) xByTweet.set(postId, row);
  }

  let scored = 0;
  let translated = 0;
  let readyToDeliver = 0;
  let needsScore = 0;
  let duplicates = 0;
  let duplicateGateChecked = 0;
  let xFailed = 0;
  for (const post of posts) {
    const tweetId = String(post.tweet_id ?? "");
    const score = typeof post.final_score === "number"
      ? post.final_score
      : post.importance_score;
    const hasScore = typeof score === "number";
    const hasTranslation = typeof post.text_translated === "string" &&
      post.text_translated.trim() !== "" &&
      post.text_translated !== post.text_original;
    const dedupeStatus = typeof post.dedupe_status === "string"
      ? post.dedupe_status
      : null;
    const duplicate = dedupeStatus === "duplicate" ||
      (
        Boolean(post.dup_of_tweet_id) &&
        !["coverage_gap", "uncertain", "related_new_info"].includes(
          dedupeStatus ?? "",
        )
      );
    if (hasScore) scored += 1;
    else if (!duplicate) needsScore += 1;
    if (hasTranslation) translated += 1;
    if (duplicate) duplicates += 1;
    if (dedupeStatus) duplicateGateChecked += 1;
    if (
      post.delivery_decision === "deliver" && hasTranslation &&
      !telegramPosted.has(tweetId) && !duplicate
    ) readyToDeliver += 1;
    if (xByTweet.get(tweetId)?.status === "failed") xFailed += 1;
  }

  const xFailedActionable = Math.max(
    xFailed,
    num(xLocalUsage.failed_posts_24h),
  );
  const failedStuck = queueBreakdown.failed_24h + queueBreakdown.stale_running;
  const needsAttention = failedStuck + xFailedActionable;
  const lastIngestAge = typeof heartbeat.age_seconds === "number"
    ? heartbeat.age_seconds
    : null;
  const budgetPct = num(
    xLocalUsage.budget_used_pct,
    num(health.x_budget_used_pct),
  );
  let severity: "ok" | "warning" | "critical" = error ? "critical" : "ok";
  let primaryIssue = error
    ? "Dashboard base summary is degraded"
    : "Pipeline is operating normally";
  let recommendedRoute = "/monitoring";
  if (error) {
    recommendedRoute = "/monitoring";
  } else if (queueBreakdown.stale_running > 0) {
    severity = "critical";
    primaryIssue = `${queueBreakdown.stale_running} stale running job${
      queueBreakdown.stale_running === 1 ? "" : "s"
    }`;
    recommendedRoute = "/monitoring?filter=failed_stuck";
  } else if (xFailedActionable > 0) {
    severity = "critical";
    primaryIssue = `${xFailedActionable} X failed post${
      xFailedActionable === 1 ? "" : "s"
    } in 24h`;
    recommendedRoute = "/monitoring?filter=x_failed";
  } else if (queueBreakdown.failed_24h > 0) {
    severity = "warning";
    primaryIssue = `${queueBreakdown.failed_24h} failed job${
      queueBreakdown.failed_24h === 1 ? "" : "s"
    } in 24h`;
    recommendedRoute = "/monitoring?filter=failed_stuck";
  } else if (budgetPct >= 90) {
    severity = "warning";
    primaryIssue = `X local budget estimate is at ${budgetPct}%`;
    recommendedRoute = "/settings#x-automation";
  } else if (heartbeat.state === "warning" || heartbeat.state === "critical") {
    severity = heartbeat.state === "critical" ? "critical" : "warning";
    primaryIssue = `Ingest ${heartbeat.state}`;
    recommendedRoute = "/settings";
  }

  return {
    ...dashboard,
    ops_status: {
      severity,
      primary_issue: primaryIssue,
      recommended_route: recommendedRoute,
      last_ingest_age_seconds: lastIngestAge,
      stale_job_count: queueBreakdown.stale_running,
    },
    pipeline_counts: {
      ingested: num(metrics.posts_ingested, posts.length),
      duplicate_gate_available: dedupeAvailable,
      duplicate_gate_checked: dedupeAvailable ? duplicateGateChecked : null,
      duplicates: dedupeAvailable ? duplicates : null,
      scored,
      translated,
      telegram_delivered: num(metrics.posts_delivered),
      x_posted: num(metrics.x_posts_24h),
      needs_attention: needsAttention,
      failed_stuck: failedStuck,
      ready_to_deliver: readyToDeliver,
      translation_queue:
        queueBreakdown.by_type.find((row) => row.type === "translate")
          ?.pending ?? 0,
      x_failed: xFailedActionable,
      stale_jobs: queueBreakdown.stale_running,
    },
    queue_breakdown: queueBreakdown,
    x_local_usage: xLocalUsage,
    openai_usage: openAiUsage,
    process_observability: processObservability,
    system_performance: systemPerformance,
    scoring_tuning: scoringTuning,
  };
}

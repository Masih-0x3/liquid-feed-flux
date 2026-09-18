import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Gauge, Loader2, ShieldCheck, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useDashboardData, type ProcessObservabilitySummary } from '@/hooks/useDashboardData';

function formatCount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function statusTone(summary: ProcessObservabilitySummary): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (!summary.available || summary.foglamp.stopped) return 'destructive';
  if (summary.foglamp.warning || summary.failedRuns24h > 0 || summary.failedAiCalls24h > 0) return 'secondary';
  return 'default';
}

function hostedLabel(summary: ProcessObservabilitySummary): string {
  if (summary.foglamp.hostedExportEnabled) return 'Hosted export on';
  if (!summary.foglamp.hasApiKey) return 'Hosted export missing key';
  return 'Hosted export off';
}

function capLabel(summary: ProcessObservabilitySummary): string {
  if (!summary.available) return 'Cap status unavailable';
  if (summary.foglamp.stopped) return 'Stopped at local cap';
  if (summary.foglamp.warning) return 'Near local cap';
  return 'Under local cap';
}

function latestRunHref(summary: ProcessObservabilitySummary): string | null {
  const subjectId = summary.latestRun?.subjectId;
  return subjectId ? `/monitoring?search=${encodeURIComponent(subjectId)}` : null;
}

export default function ObservabilitySettings() {
  const dashboardQuery = useDashboardData();
  const summary = dashboardQuery.data?.processObservability ?? null;

  if (dashboardQuery.isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex min-h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (dashboardQuery.error || !summary) {
    return (
      <Card className="glass-card border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-glass-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" />Observability
          </CardTitle>
          <CardDescription>Process observability status is unavailable from admin-actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            The local summary could not be loaded. Refresh to try again; provider usage has not been verified.
          </p>
          <Button type="button" variant="outline" className="mt-3" disabled={dashboardQuery.isFetching} onClick={() => { void dashboardQuery.refetch(); }}>Retry observability</Button>
        </CardContent>
      </Card>
    );
  }

  const capPct = Math.max(0, Math.min(100, summary.foglamp.capUsedPct ?? 0));
  const latestHref = latestRunHref(summary);
  const hudEnabled = import.meta.env.DEV && import.meta.env.VITE_FOGLAMP_HUD === '1';

  return (
    <div className="space-y-4">
      <Card id="observability-metrics" className="glass-card scroll-mt-48">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-glass-foreground">
                <Activity className="h-5 w-5 text-primary" />Process Observability
              </CardTitle>
              <CardDescription>Local XOT ledger status, hosted Foglamp export state, and cap protection.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={summary.available ? 'default' : 'destructive'}>
                {summary.available ? 'Local ledger active' : 'Local ledger unavailable'}
              </Badge>
              <Badge variant={statusTone(summary)}>{capLabel(summary)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Local process ledger. Rolling metrics cover the last 24 hours; month-to-date values use the calendar month. Last successful refresh: {dashboardQuery.dataUpdatedAt ? new Date(dashboardQuery.dataUpdatedAt).toLocaleString() : 'unavailable'}.</p>
          {!summary.available && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />Schema or summary not ready
              </div>
              <p className="text-muted-foreground">{summary.error ?? 'Apply the process observability migration before relying on dashboard rows.'}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Active runs (current)</p>
              <p className="mt-1 text-xl font-semibold">{formatCount(summary.available ? summary.activeRuns : null)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">AI calls / 24h</p>
              <p className="mt-1 text-xl font-semibold">{formatCount(summary.available ? summary.aiCalls24h : null)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Failed calls / runs (24h)</p>
              <p className="mt-1 text-xl font-semibold">{formatCount(summary.available ? summary.failedAiCalls24h : null)} / {formatCount(summary.available ? summary.failedRuns24h : null)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">AI p95 latency (24h)</p>
              <p className="mt-1 text-xl font-semibold">{formatDuration(summary.available ? summary.aiCallP95Seconds : null)}</p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Hosted Foglamp export</p>
                  <p className="text-xs text-muted-foreground">{hostedLabel(summary)}</p>
                </div>
                <Badge variant={summary.foglamp.hostedExportEnabled ? 'default' : 'outline'}>
                  {summary.foglamp.hostedExportEnabled ? 'Enabled' : 'Local only'}
                </Badge>
              </div>
              {summary.available && <Progress aria-label="Monthly hosted span cap used" value={capPct} className="h-2" />}
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatCount(summary.available ? summary.foglamp.estimatedSpansUsed : null)} / {formatCount(summary.available ? summary.foglamp.monthlySpanCap : null)} spans</span>
                <span>Warn at {formatCount(summary.available ? summary.foglamp.monthlySpanWarn : null)}</span>
                <span>{formatCount(summary.available ? summary.foglamp.estimatedSpansSkipped : null)} skipped locally</span>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Safety boundary</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">API key in browser</span>
                  <Badge variant="outline">No</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Prompt/output text</span>
                  <Badge variant="outline">Redacted</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Floating HUD</span>
                  <Badge variant={hudEnabled ? 'secondary' : 'outline'}>{hudEnabled ? 'Opted in' : 'Off'}</Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Token usage</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">OpenAI tokens (month to date)</p>
                  <p className="font-medium">{formatCount(summary.available ? summary.openAiTokensMonthToDate : null)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reasoning tokens / 24h</p>
                  <p className="font-medium">{formatCount(summary.available ? summary.reasoningTokens24h : null)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Latest run</p>
              </div>
              {summary.latestRun ? (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{summary.latestRun.status}</Badge>
                    <span className="truncate font-medium">{summary.latestRun.workflowName}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={summary.latestRun.workflowRunId ?? summary.latestRun.runKey}>
                    {summary.latestRun.workflowRunId ?? summary.latestRun.runKey}
                  </p>
                  {latestHref && (
                    <Link to={latestHref} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Open in Monitoring
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No workflow runs have landed in the local ledger yet.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card id="observability-controls" className="glass-card scroll-mt-48">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-glass-foreground">
            <SlidersHorizontal className="h-5 w-5 text-primary" />Control Plane
          </CardTitle>
          <CardDescription>Runtime controls are currently server-side environment and migration settings.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="font-medium">Hosted export</p>
            <p className="mt-1 text-muted-foreground">Supabase Edge Function secrets: FOGLAMP_ENABLED, FOGLAMP_API_KEY, FOGLAMP_INGEST_URL.</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="font-medium">Monthly cap</p>
            <p className="mt-1 text-muted-foreground">FOGLAMP_MONTHLY_SPAN_CAP hard-stops hosted export before the plan limit.</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="font-medium">Text capture</p>
            <p className="mt-1 text-muted-foreground">FOGLAMP_RECORD_INPUTS and FOGLAMP_RECORD_OUTPUTS should stay false in production.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

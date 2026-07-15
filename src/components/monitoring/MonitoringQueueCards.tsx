import { ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { compactNumber } from '@/lib/monitoringViewModel';

interface MonitoringQueueCounts {
  needs_attention: number;
  failed_stuck: number;
  translation_queue: number;
  needs_score: number;
  ready_to_deliver: number;
  manual_review: number;
  duplicates: number;
  coverage_gap?: number;
  possible_duplicate?: number;
  duplicate_anomalies?: number;
  hydration: number;
  x_pending: number;
  x_failed: number;
  delivered_24h: number;
  telegram_pending: number;
  below_threshold: number;
  stale_jobs: number;
  stale_x_pending_24h: number;
  v2_regional_auto: number;
  global_pilot_review: number;
  manual_scoring_feedback: number;
}

interface MonitoringXSummary {
  counted_attempts?: number;
  posts_local?: number;
  success_rate?: number;
}

interface MonitoringQueueCardsProps {
  counts: MonitoringQueueCounts;
  xSummary?: MonitoringXSummary | null;
  onReviewAttention: () => void;
}

function QueueMetric({ label, value, tone = 'text-glass-foreground', suffix }: { label: string; value: number | undefined; tone?: string; suffix?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{compactNumber(value)}{typeof value === 'number' ? suffix : ''}</p>
    </div>
  );
}

export function MonitoringQueueCards({ counts, xSummary, onReviewAttention }: MonitoringQueueCardsProps) {
  const blockers = counts.failed_stuck + counts.x_failed + counts.stale_jobs + (counts.duplicate_anomalies ?? 0);

  return (
    <div className="space-y-3">
      <section aria-labelledby="monitoring-attention-title">
        <Card className={counts.needs_attention > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border/60 bg-muted/20'}>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${counts.needs_attention > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
              <div>
                <p id="monitoring-attention-title" className="text-sm font-semibold text-glass-foreground">Needs attention</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-glass-foreground">{compactNumber(counts.needs_attention)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {counts.needs_attention > 0
                    ? `${compactNumber(blockers)} blocker${blockers === 1 ? '' : 's'} need an operator decision before routine throughput.`
                    : 'No active triage items. Review the queue or continue with routine pipeline health.'}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={onReviewAttention}>
              Review attention queue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <div className="mt-3 grid gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
          <QueueMetric label="Failed / stuck" value={counts.failed_stuck} tone={counts.failed_stuck > 0 ? 'text-destructive' : 'text-glass-foreground'} />
          <QueueMetric label="Needs score" value={counts.needs_score} tone={counts.needs_score > 0 ? 'text-amber-500' : 'text-glass-foreground'} />
          <QueueMetric label="X failed" value={counts.x_failed} tone={counts.x_failed > 0 ? 'text-destructive' : 'text-glass-foreground'} />
          <QueueMetric label="Stale jobs" value={counts.stale_jobs} tone={counts.stale_jobs > 0 ? 'text-amber-500' : 'text-glass-foreground'} />
        </div>
      </section>

      <section aria-labelledby="monitoring-pipeline-title">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle id="monitoring-pipeline-title" className="text-base">Pipeline & delivery health</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 min-[520px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            <QueueMetric label="Translation queue" value={counts.translation_queue} tone={counts.translation_queue > 0 ? 'text-blue-500' : 'text-glass-foreground'} />
            <QueueMetric label="Ready to deliver" value={counts.ready_to_deliver} tone="text-primary" />
            <QueueMetric label="Manual review" value={counts.manual_review} tone={counts.manual_review > 0 ? 'text-purple-500' : 'text-glass-foreground'} />
            <QueueMetric label="Telegram pending" value={counts.telegram_pending} tone={counts.telegram_pending > 0 ? 'text-amber-500' : 'text-glass-foreground'} />
            <QueueMetric label="X pending" value={counts.x_pending} tone={counts.x_pending > 0 ? 'text-amber-500' : 'text-glass-foreground'} />
            <QueueMetric label="Hydration" value={counts.hydration} tone={counts.hydration > 0 ? 'text-blue-500' : 'text-glass-foreground'} />
            <QueueMetric label="Coverage gaps" value={counts.coverage_gap ?? 0} tone={(counts.coverage_gap ?? 0) > 0 ? 'text-amber-500' : 'text-glass-foreground'} />
            <QueueMetric label="Duplicate anomalies" value={counts.duplicate_anomalies ?? 0} tone={(counts.duplicate_anomalies ?? 0) > 0 ? 'text-destructive' : 'text-glass-foreground'} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="monitoring-throughput-title">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle id="monitoring-throughput-title" className="text-base">Routine throughput</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 min-[520px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            <QueueMetric label="Delivered 24h" value={counts.delivered_24h} tone="text-emerald-500" />
            <QueueMetric label="X attempts" value={xSummary?.counted_attempts} />
            <QueueMetric label="Local posts" value={xSummary?.posts_local ?? counts.delivered_24h} />
            <QueueMetric label="X success" value={xSummary ? xSummary.success_rate : undefined} tone={xSummary && (xSummary.success_rate ?? 0) < 100 ? 'text-amber-500' : 'text-emerald-500'} suffix="%" />
            <QueueMetric label="Below threshold" value={counts.below_threshold} />
            <QueueMetric label="Duplicates" value={counts.duplicates} />
            <QueueMetric label="Possible dupes" value={counts.possible_duplicate ?? 0} />
            <QueueMetric label="Manual scoring" value={counts.manual_scoring_feedback} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

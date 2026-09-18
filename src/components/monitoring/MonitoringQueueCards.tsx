
import { compactNumber } from "@/lib/monitoringViewModel";

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
  loading?: boolean;
  scope?: string;
  updatedAt?: number;
  stale?: boolean;
}

export function MonitoringQueueCards({ counts, xSummary, loading = false, scope = 'Latest 10,000 posts; current pipeline state', updatedAt, stale }: MonitoringQueueCardsProps) {
  const metrics: Array<[string, number | undefined, string]> = [
    ['Needs attention', counts.needs_attention, 'text-warning'],
    ['Failed/stuck', counts.failed_stuck, 'text-destructive'],
    ['Ready to deliver', counts.ready_to_deliver, 'text-primary'],
    ['Translation queue', counts.translation_queue, 'text-primary'],
    ['Needs score', counts.needs_score, 'text-warning'],
    ['Manual review', counts.manual_review, 'text-warning'],
    ['Duplicates', counts.duplicates, 'text-muted-foreground'],
    ['Coverage gaps', counts.coverage_gap, 'text-warning'],
    ['Possible dupes', counts.possible_duplicate, 'text-warning'],
    ['Dup anomalies', counts.duplicate_anomalies, 'text-destructive'],
    ['Hydration', counts.hydration, 'text-primary'],
    ['X pending', counts.x_pending, 'text-warning'],
    ['X failed', counts.x_failed, 'text-destructive'],
    ['Telegram delivered · 24h', counts.delivered_24h, 'text-success'],
    ['Telegram pending', counts.telegram_pending, 'text-muted-foreground'],
    ['Below threshold', counts.below_threshold, 'text-muted-foreground'],
    ['Stale jobs · >30m', counts.stale_jobs, 'text-warning'],
    ['Stale X pending · >24h', counts.stale_x_pending_24h, 'text-warning'],
    ['Regional auto', counts.v2_regional_auto, 'text-muted-foreground'],
    ['Global pilot', counts.global_pilot_review, 'text-muted-foreground'],
    ['Manual scoring', counts.manual_scoring_feedback, 'text-muted-foreground'],
  ];
  const renderMetrics = (items: typeof metrics) => items.map(([label, value, tone]) => (
    <div key={label} className="min-w-0 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{loading ? '—' : compactNumber(value)}</dd>
    </div>
  ));
  return (
    <section aria-label="Monitoring summary" className="rounded-lg border bg-card">
      <dl className="grid grid-cols-2 gap-px sm:grid-cols-4">{renderMetrics(metrics.slice(0, 4))}</dl>
      <details className="border-t px-3 py-2">
        <summary className="cursor-pointer text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">More queue metrics and scope</summary>
        <p className="mt-2 text-xs text-muted-foreground">{loading ? 'Loading overview…' : scope}. {stale ? 'Refresh failed; last successful data shown. ' : ''}{updatedAt ? `Refreshed ${new Date(updatedAt).toLocaleTimeString()}.` : 'Refresh time unavailable.'} Needs attention includes stale running jobs; categories can overlap.</p>
        <dl className="mt-2 grid grid-cols-2 gap-px sm:grid-cols-4">{renderMetrics(metrics.slice(4))}</dl>
        <dl className="mt-2 grid grid-cols-3 border-t pt-2 text-xs">
          <div><dt>X counted attempts · 24h</dt><dd className="mt-1 font-semibold">{compactNumber(xSummary?.counted_attempts)}</dd></div>
          <div><dt>X local posts · 24h</dt><dd className="mt-1 font-semibold">{compactNumber(xSummary?.posts_local)}</dd></div>
          <div><dt>X success · 24h</dt><dd className="mt-1 font-semibold">{typeof xSummary?.success_rate === 'number' ? `${xSummary.success_rate}%` : 'Unavailable'}</dd></div>
        </dl>
      </details>
    </section>
  );
}

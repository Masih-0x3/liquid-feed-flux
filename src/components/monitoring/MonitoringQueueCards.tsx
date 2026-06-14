import { Card, CardContent } from "@/components/ui/card";
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
}

export function MonitoringQueueCards({ counts, xSummary }: MonitoringQueueCardsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          ['Needs attention', counts.needs_attention, 'text-amber-500'],
          ['Failed/stuck', counts.failed_stuck, 'text-destructive'],
          ['Translation queue', counts.translation_queue, 'text-blue-500'],
          ['Needs score', counts.needs_score, 'text-amber-500'],
          ['Ready to deliver', counts.ready_to_deliver, 'text-primary'],
          ['Manual review', counts.manual_review, 'text-purple-500'],
          ['Duplicates', counts.duplicates, 'text-muted-foreground'],
          ['Coverage gaps', counts.coverage_gap ?? 0, 'text-amber-500'],
          ['Possible dupes', counts.possible_duplicate ?? 0, 'text-amber-500'],
          ['Dup anomalies', counts.duplicate_anomalies ?? 0, 'text-destructive'],
          ['Hydration', counts.hydration, 'text-blue-500'],
          ['X pending', counts.x_pending, 'text-amber-500'],
          ['X failed', counts.x_failed, 'text-destructive'],
          ['Delivered 24h', counts.delivered_24h, 'text-emerald-500'],
        ].map(([label, value, cls]) => (
          <Card key={label as string}>
            <CardContent className="p-2.5 sm:p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-semibold tabular-nums sm:text-2xl ${cls}`}>{compactNumber(value as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
            {[
              ['Telegram pending', counts.telegram_pending],
              ['Below threshold', counts.below_threshold],
              ['Stale jobs', counts.stale_jobs],
              ['Stale X pending', counts.stale_x_pending_24h],
              ['Regional auto', counts.v2_regional_auto],
              ['Global pilot', counts.global_pilot_review],
              ['Manual scoring', counts.manual_scoring_feedback],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{compactNumber(value as number)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-3 gap-3 p-3">
            <div>
              <p className="text-xs text-muted-foreground">X attempts</p>
              <p className="text-lg font-semibold tabular-nums">{compactNumber(xSummary?.counted_attempts)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Local posts</p>
              <p className="text-lg font-semibold tabular-nums">{compactNumber(xSummary?.posts_local ?? counts.delivered_24h)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Success</p>
              <p className="text-lg font-semibold tabular-nums">{xSummary ? `${xSummary.success_rate}%` : '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

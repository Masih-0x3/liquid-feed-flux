import { Badge } from "@/components/ui/badge";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import { decisionScore, formatXBadge } from "@/lib/pipelineMessages";
import { audienceClassLabel, toneClass } from "@/lib/monitoringViewModel";

interface MonitoringEntryBadgeProps {
  entry: MonitoringEntry;
}

export function MonitoringXBadge({ entry }: MonitoringEntryBadgeProps) {
  if (!entry.x_status) return <Badge variant="outline" className="text-muted-foreground">X: —</Badge>;

  const { label, title } = formatXBadge(entry);
  const cls =
    entry.x_status === 'posted' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    : entry.x_status === 'failed' ? 'bg-destructive/15 text-destructive border-destructive/30'
    : entry.x_status === 'skipped' ? 'bg-muted text-muted-foreground border-border'
    : 'bg-amber-500/15 text-amber-500 border-amber-500/30';
  const badge = <Badge className={cls} title={title}>{label}</Badge>;

  return entry.x_status === 'posted' && entry.x_tweet_id ? (
    <a href={`https://x.com/i/status/${entry.x_tweet_id}`} target="_blank" rel="noopener noreferrer">{badge}</a>
  ) : badge;
}

export function MonitoringTelegramBadge({ entry }: MonitoringEntryBadgeProps) {
  return (
    <Badge variant={entry.is_delivered ? 'default' : entry.monitoring_state?.code === 'telegram_pending' ? 'secondary' : 'outline'}>
      {entry.is_delivered ? 'Delivered' : entry.monitoring_state?.telegram_state === 'none' ? 'No row' : entry.monitoring_state?.telegram_state || entry.delivery_status || 'No row'}
    </Badge>
  );
}

export function MonitoringDedupeBadge({ entry }: MonitoringEntryBadgeProps) {
  if (!entry.dedupe_status) return null;

  const label =
    entry.dedupe_status === 'pending' ? 'Duplicate gate pending'
    : entry.dedupe_status === 'duplicate' ? 'Duplicate'
    : entry.dedupe_status === 'coverage_gap' ? 'Coverage gap'
    : entry.dedupe_status === 'related_new_info' ? 'Related: new info'
    : entry.dedupe_status === 'uncertain' ? 'Uncertain duplicate'
    : entry.dedupe_status === 'failed' ? 'Dedupe failed'
    : 'Unique';
  const cls =
    entry.dedupe_status === 'duplicate' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
    : entry.dedupe_status === 'coverage_gap' ? toneClass('warn')
    : entry.dedupe_status === 'related_new_info' || entry.dedupe_status === 'unique' ? toneClass('good')
    : entry.dedupe_status === 'failed' ? toneClass('bad')
    : entry.dedupe_status === 'uncertain' ? toneClass('warn')
    : toneClass('info');
  const title = [
    entry.dedupe_method,
    entry.dedupe_confidence != null ? `confidence ${entry.dedupe_confidence.toFixed(2)}` : null,
    entry.dedupe_reason,
  ].filter(Boolean).join(' · ');

  return <Badge className={`${cls} text-[10px]`} title={title}>{label}</Badge>;
}

export function MonitoringAudienceBadge({ entry }: MonitoringEntryBadgeProps) {
  if (!entry.audience_class) return null;

  const cls =
    entry.audience_class === 'direct_focus' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    : entry.audience_class === 'adjacent' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    : entry.audience_class === 'global_exception' ? 'bg-violet-500/15 text-violet-400 border-violet-500/30'
    : 'bg-muted text-muted-foreground border-border';
  const title = [
    entry.scoring_profile_id ? `profile ${entry.scoring_profile_id}` : null,
    entry.audience_confidence != null ? `confidence ${entry.audience_confidence.toFixed(2)}` : null,
    entry.global_exception_class ? `exception ${entry.global_exception_class}` : null,
    entry.audience_reason,
  ].filter(Boolean).join(' · ');

  return <Badge className={`${cls} text-[10px]`} title={title}>{audienceClassLabel(entry.audience_class)}</Badge>;
}

export function MonitoringCostFlags({ entry }: MonitoringEntryBadgeProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {entry.x_cost_flags?.hydration_expected && <Badge variant="outline" className="text-[10px]">read</Badge>}
      {entry.x_cost_flags?.media_upload_expected && <Badge variant="outline" className="text-[10px]">media</Badge>}
      {entry.x_cost_flags?.may_call_x && <Badge variant="outline" className="text-[10px]">write</Badge>}
      {!entry.x_cost_flags?.reasons?.length && <span className="text-muted-foreground">—</span>}
    </div>
  );
}

interface MonitoringScoreProps extends MonitoringEntryBadgeProps {
  deliverThreshold: number;
}

export function MonitoringScore({ entry, deliverThreshold }: MonitoringScoreProps) {
  const score = decisionScore(entry);
  if (score == null) return <span className="text-muted-foreground">—</span>;

  return (
    <span className={score >= deliverThreshold ? 'font-semibold text-emerald-500' : 'font-semibold text-amber-500'}>
      {Number.isInteger(score) ? score : score.toFixed(1)}
      <span className="text-xs text-muted-foreground"> / ≥{deliverThreshold}</span>
    </span>
  );
}

import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DuplicateCluster, MonitoringEntry } from "@/hooks/useMonitoringData";
import {
  duplicateCoverageClass,
  duplicateCoverageDetail,
  duplicateCoverageLabel,
} from "@/lib/monitoringDuplicateEvidence";
import { memberScoreValue, toneClass } from "@/lib/monitoringViewModel";

type MaybePromise<T> = T | Promise<T>;

function duplicateStatusSummary(target?: MonitoringEntry['duplicate_of']) {
  if (!target) return 'match not loaded';
  const decision = target.monitoring_state?.decision_label ?? target.delivery_decision ?? 'No decision';
  return `${decision} · Telegram ${target.telegram_state} · X ${target.x_state}`;
}

interface MonitoringDuplicateHintProps {
  entry: MonitoringEntry;
}

export function MonitoringDuplicateHint({ entry }: MonitoringDuplicateHintProps) {
  if (!entry.dup_of_tweet_id) return null;

  const target = entry.duplicate_of;
  const label = target?.author_handle ? `@${target.author_handle}` : target?.tweet_id ? target.tweet_id.slice(-10) : entry.dup_of_tweet_id.slice(-10);
  const bothPostedX = entry.x_status === 'posted' && target?.x_state === 'posted';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-purple-500/20 bg-purple-500/5 px-2 py-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-purple-300">Duplicate of {label}</span>
      <Badge className={`${duplicateCoverageClass(target?.coverage_state)} text-[10px]`}>
        {duplicateCoverageLabel(target?.coverage_state)}
      </Badge>
      {bothPostedX && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both X posted</Badge>}
      <span className="min-w-0 truncate">{duplicateStatusSummary(target)}</span>
    </div>
  );
}

interface MonitoringDuplicateMatchProps {
  entry: MonitoringEntry;
  compact?: boolean;
  onInspectDuplicateMatch: (tweetId: string) => MaybePromise<void>;
}

export function MonitoringDuplicateMatch({
  entry,
  compact = false,
  onInspectDuplicateMatch,
}: MonitoringDuplicateMatchProps) {
  if (!entry.dup_of_tweet_id) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const target = entry.duplicate_of;
  const score = target ? target.final_score ?? target.importance_score : null;
  const matchedLabel = target?.author_handle ? `@${target.author_handle}` : entry.dup_of_tweet_id.slice(-10);
  const matchedId = target?.tweet_id ?? entry.dup_of_tweet_id;
  const matchedAge = target?.created_at ? formatDistanceToNow(new Date(target.created_at), { addSuffix: true }) : null;
  const bothPostedX = entry.x_status === 'posted' && target?.x_state === 'posted';

  return (
    <div className={`space-y-2 ${compact ? 'rounded-md border bg-muted/20 p-2 text-xs' : 'rounded-md border border-purple-500/20 bg-purple-500/5 p-2 text-xs'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">Duplicates {matchedLabel}</span>
            <Badge className={`${duplicateCoverageClass(target?.coverage_state)} text-[10px]`}>
              {duplicateCoverageLabel(target?.coverage_state)}
            </Badge>
            {bothPostedX && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both X posted</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={matchedId}>
            {matchedId.slice(-10)}{matchedAge ? ` · ${matchedAge}` : ''}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onInspectDuplicateMatch(matchedId)}>
          Inspect
        </Button>
      </div>
      {target ? (
        <>
          <p className="line-clamp-3 text-muted-foreground">{target.text_original || '[No content]'}</p>
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
            <span>Score {score ?? '—'}</span>
            <span>Telegram {target.telegram_state}</span>
            <span>X {target.x_state}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{duplicateCoverageDetail(target)}</p>
          {bothPostedX && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
              Anomaly: this duplicate and its matched story were both posted to X. New backend guards prevent this for future automatic posts.
            </p>
          )}
          {target.url && (
            <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Open match <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </>
      ) : (
        <p className="break-all text-muted-foreground">Matched ID {entry.dup_of_tweet_id}</p>
      )}
    </div>
  );
}

function clusterCoverageBadge(cluster: DuplicateCluster) {
  const cls = cluster.has_x_anomaly
    ? 'border-red-500/30 bg-red-500/15 text-red-300'
    : cluster.coverage_state === 'covered'
      ? toneClass('good')
      : cluster.coverage_state === 'in_pipeline'
        ? toneClass('info')
        : cluster.coverage_state === 'coverage_gap'
          ? toneClass('warn')
          : toneClass('muted');
  const label = cluster.has_x_anomaly
    ? 'Duplicate anomaly'
    : cluster.coverage_state === 'covered'
      ? 'Covered'
      : cluster.coverage_state === 'in_pipeline'
        ? 'In pipeline'
        : cluster.coverage_state === 'coverage_gap'
          ? 'Coverage gap'
          : 'Coverage unknown';

  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>;
}

interface MonitoringDuplicateClusterSummaryProps {
  entry: MonitoringEntry;
  compact?: boolean;
  expandedClusters: Set<string>;
  onToggleCluster: (clusterId: string) => void;
  onInspectDuplicateMatch: (tweetId: string) => MaybePromise<void>;
}

export function MonitoringDuplicateClusterSummary({
  entry,
  compact = false,
  expandedClusters,
  onToggleCluster,
  onInspectDuplicateMatch,
}: MonitoringDuplicateClusterSummaryProps) {
  const cluster = entry.duplicate_cluster;
  if (!cluster || cluster.counts.total < 2) {
    return <MonitoringDuplicateMatch entry={entry} compact={compact} onInspectDuplicateMatch={onInspectDuplicateMatch} />;
  }

  const isExpanded = expandedClusters.has(cluster.cluster_id);
  return (
    <div className={`${compact ? 'rounded-md border bg-muted/20 p-2' : 'rounded-md border border-purple-500/20 bg-purple-500/5 p-2'} text-xs`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 min-w-0 px-1.5 text-xs"
          onClick={() => onToggleCluster(cluster.cluster_id)}
        >
          {isExpanded ? <ChevronDown className="mr-1 h-3 w-3 shrink-0" /> : <ChevronRight className="mr-1 h-3 w-3 shrink-0" />}
          <span className="truncate">{cluster.counts.total} versions</span>
        </Button>
        <div className="flex flex-wrap gap-1">
          {clusterCoverageBadge(cluster)}
          {cluster.counts.x_posted > 0 && <Badge variant="outline" className="text-[10px]">X {cluster.counts.x_posted}</Badge>}
          {cluster.counts.delivered > 0 && <Badge variant="outline" className="text-[10px]">TG {cluster.counts.delivered}</Badge>}
          {cluster.counts.blocked > 0 && <Badge variant="outline" className="text-[10px]">{cluster.counts.blocked} blocked</Badge>}
        </div>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        Canonical {cluster.canonical_tweet_id.slice(-10)} · expand to compare duplicates
      </p>
    </div>
  );
}

interface MonitoringDuplicateClusterPanelProps {
  entry: MonitoringEntry;
  entryByTweetId: Map<string, MonitoringEntry>;
  expandedClusters: Set<string>;
  deliverThreshold: number;
  onOpenDetails: (tweetId: string) => MaybePromise<void>;
  onOpenManualScore: (entry: MonitoringEntry) => void;
  onRunDedupe: (entry: MonitoringEntry) => void;
  onClearDuplicate: (entry: MonitoringEntry) => void;
}

export function MonitoringDuplicateClusterPanel({
  entry,
  entryByTweetId,
  expandedClusters,
  deliverThreshold,
  onOpenDetails,
  onOpenManualScore,
  onRunDedupe,
  onClearDuplicate,
}: MonitoringDuplicateClusterPanelProps) {
  const cluster = entry.duplicate_cluster;
  if (!cluster || cluster.counts.total < 2 || !expandedClusters.has(cluster.cluster_id)) return null;

  return (
    <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Duplicate cluster</p>
          <p className="text-xs text-muted-foreground">
            {cluster.counts.total} versions · {cluster.counts.delivered} Telegram covered · {cluster.counts.x_posted} X posted
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {clusterCoverageBadge(cluster)}
          {cluster.has_x_anomaly && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both posted to X</Badge>}
        </div>
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {cluster.members.map((member) => {
          const fullEntry = entryByTweetId.get(member.tweet_id);
          const score = memberScoreValue(member);
          return (
            <div key={member.tweet_id} className="rounded-md border bg-background/60 p-3 text-xs">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{member.tweet_id.slice(-10)}</span>
                    {member.is_canonical && <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">canonical</Badge>}
                    {member.dedupe_status && <Badge variant="outline" className="text-[10px]">{member.dedupe_status.replaceAll('_', ' ')}</Badge>}
                  </div>
                  <p className="mt-1 font-medium">{member.author_handle ? `@${member.author_handle}` : 'Unknown author'}</p>
                  {member.created_at && <p className="text-muted-foreground">{formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}</p>}
                </div>
                <div className="text-right">
                  <p className={score != null && score >= deliverThreshold ? 'font-semibold text-emerald-500' : 'font-semibold text-amber-500'}>{score == null ? '—' : Number.isInteger(score) ? score : score.toFixed(1)}</p>
                  <p className="text-[11px] text-muted-foreground">score</p>
                </div>
              </div>
              <p className="line-clamp-3 leading-5 text-muted-foreground">{member.text_original || '[No content]'}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px]">Telegram {member.telegram_state}</Badge>
                <Badge variant="outline" className="text-[10px]">X {member.x_state}</Badge>
                {member.dup_similarity != null && <Badge variant="outline" className="text-[10px]">sim {member.dup_similarity.toFixed(2)}</Badge>}
                {member.dedupe_confidence != null && <Badge variant="outline" className="text-[10px]">conf {member.dedupe_confidence.toFixed(2)}</Badge>}
              </div>
              {member.dedupe_reason && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{member.dedupe_reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onOpenDetails(member.tweet_id)}>
                  Details
                </Button>
                {member.url && (
                  <a href={member.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-primary hover:bg-muted">
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {fullEntry && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onRunDedupe(fullEntry)}>
                      Run duplicate check
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onOpenManualScore(fullEntry)}>
                      Manual score
                    </Button>
                    {fullEntry.dup_of_tweet_id && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onClearDuplicate(fullEntry)}>
                        Clear duplicate
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

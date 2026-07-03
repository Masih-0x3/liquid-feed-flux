import { Fragment, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import { formatDecisionReason } from "@/lib/pipelineMessages";
import { monitoringDecisionLabel, monitoringStage } from "@/lib/monitoringState";
import { shortText, toneClass } from "@/lib/monitoringViewModel";
import {
  MonitoringDuplicateClusterPanel,
  MonitoringDuplicateClusterSummary,
  MonitoringDuplicateHint,
  MonitoringDuplicateMatch,
} from "@/components/monitoring/MonitoringDuplicateEvidence";
import {
  MonitoringAudienceBadge,
  MonitoringCostFlags,
  MonitoringDedupeBadge,
  MonitoringScore,
  MonitoringTelegramBadge,
  MonitoringXBadge,
} from "@/components/monitoring/MonitoringStatusBadges";

type MaybePromise<T> = T | Promise<T>;

interface MonitoringRowProps {
  entry: MonitoringEntry;
  isSelected: boolean;
  deliverThreshold: number;
  entryByTweetId: Map<string, MonitoringEntry>;
  expandedClusters: Set<string>;
  renderRowActions: (entry: MonitoringEntry, compact?: boolean) => ReactNode;
  onSelectChange: (tweetId: string, checked: boolean) => void;
  onOpenDetails: (tweetId: string) => MaybePromise<void>;
  onOpenManualScore: (entry: MonitoringEntry) => void;
  onToggleCluster: (clusterId: string) => void;
  onInspectDuplicateMatch: (tweetId: string) => MaybePromise<void>;
  onRunDedupe: (entry: MonitoringEntry) => void;
  onClearDuplicate: (entry: MonitoringEntry) => void;
}

function entryAuthor(entry: MonitoringEntry) {
  return entry.author_handle ? `@${entry.author_handle}` : `@${entry.account_handle}`;
}

function EntryTags({ entry }: { entry: MonitoringEntry }) {
  return (
    <>
      {entry.importance_tags?.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
      {entry.dup_of_tweet_id && <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px]">dup</Badge>}
      <MonitoringDedupeBadge entry={entry} />
      <MonitoringAudienceBadge entry={entry} />
      {entry.feedback_locked && <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]">locked</Badge>}
    </>
  );
}

function DuplicateSummary({
  entry,
  compact = false,
  expandedClusters,
  onToggleCluster,
  onInspectDuplicateMatch,
}: Pick<MonitoringRowProps, 'entry' | 'expandedClusters' | 'onToggleCluster' | 'onInspectDuplicateMatch'> & { compact?: boolean }) {
  return entry.duplicate_cluster ? (
    <MonitoringDuplicateClusterSummary
      entry={entry}
      compact={compact}
      expandedClusters={expandedClusters}
      onToggleCluster={onToggleCluster}
      onInspectDuplicateMatch={onInspectDuplicateMatch}
    />
  ) : (
    <MonitoringDuplicateHint entry={entry} />
  );
}

function DuplicateClusterPanel({
  entry,
  entryByTweetId,
  expandedClusters,
  deliverThreshold,
  onOpenDetails,
  onOpenManualScore,
  onRunDedupe,
  onClearDuplicate,
}: Pick<
  MonitoringRowProps,
  | 'entry'
  | 'entryByTweetId'
  | 'expandedClusters'
  | 'deliverThreshold'
  | 'onOpenDetails'
  | 'onOpenManualScore'
  | 'onRunDedupe'
  | 'onClearDuplicate'
>) {
  return (
    <MonitoringDuplicateClusterPanel
      entry={entry}
      entryByTweetId={entryByTweetId}
      expandedClusters={expandedClusters}
      deliverThreshold={deliverThreshold}
      onOpenDetails={onOpenDetails}
      onOpenManualScore={onOpenManualScore}
      onRunDedupe={onRunDedupe}
      onClearDuplicate={onClearDuplicate}
    />
  );
}

export function MonitoringMobileCard({
  entry,
  isSelected,
  deliverThreshold,
  entryByTweetId,
  expandedClusters,
  renderRowActions,
  onSelectChange,
  onOpenDetails,
  onOpenManualScore,
  onToggleCluster,
  onInspectDuplicateMatch,
  onRunDedupe,
  onClearDuplicate,
}: MonitoringRowProps) {
  const stage = monitoringStage(entry);
  const decision = formatDecisionReason(entry.decision_reason);
  const decisionLabel = monitoringDecisionLabel(entry, entry.delivery_decision ? decision.title : 'No decision');
  const blocker = entry.monitoring_state?.primary_blocker;

  return (
    <article className="space-y-3 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelectChange(entry.tweet_id, checked === true)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${entry.tweet_id}`}
        />
        <div className="min-w-0 flex-1">
          <button onClick={() => onOpenDetails(entry.tweet_id)} className="block w-full text-left">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono text-[11px]">{entry.tweet_id.slice(-10)}</span>
              <span>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</span>
            </div>
            <p className="mt-1 truncate text-sm font-medium">
              {entryAuthor(entry)}
            </p>
          </button>
          {entry.url && (
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <Badge className={toneClass(stage.tone)}>{stage.label}</Badge>
      </div>

      <button onClick={() => onOpenDetails(entry.tweet_id)} className="block w-full text-left text-sm leading-5 hover:text-primary">
        <span className="line-clamp-3">{shortText(entry) || '[No content]'}</span>
      </button>

      <div className="flex flex-wrap gap-1">
        <EntryTags entry={entry} />
      </div>
      <DuplicateSummary
        entry={entry}
        compact
        expandedClusters={expandedClusters}
        onToggleCluster={onToggleCluster}
        onInspectDuplicateMatch={onInspectDuplicateMatch}
      />
      <DuplicateClusterPanel
        entry={entry}
        entryByTweetId={entryByTweetId}
        expandedClusters={expandedClusters}
        deliverThreshold={deliverThreshold}
        onOpenDetails={onOpenDetails}
        onOpenManualScore={onOpenManualScore}
        onRunDedupe={onRunDedupe}
        onClearDuplicate={onClearDuplicate}
      />

      <div className="grid grid-cols-2 gap-2 text-xs min-[520px]:grid-cols-4">
        <div className="rounded-md border bg-muted/20 p-2">
          <p className="text-muted-foreground">Score</p>
          <div className="mt-1"><MonitoringScore entry={entry} deliverThreshold={deliverThreshold} /></div>
        </div>
        <div className="rounded-md border bg-muted/20 p-2">
          <p className="text-muted-foreground">Decision</p>
          <p className="mt-1 truncate font-medium" title={blocker || decision.detail || decision.title}>{decisionLabel}</p>
        </div>
        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-muted-foreground">Telegram</p>
          <MonitoringTelegramBadge entry={entry} />
        </div>
        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-muted-foreground">X / cost</p>
          <div className="space-y-1">
            <MonitoringXBadge entry={entry} />
            <MonitoringCostFlags entry={entry} />
          </div>
        </div>
      </div>

      {(blocker || entry.decision_reason) && (
        <p className="rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {blocker || decision.detail || decision.title}
        </p>
      )}

      {entry.dup_of_tweet_id && !entry.duplicate_cluster && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Duplicate match</p>
          <MonitoringDuplicateMatch entry={entry} compact onInspectDuplicateMatch={onInspectDuplicateMatch} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" className="h-9" onClick={() => onOpenDetails(entry.tweet_id)}>
          Details
        </Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => onOpenManualScore(entry)}>
          Score
        </Button>
        {renderRowActions(entry, true)}
      </div>
    </article>
  );
}

export function MonitoringTableEntryRows({
  entry,
  isSelected,
  deliverThreshold,
  entryByTweetId,
  expandedClusters,
  renderRowActions,
  onSelectChange,
  onOpenDetails,
  onOpenManualScore,
  onToggleCluster,
  onInspectDuplicateMatch,
  onRunDedupe,
  onClearDuplicate,
}: MonitoringRowProps) {
  const stage = monitoringStage(entry);
  const decision = formatDecisionReason(entry.decision_reason);
  const decisionLabel = monitoringDecisionLabel(entry, entry.delivery_decision ? decision.title : 'No decision');
  const blocker = entry.monitoring_state?.primary_blocker;

  return (
    <Fragment>
      <TableRow className="align-top">
        <TableCell className="px-2 py-4">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectChange(entry.tweet_id, checked === true)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${entry.tweet_id}`}
          />
        </TableCell>
        <TableCell className="px-3 py-4 text-xs">
          <div className="space-y-1">
            <div className="font-mono text-[11px] text-muted-foreground">{entry.tweet_id.slice(-10)}</div>
            <div>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</div>
            {entry.url && (
              <a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-4">
          <div className="truncate font-medium">
            {entryAuthor(entry)}
          </div>
          {entry.account_handle && entry.author_handle && entry.account_handle !== entry.author_handle && (
            <p className="text-xs text-muted-foreground truncate">@{entry.account_handle}</p>
          )}
        </TableCell>
        <TableCell className="px-3 py-4">
          <button onClick={() => onOpenDetails(entry.tweet_id)} className="block w-full text-left text-sm leading-5 hover:text-primary">
            <span className="line-clamp-2">{shortText(entry) || '[No content]'}</span>
          </button>
          <div className="mt-1 flex flex-wrap gap-1">
            <EntryTags entry={entry} />
          </div>
          {!entry.duplicate_cluster && <MonitoringDuplicateHint entry={entry} />}
        </TableCell>
        <TableCell className="px-3 py-4"><Badge className={toneClass(stage.tone)}>{stage.label}</Badge></TableCell>
        <TableCell className="px-3 py-4"><MonitoringScore entry={entry} deliverThreshold={deliverThreshold} /></TableCell>
        <TableCell className="px-3 py-4">
          <p className="line-clamp-2 text-sm" title={blocker || decision.detail || decision.title}>{decisionLabel}</p>
          {(blocker || entry.decision_reason) && <p className="line-clamp-2 text-xs text-muted-foreground">{blocker || decision.title}</p>}
        </TableCell>
        <TableCell className="px-3 py-4">
          <MonitoringDuplicateClusterSummary
            entry={entry}
            expandedClusters={expandedClusters}
            onToggleCluster={onToggleCluster}
            onInspectDuplicateMatch={onInspectDuplicateMatch}
          />
        </TableCell>
        <TableCell className="px-3 py-4">
          <div className="space-y-2">
            <div><MonitoringTelegramBadge entry={entry} /></div>
            <div><MonitoringXBadge entry={entry} /></div>
            <div><MonitoringCostFlags entry={entry} /></div>
          </div>
        </TableCell>
        <TableCell className="px-2 py-4">
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onOpenDetails(entry.tweet_id)}>
              Details
            </Button>
            {renderRowActions(entry)}
          </div>
        </TableCell>
      </TableRow>
      {entry.duplicate_cluster && expandedClusters.has(entry.duplicate_cluster.cluster_id) && (
        <TableRow>
          <TableCell colSpan={10} className="px-3 py-3">
            <DuplicateClusterPanel
              entry={entry}
              entryByTweetId={entryByTweetId}
              expandedClusters={expandedClusters}
              deliverThreshold={deliverThreshold}
              onOpenDetails={onOpenDetails}
              onOpenManualScore={onOpenManualScore}
              onRunDedupe={onRunDedupe}
              onClearDuplicate={onClearDuplicate}
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

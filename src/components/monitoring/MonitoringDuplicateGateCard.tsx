import { formatDistanceToNow } from "date-fns";
import { Ban, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import {
  duplicateCoverageClass,
  duplicateCoverageLabel,
} from "@/lib/monitoringDuplicateEvidence";
import { MonitoringDedupeBadge } from "@/components/monitoring/MonitoringStatusBadges";

interface MonitoringDuplicateGateCardProps {
  entry: MonitoringEntry;
  onRunDedupe: (entry: MonitoringEntry) => void;
  readOnly: boolean;
  mutationDisabledTitle?: string;
}

export function MonitoringDuplicateGateCard({
  entry,
  onRunDedupe,
  readOnly,
  mutationDisabledTitle,
}: MonitoringDuplicateGateCardProps) {
  if (!entry.dedupe_status && !entry.dup_of_tweet_id) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Duplicate Gate</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly}
            title={readOnly ? mutationDisabledTitle : undefined}
            onClick={() => { if (!readOnly) onRunDedupe(entry); }}
          >
            <Ban className="w-3 h-3 mr-1.5" />Run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <MonitoringDedupeBadge entry={entry} />
          {entry.dup_of_tweet_id && <Badge variant="outline">Duplicate of {entry.dup_of_tweet_id}</Badge>}
          {entry.dedupe_checked_at && <Badge variant="outline">{formatDistanceToNow(new Date(entry.dedupe_checked_at), { addSuffix: true })}</Badge>}
        </div>
        {entry.dedupe_reason && <p className="rounded-md border bg-muted/30 p-2">{entry.dedupe_reason}</p>}
        {entry.x_status === 'posted' && entry.duplicate_of?.x_state === 'posted' && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
            Anomaly: both this duplicate and the matched story were posted to X. This row should be treated as historical leakage; future automatic X posts are now blocked at the poster boundary.
          </p>
        )}
        {entry.dup_of_tweet_id && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Matched story</p>
                <p className="break-all font-mono text-xs">{entry.dup_of_tweet_id}</p>
              </div>
              <Badge className={duplicateCoverageClass(entry.duplicate_of?.coverage_state)}>
                {duplicateCoverageLabel(entry.duplicate_of?.coverage_state)}
              </Badge>
            </div>
            {entry.duplicate_of ? (
              <>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-md border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Author</p>
                    <p className="truncate font-medium">{entry.duplicate_of.author_handle ? `@${entry.duplicate_of.author_handle}` : 'Unknown'}</p>
                  </div>
                  <div className="rounded-md border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Score</p>
                    <p className="font-medium">{entry.duplicate_of.final_score ?? entry.duplicate_of.importance_score ?? '—'}</p>
                  </div>
                  <div className="rounded-md border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Telegram</p>
                    <p className="truncate font-medium">{entry.duplicate_of.telegram_state}</p>
                  </div>
                  <div className="rounded-md border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">X</p>
                    <p className="truncate font-medium">{entry.duplicate_of.x_state}</p>
                  </div>
                </div>
                <div className="rounded-md border bg-background/50 p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Matched excerpt</p>
                  <p className="text-sm leading-5">{entry.duplicate_of.text_original || '[No content]'}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{entry.duplicate_of.monitoring_state?.decision_label ?? entry.duplicate_of.delivery_decision ?? 'No decision'}</Badge>
                  {entry.duplicate_of.decision_reason && <span className="min-w-0 break-words">{entry.duplicate_of.decision_reason}</span>}
                  {entry.duplicate_of.url && (
                    <a href={entry.duplicate_of.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Open matched source <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {(entry.duplicate_of.coverage_state === 'not_covered' || entry.duplicate_of.coverage_state === 'also_duplicate') && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
                    This match is not delivered yet. Future duplicate checks now treat this as a coverage gap instead of silently blocking the newer item.
                  </p>
                )}
              </>
            ) : (
              <p className="rounded-md border bg-background/50 p-2 text-xs text-muted-foreground">
                The matched post is not included in this page response yet. Re-run duplicate check or refresh after the backend deploy to load its delivery coverage.
              </p>
            )}
          </div>
        )}
        {entry.dedupe_new_facts && entry.dedupe_new_facts.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">New facts</p>
            <ul className="list-disc space-y-1 pl-4">
              {entry.dedupe_new_facts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

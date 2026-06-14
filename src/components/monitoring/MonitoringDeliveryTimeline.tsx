import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toneClass } from "@/lib/monitoringViewModel";
import type { TimelineDeliverySummary, TimelineEventGroup } from "@/lib/timelineDisplay";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Send, Sparkles, Twitter, Wrench } from "lucide-react";

interface MonitoringDeliveryTimelineProps {
  deliverySummary: TimelineDeliverySummary[];
  timelineGroups: TimelineEventGroup[];
  eventCount: number;
  showDeliverySummary: boolean;
}

function timelineIcon(platform: string, className = "h-4 w-4") {
  if (platform === 'Telegram') return <Send className={className} />;
  if (platform === 'X' || platform === 'X read') return <Twitter className={className} />;
  if (platform === 'OpenAI') return <Sparkles className={className} />;
  if (platform === 'Media') return <MessageSquare className={className} />;
  return <Wrench className={className} />;
}

function relativeTimestamp(rawTimestamp: string | null): string | null {
  if (!rawTimestamp) return null;
  const date = new Date(rawTimestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function timelineDotClass(tone: TimelineEventGroup['statusTone']) {
  if (tone === 'good') return 'border-emerald-500';
  if (tone === 'bad') return 'border-destructive';
  if (tone === 'warn') return 'border-amber-500';
  if (tone === 'info') return 'border-blue-500';
  return 'border-muted-foreground';
}

export function MonitoringDeliveryTimeline({
  deliverySummary,
  timelineGroups,
  eventCount,
  showDeliverySummary,
}: MonitoringDeliveryTimelineProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Delivery timeline</CardTitle>
        <p className="text-xs text-muted-foreground">
          External delivery states first, then internal pipeline work.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {showDeliverySummary && (
          <div className="grid gap-2">
            {deliverySummary.map((item) => {
              const relative = relativeTimestamp(item.rawTimestamp);
              return (
                <div key={item.platform} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${toneClass(item.tone)}`}>
                        {timelineIcon(item.platform, "h-4 w-4")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.platform}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                    <Badge className={`${toneClass(item.tone)} shrink-0`}>{item.label}</Badge>
                  </div>
                  {item.timestamp ? (
                    <div className="mt-3 rounded-md border bg-background/40 px-2 py-1.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {item.timestampLabel}
                      </p>
                      <time dateTime={item.rawTimestamp ?? undefined} className="block text-xs font-medium">
                        {item.timestamp}
                      </time>
                      {relative && <p className="text-[11px] text-muted-foreground">{relative}</p>}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No exact platform timestamp available.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline work</p>
            {timelineGroups.length > 0 && (
              <Badge variant="outline" className="text-[11px]">
                {eventCount} event{eventCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          {timelineGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
              No pipeline events found
            </p>
          ) : (
            <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[0.45rem] before:top-3 before:w-px before:bg-border">
              {timelineGroups.map((group) => {
                const relative = relativeTimestamp(group.rawTimestamp);
                const hasExpandedUpdates = group.events.length > 1;
                return (
                  <div key={group.key} className="relative pl-5">
                    <span className={`absolute left-0 top-3 h-3 w-3 rounded-full border-2 bg-background ${timelineDotClass(group.statusTone)}`} />
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass(group.platformTone)}`}>
                              {timelineIcon(group.platform, "h-3 w-3")}
                              {group.platform}
                            </span>
                            <p className="text-sm font-semibold">{group.title}</p>
                          </div>
                          {group.detail && <p className="mt-1 text-xs text-muted-foreground">{group.detail}</p>}
                        </div>
                        <Badge className={`${toneClass(group.statusTone)} shrink-0`}>{group.statusLabel}</Badge>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div className="rounded-md border bg-background/40 px-2 py-1.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest update</p>
                          <time dateTime={group.rawTimestamp ?? undefined} className="block font-medium">
                            {group.timestamp}
                          </time>
                          {relative && <p className="text-[11px] text-muted-foreground">{relative}</p>}
                        </div>
                        <div className="rounded-md border bg-background/40 px-2 py-1.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Run details</p>
                          <p className="font-medium">
                            {group.duration ? `${group.duration} total` : 'Duration not recorded'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {group.updateCount} update{group.updateCount === 1 ? '' : 's'}
                          </p>
                          {group.timingBadges.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {group.timingBadges.map((badge) => (
                                <span key={`${badge.label}-${badge.value}`} className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {badge.label} {badge.value}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {hasExpandedUpdates && (
                        <div className="mt-3 space-y-1.5 rounded-md border bg-background/35 p-2">
                          {group.events.map((event, eventIndex) => (
                            <div key={`${event.rawStep}-${event.statusLabel}-${event.rawTimestamp ?? eventIndex}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                              <Badge variant="outline" className={toneClass(event.statusTone)}>{event.statusLabel}</Badge>
                              <span className="font-mono text-muted-foreground">{event.rawStep}</span>
                              <span className="text-muted-foreground">{event.timestamp}</span>
                              {event.duration && <span className="text-muted-foreground">({event.duration})</span>}
                              {event.timingBadges.map((badge) => (
                                <span key={`${badge.label}-${badge.value}`} className="rounded border border-border/70 px-1 py-0.5 text-muted-foreground">
                                  {badge.label} {badge.value}
                                </span>
                              ))}
                              {event.errorTitle && <span className="text-destructive">{event.errorTitle}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {!hasExpandedUpdates && group.events[0]?.errorTitle && (
                        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                          <p className="font-medium">{group.events[0].errorTitle}</p>
                          {group.events[0].errorDetail && <p className="mt-1 line-clamp-3">{group.events[0].errorDetail}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

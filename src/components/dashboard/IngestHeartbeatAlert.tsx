import { Card, CardContent } from '@/components/ui/card';
import { Activity, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { IngestHeartbeat } from '@/hooks/useDashboardData';

interface Props {
  heartbeat?: IngestHeartbeat;
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return 'never';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) return `${hours}h ${remMin}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export function IngestHeartbeatAlert({ heartbeat }: Props) {
  if (!heartbeat) return null;
  const { state, lastPostAt, ageSeconds, warnMinutes, criticalMinutes } = heartbeat;

  const variants = {
    ok: {
      icon: Activity,
      iconClass: 'text-success',
      borderClass: 'border-success/30',
      bgClass: 'bg-success/5',
      label: 'Ingest healthy',
    },
    warning: {
      icon: AlertTriangle,
      iconClass: 'text-warning',
      borderClass: 'border-warning/40',
      bgClass: 'bg-warning/10',
      label: 'Ingest delayed',
    },
    critical: {
      icon: AlertOctagon,
      iconClass: 'text-destructive',
      borderClass: 'border-destructive/40',
      bgClass: 'bg-destructive/10',
      label: 'Ingest stalled',
    },
  } as const;

  const v = variants[state];
  const Icon = v.icon;
  const ageLabel = formatAge(ageSeconds);
  const lastTs = lastPostAt ? new Date(lastPostAt).toLocaleString() : 'never';

  return (
    <Card className={`glass-card ${v.borderClass} ${v.bgClass}`}>
      <CardContent className="py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${v.iconClass} ${state === 'ok' ? 'animate-pulse' : ''}`} />
          <div>
            <div className="text-sm font-semibold text-glass-foreground">
              {v.label} · last post {ageLabel}
            </div>
            <div className="text-xs text-muted-foreground">
              Last ingest: {lastTs} · thresholds: warn {warnMinutes}m / critical {criticalMinutes}m
            </div>
          </div>
        </div>
        {state !== 'ok' && (
          <div className="text-xs text-muted-foreground hidden sm:block">
            Check RSS.app webhook configuration
          </div>
        )}
      </CardContent>
    </Card>
  );
}

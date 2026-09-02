import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useSaveSettings } from '@/hooks/useSettingsData';
import { Gauge, Save, Loader2 } from 'lucide-react';
import { useXApiSummary } from '@/hooks/useMonitoringData';

export interface XRateLimitsValue {
  posts_per_hour: number;
  posts_per_day: number;
  monthly_post_budget: number;
  media_uploads_per_day: number;
  hydrations_per_day: number;
}

const DEFAULTS: XRateLimitsValue = {
  posts_per_hour: 20,
  posts_per_day: 100,
  monthly_post_budget: 2500,
  media_uploads_per_day: 200,
  hydrations_per_day: 400,
};

interface Props {
  initial?: Partial<XRateLimitsValue>;
  monthlyPostsCount?: number;
  enabled?: boolean;
}

function pctColor(pct: number) {
  if (pct >= 90) return 'text-destructive';
  if (pct >= 70) return 'text-warning';
  return 'text-success';
}

function wholeLimit(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export default function XRateLimits({ initial, monthlyPostsCount = 0, enabled = true }: Props) {
  const save = useSaveSettings();
  const { data: xApiSummary } = useXApiSummary(24, false, enabled);
  const [cfg, setCfg] = useState<XRateLimitsValue>({ ...DEFAULTS, ...(initial ?? {}) });

  useEffect(() => { setCfg({ ...DEFAULTS, ...(initial ?? {}) }); }, [initial]);

  const localPosts1h = xApiSummary?.posts_last_hour ?? 0;
  const hourPct = Math.min(100, (localPosts1h / Math.max(1, cfg.posts_per_hour)) * 100);
  const localPosts24h = xApiSummary?.posts_local ?? 0;
  const localMedia24h = xApiSummary?.media_posts_local ?? 0;
  const localAttempts24h = xApiSummary?.counted_attempts ?? 0;
  const dayPct = Math.min(100, (localPosts24h / Math.max(1, cfg.posts_per_day)) * 100);
  const monthPct = Math.min(100, (monthlyPostsCount / Math.max(1, cfg.monthly_post_budget)) * 100);
  const mediaPct = Math.min(100, (localMedia24h / Math.max(1, cfg.media_uploads_per_day)) * 100);

  const update = (patch: Partial<XRateLimitsValue>) => setCfg((c) => ({ ...c, ...patch }));
  const handleSave = () => save.mutate({ key: 'x_rate_limits', value: cfg });

  const Row = ({ label, current, limit, pct }: { label: string; current: number; limit: number; pct: number }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${pctColor(pct)}`}>{current.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <Gauge className="w-5 h-5 mr-2" />Rate Limits & Quotas
        </CardTitle>
        <CardDescription>
          Configured X posting budgets. The worker skips posts that exceed these local limits; official project caps should be checked in the X Developer Console or synced usage panel.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Live usage */}
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-glass-foreground">Live usage</p>
            <Badge variant="outline" className="text-xs">rolling windows</Badge>
          </div>
          <Row label="Last hour" current={localPosts1h} limit={cfg.posts_per_hour} pct={hourPct} />
          <Row label="Last 24h" current={localPosts24h} limit={cfg.posts_per_day} pct={dayPct} />
          <Row label="Last 30 days" current={monthlyPostsCount} limit={cfg.monthly_post_budget} pct={monthPct} />
          <Row label="Media posts (24h)" current={localMedia24h} limit={cfg.media_uploads_per_day} pct={mediaPct} />
          <Row label="Local X attempts (24h)" current={localAttempts24h} limit={Math.max(1, cfg.posts_per_day + cfg.hydrations_per_day + cfg.media_uploads_per_day)} pct={Math.min(100, (localAttempts24h / Math.max(1, cfg.posts_per_day + cfg.hydrations_per_day + cfg.media_uploads_per_day)) * 100)} />
        </div>

        {/* Edit limits */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="posts_per_hour">Posts / hour</Label>
            <Input id="posts_per_hour" type="number" min={1} max={1000} step={1} value={cfg.posts_per_hour}
              onChange={(e) => update({ posts_per_hour: wholeLimit(e.target.value, 1, 1000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="posts_per_day">Posts / day</Label>
            <Input id="posts_per_day" type="number" min={1} max={10000} step={1} value={cfg.posts_per_day}
              onChange={(e) => update({ posts_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monthly_budget">Monthly post budget</Label>
            <Input id="monthly_budget" type="number" min={1} max={1000000} step={1} value={cfg.monthly_post_budget}
              onChange={(e) => update({ monthly_post_budget: wholeLimit(e.target.value, 1, 1000000) })} className="glass-input" />
            <p className="text-xs text-muted-foreground">Your configured monthly write budget. Keep this aligned with the cap shown in X Developer Console.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="media_uploads_per_day">Media uploads / day</Label>
            <Input id="media_uploads_per_day" type="number" min={1} max={10000} step={1} value={cfg.media_uploads_per_day}
              onChange={(e) => update({ media_uploads_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hydrations_per_day">Tweet hydrations / day (X API reads)</Label>
            <Input id="hydrations_per_day" type="number" min={1} max={10000} step={1} value={cfg.hydrations_per_day}
              onChange={(e) => update({ hydrations_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
            <p className="text-xs text-muted-foreground">Daily cap on X API reads used to hydrate truncated high-scoring tweets.</p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={save.isPending} className="bg-gradient-primary hover:opacity-90 text-white">
          {save.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save limits</>}
        </Button>
      </CardContent>
    </Card>
  );
}

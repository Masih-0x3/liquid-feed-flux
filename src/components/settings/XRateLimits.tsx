import { useMemo } from 'react';
import { useSettingsDraft, useSettingsSave, SettingsSaveStatus, SettingsIncomingNotice } from '@/components/settings/SettingsDrafts';
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
  monthlyPostsCount?: number | null;
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

export default function XRateLimits({ initial, monthlyPostsCount, enabled = true }: Props) {
  const save = useSaveSettings();
  const { data: xApiSummary, error: usageError, dataUpdatedAt: usageUpdatedAt } = useXApiSummary(24, false, enabled);
  const incoming = useMemo(() => ({ ...DEFAULTS, ...(initial ?? {}) }), [initial]);
  const editor = useSettingsDraft('x-limits', 'X rate limits', incoming);
  const { draft: cfg, updateDraft: setCfg } = editor;
  const savedLimits = editor.baseline;
  const saving = useSettingsSave(editor, (value) => save.mutateAsync({ key: 'x_rate_limits', value }));

  const localPosts1h = xApiSummary?.posts_last_hour ?? 0;
  const hourPct = Math.min(100, (localPosts1h / Math.max(1, savedLimits.posts_per_hour)) * 100);
  const localPosts24h = xApiSummary?.posts_local ?? 0;
  const dayPct = Math.min(100, (localPosts24h / Math.max(1, savedLimits.posts_per_day)) * 100);
  const monthPct = Math.min(100, ((monthlyPostsCount ?? 0) / Math.max(1, savedLimits.monthly_post_budget)) * 100);

  const update = (patch: Partial<XRateLimitsValue>) => setCfg((c) => ({ ...c, ...patch }));
  const handleSave = () => { void saving.save(); };

  const Row = ({ label, current, limit, pct }: { label: string; current: number | null | undefined; limit: number; pct: number }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${current == null ? 'text-muted-foreground' : pctColor(pct)}`}>{current == null ? 'Unavailable' : current.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      {current != null && <Progress aria-label={`${label} local budget used`} value={pct} className="h-1.5" />}
    </div>
  );

  return (
    <Card id="x-limits" className="glass-card scroll-mt-48">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <Gauge className="w-5 h-5 mr-2" />Rate Limits & Quotas
        </CardTitle>
        <CardDescription>
          Configured X posting budgets. The worker skips posts that exceed these local limits; official project caps should be checked in the X Developer Console or synced usage panel.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <SettingsSaveStatus label="X rate limits" dirty={editor.isDirty} {...saving} onSave={handleSave} disabled={editor.hasPendingIncoming} />
        <SettingsIncomingNotice editor={editor} />
        {/* Live usage */}
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-glass-foreground">Local ledger usage</p>
            <Badge variant="outline" className="text-xs">rolling windows</Badge>
          </div>
          {usageError && <p role="status" className="text-sm text-amber-200">Refresh failed. Displayed usage is from the last successful snapshot.</p>}
          <p className="text-xs text-muted-foreground">Last successful refresh: {usageUpdatedAt ? new Date(usageUpdatedAt).toLocaleString() : 'unavailable'}.</p>
          <p className="text-xs text-muted-foreground">Measured local posts against the last saved budgets. These are not the official X billing totals. Last recorded event: {xApiSummary?.latest_event_at ? new Date(xApiSummary.latest_event_at).toLocaleString() : 'unavailable'}.</p>
          <Row label="Posts (last hour)" current={xApiSummary?.posts_last_hour} limit={savedLimits.posts_per_hour} pct={hourPct} />
          <Row label="Posts (last 24h)" current={xApiSummary?.posts_local} limit={savedLimits.posts_per_day} pct={dayPct} />
          <Row label="Posts (last 30 days)" current={monthlyPostsCount} limit={savedLimits.monthly_post_budget} pct={monthPct} />
          <dl className="grid grid-cols-1 gap-2 border-t pt-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Posts with media (24h)</dt><dd>{xApiSummary?.media_posts_local == null ? 'Unavailable' : xApiSummary.media_posts_local.toLocaleString()}</dd></div>
            <div><dt className="text-muted-foreground">Counted X API attempts (24h)</dt><dd>{xApiSummary?.counted_attempts == null ? 'Unavailable' : xApiSummary.counted_attempts.toLocaleString()}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Posts with media are not an upload count. The upload quota cannot be inferred from this summary, and API attempts span several independently limited operations.</p>
        </div>

        {/* Edit limits */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="posts_per_hour">Posts / hour</Label>
            <Input aria-label="Posts / hour" id="posts_per_hour" type="number" min={1} max={1000} step={1} value={cfg.posts_per_hour}
              onChange={(e) => update({ posts_per_hour: wholeLimit(e.target.value, 1, 1000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="posts_per_day">Posts / day</Label>
            <Input aria-label="Posts / day" id="posts_per_day" type="number" min={1} max={10000} step={1} value={cfg.posts_per_day}
              onChange={(e) => update({ posts_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monthly_budget">Monthly post budget</Label>
            <Input aria-label="Monthly post budget" id="monthly_budget" type="number" min={1} max={1000000} step={1} value={cfg.monthly_post_budget}
              onChange={(e) => update({ monthly_post_budget: wholeLimit(e.target.value, 1, 1000000) })} className="glass-input" />
            <p className="text-xs text-muted-foreground">Your configured monthly write budget. Keep this aligned with the cap shown in X Developer Console.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="media_uploads_per_day">Media uploads / day</Label>
            <Input aria-label="Media uploads / day" id="media_uploads_per_day" type="number" min={1} max={10000} step={1} value={cfg.media_uploads_per_day}
              onChange={(e) => update({ media_uploads_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hydrations_per_day">Tweet hydrations / day (X API reads)</Label>
            <Input aria-label="Tweet hydrations / day (X API reads)" id="hydrations_per_day" type="number" min={1} max={10000} step={1} value={cfg.hydrations_per_day}
              onChange={(e) => update({ hydrations_per_day: wholeLimit(e.target.value, 1, 10000) })} className="glass-input" />
            <p className="text-xs text-muted-foreground">Daily cap on X API reads used to hydrate truncated high-scoring tweets.</p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={save.isPending} >
          {save.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save limits</>}
        </Button>
      </CardContent>
    </Card>
  );
}

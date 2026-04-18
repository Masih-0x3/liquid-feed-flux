import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useSaveSettings } from '@/hooks/useSettingsData';
import { PromptEditor } from '@/components/settings/PromptEditor';
import { Newspaper, Save, Sparkles, Loader2, ImageIcon, Eye } from 'lucide-react';

export interface XPostingConfigValue {
  enabled: boolean;
  min_score: number;
  require_media: boolean;
  post_template: string;
  leading_emoji: string;
  hashtags: string;
  max_chars: number;
  dedupe_window_hours: number;
  post_only_decision_deliver: boolean;
}

const DEFAULTS: XPostingConfigValue = {
  enabled: false,
  min_score: 14,
  require_media: true,
  post_template: '{leading_emoji} {translated_text}',
  leading_emoji: '📰',
  hashtags: '',
  max_chars: 280,
  dedupe_window_hours: 48,
  post_only_decision_deliver: true,
};

const PLACEHOLDERS = [
  { key: '{leading_emoji}', desc: 'News emoji prefix' },
  { key: '{translated_text}', desc: 'Persian translation' },
  { key: '{hashtags}', desc: 'Configured hashtags' },
  { key: '{author_handle}', desc: 'Original author' },
];

interface Props {
  initial?: Partial<XPostingConfigValue>;
}

export default function XPostingConfig({ initial }: Props) {
  const { toast } = useToast();
  const save = useSaveSettings();
  const [cfg, setCfg] = useState<XPostingConfigValue>({ ...DEFAULTS, ...(initial ?? {}) });
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ results?: Array<Record<string, unknown>> } | null>(null);

  useEffect(() => { setCfg({ ...DEFAULTS, ...(initial ?? {}) }); }, [initial]);

  const update = (patch: Partial<XPostingConfigValue>) => setCfg((c) => ({ ...c, ...patch }));

  const handleSave = () => save.mutate({ key: 'x_posting_config', value: cfg });

  const insertPlaceholder = (ph: string) => update({ post_template: cfg.post_template + ' ' + ph });

  const RLM = '\u200F';
  const previewText = RLM + cfg.post_template
    .split('{leading_emoji}').join(cfg.leading_emoji)
    .split('{translated_text}').join('این یک نمونه‌ی پیش‌نمایش از پست خبری ترجمه‌شده است.')
    .split('{hashtags}').join(cfg.hashtags)
    .split('{author_handle}').join('example_user')
    .replace(/\n{3,}/g, '\n\n').trim()
    .slice(0, Math.max(1, cfg.max_chars - 1));

  const runDryRun = async () => {
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'dry_run_x_post' },
      });
      if (error) throw error;
      setDryRunResult(data);
      toast({ title: 'Dry-run complete', description: `${data?.results?.length ?? 0} candidates evaluated.` });
    } catch (e) {
      toast({ title: 'Dry-run failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setDryRunLoading(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <Newspaper className="w-5 h-5 mr-2" />X Posting Configuration
        </CardTitle>
        <CardDescription>
          Score-gated, media-required posts are formatted and posted to your X account. Disabled by default.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enable */}
        <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
          <div>
            <Label htmlFor="x_enabled" className="font-medium">Enable X posting</Label>
            <p className="text-xs text-muted-foreground mt-1">When off, the cron worker will skip all posts.</p>
          </div>
          <Switch id="x_enabled" checked={cfg.enabled} onCheckedChange={(v) => update({ enabled: v })} />
        </div>

        {/* Score gate */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Minimum importance score</Label>
            <Badge variant="secondary">{cfg.min_score}/20</Badge>
          </div>
          <Slider value={[cfg.min_score]} min={1} max={20} step={1} onValueChange={([v]) => update({ min_score: v })} />
          <p className="text-xs text-muted-foreground">Only posts scored ≥ this threshold are eligible.</p>
        </div>

        {/* Media rules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer opacity-70">
            <Checkbox checked disabled />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" />Attach media when available</p>
              <p className="text-xs text-muted-foreground mt-0.5">Posts with downloaded images attach them automatically. Posts without media are still posted as text-only — no media-upload API call is made.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer">
            <Checkbox checked={cfg.post_only_decision_deliver} onCheckedChange={(v) => update({ post_only_decision_deliver: !!v })} />
            <div>
              <p className="text-sm font-medium">Only post items already approved for Telegram delivery</p>
              <p className="text-xs text-muted-foreground mt-0.5">Recommended — keeps X in sync with the content filter decision.</p>
            </div>
          </label>
        </div>

        <Separator />

        {/* Template */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Post template</Label>
            <span className="text-xs text-muted-foreground">{cfg.post_template.length} chars</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <Button key={p.key} type="button" variant="outline" size="sm"
                className="h-7 text-xs" onClick={() => insertPlaceholder(p.key)} title={p.desc}>
                {p.key}
              </Button>
            ))}
          </div>
          <PromptEditor
            value={cfg.post_template}
            onChange={(v) => update({ post_template: v })}
            placeholder="{leading_emoji} {translated_text}"
            minHeight={140}
            maxLength={1000}
            title="X post template"
            onReset={() => update({ post_template: DEFAULTS.post_template })}
            mono
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="leading_emoji">Leading emoji</Label>
            <Input id="leading_emoji" value={cfg.leading_emoji} onChange={(e) => update({ leading_emoji: e.target.value })} className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hashtags">Hashtags</Label>
            <Input id="hashtags" value={cfg.hashtags} onChange={(e) => update({ hashtags: e.target.value })} placeholder="#News #Iran" className="glass-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max_chars">Max characters</Label>
            <Input id="max_chars" type="number" min={50} max={4000} value={cfg.max_chars}
              onChange={(e) => update({ max_chars: Math.max(50, Math.min(4000, Number(e.target.value) || 280)) })} className="glass-input" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dedupe_hours">Dedupe window (hours)</Label>
          <Input id="dedupe_hours" type="number" min={1} max={720} value={cfg.dedupe_window_hours}
            onChange={(e) => update({ dedupe_window_hours: Math.max(1, Math.min(720, Number(e.target.value) || 48)) })} className="glass-input max-w-[200px]" />
          <p className="text-xs text-muted-foreground">A post will not be reposted to X within this window.</p>
        </div>

        {/* Live preview */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="w-3.5 h-3.5" /><span>Live preview</span>
            <Badge variant="outline" className="ml-auto text-xs">{previewText.length}/{cfg.max_chars}</Badge>
          </div>
          <div dir="rtl" lang="fa" className="whitespace-pre-wrap text-sm text-glass-foreground bg-background/50 p-3 rounded text-right">{previewText || '(empty)'}</div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={save.isPending} className="bg-gradient-primary hover:opacity-90 text-white">
            {save.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save configuration</>}
          </Button>
          <Button onClick={runDryRun} disabled={dryRunLoading} variant="outline">
            {dryRunLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running...</> : <><Sparkles className="w-4 h-4 mr-2" />Dry-run on latest eligible</>}
          </Button>
        </div>

        {dryRunResult && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
            <p className="font-medium text-glass-foreground">Dry-run results ({dryRunResult.results?.length ?? 0})</p>
            {(dryRunResult.results || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No eligible posts found in the dedupe window.</p>
            )}
            {(dryRunResult.results || []).map((r, i) => (
              <div key={i} className="border-l-2 border-primary/40 pl-3 text-xs space-y-1">
                <div className="flex gap-2 items-center">
                  <Badge variant={r.status === 'dry_run' ? 'default' : 'secondary'}>{String(r.status)}</Badge>
                  <code>{String(r.tweet_id)}</code>
                  {r.reason && <span className="text-muted-foreground">— {String(r.reason)}</span>}
                </div>
                {r.preview_text && <div className="whitespace-pre-wrap p-2 bg-background/50 rounded">{String(r.preview_text)}</div>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

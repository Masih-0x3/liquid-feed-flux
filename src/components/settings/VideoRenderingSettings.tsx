import { useMemo, useRef } from 'react';
import { useSettingsDraft, useSettingsSave, SettingsSaveStatus, SettingsIncomingNotice } from '@/components/settings/SettingsDrafts';
import { VideoStylePreview } from '@/components/settings/VideoStylePreview';
import { SettingsNumberField } from '@/components/settings/SettingsNumberField';
import { Link } from 'react-router-dom';
import { AlertTriangle, Film, Loader2, RefreshCw, Save, Settings2, Shield, Wand2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useUpdateVideoRenderConfig,
  useVideoRenderConfig,
  useVideoRenderOverview,
  type VideoRenderConfigValue,
} from '@/hooks/useVideoRenderData';

function cloneConfig(config: VideoRenderConfigValue): VideoRenderConfigValue {
  return JSON.parse(JSON.stringify(config)) as VideoRenderConfigValue;
}

function numberValue(value: number | undefined, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasFiniteNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string');
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function isVideoRenderConfig(value: unknown): value is VideoRenderConfigValue {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || !hasStrings(value, ['render_version', 'transcription_model', 'translation_model', 'vision_model'])
    || !hasFiniteNumbers(value, ['retention_hours'])
    || !isOneOf(value.mode, ['disabled', 'shadow', 'enabled'])
    || !isOneOf(value.failure_policy, ['post_original', 'block'])
    || !isOneOf(value.transcription_provider, ['deepgram', 'openai'])
    || !isOneOf(value.target_language_rule, ['fa_except_fa_to_en'])
    || !(value.renderer_url === null || typeof value.renderer_url === 'string')) {
    return false;
  }

  const subtitle = value.subtitle_style;
  const delogo = value.delogo;
  const watermark = value.watermark;
  return isRecord(subtitle)
    && hasStrings(subtitle, ['text_color', 'background_color'])
    && hasFiniteNumbers(subtitle, ['font_scale', 'max_width_pct', 'bottom_padding_pct', 'collision_gap_pct'])
    && isRecord(delogo)
    && isOneOf(delogo.vision_mode, ['off', 'auto', 'always'])
    && isOneOf(delogo.engine, ['opencv', 'ffmpeg'])
    && hasFiniteNumbers(delogo, [
      'max_regions',
      'max_single_area_ratio',
      'max_total_area_ratio',
      'opencv_radius',
      'opencv_kernel',
      'opencv_dilate_iterations',
      'opencv_feather',
    ])
    && isRecord(watermark)
    && isOneOf(watermark.apply_when, ['subtitle_track', 'modified', 'always', 'never'])
    && typeof watermark.multiple === 'boolean'
    && typeof watermark.cover_delogo === 'boolean'
    && hasFiniteNumbers(watermark, ['opacity', 'top_right_opacity', 'cover_opacity', 'cover_padding_pct']);
}

export default function VideoRenderingSettings() {
  const configQuery = useVideoRenderConfig();
  const overview = useVideoRenderOverview();
  const update = useUpdateVideoRenderConfig();
  const incoming = useMemo(() => isVideoRenderConfig(configQuery.data?.config) ? cloneConfig(configQuery.data.config) : null, [configQuery.data?.config]);
  const editor = useSettingsDraft('video-rendering', 'Video rendering settings', incoming);
  const { draft, updateDraft: setDraft } = editor;
  const formRef = useRef<HTMLFormElement>(null);
  const saving = useSettingsSave(editor, async (value) => {
    if (!value) throw new Error('Configuration unavailable');
    await update.mutateAsync(value);
  });
  const save = () => {
    const form = formRef.current;
    if (!form) return;
    const invalid = form.querySelector(':invalid');
    // Reveal advanced fields before the browser focuses a validation error.
    for (let ancestor = invalid?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    if (form.reportValidity()) void saving.save();
  };

  if (configQuery.isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex min-h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (configQuery.isError || configQuery.error || !incoming || !draft) {
    return (
      <Card className="glass-card border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-glass-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Video rendering settings are unavailable
          </CardTitle>
          <CardDescription>
            An authoritative renderer configuration could not be loaded. Changes remain disabled until it is available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => { void configQuery.refetch(); }} disabled={configQuery.isFetching}>
            {configQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Retry loading settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  const set = (patch: Partial<VideoRenderConfigValue>) => setDraft({ ...draft, ...patch });
  const setSubtitle = (patch: Partial<VideoRenderConfigValue['subtitle_style']>) => set({ subtitle_style: { ...draft.subtitle_style, ...patch } });
  const setDelogo = (patch: Partial<VideoRenderConfigValue['delogo']>) => set({ delogo: { ...draft.delogo, ...patch } });
  const setWatermark = (patch: Partial<VideoRenderConfigValue['watermark']>) => set({ watermark: { ...draft.watermark, ...patch } });
  const rendererHealth = overview.data?.renderer_health;

  return (
    <form ref={formRef} className="space-y-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <SettingsSaveStatus label="Video rendering settings" dirty={editor.isDirty} {...saving} onSave={save} disabled={editor.hasPendingIncoming} />
      <SettingsIncomingNotice editor={editor} />
      <Alert className="border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Production-safe rollout</AlertTitle>
        <AlertDescription>
          Keep this in disabled or shadow mode until the Ubuntu renderer heartbeat is healthy and one manual render has been reviewed.
          API keys are not shown here; OpenAI, Deepgram, Supabase service role, and renderer tokens stay in server-side env files.
        </AlertDescription>
      </Alert>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card id="video-mode" className="glass-card scroll-mt-48">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-glass-foreground">
                <Film className="h-5 w-5 text-primary" />
                Subtitle Creator Mode
              </CardTitle>
              <CardDescription>Controls whether video rendering affects Telegram/X posting.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={draft.mode} onValueChange={(mode) => set({ mode: mode as VideoRenderConfigValue['mode'], enabled: mode === 'enabled' })}>
                  <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="shadow">Shadow review</SelectItem>
                    <SelectItem value="enabled">Enabled gate</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Shadow can render for review but posts originals.</p>
              </div>
              <div className="space-y-2">
                <Label>Failure policy</Label>
                <Select value={draft.failure_policy} onValueChange={(failure_policy) => set({ failure_policy: failure_policy as VideoRenderConfigValue['failure_policy'] })}>
                  <SelectTrigger aria-label="Failure policy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="post_original">Post original on render failure</SelectItem>
                    <SelectItem value="block">Block on render failure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Processed retention hours</Label>
                <Input aria-label="Processed retention hours"
                  type="number"
                  min={1}
                  max={168}
                  value={draft.retention_hours}
                  onChange={(event) => set({ retention_hours: numberValue(Number(event.target.value), 24) })}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-glass-foreground">
                <Wand2 className="h-5 w-5 text-primary" />
                Models and Language Rule
              </CardTitle>
              <CardDescription>Speech-to-text and translation defaults for production renders.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label>Transcription provider</Label>
                <Select value={draft.transcription_provider} onValueChange={(transcription_provider) => set({ transcription_provider: transcription_provider as VideoRenderConfigValue['transcription_provider'] })}>
                  <SelectTrigger aria-label="Transcription provider"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepgram">Deepgram</SelectItem>
                    <SelectItem value="openai">OpenAI fallback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Transcription model</Label>
                <Input aria-label="Transcription model" value={draft.transcription_model} onChange={(event) => set({ transcription_model: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Translation model</Label>
                <Input aria-label="Translation model" value={draft.translation_model} onChange={(event) => set({ translation_model: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vision model</Label>
                <Input aria-label="Vision model" value={draft.vision_model} onChange={(event) => set({ vision_model: event.target.value })} />
              </div>
              <div className="rounded-md border bg-muted/20 p-3 md:col-span-2 xl:col-span-4">
                <p className="text-sm font-medium">Target language rule</p>
                <p className="mt-1 text-sm text-muted-foreground">Every usable non-Persian video gets Persian subtitles. Persian speech gets English subtitles.</p>
              </div>
            </CardContent>
          </Card>

          <Card id="video-style" className="glass-card scroll-mt-48">
            <CardHeader>
              <CardTitle className="text-glass-foreground">Subtitle Style</CardTitle>
              <CardDescription>Review placement, wrapping and colors before saving. The preview stays local.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="md:col-span-2 xl:col-span-3"><VideoStylePreview config={draft} /></div>
              <div className="space-y-2">
                <Label>Text color</Label>
                <Input aria-label="Text color" type="color" value={draft.subtitle_style.text_color} onChange={(event) => setSubtitle({ text_color: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Background color</Label>
                <Input aria-label="Background color" type="color" value={draft.subtitle_style.background_color} onChange={(event) => setSubtitle({ background_color: event.target.value })} />
              </div>
              <SettingsNumberField label="Font scale" value={draft.subtitle_style.font_scale} onChange={(value) => setSubtitle({ font_scale: value })} min={0.75} max={1.35} step={0.01} unit="times the renderer’s base font size" />
              <SettingsNumberField label="Max width" value={draft.subtitle_style.max_width_pct} onChange={(value) => setSubtitle({ max_width_pct: value })} min={0.72} max={0.96} step={0.01} unit="percent of frame width" percent />
              <SettingsNumberField label="Bottom padding" value={draft.subtitle_style.bottom_padding_pct} onChange={(value) => setSubtitle({ bottom_padding_pct: value })} min={0.025} max={0.14} step={0.005} unit="percent of frame height" percent />
              <div className="space-y-2"><p className="text-sm font-medium">Collision gap (saved reference)</p><p className="text-sm">{Number((draft.subtitle_style.collision_gap_pct * 100).toFixed(2))}% of frame height</p><p className="text-xs text-muted-foreground">The current renderer computes collision spacing automatically and does not apply this saved field.</p></div>
            </CardContent>
          </Card>

          <Card id="video-watermark" className="glass-card scroll-mt-48">
            <CardHeader>
              <CardTitle className="text-glass-foreground">Delogo and Watermark</CardTitle>
              <CardDescription>Controls source watermark removal and our @Masihh watermark behavior.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <div className="grid gap-2">
                  <Label>Vision mode</Label>
                  <Select value={draft.delogo.vision_mode} onValueChange={(vision_mode) => setDelogo({ vision_mode: vision_mode as VideoRenderConfigValue['delogo']['vision_mode'] })}>
                    <SelectTrigger aria-label="Vision mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Always inspect</SelectItem>
                      <SelectItem value="auto">Only uncertain videos</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Delogo engine</Label>
                  <Select value={draft.delogo.engine} onValueChange={(engine) => setDelogo({ engine: engine as VideoRenderConfigValue['delogo']['engine'] })}>
                    <SelectTrigger aria-label="Delogo engine"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="opencv">OpenCV selective inpaint</SelectItem>
                      <SelectItem value="ffmpeg">FFmpeg delogo fallback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SettingsNumberField label="Max regions" value={draft.delogo.max_regions} onChange={(value) => setDelogo({ max_regions: value })} min={0} max={4} step={1} unit="regions" />
                  <SettingsNumberField label="Single area" value={draft.delogo.max_single_area_ratio} onChange={(value) => setDelogo({ max_single_area_ratio: value })} min={0.01} max={0.3} step={0.01} unit="percent of frame area per region" percent />
                  <SettingsNumberField label="Total area" value={draft.delogo.max_total_area_ratio} onChange={(value) => setDelogo({ max_total_area_ratio: value })} min={0.02} max={0.45} step={0.01} unit="percent of total frame area" percent />
                </div>
                <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Advanced inpainting parameters</summary><div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <SettingsNumberField label="Radius" value={draft.delogo.opencv_radius} onChange={(value) => setDelogo({ opencv_radius: value })} min={1} max={8} step={1} unit="pixels" />
                  <SettingsNumberField label="Kernel" value={draft.delogo.opencv_kernel} onChange={(value) => setDelogo({ opencv_kernel: value })} min={3} max={21} step={1} unit="pixels" />
                  <SettingsNumberField label="Dilate" value={draft.delogo.opencv_dilate_iterations} onChange={(value) => setDelogo({ opencv_dilate_iterations: value })} min={0} max={8} step={1} unit="iterations" />
                  <SettingsNumberField label="Feather" value={draft.delogo.opencv_feather} onChange={(value) => setDelogo({ opencv_feather: value })} min={0} max={12} step={1} unit="pixels" />
                </div>
                </div></details>
              </div>
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <div className="space-y-2">
                  <Label>Apply @Masihh watermark</Label>
                  <Select value={draft.watermark.apply_when} onValueChange={(apply_when) => setWatermark({ apply_when: apply_when as VideoRenderConfigValue['watermark']['apply_when'] })}>
                    <SelectTrigger aria-label="Apply @Masihh watermark">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subtitle_track">Only when subtitles are added</SelectItem>
                      <SelectItem value="modified">When any video processing is applied</SelectItem>
                      <SelectItem value="always">Always</SelectItem>
                      <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingsNumberField label="Global opacity" value={draft.watermark.opacity} onChange={(value) => setWatermark({ opacity: value })} min={0.03} max={0.35} step={0.01} unit="percent opacity" percent />
                  <SettingsNumberField label="Top-right opacity" value={draft.watermark.top_right_opacity} onChange={(value) => setWatermark({ top_right_opacity: value })} min={0.12} max={0.7} step={0.01} unit="percent opacity" percent />
                  <SettingsNumberField label="Delogo-cover opacity" value={draft.watermark.cover_opacity} onChange={(value) => setWatermark({ cover_opacity: value })} min={0.12} max={0.7} step={0.01} unit="percent opacity" percent />
                  <SettingsNumberField label="Cover padding" value={draft.watermark.cover_padding_pct} onChange={(value) => setWatermark({ cover_padding_pct: value })} min={0} max={0.08} step={0.005} unit="percent of the shorter frame dimension" percent />
                </div>
                <Label className="flex items-center gap-2 rounded-md border bg-background/60 p-3">
                  <Checkbox aria-label="Multiple low-opacity watermarks" checked={draft.watermark.multiple} onCheckedChange={(checked) => setWatermark({ multiple: checked === true })} />
                  Multiple low-opacity watermarks
                </Label>
                <Label className="flex items-center gap-2 rounded-md border bg-background/60 p-3">
                  <Checkbox aria-label="Cover delogo distortion with our watermark" checked={draft.watermark.cover_delogo} onCheckedChange={(checked) => setWatermark({ cover_delogo: checked === true })} />
                  Cover delogo distortion with our watermark
                </Label>
                <Badge variant="outline" className="w-fit">Default: watermark only when subtitles are added</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                Renderer Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">All render jobs in the overview snapshot. This excludes other console issue categories such as output verification errors.</p>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Draft mode</span>
                <Badge variant={draft.mode === 'enabled' ? 'default' : 'outline'}>{draft.mode}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Heartbeat</span>
                <Badge variant="outline">{rendererHealth?.state ?? 'unknown'}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Queued</span>
                <span className="font-medium">{overview.data?.counts?.queued ?? 'Unavailable'}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Failed or blocked render jobs</span>
                <span className="font-medium">{overview.data?.counts ? overview.data.counts.failed + overview.data.counts.blocked : 'Unavailable'}</span>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/video-renders">Open render console</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Secrets
              </CardTitle>
              <CardDescription>Managed outside the browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 break-words text-sm text-muted-foreground">
              <p>OPENAI_API_KEY, DEEPGRAM_API_KEY, SUPABASE_SERVICE_ROLE_KEY, and VIDEO_RENDERER_TOKEN stay in Supabase/Ubuntu env files.</p>
              <p>This UI stores only non-secret behavior and style settings.</p>
            </CardContent>
          </Card>

          <Button
            id="video-save"
            type="button"
            className="scroll-mt-48 h-auto min-h-11 w-full whitespace-normal"
            onClick={save}
            disabled={saving.saving || editor.hasPendingIncoming}
          >
            {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Video Rendering Settings
          </Button>
        </div>
      </div>
    </form>
  );
}

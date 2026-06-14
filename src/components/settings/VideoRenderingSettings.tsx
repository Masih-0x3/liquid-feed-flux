import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Film, Loader2, Save, Settings2, Shield, Wand2 } from 'lucide-react';
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

export default function VideoRenderingSettings() {
  const configQuery = useVideoRenderConfig();
  const overview = useVideoRenderOverview();
  const update = useUpdateVideoRenderConfig();
  const [draft, setDraft] = useState<VideoRenderConfigValue | null>(null);

  useEffect(() => {
    if (configQuery.data?.config && !draft) setDraft(cloneConfig(configQuery.data.config));
  }, [configQuery.data?.config, draft]);

  if (configQuery.isLoading || !draft) {
    return (
      <Card className="glass-card">
        <CardContent className="flex min-h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const set = (patch: Partial<VideoRenderConfigValue>) => setDraft({ ...draft, ...patch });
  const setSubtitle = (patch: Partial<VideoRenderConfigValue['subtitle_style']>) => set({ subtitle_style: { ...draft.subtitle_style, ...patch } });
  const setDelogo = (patch: Partial<VideoRenderConfigValue['delogo']>) => set({ delogo: { ...draft.delogo, ...patch } });
  const setWatermark = (patch: Partial<VideoRenderConfigValue['watermark']>) => set({ watermark: { ...draft.watermark, ...patch } });
  const onlineHeartbeat = overview.data?.heartbeats?.[0];

  return (
    <div className="space-y-6">
      <Alert className="border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Production-safe rollout</AlertTitle>
        <AlertDescription>
          Keep this in disabled or shadow mode until the Ubuntu renderer heartbeat is healthy and one manual render has been reviewed.
          API keys are not shown here; OpenAI, Deepgram, Supabase service role, and renderer tokens stay in server-side env files.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="glass-card">
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="post_original">Post original on render failure</SelectItem>
                    <SelectItem value="block">Block on render failure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Processed retention hours</Label>
                <Input
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepgram">Deepgram</SelectItem>
                    <SelectItem value="openai">OpenAI fallback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Transcription model</Label>
                <Input value={draft.transcription_model} onChange={(event) => set({ transcription_model: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Translation model</Label>
                <Input value={draft.translation_model} onChange={(event) => set({ translation_model: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vision model</Label>
                <Input value={draft.vision_model} onChange={(event) => set({ vision_model: event.target.value })} />
              </div>
              <div className="rounded-md border bg-muted/20 p-3 md:col-span-2 xl:col-span-4">
                <p className="text-sm font-medium">Target language rule</p>
                <p className="mt-1 text-sm text-muted-foreground">Every usable non-Persian video gets Persian subtitles. Persian speech gets English subtitles.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-glass-foreground">Subtitle Style</CardTitle>
              <CardDescription>Yellow subtitle with black background, tuned from the golden video review.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Text color</Label>
                <Input type="color" value={draft.subtitle_style.text_color} onChange={(event) => setSubtitle({ text_color: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Background color</Label>
                <Input type="color" value={draft.subtitle_style.background_color} onChange={(event) => setSubtitle({ background_color: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Font scale</Label>
                <Input type="number" step="0.01" min="0.8" max="1.8" value={draft.subtitle_style.font_scale} onChange={(event) => setSubtitle({ font_scale: numberValue(Number(event.target.value), 1.18) })} />
              </div>
              <div className="space-y-2">
                <Label>Max width</Label>
                <Input type="number" step="0.01" min="0.55" max="0.96" value={draft.subtitle_style.max_width_pct} onChange={(event) => setSubtitle({ max_width_pct: numberValue(Number(event.target.value), 0.92) })} />
              </div>
              <div className="space-y-2">
                <Label>Bottom padding</Label>
                <Input type="number" step="0.005" min="0.02" max="0.18" value={draft.subtitle_style.bottom_padding_pct} onChange={(event) => setSubtitle({ bottom_padding_pct: numberValue(Number(event.target.value), 0.06) })} />
              </div>
              <div className="space-y-2">
                <Label>Collision gap</Label>
                <Input type="number" step="0.005" min="0" max="0.08" value={draft.subtitle_style.collision_gap_pct} onChange={(event) => setSubtitle({ collision_gap_pct: numberValue(Number(event.target.value), 0.015) })} />
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-glass-foreground">Delogo and Watermark</CardTitle>
              <CardDescription>Controls source watermark removal and our @Masihh watermark behavior.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <div className="grid gap-2">
                  <Label>Vision mode</Label>
                  <Select value={draft.delogo.vision_mode} onValueChange={(vision_mode) => setDelogo({ vision_mode: vision_mode as VideoRenderConfigValue['delogo']['vision_mode'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="opencv">OpenCV selective inpaint</SelectItem>
                      <SelectItem value="ffmpeg">FFmpeg delogo fallback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Max regions</Label>
                    <Input type="number" min="0" max="6" value={draft.delogo.max_regions} onChange={(event) => setDelogo({ max_regions: numberValue(Number(event.target.value), 2) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Single area</Label>
                    <Input type="number" step="0.01" min="0" max="0.25" value={draft.delogo.max_single_area_ratio} onChange={(event) => setDelogo({ max_single_area_ratio: numberValue(Number(event.target.value), 0.1) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Total area</Label>
                    <Input type="number" step="0.01" min="0" max="0.35" value={draft.delogo.max_total_area_ratio} onChange={(event) => setDelogo({ max_total_area_ratio: numberValue(Number(event.target.value), 0.15) })} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Radius</Label>
                    <Input type="number" min="1" max="8" value={draft.delogo.opencv_radius} onChange={(event) => setDelogo({ opencv_radius: numberValue(Number(event.target.value), 2) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Kernel</Label>
                    <Input type="number" min="3" max="21" value={draft.delogo.opencv_kernel} onChange={(event) => setDelogo({ opencv_kernel: numberValue(Number(event.target.value), 7) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Dilate</Label>
                    <Input type="number" min="0" max="8" value={draft.delogo.opencv_dilate_iterations} onChange={(event) => setDelogo({ opencv_dilate_iterations: numberValue(Number(event.target.value), 2) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Feather</Label>
                    <Input type="number" min="0" max="12" value={draft.delogo.opencv_feather} onChange={(event) => setDelogo({ opencv_feather: numberValue(Number(event.target.value), 0) })} />
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                <div className="space-y-2">
                  <Label>Apply @Masihh watermark</Label>
                  <Select value={draft.watermark.apply_when} onValueChange={(apply_when) => setWatermark({ apply_when: apply_when as VideoRenderConfigValue['watermark']['apply_when'] })}>
                    <SelectTrigger>
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
                  <div className="space-y-2">
                    <Label>Global opacity</Label>
                    <Input type="number" step="0.01" min="0.04" max="0.45" value={draft.watermark.opacity} onChange={(event) => setWatermark({ opacity: numberValue(Number(event.target.value), 0.16) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Top-right opacity</Label>
                    <Input type="number" step="0.01" min="0.08" max="0.70" value={draft.watermark.top_right_opacity} onChange={(event) => setWatermark({ top_right_opacity: numberValue(Number(event.target.value), 0.34) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Delogo-cover opacity</Label>
                    <Input type="number" step="0.01" min="0.08" max="0.70" value={draft.watermark.cover_opacity} onChange={(event) => setWatermark({ cover_opacity: numberValue(Number(event.target.value), 0.34) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Cover padding</Label>
                    <Input type="number" step="0.005" min="0" max="0.08" value={draft.watermark.cover_padding_pct} onChange={(event) => setWatermark({ cover_padding_pct: numberValue(Number(event.target.value), 0) })} />
                  </div>
                </div>
                <Label className="flex items-center gap-2 rounded-md border bg-background/60 p-3">
                  <Checkbox checked={draft.watermark.multiple} onCheckedChange={(checked) => setWatermark({ multiple: checked === true })} />
                  Multiple low-opacity watermarks
                </Label>
                <Label className="flex items-center gap-2 rounded-md border bg-background/60 p-3">
                  <Checkbox checked={draft.watermark.cover_delogo} onCheckedChange={(checked) => setWatermark({ cover_delogo: checked === true })} />
                  Cover delogo distortion with our watermark
                </Label>
                <Badge variant="outline" className="w-fit">Default: watermark only when subtitles are added</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                Renderer Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Mode</span>
                <Badge variant={draft.mode === 'enabled' ? 'default' : 'outline'}>{draft.mode}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Heartbeat</span>
                <Badge variant="outline">{onlineHeartbeat?.status ?? 'none'}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Queued</span>
                <span className="font-medium">{overview.data?.counts?.queued ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <span>Failed/blocked</span>
                <span className="font-medium">{(overview.data?.counts?.failed ?? 0) + (overview.data?.counts?.blocked ?? 0)}</span>
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
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>OPENAI_API_KEY, DEEPGRAM_API_KEY, SUPABASE_SERVICE_ROLE_KEY, and VIDEO_RENDERER_TOKEN stay in Supabase/Ubuntu env files.</p>
              <p>This UI stores only non-secret behavior and style settings.</p>
            </CardContent>
          </Card>

          <Button
            className="w-full bg-gradient-primary text-white hover:opacity-90"
            onClick={() => update.mutate(draft)}
            disabled={update.isPending}
          >
            {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Video Rendering Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { VideoRenderConfigValue } from '@/hooks/useVideoRenderData';

const PERSIAN_SAMPLE = 'این یک نمونهٔ طولانی از زیرنویس فارسی است تا خوانایی و فاصله از لبه‌های تصویر را بررسی کنید.';
const ENGLISH_SAMPLE = 'A longer English subtitle demonstrates wrapping and the distance from the edge of the frame.';

export function VideoStylePreview({ config }: { config: Pick<VideoRenderConfigValue, 'subtitle_style' | 'watermark'> }) {
  const [portrait, setPortrait] = useState(false);
  const [sample, setSample] = useState(PERSIAN_SAMPLE);
  const { subtitle_style: subtitle, watermark } = config;
  const hasWatermark = watermark.apply_when !== 'never';
  return <figure className="space-y-3 rounded-lg border bg-muted/10 p-3">
    <figcaption className="space-y-1"><p className="text-sm font-medium">Local illustrative preview</p><p className="text-xs text-muted-foreground">Updates in your browser with no render or provider call. Assumes a subtitle track; actual font metrics, detected logo regions and collision handling can differ.</p></figcaption>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" aria-pressed={!portrait} onClick={() => setPortrait(false)}>Landscape</Button><Button type="button" size="sm" variant="outline" aria-pressed={portrait} onClick={() => setPortrait(true)}>Portrait</Button><Button type="button" size="sm" variant="outline" onClick={() => setSample(PERSIAN_SAMPLE)}>Persian sample</Button><Button type="button" size="sm" variant="outline" onClick={() => setSample(ENGLISH_SAMPLE)}>English sample</Button></div>
    <Label htmlFor="video-preview-subtitle">Preview subtitle</Label><Input aria-label="Preview subtitle" id="video-preview-subtitle" dir="auto" value={sample} onChange={(event) => setSample(event.target.value)} />
    <div className={`relative mx-auto overflow-hidden rounded-md border bg-slate-900 ${portrait ? 'aspect-[9/16] w-56 max-w-full' : 'aspect-video w-full max-w-xl'}`} aria-label="Illustrative subtitle frame">
      <div aria-hidden="true" className="absolute inset-[3.5%] border border-dashed border-white/25" />
      <p aria-hidden="true" className="absolute inset-x-4 top-1/3 text-center text-xs text-slate-400">Illustrative frame · no source video</p>
      {hasWatermark && <>
        <span className="absolute right-[3.5%] top-[3.5%] text-sm font-semibold text-white" style={{ opacity: watermark.top_right_opacity }}>@Masihh</span>
        {watermark.multiple && <span className="absolute left-[8%] top-[45%] -rotate-12 text-xl font-semibold text-white" style={{ opacity: watermark.opacity }}>@Masihh</span>}
        {watermark.cover_delogo && <span className="absolute left-[4%] top-[12%] border border-dashed border-white/30 text-xs text-white" style={{ opacity: watermark.cover_opacity, padding: `${watermark.cover_padding_pct * 100}%` }}>@Masihh</span>}
      </>}
      <div dir="auto" lang={/[\u0600-\u06ff]/.test(sample) ? 'fa' : 'en'} className="absolute left-1/2 -translate-x-1/2 whitespace-pre-wrap break-words text-center font-sans leading-relaxed" style={{ width: `${Math.max(0, Math.min(1, subtitle.max_width_pct)) * 100}%`, bottom: `${Math.max(0, Math.min(1, subtitle.bottom_padding_pct)) * 100}%`, fontSize: `${Math.max(0.75, Math.min(1.35, subtitle.font_scale)) * (portrait ? 15 : 18)}px`, color: subtitle.text_color }}>
        <span className="box-decoration-clone px-1.5 py-0.5" style={{ backgroundColor: subtitle.background_color }}>{sample || 'Subtitle preview is empty'}</span>
      </div>
    </div>
    {hasWatermark && watermark.cover_delogo && <p className="text-xs text-muted-foreground">The upper-left watermark illustrates a hypothetical removed-logo region. No logo detection has run.</p>}
  </figure>;
}

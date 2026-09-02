import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, FlaskConical, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslationPreview, type TranslationSettings, type PreviewTranslationResult } from '@/hooks/useSettingsData';
import { persianContentAttributes } from '@/lib/contentLanguage';

interface Props {
  translationSettings: TranslationSettings;
  contentFilter: {
    enabled: boolean;
    score_only?: boolean;
    editorial_guidelines?: string;
    priority_topics?: string[];
    low_priority_topics?: string[];
  };
  sampleTweets: Record<string, unknown>[];
}

function scoreBadgeClass(score: number | null): string {
  if (score == null) return 'bg-muted text-muted-foreground';
  if (score >= 15) return 'bg-destructive text-destructive-foreground';
  if (score >= 10) return 'bg-primary text-primary-foreground';
  if (score >= 5) return 'bg-secondary text-secondary-foreground';
  return 'bg-muted text-muted-foreground';
}

export default function TranslationPlayground({ translationSettings, contentFilter, sampleTweets }: Props) {
  const { toast } = useToast();
  const previewMutation = useTranslationPreview();
  const [text, setText] = useState('');
  const [authorHandle, setAuthorHandle] = useState('');
  const [forceFilter, setForceFilter] = useState<'auto' | 'on' | 'off'>('auto');
  const [keepPrevious, setKeepPrevious] = useState(false);
  const [previousResult, setPreviousResult] = useState<PreviewTranslationResult | null>(null);
  const [currentResult, setCurrentResult] = useState<PreviewTranslationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSample = (idx: string) => {
    const t = sampleTweets[parseInt(idx)];
    if (t?.text_original && typeof t.text_original === 'string') setText(t.text_original);
    const acc = t?.accounts as Record<string, unknown> | undefined;
    if (acc?.handle) setAuthorHandle(acc.handle as string);
  };

  const run = () => {
    if (!text.trim()) {
      toast({ title: 'Enter some text first', variant: 'destructive' });
      return;
    }
    const cf = forceFilter === 'auto' ? contentFilter
      : forceFilter === 'on' ? { ...contentFilter, enabled: true }
      : { ...contentFilter, enabled: false, score_only: false };

    previewMutation.mutate(
      { text, translation_settings: translationSettings, content_filter: cf, author_handle: authorHandle || undefined },
      {
        onSuccess: (res) => {
          if (keepPrevious && currentResult) setPreviousResult(currentResult);
          else if (!keepPrevious) setPreviousResult(null);
          setCurrentResult(res);
        },
      }
    );
  };

  const copyText = (s: string) => {
    navigator.clipboard.writeText(s);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const renderResult = (res: PreviewTranslationResult, label?: string) => (
    <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
      {label && <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {res.importance_score != null && (
          <Badge className={scoreBadgeClass(res.importance_score)}>Score: {res.importance_score}/20</Badge>
        )}
        {res.importance_tags?.map((t) => (
          <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
        ))}
        <Badge variant="secondary" className="text-xs">{res.model}</Badge>
        <Badge variant="secondary" className="text-xs">{res.duration_ms}ms</Badge>
        {res.usage?.total_tokens && <Badge variant="secondary" className="text-xs">{res.usage.total_tokens} tokens</Badge>}
        {res.used_filter ? <Badge variant="outline" className="text-xs">filter: on</Badge> : <Badge variant="outline" className="text-xs">filter: off</Badge>}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Translated text</p>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyText(res.translated_text)} title="Copy translated text" aria-label="Copy translated text">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
        <div {...persianContentAttributes} className="p-3 rounded bg-background border border-border whitespace-pre-wrap text-sm leading-relaxed">
          {res.translated_text || <span className="text-muted-foreground italic">[empty]</span>}
        </div>
      </div>

      {res.reasoning && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">AI reasoning</p>
          <div className="p-3 rounded bg-background border border-border text-sm italic text-muted-foreground">
            {res.reasoning}
          </div>
        </div>
      )}

    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <FlaskConical className="w-5 h-5 mr-2" />Translation Playground
        </CardTitle>
        <CardDescription>
          Test the current (unsaved) prompt + model + filter against any text. Reuses the exact same OpenAI call as production — no DB writes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="playground_text">Test text (English)</Label>
            {sampleTweets.length > 0 && (
              <Select onValueChange={loadSample}>
                <SelectTrigger aria-label="Load sample tweet" className="w-48 h-8 text-xs"><SelectValue placeholder="Load sample tweet…" /></SelectTrigger>
                <SelectContent>
                  {sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample {i + 1}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <Textarea
            id="playground_text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste English text here to translate and score…"
            className="glass-input min-h-[120px] text-sm"
          />
          <div className="text-xs text-muted-foreground text-right">{text.length} chars</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="author_handle" className="text-xs">Author handle (optional)</Label>
            <Input id="author_handle" value={authorHandle} onChange={(e) => setAuthorHandle(e.target.value)} placeholder="@example" className="glass-input h-9" />
          </div>
          <div className="space-y-2">
            <Label id="translation-playground-filter-mode-label" className="text-xs">Filter mode</Label>
            <Select value={forceFilter} onValueChange={(v) => setForceFilter(v as 'auto' | 'on' | 'off')}>
              <SelectTrigger aria-labelledby="translation-playground-filter-mode-label" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (use saved filter setting)</SelectItem>
                <SelectItem value="on">Force ON (translate + score)</SelectItem>
                <SelectItem value="off">Force OFF (translate only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label id="translation-playground-ab-compare-label" className="text-xs">A/B compare</Label>
            <div className="flex items-center h-9 gap-2">
              <Switch
                aria-labelledby="translation-playground-ab-compare-label"
                aria-describedby="translation-playground-ab-compare-description"
                checked={keepPrevious}
                onCheckedChange={setKeepPrevious}
              />
              <span id="translation-playground-ab-compare-description" className="text-sm text-muted-foreground">Keep previous result</span>
            </div>
          </div>
        </div>

        <Button
          onClick={run}
          disabled={previewMutation.isPending || !text.trim()}
          className="w-full bg-gradient-primary hover:opacity-90 text-white"
        >
          {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Run translation preview
        </Button>

        {(currentResult || previousResult) && (
          <>
            <Separator />
            <div className={previousResult && currentResult ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}>
              {previousResult && renderResult(previousResult, 'Previous run')}
              {currentResult && renderResult(currentResult, previousResult ? 'Current run' : undefined)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

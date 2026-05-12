import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Layers, Plus, X, Save, Loader2 } from 'lucide-react';
import { useSaveSettings } from '@/hooks/useSettingsData';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface StoryMemoryConfig {
  enabled: boolean;
  window_hours: number;
  similarity_threshold: number;
  action: 'skip' | 'mark_and_deliver';
  bypass_authors: string[];
}

interface Props {
  initial?: Partial<StoryMemoryConfig>;
}

const DEFAULTS: StoryMemoryConfig = {
  enabled: false,
  window_hours: 12,
  similarity_threshold: 0.86,
  action: 'skip',
  bypass_authors: [],
};

export default function StoryMemoryCard({ initial }: Props) {
  const [cfg, setCfg] = useState<StoryMemoryConfig>({ ...DEFAULTS, ...(initial ?? {}) });
  const [authorInput, setAuthorInput] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const save = useSaveSettings();
  const { toast } = useToast();

  useEffect(() => { setCfg({ ...DEFAULTS, ...(initial ?? {}) }); }, [initial]);

  const addAuthor = () => {
    const v = authorInput.trim().replace(/^@/, '');
    if (!v) return;
    if (cfg.bypass_authors.includes(v)) return;
    setCfg({ ...cfg, bypass_authors: [...cfg.bypass_authors, v] });
    setAuthorInput('');
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'backfill_signatures', hours: 24 },
      });
      if (error) throw error;
      toast({ title: 'Backfill queued', description: `Queued ${data?.queued ?? 0} signatures over ${data?.scanned ?? 0} posts.` });
    } catch (e) {
      toast({ title: 'Backfill failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <Layers className="w-5 h-5 mr-2" />Story Memory (Semantic Dedup)
        </CardTitle>
        <CardDescription>
          Detect when two outlets cover the same story in different words (e.g. two news sites reporting the same Israeli strike).
          Uses OpenAI embeddings + SimHash on the translated text.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div>
            <Label className="font-medium">Enable Story Memory</Label>
            <p className="text-xs text-muted-foreground mt-1">When off, only exact tweet/URL dedup runs.</p>
          </div>
          <Checkbox checked={cfg.enabled} onCheckedChange={(c) => setCfg({ ...cfg, enabled: !!c })} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Lookback window</Label>
              <Badge variant="outline">{cfg.window_hours}h</Badge>
            </div>
            <Slider min={1} max={48} step={1} value={[cfg.window_hours]} onValueChange={([v]) => setCfg({ ...cfg, window_hours: v })} />
            <p className="text-xs text-muted-foreground">How far back to search for duplicates.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Similarity threshold (cosine)</Label>
              <Badge variant="outline">{cfg.similarity_threshold.toFixed(2)}</Badge>
            </div>
            <Slider min={0.80} max={0.95} step={0.01} value={[cfg.similarity_threshold]} onValueChange={([v]) => setCfg({ ...cfg, similarity_threshold: v })} />
            <p className="text-xs text-muted-foreground">Higher = stricter (fewer false positives, more misses). 0.86 is a good default.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>When duplicate found</Label>
          <Select value={cfg.action} onValueChange={(v: 'skip' | 'mark_and_deliver') => setCfg({ ...cfg, action: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip delivery (default)</SelectItem>
              <SelectItem value="mark_and_deliver">Mark and still deliver</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Bypass authors (always deliver, never skip as duplicate)</Label>
          <div className="flex gap-2">
            <Input
              value={authorInput}
              onChange={(e) => setAuthorInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAuthor(); } }}
              placeholder="e.g. OfficialIRGCEN"
            />
            <Button variant="outline" size="icon" onClick={addAuthor}><Plus className="w-4 h-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {cfg.bypass_authors.map((a) => (
              <Badge key={a} className="bg-primary/15 text-primary border-primary/30 gap-1">
                @{a}
                <X className="w-3 h-3 cursor-pointer" onClick={() => setCfg({ ...cfg, bypass_authors: cfg.bypass_authors.filter(x => x !== a) })} />
              </Badge>
            ))}
            {cfg.bypass_authors.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={handleBackfill} disabled={backfilling || !cfg.enabled}>
            {backfilling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Backfilling...</> : 'Backfill last 24h'}
          </Button>
          <Button onClick={() => save.mutate({ key: 'story_memory', value: cfg })} disabled={save.isPending} className="bg-gradient-primary hover:opacity-90 text-white">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Story Memory
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

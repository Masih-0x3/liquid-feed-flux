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
import { invokeAdminAction } from '@/api/adminActions';

export interface StoryMemoryConfig {
  enabled: boolean;
  window_hours: number;
  similarity_threshold: number;
  candidate_min_similarity: number;
  auto_duplicate_similarity: number;
  action: 'skip' | 'mark_and_deliver';
  mode: 'hybrid_ai' | 'semantic_only' | 'review_first';
  adjudicator_model: string;
  adjudicator_reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh';
  adjudicator_confidence_threshold: number;
  bypass_authors: string[];
}

interface Props {
  initial?: Partial<StoryMemoryConfig>;
}

const DEFAULTS: StoryMemoryConfig = {
  enabled: false,
  window_hours: 48,
  similarity_threshold: 0.86,
  candidate_min_similarity: 0.78,
  auto_duplicate_similarity: 0.94,
  action: 'skip',
  mode: 'hybrid_ai',
  adjudicator_model: 'gpt-5.4-mini',
  adjudicator_reasoning_effort: 'low',
  adjudicator_confidence_threshold: 0.65,
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
      const data = await invokeAdminAction<{ queued?: number; scanned?: number }>({ action: 'backfill_dedupe', hours: 24, max: 500 });
      toast({ title: 'Backfill queued', description: `Queued ${data?.queued ?? 0} duplicate checks over ${data?.scanned ?? 0} posts.` });
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
          <Layers className="w-5 h-5 mr-2" />Duplicate Gate
        </CardTitle>
        <CardDescription>
          Reject duplicated stories before scoring and translation. Uses semantic candidates first, then an AI adjudicator to separate repeated coverage from updates with new facts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div>
            <Label className="font-medium">Enable Duplicate Gate</Label>
            <p className="text-xs text-muted-foreground mt-1">Runs before content filtering so duplicates are blocked regardless of score.</p>
          </div>
          <Checkbox checked={cfg.enabled} onCheckedChange={(c) => setCfg({ ...cfg, enabled: !!c })} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Lookback window</Label>
              <Badge variant="outline">{cfg.window_hours}h</Badge>
            </div>
            <Slider min={1} max={168} step={1} value={[cfg.window_hours]} onValueChange={([v]) => setCfg({ ...cfg, window_hours: v })} />
            <p className="text-xs text-muted-foreground">How far back to search for duplicates.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Candidate floor</Label>
              <Badge variant="outline">{cfg.candidate_min_similarity.toFixed(2)}</Badge>
            </div>
            <Slider min={0.50} max={0.95} step={0.01} value={[cfg.candidate_min_similarity]} onValueChange={([v]) => setCfg({ ...cfg, candidate_min_similarity: v })} />
            <p className="text-xs text-muted-foreground">Minimum semantic similarity before a post is worth adjudicating.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Auto-duplicate threshold</Label>
              <Badge variant="outline">{cfg.auto_duplicate_similarity.toFixed(2)}</Badge>
            </div>
            <Slider min={0.80} max={0.99} step={0.01} value={[cfg.auto_duplicate_similarity]} onValueChange={([v]) => setCfg({ ...cfg, auto_duplicate_similarity: v })} />
            <p className="text-xs text-muted-foreground">Very high similarity can skip the AI adjudicator.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>AI confidence required</Label>
              <Badge variant="outline">{cfg.adjudicator_confidence_threshold.toFixed(2)}</Badge>
            </div>
            <Slider min={0.50} max={0.95} step={0.01} value={[cfg.adjudicator_confidence_threshold]} onValueChange={([v]) => setCfg({ ...cfg, adjudicator_confidence_threshold: v })} />
            <p className="text-xs text-muted-foreground">Low-confidence cases become manual review instead of silent skips.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={cfg.mode} onValueChange={(v: StoryMemoryConfig['mode']) => setCfg({ ...cfg, mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid_ai">Semantic + AI adjudicator</SelectItem>
                <SelectItem value="semantic_only">Semantic only</SelectItem>
                <SelectItem value="review_first">Manual review first</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cfg.mode === 'semantic_only' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Semantic-only threshold</Label>
                <Badge variant="outline">{cfg.similarity_threshold.toFixed(2)}</Badge>
              </div>
              <Slider min={0.50} max={0.99} step={0.01} value={[cfg.similarity_threshold]} onValueChange={([v]) => setCfg({ ...cfg, similarity_threshold: v })} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Adjudicator model</Label>
            <Input value={cfg.adjudicator_model} onChange={(e) => setCfg({ ...cfg, adjudicator_model: e.target.value })} placeholder="gpt-5.4-mini" />
          </div>

          <div className="space-y-2">
            <Label>Reasoning effort</Label>
            <Select value={cfg.adjudicator_reasoning_effort} onValueChange={(v: StoryMemoryConfig['adjudicator_reasoning_effort']) => setCfg({ ...cfg, adjudicator_reasoning_effort: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="xhigh">Extra high</SelectItem>
              </SelectContent>
            </Select>
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
          <Label>Bypass authors</Label>
          <div className="flex gap-2">
            <Input
              value={authorInput}
              onChange={(e) => setAuthorInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAuthor(); } }}
              placeholder="e.g. OfficialIRGCEN"
            />
            <Button variant="outline" size="icon" onClick={addAuthor}><Plus className="w-4 h-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground">These authors are still indexed, but their posts will not be skipped by the duplicate gate.</p>
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
            {backfilling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Backfilling...</> : 'Backfill duplicate gate'}
          </Button>
          <Button onClick={() => save.mutate({ key: 'story_memory', value: cfg })} disabled={save.isPending} className="bg-gradient-primary hover:opacity-90 text-white">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Duplicate Gate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

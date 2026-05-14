import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Plus, X, Sparkles, Search, PenTool, Wand2, Layout, BookOpen, Loader2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface EnrichmentConfig {
  enabled: boolean;
  model: string;
  analyst_prompt: string;
  researcher_prompt: string;
  humanizer_prompt: string;
  archivist_prompt: string;
  composer_prompt: string;
  max_research_tokens: number;
  max_analysis_tokens: number;
  max_humanizer_tokens: number;
  max_archivist_tokens: number;
  max_composer_tokens: number;
  skip_research_below_score: number;
  archivist_lookback_days: number;
  archivist_max_posts: number;
  require_approval: boolean;
  thread_above_score: number;
}

interface VoiceSamples {
  samples: string[];
  updated_at: string | null;
}

const DEFAULT_CONFIG: EnrichmentConfig = {
  enabled: false,
  model: 'gpt-5.4-mini',
  analyst_prompt: 'You are a sharp, direct Iranian political commentator. You are skeptical of the Islamic Republic regime, care deeply about human rights and freedom, and connect news to the bigger picture. You never use flowery diplomatic language. You sound like a real person with real opinions -- not a news anchor.',
  researcher_prompt: 'You are a senior news researcher specializing in Iran, the Middle East, and US foreign policy. Given a news item in English, search the web for background context, related recent events, and key figures. Return structured facts in English -- no opinions, no analysis.',
  humanizer_prompt: 'You are a rewriter that makes AI-generated Persian text sound like a real human wrote it on their phone. You match the author\'s voice samples. You aggressively vary sentence structure, use colloquial contractions, and add natural imperfections. You NEVER use formal AI-tell patterns.',
  archivist_prompt: 'You are an editorial archivist for a Persian news account. Given a new story (in English) and recent posts, identify meaningful narrative connections. Only suggest a callback if it genuinely enriches the new post. Your callback_suggestion must be in natural Persian.',
  composer_prompt: 'You are a social media editor for a Persian news account on X (Twitter). You assemble final posts from translated news + commentary components. Every post must feel structurally different. The translation is the core content. Commentary and hooks enhance it. Final output must be in Persian.',
  max_research_tokens: 4000,
  max_analysis_tokens: 2000,
  max_humanizer_tokens: 2000,
  max_archivist_tokens: 2000,
  max_composer_tokens: 2000,
  skip_research_below_score: 16,
  archivist_lookback_days: 3,
  archivist_max_posts: 10,
  require_approval: true,
  thread_above_score: 18,
};

export default function EnrichmentSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<EnrichmentConfig>(DEFAULT_CONFIG);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSamples>({ samples: [], updated_at: null });
  const [newSample, setNewSample] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['enrichment_config', 'voice_samples']);
      if (data) {
        for (const row of data) {
          if (row.key === 'enrichment_config' && row.value) setConfig({ ...DEFAULT_CONFIG, ...(row.value as object) });
          if (row.key === 'voice_samples' && row.value) setVoiceSamples(row.value as VoiceSamples);
        }
      }
    } catch (e) {
      console.error('Failed to load enrichment settings:', e);
    }
    setLoading(false);
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'enrichment_config', value: config as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      toast({ title: 'Saved', description: 'Enrichment configuration updated.' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
    setSaving(false);
  }

  async function saveVoiceSamples(samples: string[]) {
    const updated = { samples, updated_at: new Date().toISOString() };
    setVoiceSamples(updated);
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'voice_samples', value: updated as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      toast({ title: 'Saved', description: 'Voice samples updated.' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  }

  function addSample() {
    if (!newSample.trim()) return;
    const updated = [...voiceSamples.samples, newSample.trim()];
    setNewSample('');
    saveVoiceSamples(updated);
  }

  function removeSample(idx: number) {
    const updated = voiceSamples.samples.filter((_, i) => i !== idx);
    saveVoiceSamples(updated);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                AI Commentary Pipeline
              </CardTitle>
              <CardDescription>
                5-agent system: Archivist + Researcher (parallel) then Analyst, Humanizer, Composer
              </CardDescription>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Require Approval Before Posting</Label>
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${config.require_approval ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}
                onClick={() => setConfig({ ...config, require_approval: !config.require_approval })}
              >
                <Switch
                  checked={config.require_approval}
                  onCheckedChange={(require_approval) => setConfig({ ...config, require_approval })}
                />
                <div className="text-sm">
                  {config.require_approval ? (
                    <span className="text-green-400 font-medium">Enabled -- enriched posts wait for your approval before posting to X</span>
                  ) : (
                    <span className="text-red-400 font-medium">Disabled -- enriched posts are posted to X automatically</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Voice / Persona */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenTool className="w-5 h-5" />
            Your Voice / Persona
          </CardTitle>
          <CardDescription>
            Describe how you write and what your positions are. The Analyst agent uses this to write in your style.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={config.analyst_prompt}
            onChange={(e) => setConfig({ ...config, analyst_prompt: e.target.value })}
            rows={6}
            placeholder="You are [name], an Iranian political commentator. You are blunt, sarcastic when appropriate..."
          />
        </CardContent>
      </Card>

      {/* Voice Samples Library */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Voice Samples
          </CardTitle>
          <CardDescription>
            Paste 5-10 of your real tweets. The Humanizer agent uses these to match your exact writing style.
            <br />
            <span className="text-xs text-muted-foreground">{voiceSamples.samples.length}/10 samples provided</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {voiceSamples.samples.map((sample, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-muted/40 rounded-lg border">
              <p className="text-sm flex-1 text-right" dir="rtl">{sample}</p>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeSample(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {voiceSamples.samples.length < 10 && (
            <div className="flex gap-2">
              <Textarea
                value={newSample}
                onChange={(e) => setNewSample(e.target.value)}
                rows={2}
                placeholder="Paste one of your real tweets here..."
                dir="rtl"
                className="flex-1"
              />
              <Button onClick={addSample} disabled={!newSample.trim()} className="shrink-0">
                <Plus className="w-4 h-4 mr-1" />Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Archivist Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Archivist (Narrative Memory)
          </CardTitle>
          <CardDescription>
            Searches your recent posts for narrative connections to reference in new posts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lookback Window (days)</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.archivist_lookback_days]}
                  onValueChange={([v]) => setConfig({ ...config, archivist_lookback_days: v })}
                  min={1} max={7} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.archivist_lookback_days}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Posts to Consider</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.archivist_max_posts]}
                  onValueChange={([v]) => setConfig({ ...config, archivist_max_posts: v })}
                  min={3} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.archivist_max_posts}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" />
            Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Skip Research Below Score</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.skip_research_below_score]}
                  onValueChange={([v]) => setConfig({ ...config, skip_research_below_score: v })}
                  min={8} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.skip_research_below_score}</span>
              </div>
              <p className="text-xs text-muted-foreground">Posts below this score get commentary but no web research (saves tokens)</p>
            </div>
            <div className="space-y-2">
              <Label>Auto-Thread Above Score</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.thread_above_score]}
                  onValueChange={([v]) => setConfig({ ...config, thread_above_score: v })}
                  min={14} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.thread_above_score}</span>
              </div>
              <p className="text-xs text-muted-foreground">High-scoring posts may be composed as threads (2 tweets)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced: Agent Prompts */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Card>
          <CardHeader>
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Layout className="w-5 h-5" />
                <CardTitle className="text-base">Agent Prompts (Advanced)</CardTitle>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Researcher Prompt</Label>
                <Textarea
                  value={config.researcher_prompt}
                  onChange={(e) => setConfig({ ...config, researcher_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Humanizer Prompt</Label>
                <Textarea
                  value={config.humanizer_prompt}
                  onChange={(e) => setConfig({ ...config, humanizer_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Archivist Prompt</Label>
                <Textarea
                  value={config.archivist_prompt}
                  onChange={(e) => setConfig({ ...config, archivist_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Composer Prompt</Label>
                <Textarea
                  value={config.composer_prompt}
                  onChange={(e) => setConfig({ ...config, composer_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-5 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Research Tokens</Label>
                  <Input type="number" value={config.max_research_tokens} onChange={(e) => setConfig({ ...config, max_research_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Analysis Tokens</Label>
                  <Input type="number" value={config.max_analysis_tokens} onChange={(e) => setConfig({ ...config, max_analysis_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Humanizer Tokens</Label>
                  <Input type="number" value={config.max_humanizer_tokens} onChange={(e) => setConfig({ ...config, max_humanizer_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Archivist Tokens</Label>
                  <Input type="number" value={config.max_archivist_tokens} onChange={(e) => setConfig({ ...config, max_archivist_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Composer Tokens</Label>
                  <Input type="number" value={config.max_composer_tokens} onChange={(e) => setConfig({ ...config, max_composer_tokens: +e.target.value })} />
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Save Button */}
      <Button onClick={saveConfig} disabled={saving} className="w-full bg-gradient-primary hover:opacity-90 text-white">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Enrichment Settings</>}
      </Button>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Filter, Shield, Users, Sparkles, X, Plus, Loader2, ChevronDown, Wand2, Code } from 'lucide-react';
import PromptEditor from '@/components/settings/PromptEditor';
import {
  DEFAULT_SCORING_SYSTEM_PROMPT,
  DEFAULT_CLASSIFIER_TOOL_SCHEMA,
  type TranslationSettings,
} from '@/hooks/useSettingsData';
import { useToast } from '@/hooks/use-toast';

const RECOMMENDED_IRAN_RUBRIC: ContentFilterConfig = {
  enabled: true,
  score_only: false,
  filter_mode: 'global',
  default_threshold: 12,
  priority_topics: ['Iran', 'IRGC', 'Hormuz', 'sanctions', 'nuclear', 'Hezbollah', 'Houthis', 'Israel-Iran', 'Persian Gulf', 'Middle East', 'GCC', 'Syria', 'Iraq', 'Yemen', 'Pahlavi'],
  low_priority_topics: ['stocks', 'crypto', 'earnings', 'sports', 'entertainment', 'celebrity', 'tech launches', 'weather'],
  author_rules: {},
  editorial_guidelines: 'This channel covers Iran and the broader Middle East. Score on whether the SUBJECT MATTER touches Iran/Middle East — NOT on the framing or dateline. Polls, leaks, analyst reports, and foreign leadership rhetoric ABOUT Iran, the Iran war, or US-Iran relations are INDIRECT Iran-adjacent (cap 16) and should score 13–16 when they materially shift the public or political picture of an active Iran-related conflict. Only pure US/EU/China domestic news with NO Iran nexus should fall to 8 or below. When in doubt between two tiers, prefer the higher tier.',
};
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSaveSettings } from '@/hooks/useSettingsData';

export interface ContentFilterConfig {
  enabled: boolean;
  score_only?: boolean;
  filter_mode?: 'global' | 'granular';
  default_threshold: number;
  editorial_guidelines: string;
  priority_topics: string[];
  low_priority_topics: string[];
  author_rules: Record<string, { rule: string; threshold?: number }>;
}

const defaultConfig: ContentFilterConfig = {
  enabled: false,
  score_only: false,
  filter_mode: 'global',
  default_threshold: 12,
  editorial_guidelines: '',
  priority_topics: [],
  low_priority_topics: [],
  author_rules: {},
};

type FilterStatus = 'off' | 'score_only' | 'active';

function getFilterStatus(config: ContentFilterConfig): FilterStatus {
  if (config.enabled) return 'active';
  if (config.score_only) return 'score_only';
  return 'off';
}

function applyFilterStatus(config: ContentFilterConfig, status: FilterStatus): ContentFilterConfig {
  switch (status) {
    case 'off': return { ...config, enabled: false, score_only: false };
    case 'score_only': return { ...config, enabled: false, score_only: true };
    case 'active': return { ...config, enabled: true, score_only: false };
  }
}

interface Props {
  initialConfig?: ContentFilterConfig;
}

interface Props {
  initialConfig?: ContentFilterConfig;
  translationSettings: TranslationSettings;
  onTranslationSettingsChange: (next: TranslationSettings) => void;
}

export default function ContentFilterSettings({ initialConfig, translationSettings, onTranslationSettingsChange }: Props) {
  const [config, setConfig] = useState<ContentFilterConfig>({ ...defaultConfig, ...initialConfig });
  const [newPriorityTopic, setNewPriorityTopic] = useState('');
  const [newLowPriorityTopic, setNewLowPriorityTopic] = useState('');
  const [authorOverridesOpen, setAuthorOverridesOpen] = useState(false);
  const saveMutation = useSaveSettings();
  const { toast } = useToast();

  const ts = translationSettings;
  const setTs = (patch: Partial<TranslationSettings>) => onTranslationSettingsChange({ ...ts, ...patch });
  const saveTranslationPrompt = () => saveMutation.mutate({ key: 'translation_prompt', value: ts });

  const applyRecommendedDefaults = async () => {
    setConfig(RECOMMENDED_IRAN_RUBRIC);
    try {
      await saveMutation.mutateAsync({ key: 'content_filter', value: RECOMMENDED_IRAN_RUBRIC });
      toast({ title: 'Recommended Iran-rubric defaults applied', description: 'Threshold 12 with updated guidelines.' });
    } catch (e) {
      // useSaveSettings already shows an error toast
    }
  };

  useEffect(() => {
    if (initialConfig) {
      setConfig({ ...defaultConfig, ...initialConfig });
    }
  }, [initialConfig]);

  const filterStatus = getFilterStatus(config);
  const filterMode = config.filter_mode || 'global';

  const authorsQuery = useQuery({
    queryKey: ['author-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('author_handle')
        .not('author_handle', 'is', null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const handle = row.author_handle as string;
        if (handle) counts[handle] = (counts[handle] || 0) + 1;
      }
      return Object.entries(counts)
        .map(([handle, count]) => ({ handle, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 120_000,
  });

  const authors = authorsQuery.data || [];

  const addTopic = (type: 'priority' | 'low_priority') => {
    const value = type === 'priority' ? newPriorityTopic.trim() : newLowPriorityTopic.trim();
    if (!value) return;
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    if (!config[key].includes(value)) {
      setConfig({ ...config, [key]: [...config[key], value] });
    }
    if (type === 'priority') setNewPriorityTopic('');
    else setNewLowPriorityTopic('');
  };

  const removeTopic = (type: 'priority' | 'low_priority', topic: string) => {
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    setConfig({ ...config, [key]: config[key].filter(t => t !== topic) });
  };

  const setAuthorRule = (handle: string, rule: string, threshold?: number) => {
    const newRules = { ...config.author_rules };
    if (rule === 'ai_scoring') {
      delete newRules[handle];
    } else {
      newRules[handle] = { rule, ...(threshold != null ? { threshold } : {}) };
    }
    setConfig({ ...config, author_rules: newRules });
  };

  const getAuthorRule = (handle: string) => {
    return config.author_rules[handle]?.rule || 'ai_scoring';
  };

  const getAuthorThreshold = (handle: string) => {
    return config.author_rules[handle]?.threshold ?? config.default_threshold;
  };

  const statusOptions: { value: FilterStatus; label: string; desc: string }[] = [
    { value: 'off', label: 'Off', desc: 'All posts delivered without scoring' },
    { value: 'score_only', label: 'Score Only', desc: 'AI scores posts but everything is delivered' },
    { value: 'active', label: 'Active', desc: 'AI scores and filters posts by threshold' },
  ];

  return (
    <div className="space-y-6">
      {/* Filter Status */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground">
            <Filter className="w-5 h-5 mr-2" />Content Filtering
          </CardTitle>
          <CardDescription>
            Control which posts get delivered to Telegram based on AI importance scoring (1-20 scale)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 3-way status selector */}
          <div className="grid grid-cols-3 gap-3">
            {statusOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setConfig(applyFilterStatus(config, opt.value))}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  filterStatus === opt.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/30 hover:border-muted-foreground/30'
                }`}
              >
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>

          {filterStatus === 'active' && (
            <>
              <Separator />

              {/* Filter Mode: Global vs Granular */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">Filter Mode</Label>
                <RadioGroup
                  value={filterMode}
                  onValueChange={(v) => setConfig({ ...config, filter_mode: v as 'global' | 'granular' })}
                  className="space-y-3"
                >
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    filterMode === 'global' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}>
                    <RadioGroupItem value="global" className="mt-0.5" />
                    <div>
                      <div className="font-medium text-sm">Global Only</div>
                      <div className="text-xs text-muted-foreground">All posts use one threshold — simple and consistent</div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    filterMode === 'granular' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}>
                    <RadioGroupItem value="granular" className="mt-0.5" />
                    <div>
                      <div className="font-medium text-sm">Granular (Per-Author)</div>
                      <div className="text-xs text-muted-foreground">Set rules per author with global threshold as fallback</div>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              <Separator />

              {/* Global Threshold */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Filter className="w-4 h-4 text-primary" />
                  <Label className="text-base font-semibold">
                    {filterMode === 'global' ? 'Global Threshold' : 'Default Threshold (Fallback)'}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {filterMode === 'global'
                    ? 'Posts scoring below this are skipped. Applies to all posts.'
                    : 'Used for authors without a specific override rule.'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Minimum score to deliver</span>
                  <Badge variant="outline" className="text-lg px-3 py-1">{config.default_threshold}/20</Badge>
                </div>
                <Slider
                  value={[config.default_threshold]}
                  onValueChange={([v]) => setConfig({ ...config, default_threshold: v })}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 — Deliver all</span>
                  <span>5 — Low bar</span>
                  <span>10 — Balanced</span>
                  <span>15 — Selective</span>
                  <span>20 — Critical only</span>
                </div>
              </div>

              {/* Per-Author Overrides (only in granular mode) */}
              {filterMode === 'granular' && (
                <>
                  <Separator />
                  <Collapsible open={authorOverridesOpen} onOpenChange={setAuthorOverridesOpen}>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">Per-Author Overrides</span>
                        {Object.keys(config.author_rules).length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {Object.keys(config.author_rules).length} rule{Object.keys(config.author_rules).length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${authorOverridesOpen ? 'rotate-180' : ''}`} />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">
                      {authorsQuery.isLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : authors.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No authors found yet. They will appear as posts are ingested.</p>
                      ) : (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Author</TableHead>
                                <TableHead className="text-right">Posts</TableHead>
                                <TableHead>Rule</TableHead>
                                <TableHead>Threshold</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {authors.slice(0, 50).map(({ handle, count }) => {
                                const rule = getAuthorRule(handle);
                                return (
                                  <TableRow key={handle}>
                                    <TableCell className="font-mono text-sm">@{handle}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{count.toLocaleString()}</TableCell>
                                    <TableCell>
                                      <Select value={rule} onValueChange={(v) => setAuthorRule(handle, v)}>
                                        <SelectTrigger className="w-[180px]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="ai_scoring">Use AI scoring</SelectItem>
                                          <SelectItem value="always_deliver">Always deliver</SelectItem>
                                          <SelectItem value="always_skip">Always skip</SelectItem>
                                          <SelectItem value="custom_threshold">Custom threshold</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      {rule === 'custom_threshold' ? (
                                        <div className="flex items-center gap-2">
                                          <Slider
                                            value={[getAuthorThreshold(handle)]}
                                            onValueChange={([v]) => setAuthorRule(handle, 'custom_threshold', v)}
                                            min={1}
                                            max={20}
                                            step={1}
                                            className="w-24"
                                          />
                                          <Badge variant="outline">{getAuthorThreshold(handle)}</Badge>
                                        </div>
                                      ) : rule === 'always_deliver' ? (
                                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">All</Badge>
                                      ) : rule === 'always_skip' ? (
                                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">None</Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground">Default ({config.default_threshold})</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Editorial Guidelines — visible for Score Only and Active */}
      {filterStatus !== 'off' && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center text-glass-foreground">
              <Sparkles className="w-5 h-5 mr-2" />Editorial Guidelines
            </CardTitle>
            <CardDescription>
              Tell the AI what matters to your audience in plain language. This is injected directly into the scoring prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={config.editorial_guidelines}
              onChange={(e) => setConfig({ ...config, editorial_guidelines: e.target.value })}
              className="glass-input min-h-[120px]"
              placeholder="e.g., Prioritize anything related to Iran, the war, GCC countries, sanctions, and military developments..."
            />

            <div className="space-y-2">
              <Label>High Priority Topics (boost score)</Label>
              <div className="flex gap-2">
                <Input
                  value={newPriorityTopic}
                  onChange={(e) => setNewPriorityTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTopic('priority')}
                  placeholder="Add topic..."
                  className="glass-input"
                />
                <Button variant="outline" size="icon" onClick={() => addTopic('priority')}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {config.priority_topics.map(topic => (
                  <Badge key={topic} className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                    {topic}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeTopic('priority', topic)} />
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Low Priority Topics (lower score)</Label>
              <div className="flex gap-2">
                <Input
                  value={newLowPriorityTopic}
                  onChange={(e) => setNewLowPriorityTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTopic('low_priority')}
                  placeholder="Add topic..."
                  className="glass-input"
                />
                <Button variant="outline" size="icon" onClick={() => addTopic('low_priority')}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {config.low_priority_topics.map(topic => (
                  <Badge key={topic} className="bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1">
                    {topic}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeTopic('low_priority', topic)} />
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scoring Rubric (System Prompt for combined translate+score call) */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground">
            <Shield className="w-5 h-5 mr-2" />Scoring Rubric (System Prompt)
          </CardTitle>
          <CardDescription>
            Used only when this filter is enabled. Combined with the translation prompt for the dual translate+score call.
            Placeholders: <code className="text-xs">{'{translation_prompt}'}</code>, <code className="text-xs">{'{priority_topics}'}</code>, <code className="text-xs">{'{low_priority_topics}'}</code>, <code className="text-xs">{'{editorial_guidelines_block}'}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PromptEditor
            value={ts.scoring_system_prompt ?? DEFAULT_SCORING_SYSTEM_PROMPT}
            onChange={(v) => setTs({ scoring_system_prompt: v })}
            placeholder="Enter the scoring rubric system prompt..."
            minHeight={420}
            maxLength={20000}
            title="Scoring Rubric (System Prompt)"
            onReset={() => setTs({ scoring_system_prompt: DEFAULT_SCORING_SYSTEM_PROMPT })}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={saveTranslationPrompt}
              disabled={saveMutation.isPending}
              className="bg-gradient-primary hover:opacity-90 text-white"
            >
              Save scoring prompt
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Classifier Tool Schema */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground">
            <Code className="w-5 h-5 mr-2" />Classifier Tool Schema
          </CardTitle>
          <CardDescription>
            JSON schema for the <code className="text-xs">classify_importance</code> function the model is forced to call. Edit field names, descriptions, or constraints. Must be valid JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PromptEditor
            value={ts.classifier_tool_schema ?? DEFAULT_CLASSIFIER_TOOL_SCHEMA}
            onChange={(v) => setTs({ classifier_tool_schema: v })}
            placeholder="Enter the JSON schema..."
            minHeight={360}
            maxLength={20000}
            title="Classifier Tool Schema"
            onReset={() => setTs({ classifier_tool_schema: DEFAULT_CLASSIFIER_TOOL_SCHEMA })}
          />
          <div className="flex gap-2 items-center justify-end">
            <span className="text-xs text-muted-foreground mr-auto">JSON validated on save</span>
            <Button
              size="sm"
              onClick={() => {
                try {
                  JSON.parse(ts.classifier_tool_schema ?? DEFAULT_CLASSIFIER_TOOL_SCHEMA);
                  saveTranslationPrompt();
                } catch (e) {
                  toast({ title: 'Invalid JSON', description: (e as Error).message, variant: 'destructive' });
                }
              }}
              disabled={saveMutation.isPending}
              className="bg-gradient-primary hover:opacity-90 text-white"
            >
              Save tool schema
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={() => saveMutation.mutate({ key: 'content_filter', value: config })}
          disabled={saveMutation.isPending}
          className="bg-gradient-primary hover:opacity-90 text-white flex-1"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
          Save Content Filter Settings
        </Button>
        <Button
          onClick={applyRecommendedDefaults}
          disabled={saveMutation.isPending}
          variant="outline"
          className="sm:w-auto"
          title="Sets threshold to 12, replaces editorial guidelines with the bias-corrected version, and switches the OpenAI model to gpt-5.4-mini."
        >
          <Wand2 className="w-4 h-4 mr-2" />
          Apply Recommended Iran-Rubric Defaults
        </Button>
      </div>
    </div>
  );
}

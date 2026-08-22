import { useMemo, useState } from 'react';
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
  useSaveSettings,
} from '@/hooks/useSettingsData';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { invokeAdminAction } from '@/api/adminActions';
import { useIncomingSettingsDraft } from '@/hooks/useIncomingSettingsDraft';

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
  translationSettings: TranslationSettings;
  onTranslationSettingsChange: (next: TranslationSettings) => void;
}

interface AuthorSampleRow {
  handle: string;
  count: number;
}

interface AuthorStatsResponse {
  ok: true;
  scope: 'recent_posts_sample';
  sampled_posts: number;
  limit: number;
  authors: AuthorSampleRow[];
}

export default function ContentFilterSettings({ initialConfig, translationSettings, onTranslationSettingsChange }: Props) {
  const incomingConfig = useMemo(
    () => ({ ...defaultConfig, ...initialConfig }),
    [initialConfig],
  );
  const {
    draft: config,
    dirtyFields,
    pendingFields,
    hasPendingIncoming,
    updateDraft: updateConfig,
    reloadIncoming,
    keepEditing,
    markSaved,
  } = useIncomingSettingsDraft(incomingConfig);
  const [newPriorityTopic, setNewPriorityTopic] = useState('');
  const [newLowPriorityTopic, setNewLowPriorityTopic] = useState('');
  const [authorOverridesOpen, setAuthorOverridesOpen] = useState(false);
  const [advancedFilterHelpOpen, setAdvancedFilterHelpOpen] = useState(false);
  const saveMutation = useSaveSettings();
  const { toast } = useToast();

  const ts = translationSettings;
  const setTs = (patch: Partial<TranslationSettings>) => onTranslationSettingsChange({ ...ts, ...patch });
  const saveTranslationPrompt = () => saveMutation.mutate({ key: 'translation_prompt', value: ts });

  const applyRecommendedDefaults = async () => {
    const recommendedConfig: ContentFilterConfig = {
      ...RECOMMENDED_IRAN_RUBRIC,
      priority_topics: [...RECOMMENDED_IRAN_RUBRIC.priority_topics],
      low_priority_topics: [...RECOMMENDED_IRAN_RUBRIC.low_priority_topics],
      author_rules: { ...RECOMMENDED_IRAN_RUBRIC.author_rules },
    };
    updateConfig(recommendedConfig);
    try {
      await saveMutation.mutateAsync({ key: 'content_filter', value: recommendedConfig });
      markSaved(recommendedConfig);
      toast({ title: 'Recommended Iran-rubric defaults applied', description: 'Threshold 12 with updated guidelines.' });
    } catch (e) {
      // useSaveSettings already shows an error toast
    }
  };

  const saveContentFilter = async () => {
    const savedConfig = config;
    try {
      await saveMutation.mutateAsync({ key: 'content_filter', value: savedConfig });
      markSaved(savedConfig);
    } catch {
      // useSaveSettings already shows an error toast and keeps the draft dirty.
    }
  };

  const filterStatus = getFilterStatus(config);
  const filterMode = config.filter_mode || 'global';
  const shouldLoadAuthors = filterStatus === 'active' &&
    filterMode === 'granular' &&
    authorOverridesOpen;

  const authorsQuery = useQuery({
    queryKey: ['content-filter-author-stats', 500],
    queryFn: () => invokeAdminAction<AuthorStatsResponse>({
      action: 'get_recent_author_stats',
      limit: 500,
    }),
    enabled: shouldLoadAuthors,
    staleTime: 120_000,
  });

  const visibleAuthors = useMemo(() => {
    const sampledByHandle = new Map(
      (authorsQuery.data?.authors ?? []).map((author) => [author.handle, author]),
    );
    const configuredHandles = Object.keys(config.author_rules).sort((left, right) => left.localeCompare(right));
    const configuredAuthors = configuredHandles.map((handle) => (
      sampledByHandle.get(handle) ?? { handle, count: 0 }
    ));
    const configuredHandleSet = new Set(configuredHandles);
    const sampleAuthors = (authorsQuery.data?.authors ?? [])
      .filter((author) => !configuredHandleSet.has(author.handle))
      .slice(0, 50);
    return [...configuredAuthors, ...sampleAuthors];
  }, [authorsQuery.data?.authors, config.author_rules]);
  const authorSampledPosts = authorsQuery.data?.sampled_posts ?? 0;
  const authorSampleLimit = authorsQuery.data?.limit ?? 500;

  const addTopic = (type: 'priority' | 'low_priority') => {
    const value = type === 'priority' ? newPriorityTopic.trim() : newLowPriorityTopic.trim();
    if (!value) return;
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    if (!config[key].includes(value)) {
      updateConfig({ ...config, [key]: [...config[key], value] });
    }
    if (type === 'priority') setNewPriorityTopic('');
    else setNewLowPriorityTopic('');
  };

  const removeTopic = (type: 'priority' | 'low_priority', topic: string) => {
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    updateConfig({ ...config, [key]: config[key].filter(t => t !== topic) });
  };

  const setAuthorRule = (handle: string, rule: string, threshold?: number) => {
    const newRules = { ...config.author_rules };
    if (rule === 'ai_scoring') {
      delete newRules[handle];
    } else {
      newRules[handle] = { rule, ...(threshold != null ? { threshold } : {}) };
    }
    updateConfig({ ...config, author_rules: newRules });
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
          <CardDescription className="space-y-2">
            <p>
              Legacy path: the model returns an <span className="font-medium text-foreground">importance score</span> (1–20). When filtering is{' '}
              <span className="font-medium text-foreground">Active</span>, posts below your threshold are skipped for Telegram. When an editorial profile is active in the worker,
              delivery instead uses that profile&apos;s <span className="font-medium text-foreground">final score</span> and profile threshold — so Monitoring may show different headline numbers than this card.
            </p>
            <p className="text-muted-foreground">
              Score Only records scores without blocking delivery. Off disables scoring for this legacy path (profiles may still apply).
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {hasPendingIncoming && (
            <div role="alert" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <div>
                <p className="font-medium text-foreground">New saved settings available</p>
                <p className="mt-1 text-muted-foreground">
                  {dirtyFields.length} unsaved {dirtyFields.length === 1 ? 'setting has' : 'settings have'} local edits. Reload saved values to discard them, or keep editing before you save.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Compare changed fields: {pendingFields.length > 0 ? pendingFields.join(', ') : 'none; the saved snapshot matches this draft'}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={reloadIncoming}>
                  Reload saved values
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={keepEditing}>
                  Keep editing
                </Button>
              </div>
            </div>
          )}
          {/* 3-way status selector */}
          <div className="grid grid-cols-3 gap-3">
            {statusOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateConfig(applyFilterStatus(config, opt.value))}
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

          <Collapsible open={advancedFilterHelpOpen} onOpenChange={setAdvancedFilterHelpOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-left text-sm font-medium hover:bg-muted/50">
              <span>Advanced: how this interacts with editorial profiles</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${advancedFilterHelpOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3 text-sm text-muted-foreground">
              <ul className="list-disc space-y-1.5 pl-4">
                <li>
                  Topics and editorial guidelines here are merged into the scoring prompt (together with the rubric below) whenever the dual translate+score call runs.
                </li>
                <li>
                  They are <span className="font-medium text-foreground">hints and rubric text</span>, not hard allow-lists, unless an active editorial profile adds hard rules (tags, keywords, overrides).
                </li>
                <li>
                  Priority topics nudge the model toward higher scores when relevant; they do not guarantee delivery. Low-priority topics nudge downward; they do not auto-skip by themselves.
                </li>
                <li>
                  The <span className="font-medium text-foreground">global threshold</span> on this card gates <span className="font-medium text-foreground">importance_score</span> on the legacy filter path. An active profile uses its own threshold on <span className="font-medium text-foreground">final_score</span> after axes and profile rules.
                </li>
              </ul>
            </CollapsibleContent>
          </Collapsible>

          {filterStatus === 'active' && (
            <>
              <Separator />

              {/* Filter Mode: Global vs Granular */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">Filter Mode</Label>
                <RadioGroup
                  value={filterMode}
                  onValueChange={(v) => updateConfig({ ...config, filter_mode: v as 'global' | 'granular' })}
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
                    ? 'On the legacy filter path, posts whose importance_score is below this are skipped for Telegram. Does not replace an active editorial profile threshold on final_score.'
                    : 'Fallback threshold for authors without a per-author rule on the legacy path.'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Minimum score to deliver</span>
                  <Badge variant="outline" className="text-lg px-3 py-1">{config.default_threshold}/20</Badge>
                </div>
                <Slider
                  value={[config.default_threshold]}
                  onValueChange={([v]) => updateConfig({ ...config, default_threshold: v })}
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
                      ) : authorsQuery.isError ? (
                        <div role="alert" className="space-y-3 rounded-md border border-destructive/40 p-4 text-sm">
                          <p className="text-destructive">Could not load the bounded recent author sample.</p>
                          <Button type="button" size="sm" variant="outline" onClick={() => void authorsQuery.refetch()}>
                            Retry authors
                          </Button>
                        </div>
                      ) : visibleAuthors.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No authors found yet. They will appear as posts are ingested.</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Showing author counts from {authorSampledPosts.toLocaleString()} newest posts with an author handle (maximum {authorSampleLimit.toLocaleString()}). This is a bounded recent sample, not an all-time count.
                          </p>
                          <div className="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Author</TableHead>
                                  <TableHead className="text-right">Posts in sample</TableHead>
                                  <TableHead>Rule</TableHead>
                                  <TableHead>Threshold</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visibleAuthors.map(({ handle, count }) => {
                                  const rule = getAuthorRule(handle);
                                  return (
                                    <TableRow key={handle}>
                                      <TableCell className="font-mono text-sm">@{handle}</TableCell>
                                      <TableCell className="text-right text-muted-foreground">
                                        {count > 0 ? count.toLocaleString() : 'Not in sample'}
                                      </TableCell>
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
            <CardDescription className="space-y-2">
              <p>
                Free-text rubric merged into the scoring prompt; this is usually the strongest narrative control on what “important” means for your channel.
              </p>
              <p className="text-muted-foreground">
                Shown when filtering is Score Only or Active so you can tune the model even if delivery is not gated here.
              </p>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={config.editorial_guidelines}
              onChange={(e) => updateConfig({ ...config, editorial_guidelines: e.target.value })}
              className="glass-input min-h-[120px]"
              placeholder="e.g., Prioritize anything related to Iran, the war, GCC countries, sanctions, and military developments..."
            />

            <div className="space-y-2">
              <Label>High Priority Topics (boost score)</Label>
              <p className="text-xs text-muted-foreground">
                Hints so the model leans higher when a topic is relevant — not a hard allow-list unless combined with editorial profile rules.
              </p>
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
              <p className="text-xs text-muted-foreground">
                Hints to de-emphasize matching content; does not automatically skip posts.
              </p>
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
          onClick={() => { void saveContentFilter(); }}
          disabled={saveMutation.isPending || hasPendingIncoming}
          className="bg-gradient-primary hover:opacity-90 text-white flex-1"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
          Save Content Filter Settings
        </Button>
        <Button
          onClick={applyRecommendedDefaults}
          disabled={saveMutation.isPending || hasPendingIncoming}
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

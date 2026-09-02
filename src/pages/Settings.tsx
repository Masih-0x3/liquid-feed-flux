import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { invokeAdminRetry, isAdminRetryCutoverBlocked } from '@/api/adminRetry';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Activity, AlertTriangle, Brain, MessageSquare, Eye, Code, Sparkles, Send, Shield, Loader2, Filter, AtSign, ChevronDown, Info, Film } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useSettingsData, useSaveSettings, openaiModels, messagePlaceholders, promptPlaceholders,
  type TranslationSettings, type TelegramSettings, type MessageTemplateSettings, type ScoringPolicy,
} from '@/hooks/useSettingsData';
import type { ContentFilterConfig } from '@/components/settings/ContentFilterSettings';
import type { EditorialProfile } from '@/hooks/useSettingsData';
import PromptEditor from '@/components/settings/PromptEditor';
import RuntimeControlsPanel from '@/components/settings/RuntimeControlsPanel';

const ContentFilterSettings = lazy(() => import('@/components/settings/ContentFilterSettings'));
const EditorialProfilesCard = lazy(() => import('@/components/settings/EditorialProfilesCard'));
const ScoringStudio = lazy(() => import('@/components/settings/ScoringStudio'));
const StoryMemoryCard = lazy(() => import('@/components/settings/StoryMemoryCard'));
const XAutomationSettings = lazy(() => import('@/components/settings/XAutomationSettings'));
const TranslationPlayground = lazy(() => import('@/components/settings/TranslationPlayground'));
const LearnedSignalsCard = lazy(() => import('@/components/settings/LearnedSignalsCard'));
const EnrichmentSettings = lazy(() => import('@/components/settings/EnrichmentSettings'));
const VideoRenderingSettings = lazy(() => import('@/components/settings/VideoRenderingSettings'));
const ObservabilitySettings = lazy(() => import('@/components/settings/ObservabilitySettings'));

const SETTINGS_TAB_IDS = ['translation', 'filter', 'messages', 'telegram', 'x-automation', 'video-rendering', 'enrichment', 'observability'] as const;
type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];
const OPENAI_MAX_COMPLETION_TOKENS_LIMIT = 8000;

function completionTokenMax(modelLimit: number | undefined, fallback: number): number {
  return Math.min(modelLimit ?? fallback, OPENAI_MAX_COMPLETION_TOKENS_LIMIT);
}

function clampOpenAiCompletionTokens(value: number | null | undefined, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, Math.min(OPENAI_MAX_COMPLETION_TOKENS_LIMIT, candidate));
}

function parseOpenAiCompletionTokens(value: string, fallback: number): number {
  return clampOpenAiCompletionTokens(Number.parseInt(value, 10), fallback);
}

function prepareTranslationSettingsForSave(settings: TranslationSettings): TranslationSettings {
  return {
    ...settings,
    max_completion_tokens: clampOpenAiCompletionTokens(settings.max_completion_tokens, 1000),
    scoring: settings.scoring
      ? {
          ...settings.scoring,
          max_completion_tokens: clampOpenAiCompletionTokens(settings.scoring.max_completion_tokens, 2000),
        }
      : settings.scoring,
  };
}

function tabIdFromHash(hash: string): SettingsTabId | null {
  const id = hash.replace(/^#/, '');
  return (SETTINGS_TAB_IDS as readonly string[]).includes(id) ? (id as SettingsTabId) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTranslationSettingsBaseline(value: unknown): value is TranslationSettings {
  return isRecord(value)
    && typeof value.system_prompt === 'string'
    && typeof value.user_prompt_template === 'string'
    && typeof value.model === 'string'
    && isFiniteNumber(value.temperature)
    && isFiniteNumber(value.max_completion_tokens)
    && isFiniteNumber(value.top_p)
    && isFiniteNumber(value.frequency_penalty)
    && isFiniteNumber(value.presence_penalty);
}

function isTelegramSettingsBaseline(value: unknown): value is TelegramSettings {
  return isRecord(value) && typeof value.parse_mode === 'string';
}

function isMessageTemplateBaseline(value: unknown): value is MessageTemplateSettings {
  return isRecord(value)
    && typeof value.template === 'string'
    && typeof value.include_source_link === 'boolean'
    && typeof value.include_hashtags === 'boolean'
    && typeof value.include_media_caption === 'boolean'
    && typeof value.source_link_text === 'string'
    && typeof value.custom_hashtags === 'string';
}

function hasSettingsBaseline(value: unknown): boolean {
  return isRecord(value)
    && isTranslationSettingsBaseline(value.translation_prompt)
    && isTelegramSettingsBaseline(value.telegram_config)
    && isMessageTemplateBaseline(value.message_template);
}

function insertPlaceholder(placeholder: string, textareaId: string, getter: string, setter: (val: string) => void) {
  const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setter(getter.substring(0, start) + placeholder + getter.substring(end));
    setTimeout(() => { textarea.setSelectionRange(start + placeholder.length, start + placeholder.length); textarea.focus(); }, 0);
  }
}

function SettingsPanelFallback() {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { role, isAdmin } = useAuth();
  const isReadOnly = role === 'read_only';
  const canMutate = isAdmin === true && !isReadOnly;
  const location = useLocation();
  const { settingsQuery, samplesQuery } = useSettingsData();
  const saveMutation = useSaveSettings();
  const [selectedSample, setSelectedSample] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(() => {
    if (typeof window === 'undefined') return 'translation';
    return tabIdFromHash(window.location.hash) ?? 'translation';
  });

  const goToSettingsTab = useCallback(
    (tab: SettingsTabId) => {
      setSettingsTab(tab);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
      }
    },
    [location.pathname, location.search],
  );

  useEffect(() => {
    const fromUrl = tabIdFromHash(location.hash);
    if (fromUrl) setSettingsTab(fromUrl);
  }, [location.hash]);

  // Local state for editing (initialized from query data)
  const settings = settingsQuery.data;
  const sampleTweets = samplesQuery.data || [];
  const hasAuthoritativeSettingsBaseline = hasSettingsBaseline(settings);

  const [translationSettings, setTranslationSettings] = useState<TranslationSettings | null>(null);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings | null>(null);
  const [messageTemplate, setMessageTemplate] = useState<MessageTemplateSettings | null>(null);

  // Sync from server on first load
  const ts = translationSettings ?? settings?.translation_prompt;
  const tgs = telegramSettings ?? settings?.telegram_config;
  const mt = messageTemplate ?? settings?.message_template;

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (settingsQuery.isError || settingsQuery.error || !hasAuthoritativeSettingsBaseline) {
    return (
      <div className="mx-auto flex min-h-[400px] w-full max-w-2xl items-center px-4 py-8">
        <Alert className="border-destructive/40 bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle>Settings are unavailable</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>We could not load an authoritative settings baseline. Nothing can be changed until the read succeeds.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void settingsQuery.refetch(); }}
              disabled={settingsQuery.isFetching}
            >
              {settingsQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Retry loading settings
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!ts || !tgs || !mt) return null;

  const selectedModel = openaiModels.find(m => m.id === ts.model);
  const cappedTranslationMaxTokens = clampOpenAiCompletionTokens(ts.max_completion_tokens, 1000);
  const saveSetting = (input: Parameters<typeof saveMutation.mutate>[0]) => {
    if (!canMutate) return;
    saveMutation.mutate(input);
  };
  const saveTranslationPrompt = () => saveSetting({ key: 'translation_prompt', value: prepareTranslationSettingsForSave(ts) });

  const getPlaceholderValue = (key: string, tweet: Record<string, unknown>) => {
    const accounts = tweet?.accounts as Record<string, unknown> | undefined;
    switch (key) {
      case '{content}': { const text = tweet?.text_original as string; return text && text !== 'RSS Item' ? text : '[Tweet content]'; }
      case '{author_handle}': return (accounts?.handle as string) || '[author_handle]';
      case '{author_name}': return (accounts?.display_name as string) || '[author_name]';
      case '{tweet_url}': return (tweet?.url as string) || '[tweet_url]';
      case '{published_date}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleDateString() : '[date]';
      case '{has_media}': return (tweet?.has_media as boolean)?.toString() || 'false';
      case '{media_count}': return tweet?.has_media ? '[count]' : '0';
      case '{original_language}': return (tweet?.lang_original as string) || '[lang]';
      default: return key;
    }
  };

  const getMessagePlaceholderValue = (key: string, tweet: Record<string, unknown>) => {
    const accounts = tweet?.accounts as Record<string, unknown> | undefined;
    switch (key) {
      case '{translated_text}': return (tweet?.text_translated as string) || '\u062F\u0648\u0644\u062A \u062A\u0631\u0627\u0645\u067E \u0627\u0639\u0644\u0627\u0645 \u06A9\u0631\u062F...';
      case '{original_text}': return (tweet?.text_original as string) || 'Sample original text';
      case '{author_handle}': return (accounts?.handle as string) || '@sample';
      case '{author_name}': return (accounts?.display_name as string) || 'Sample Author';
      case '{source_link}': return mt.include_source_link ? `<a href="${(tweet?.url as string) || '#'}">${mt.source_link_text}</a>` : '';
      case '{published_date}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleDateString('fa-IR') : '\u06F1\u06F4\u06F0\u06F4/\u06F6/\u06F1\u06F2';
      case '{published_time}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '\u06F2\u06F1:\u06F3\u06F5';
      case '{hashtags}': return mt.custom_hashtags;
      case '{media_info}': return (tweet?.has_media as boolean) ? '\u{1F4F8} \u062A\u0635\u0648\u06CC\u0631' : '';
      default: return key;
    }
  };

  const renderMessagePreview = () => {
    const sampleTweet = sampleTweets[selectedSample];
    if (!sampleTweet) return '';
    return messagePlaceholders.reduce((tpl, p) => tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getMessagePlaceholderValue(p.key, sampleTweet)), mt.template);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-3xl font-display font-bold text-glass-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your pipeline integrations and translation prompts</p>
      </div>

      {isReadOnly && (
        <Alert className="border-amber-400/30 bg-amber-500/10 text-amber-100" role="status">
          <Shield className="h-4 w-4 text-amber-300" aria-hidden="true" />
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>Settings are available for review. Editing and test actions are disabled.</AlertDescription>
        </Alert>
      )}

      <RuntimeControlsPanel />

      <Tabs value={settingsTab} onValueChange={(v) => goToSettingsTab(v as SettingsTabId)} className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto p-1">
          <TabsTrigger value="translation" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Brain className="w-4 h-4" />Translation</TabsTrigger>
          <TabsTrigger value="filter" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Filter className="w-4 h-4" />Scoring</TabsTrigger>
          <TabsTrigger value="messages" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><MessageSquare className="w-4 h-4" />Messages</TabsTrigger>
          <TabsTrigger value="telegram" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Send className="w-4 h-4" />Telegram</TabsTrigger>
          <TabsTrigger value="x-automation" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><AtSign className="w-4 h-4" />X Automation</TabsTrigger>
          <TabsTrigger value="video-rendering" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Film className="w-4 h-4" />Video</TabsTrigger>
          <TabsTrigger value="enrichment" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Sparkles className="w-4 h-4" />Enrichment</TabsTrigger>
          <TabsTrigger value="observability" className="shrink-0 whitespace-nowrap flex items-center gap-2 text-xs sm:text-sm"><Activity className="w-4 h-4" />Observability</TabsTrigger>
        </TabsList>

        <fieldset disabled={!canMutate} className="min-w-0 space-y-6 disabled:cursor-not-allowed">

        {/* Translation Tab */}
        <TabsContent value="translation" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Sparkles className="w-5 h-5 mr-2" />AI Model Selection</CardTitle>
              <CardDescription>Choose the OpenAI model and configure its parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="model_select">Model</Label>
                <Select value={ts.model} onValueChange={(v) => setTranslationSettings({ ...ts, model: v })}>
                  <SelectTrigger className="glass-input"><SelectValue placeholder="Select a model" /></SelectTrigger>
                  <SelectContent>
                    {openaiModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <Badge variant={model.tier === 'latest' ? 'default' : model.tier === 'legacy' ? 'outline' : 'secondary'} className="text-[10px] uppercase">{model.tier}</Badge>
                          <div className="flex gap-1">{model.supports.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedModel && (
                  <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{selectedModel.description}</p>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span>Max Tokens: {selectedModel.maxTokens.toLocaleString()}</span>
                      <span>Supports: {selectedModel.supports.join(', ')}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{selectedModel?.useMaxCompletionTokens ? 'Max Completion Tokens' : 'Max Tokens'}</Label>
                  <Input type="number" min="1" max={completionTokenMax(selectedModel?.maxTokens, 4096)} value={cappedTranslationMaxTokens} onChange={(e) => setTranslationSettings({ ...ts, max_completion_tokens: parseOpenAiCompletionTokens(e.target.value, 1000) })} className="glass-input" />
                </div>
                {selectedModel?.supportsTemperature && (
                  <div className="space-y-2">
                    <Label>Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={ts.temperature} onChange={(e) => setTranslationSettings({ ...ts, temperature: parseFloat(e.target.value) || 0 })} className="glass-input" />
                    <p className="text-xs text-muted-foreground">0 = deterministic, 2 = very random.</p>
                  </div>
                )}
                {selectedModel?.supportsReasoningEffort && (
                  <div className="space-y-2">
                    <Label>Reasoning effort</Label>
                    <Select value={ts.reasoning_effort ?? 'medium'} onValueChange={(v) => setTranslationSettings({ ...ts, reasoning_effort: v as 'minimal' | 'low' | 'medium' | 'high' })}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minimal">Minimal — fastest, cheapest</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium (recommended)</SelectItem>
                        <SelectItem value="high">High — deepest, slowest</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">How much hidden reasoning the model performs before answering.</p>
                  </div>
                )}
                {selectedModel?.supportsVerbosity && (
                  <div className="space-y-2">
                    <Label>Verbosity</Label>
                    <Select value={ts.verbosity ?? 'medium'} onValueChange={(v) => setTranslationSettings({ ...ts, verbosity: v as 'low' | 'medium' | 'high' })}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low — terse output</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High — expansive</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Controls visible answer length, independent of reasoning depth.</p>
                  </div>
                )}
              </div>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground border border-dashed border-border">
                    <span className="flex items-center gap-2"><Code className="w-3.5 h-3.5" />Advanced sampling parameters</span>
                    <ChevronDown className="w-4 h-4 transition-transform [&[data-state=open]]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-3 gap-4">
                    {selectedModel?.supportsTopP && (
                      <div className="space-y-2">
                        <Label>Top P</Label>
                        <Input type="number" step="0.05" min="0" max="1" value={ts.top_p} onChange={(e) => setTranslationSettings({ ...ts, top_p: parseFloat(e.target.value) || 1 })} className="glass-input" />
                      </div>
                    )}
                    {selectedModel?.supportsPenalties && (
                      <>
                        <div className="space-y-2"><Label>Frequency Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.frequency_penalty} onChange={(e) => setTranslationSettings({ ...ts, frequency_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                        <div className="space-y-2"><Label>Presence Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.presence_penalty} onChange={(e) => setTranslationSettings({ ...ts, presence_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {selectedModel?.supportsSeed && (
                      <div className="space-y-2">
                        <Label>Seed (optional)</Label>
                        <Input
                          type="number"
                          placeholder="leave blank for random"
                          value={ts.seed ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            setTranslationSettings({ ...ts, seed: raw === '' ? null : parseInt(raw) });
                          }}
                          className="glass-input"
                        />
                        <p className="text-xs text-muted-foreground">Same seed + same prompt → reproducible output.</p>
                      </div>
                    )}
                    {selectedModel?.supportsServiceTier && (
                      <div className="space-y-2">
                        <Label>Service tier</Label>
                        <Select value={ts.service_tier ?? 'auto'} onValueChange={(v) => setTranslationSettings({ ...ts, service_tier: v as 'auto' | 'default' | 'flex' | 'priority' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="flex">Flex (cheaper, slower)</SelectItem>
                            <SelectItem value="priority">Priority (faster, costlier)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {selectedModel?.supportsParallelToolCalls && (
                      <div className="space-y-2">
                        <Label>Parallel tool calls</Label>
                        <Select value={String(ts.parallel_tool_calls ?? true)} onValueChange={(v) => setTranslationSettings({ ...ts, parallel_tool_calls: v === 'true' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Enabled</SelectItem>
                            <SelectItem value="false">Disabled (force single call)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={saveTranslationPrompt} disabled={saveMutation.isPending}>
                      Save model parameters
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Scoring Model Settings — independent params for the importance-scoring call */}
          {(() => {
            const scoring = ts.scoring ?? {};
            const scoringModelId = scoring.model ?? ts.model;
            const scoringModel = openaiModels.find(m => m.id === scoringModelId);
            const cappedScoringMaxTokens = clampOpenAiCompletionTokens(scoring.max_completion_tokens, 2000);
            const updateScoring = (patch: Partial<NonNullable<TranslationSettings['scoring']>>) => {
              setTranslationSettings({ ...ts, scoring: { ...scoring, ...patch } });
            };
            return (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center text-glass-foreground"><Brain className="w-5 h-5 mr-2" />Scoring Model Settings</CardTitle>
                  <CardDescription>
                    Independent OpenAI parameters for the importance-scoring call. When the score passes the filter, the translation call runs with the settings above.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div>
                      <Label className="text-sm">Score-first pipeline (split calls)</Label>
                      <p className="text-xs text-muted-foreground mt-1">When enabled, score first and translate only on pass.</p>
                    </div>
                    <Select value={String(ts.split_calls ?? true)} onValueChange={(v) => setTranslationSettings({ ...ts, split_calls: v === 'true' })}>
                      <SelectTrigger className="glass-input w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Scoring model</Label>
                    <Select value={scoringModelId} onValueChange={(v) => updateScoring({ model: v })}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {openaiModels.map(model => (
                          <SelectItem key={model.id} value={model.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{model.name}</span>
                              <Badge variant={model.tier === 'latest' ? 'default' : model.tier === 'legacy' ? 'outline' : 'secondary'} className="text-[10px] uppercase">{model.tier}</Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Completion Tokens</Label>
                      <Input type="number" min={1} max={completionTokenMax(scoringModel?.maxTokens, 16000)} value={cappedScoringMaxTokens} onChange={(e) => updateScoring({ max_completion_tokens: parseOpenAiCompletionTokens(e.target.value, 2000) })} className="glass-input" />
                    </div>
                    {scoringModel?.supportsTemperature && (
                      <div className="space-y-2">
                        <Label>Temperature</Label>
                        <Input type="number" step="0.1" min={0} max={2} value={scoring.temperature ?? 0.2} onChange={(e) => updateScoring({ temperature: parseFloat(e.target.value) })} className="glass-input" />
                      </div>
                    )}
                    {scoringModel?.supportsReasoningEffort && (
                      <div className="space-y-2">
                        <Label>Reasoning effort</Label>
                        <Select value={scoring.reasoning_effort ?? 'low'} onValueChange={(v) => updateScoring({ reasoning_effort: v as 'minimal' | 'low' | 'medium' | 'high' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minimal">Minimal</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {scoringModel?.supportsVerbosity && (
                      <div className="space-y-2">
                        <Label>Verbosity</Label>
                        <Select value={scoring.verbosity ?? 'low'} onValueChange={(v) => updateScoring({ verbosity: v as 'low' | 'medium' | 'high' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {scoringModel?.supportsTopP && (
                      <div className="space-y-2">
                        <Label>Top P</Label>
                        <Input type="number" step="0.05" min={0} max={1} value={scoring.top_p ?? 1} onChange={(e) => updateScoring({ top_p: parseFloat(e.target.value) })} className="glass-input" />
                      </div>
                    )}
                    {scoringModel?.supportsSeed && (
                      <div className="space-y-2">
                        <Label>Seed (optional)</Label>
                        <Input type="number" placeholder="random" value={scoring.seed ?? ''} onChange={(e) => updateScoring({ seed: e.target.value === '' ? null : parseInt(e.target.value) })} className="glass-input" />
                      </div>
                    )}
                    {scoringModel?.supportsServiceTier && (
                      <div className="space-y-2">
                        <Label>Service tier</Label>
                        <Select value={scoring.service_tier ?? 'auto'} onValueChange={(v) => updateScoring({ service_tier: v as 'auto' | 'default' | 'flex' | 'priority' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="flex">Flex</SelectItem>
                            <SelectItem value="priority">Priority</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => updateScoring({
                      model: ts.model, temperature: ts.temperature, max_completion_tokens: cappedTranslationMaxTokens,
                      top_p: ts.top_p, reasoning_effort: ts.reasoning_effort, verbosity: ts.verbosity,
                      seed: ts.seed, service_tier: ts.service_tier, parallel_tool_calls: ts.parallel_tool_calls,
                    })}>
                      Copy from translation
                    </Button>
                    <Button size="sm" variant="outline" onClick={saveTranslationPrompt} disabled={saveMutation.isPending}>
                      Save scoring parameters
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><MessageSquare className="w-5 h-5 mr-2" />Translation Prompt Configuration</CardTitle>
              <CardDescription>Configure the AI translation prompts with dynamic placeholders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <PromptEditor
                  id="system_prompt"
                  value={ts.system_prompt}
                  onChange={(v) => setTranslationSettings({ ...ts, system_prompt: v })}
                  placeholder="Enter the system prompt for translation..."
                  minHeight={360}
                  maxLength={20000}
                  title="System Prompt"
                />
              </div>
              <Separator />
              <div className="space-y-4">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
                  <Label htmlFor="user_prompt_template">User Prompt Template</Label>
                  <div className="flex items-center gap-2"><Eye className="w-4 h-4" /><span className="text-sm text-muted-foreground">Available Placeholders</span></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {promptPlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'user_prompt_template', ts.user_prompt_template, (v) => setTranslationSettings({ ...ts, user_prompt_template: v }))} className="justify-start h-auto p-3 w-full whitespace-normal min-w-0 break-words">
                      <div className="text-left min-w-0 w-full break-words"><div className="font-mono text-xs text-primary">{p.key}</div><div className="text-xs text-muted-foreground whitespace-normal break-words">{p.description}</div></div>
                    </Button>
                  ))}
                </div>
                <PromptEditor
                  id="user_prompt_template"
                  value={ts.user_prompt_template}
                  onChange={(v) => setTranslationSettings({ ...ts, user_prompt_template: v })}
                  placeholder="Enter the user prompt template..."
                  minHeight={240}
                  maxLength={10000}
                  title="User Prompt Template"
                />
              </div>
              <Separator />
              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Code className="w-4 h-4" />Prompt Preview with Real Data</Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>{sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Preview of User Prompt:</div>
                    <div className="text-sm font-mono bg-background p-3 rounded border whitespace-pre-wrap">
                      {promptPlaceholders.reduce((tpl, p) => tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getPlaceholderValue(p.key, sampleTweets[selectedSample])), ts.user_prompt_template)}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={saveTranslationPrompt} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full sm:flex-1">
                  Save Translation Settings
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={saveMutation.isPending} className="border-primary/50 hover:bg-primary/10 w-full sm:w-auto">
                      Validate Webhook
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Validate the webhook safely?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This checks the production webhook's authentication and payload parsing when validation is available. It does not create posts or jobs. Validation is currently blocked during the immutable delivery cutover.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={async () => {
                        try {
                          if (!canMutate) return;
                          await invokeAdminRetry({ action: 'test_webhook' });
                          toast({ title: 'Webhook validation completed', description: 'Authentication and payload parsing completed; no post or job was created.' });
                        } catch (error) {
                          if (isAdminRetryCutoverBlocked(error)) {
                            toast({
                              title: 'Webhook validation blocked',
                              description: 'Validation is unavailable during the immutable delivery cutover. No webhook request was made.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          toast({ title: 'Webhook validation failed', description: 'The webhook could not be validated.', variant: 'destructive' });
                        }
                      }}>Validate webhook</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          {/* Scoring rubric + classifier tool schema have moved to the Content Filter tab,
              where they conceptually belong (they only run when filtering/scoring is active). */}

          {/* Live Translation Playground */}
          <Suspense fallback={<SettingsPanelFallback />}>
            <TranslationPlayground
              translationSettings={ts}
              contentFilter={(settings?.content_filter ?? { enabled: false }) as ContentFilterConfig}
              sampleTweets={sampleTweets}
            />
          </Suspense>
        </TabsContent>

        {/* Content Filter Tab */}
        <TabsContent value="filter" className="space-y-6">
          <Alert className="border-primary/25 bg-primary/5">
            <Info className="h-4 w-4" />
            <AlertTitle>How scoring fits together</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Scoring Studio</span> is the new profile-driven system. It separates audience fit from the final priority score.
                </li>
                <li>
                  In <span className="font-medium text-foreground">shadow</span> mode, v2 records audience class and score evidence while legacy gates stay in control.
                  In <span className="font-medium text-foreground">active</span> mode, v2 controls deliver/skip before translation.
                </li>
                <li>
                  <span className="font-medium text-foreground">Duplicate Gate</span> runs before scoring and translation. The novelty axis remains an importance signal, not duplicate enforcement.
                </li>
                <li>
                  X posting uses separate thresholds: open the{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                    onClick={() => goToSettingsTab('x-automation')}
                  >
                    X Automation
                  </button>{' '}
                  tab for <code className="rounded bg-muted px-1 py-0.5 text-xs">min_score</code> and related posting rules.
                </li>
              </ul>
            </AlertDescription>
          </Alert>
          <Suspense fallback={<SettingsPanelFallback />}>
            <ScoringStudio initial={settings?.scoring_policy as ScoringPolicy | undefined} />
            <EditorialProfilesCard
              profiles={(settings?.editorial_profiles as { profiles?: EditorialProfile[] } | undefined)?.profiles ?? []}
              activeProfileId={(settings?.active_profile_id as { id?: string | null } | undefined)?.id ?? null}
            />
            <StoryMemoryCard
              initial={settings?.story_memory as Partial<import('@/components/settings/StoryMemoryCard').StoryMemoryConfig> | undefined}
            />
            <ContentFilterSettings
              initialConfig={settings?.content_filter as ContentFilterConfig | undefined}
              translationSettings={ts}
              onTranslationSettingsChange={setTranslationSettings}
            />
            <LearnedSignalsCard />
          </Suspense>
        </TabsContent>

        <TabsContent value="messages" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><MessageSquare className="w-5 h-5 mr-2" />Telegram Message Template</CardTitle>
              <CardDescription>Configure how your translated messages appear in Telegram</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
                  <Label htmlFor="message_template">Message Template</Label>
                  <div className="flex items-center gap-2"><Eye className="w-4 h-4" /><span className="text-sm text-muted-foreground">Available Placeholders</span></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {messagePlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'message_template', mt.template, (v) => setMessageTemplate({ ...mt, template: v }))} className="justify-start h-auto p-3 w-full whitespace-normal min-w-0 break-words">
                      <div className="text-left min-w-0 w-full break-words"><div className="font-mono text-xs text-primary">{p.key}</div><div className="text-xs text-muted-foreground whitespace-normal break-words">{p.description}</div></div>
                    </Button>
                  ))}
                </div>
                <Textarea id="message_template" value={mt.template} onChange={(e) => setMessageTemplate({ ...mt, template: e.target.value })} className="glass-input min-h-[150px] font-mono text-sm" placeholder="Enter your message template..." />
              </div>
              <Separator />
              <div className="space-y-4">
                <Label className="text-base font-medium">Message Options</Label>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2"><input type="checkbox" checked={mt.include_source_link} onChange={(e) => setMessageTemplate({ ...mt, include_source_link: e.target.checked })} className="rounded" />Include Source Link</Label>
                  <Label className="flex items-center gap-2"><input type="checkbox" checked={mt.include_media_caption} onChange={(e) => setMessageTemplate({ ...mt, include_media_caption: e.target.checked })} className="rounded" />Include Media Caption</Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Source Link Text</Label><Input value={mt.source_link_text} onChange={(e) => setMessageTemplate({ ...mt, source_link_text: e.target.value })} className="glass-input" /></div>
                  <div className="space-y-2"><Label>Custom Hashtags</Label><Input value={mt.custom_hashtags} onChange={(e) => setMessageTemplate({ ...mt, custom_hashtags: e.target.value })} className="glass-input" /></div>
                </div>
              </div>
              <Separator />
              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Eye className="w-4 h-4" />Telegram Message Preview</Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>{sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg border-2 border-dashed border-muted-foreground/20">
                    <div className="text-sm font-medium mb-2 flex items-center gap-2"><Send className="w-4 h-4" />How it will appear in Telegram:</div>
                    <div className="text-sm bg-background p-4 rounded border whitespace-pre-wrap font-sans">{renderMessagePreview()}</div>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => saveSetting({ key: 'message_template', value: mt })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full sm:flex-1">Save Message Template</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={saveMutation.isPending || sampleTweets.length === 0} className="border-primary/50 hover:bg-primary/10 w-full sm:w-auto">
                      Test Message
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Send a live Telegram test?</AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div>
                          <p>This sends the selected sample through the production Telegram template test action.</p>
                          <div className="mt-2 max-h-48 overflow-auto rounded border bg-muted p-3 text-sm text-foreground whitespace-pre-wrap">
                            {renderMessagePreview()}
                          </div>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={async () => {
                        try {
                          if (!canMutate) return;
                          await invokeAdminRetry({ action: 'test_template', post: sampleTweets[selectedSample], template: mt.template, settings: { include_source_links: mt.include_source_link, custom_hashtags: mt.custom_hashtags } });
                          toast({ title: 'Test message sent!', description: 'Check your Telegram channel' });
                        } catch { toast({ title: 'Test failed', variant: 'destructive' }); }
                      }}>Send message</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Telegram Tab */}
        <TabsContent value="telegram" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Send className="w-5 h-5 mr-2" />Telegram Configuration</CardTitle>
              <CardDescription>Configure Telegram delivery settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/30 flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-glass-foreground">Bot Token &amp; Chat ID managed securely</p>
                  <p className="text-xs text-muted-foreground mt-1">Your Telegram credentials are stored as Supabase secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). To update them, go to your Supabase project → Edge Function Secrets.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Parse Mode</Label>
                <Select value={tgs.parse_mode} onValueChange={(v) => setTelegramSettings({ ...tgs, parse_mode: v })}>
                  <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Markdown">Markdown</SelectItem>
                    <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
                    <SelectItem value="HTML">HTML</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => saveSetting({ key: 'telegram_config', value: tgs })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full">Save Telegram Config</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* X Automation Tab */}
        <TabsContent value="x-automation" className="space-y-6">
          <Suspense fallback={<SettingsPanelFallback />}>
            <XAutomationSettings
              twitterHydration={settings?.twitter_hydration as { enabled?: boolean; max_attempts?: number } | undefined}
              xPostingConfig={settings?.x_posting_config as Record<string, unknown> | undefined}
              xRateLimits={settings?.x_rate_limits as Record<string, unknown> | undefined}
              xApiControls={settings?.x_api_controls as { my_x_enabled?: boolean } | undefined}
            />
          </Suspense>
        </TabsContent>

        {/* Video Rendering Tab */}
        <TabsContent value="video-rendering" className="space-y-6">
          <Suspense fallback={<SettingsPanelFallback />}>
            <VideoRenderingSettings />
          </Suspense>
        </TabsContent>

        {/* Enrichment Tab */}
        <TabsContent value="enrichment" className="space-y-6">
          <Suspense fallback={<SettingsPanelFallback />}>
            <EnrichmentSettings />
          </Suspense>
        </TabsContent>

        {/* Observability Tab */}
        <TabsContent value="observability" className="space-y-6">
          <Suspense fallback={<SettingsPanelFallback />}>
            <ObservabilitySettings />
          </Suspense>
        </TabsContent>
        </fieldset>
      </Tabs>
    </div>
  );
}

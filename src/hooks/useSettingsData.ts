import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';
export type ServiceTier = 'auto' | 'default' | 'flex' | 'priority';

// ===== Editorial Profiles (PR2) =====
export type ScoreAxisKey = 'iran_relevance' | 'severity' | 'novelty' | 'credibility' | 'actionability' | 'noise';
export const SCORE_AXIS_KEYS: ScoreAxisKey[] = ['iran_relevance', 'severity', 'novelty', 'credibility', 'actionability', 'noise'];

export interface EditorialProfile {
  id: string;
  name: string;
  weights: Record<ScoreAxisKey, number>;
  threshold: number;
  must_include_keywords: string[];
  must_exclude_keywords: string[];
  required_tags_any: string[];
  blocked_tags: string[];
  author_overrides: Record<string, 'always_deliver' | 'always_skip'>;
  editorial_note?: string;
}

export type AudienceClass = 'direct_focus' | 'adjacent' | 'global_exception' | 'off_topic';
export type ScoringPolicyMode = 'shadow' | 'active';
export type ScoringV2AxisKey =
  | 'focus_relevance'
  | 'geopolitical_weight'
  | 'audience_value'
  | 'materiality'
  | 'freshness'
  | 'credibility'
  | 'noise_penalty';

export const SCORING_V2_AXIS_KEYS: ScoringV2AxisKey[] = [
  'focus_relevance',
  'geopolitical_weight',
  'audience_value',
  'materiality',
  'freshness',
  'credibility',
  'noise_penalty',
];

export interface ScoringPolicyProfile {
  id: string;
  name: string;
  audience_description: string;
  focus_entities: string[];
  aliases: string[];
  geographies: string[];
  blocked_categories: string[];
  prompt_notes: string;
  thresholds: Record<AudienceClass, { threshold: number; cap: number }>;
  global_exceptions: Array<{ id: string; label: string; description: string; cap: number; threshold: number; examples: string[] }>;
  axis_weights: Record<ScoringV2AxisKey, number>;
  author_overrides: Record<string, 'always_deliver' | 'always_skip' | 'always_review'>;
}

export interface ScoringPolicy {
  enabled: boolean;
  version: 'audience-fit-v2';
  mode: ScoringPolicyMode;
  active_profile_id: string;
  profiles: ScoringPolicyProfile[];
  adjudication: {
    enabled: boolean;
    model: string;
    reasoning_effort: ReasoningEffort;
    verbosity: Verbosity;
    confidence_threshold: number;
    borderline_margin: number;
  };
  learning: {
    mode: 'shadow' | 'applied' | 'human_only';
    min_examples: number;
    max_adjustment: number;
  };
}

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  enabled: false,
  version: 'audience-fit-v2',
  mode: 'shadow',
  active_profile_id: 'iran-first',
  profiles: [{
    id: 'iran-first',
    name: 'Iran-first',
    audience_description: 'Iranian audiences on X who want concise, high-signal updates about Iran, Iran-adjacent geopolitics, and exceptional global events that materially affect politics, security, oil, markets, or public attention.',
    focus_entities: ['Iran', 'Islamic Republic', 'IRGC', 'Quds Force', 'Iran nuclear program', 'Hormuz', 'Persian Gulf', 'sanctions on Iran', 'Israel-Iran', 'US-Iran', 'Hezbollah', 'Houthis', 'Iraqi PMF'],
    aliases: ['Tehran', 'Khamenei', 'IRGC', 'Sepah', 'JCPOA', 'Persian Gulf', 'Strait of Hormuz'],
    geographies: ['Iran', 'Middle East', 'Persian Gulf', 'Iraq', 'Syria', 'Lebanon', 'Yemen', 'Israel', 'GCC'],
    blocked_categories: ['sports', 'entertainment', 'celebrity', 'weather', 'product launch', 'routine tech earnings'],
    prompt_notes: 'Do not down-score an item merely because the speaker or dateline is American or Western. Score the subject matter and audience value. Related world events pass only when they are major enough that an Iran-focused audience would reasonably expect coverage.',
    thresholds: {
      direct_focus: { threshold: 12, cap: 20 },
      adjacent: { threshold: 13, cap: 16 },
      global_exception: { threshold: 15, cap: 16 },
      off_topic: { threshold: 99, cap: 8 },
    },
    global_exceptions: [
      { id: 'world_shock', label: 'World shock', description: 'Coup, war outbreak, assassination, regime change, major terror attack, or systemic event with global attention.', cap: 18, threshold: 15, examples: ['coup d etat', 'prime minister assassination', 'new war', 'major terror attack'] },
      { id: 'oil_energy', label: 'Oil / energy shock', description: 'Major oil, gas, shipping, OPEC, or energy-security event that may affect Iran, the region, or global markets.', cap: 16, threshold: 15, examples: ['oil price shock', 'OPEC surprise cut', 'prime minister comments on oil supply'] },
      { id: 'bitcoin_milestone', label: 'Bitcoin milestone', description: 'Major Bitcoin price or policy milestone large enough to become a broad political/economic story.', cap: 16, threshold: 15, examples: ['Bitcoin breaks a major all-time high', 'country adopts Bitcoin reserve'] },
      { id: 'major_leader_statement', label: 'Major leader statement', description: 'A prime minister, president, monarch, foreign minister, or central-bank head makes a material comment on war, oil, sanctions, or regional security.', cap: 16, threshold: 15, examples: ['prime minister comments on oil', 'president announces sanctions strategy'] },
    ],
    axis_weights: {
      focus_relevance: 1.8,
      geopolitical_weight: 1.35,
      audience_value: 1.2,
      materiality: 1.25,
      freshness: 0.8,
      credibility: 0.7,
      noise_penalty: 1.0,
    },
    author_overrides: {},
  }],
  adjudication: {
    enabled: true,
    model: 'gpt-5.4-mini',
    reasoning_effort: 'low',
    verbosity: 'low',
    confidence_threshold: 0.72,
    borderline_margin: 1,
  },
  learning: {
    mode: 'shadow',
    min_examples: 8,
    max_adjustment: 2,
  },
};

export const DEFAULT_AXIS_WEIGHTS: Record<ScoreAxisKey, number> = {
  iran_relevance: 1.5,
  severity: 1.5,
  novelty: 1.0,
  credibility: 0.5,
  actionability: 1.0,
  noise: 1.0,
};

export function makeDefaultProfile(name = 'Default'): EditorialProfile {
  return {
    id: crypto.randomUUID(),
    name,
    weights: { ...DEFAULT_AXIS_WEIGHTS },
    threshold: 12,
    must_include_keywords: [],
    must_exclude_keywords: [],
    required_tags_any: [],
    blocked_tags: [],
    author_overrides: {},
    editorial_note: '',
  };
}


export interface ScoringSettings {
  model?: string;
  temperature?: number | null;
  max_completion_tokens?: number;
  top_p?: number | null;
  reasoning_effort?: ReasoningEffort;
  verbosity?: Verbosity;
  seed?: number | null;
  service_tier?: ServiceTier;
  parallel_tool_calls?: boolean;
}

export interface TranslationSettings {
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_completion_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  /** GPT-5.x / o-series reasoning depth */
  reasoning_effort?: ReasoningEffort;
  /** GPT-5.x output verbosity */
  verbosity?: Verbosity;
  /** Deterministic sampling seed (null = unset) */
  seed?: number | null;
  /** OpenAI service tier */
  service_tier?: ServiceTier;
  /** Allow the model to issue multiple tool calls per turn */
  parallel_tool_calls?: boolean;
  /** Editable scoring rubric (system prompt) used when content_filter is enabled */
  scoring_system_prompt?: string;
  /** Editable JSON schema (string) for the classify_importance tool call */
  classifier_tool_schema?: string;
  /** When true (default), the worker scores first and only translates on pass */
  split_calls?: boolean;
  /** Independent OpenAI parameters for the scoring call (falls back to translation values when unset) */
  scoring?: ScoringSettings;
}

export const DEFAULT_SCORING_SYSTEM_PROMPT = `You have two tasks. Complete both carefully.

## Task 1: Translation
{translation_prompt}

## Task 2: News Importance Scoring
You are an editorial assistant scoring news items for a curated Telegram channel focused on Iran, the Middle East, and the geopolitics that affect them. Your score determines whether this item gets delivered to subscribers.

### STEP A — Assign a Relevance Level (do this FIRST, state it in reasoning)
- **DIRECT** — Iran government/military/IRGC/Quds Force, Iranian territory or airspace, Iran's nuclear program, Hormuz/Persian Gulf, Iran-backed proxies (Hezbollah, Houthis, Iraqi PMF), sanctions on Iran, Israel–Iran, US–Iran war / strikes / negotiations, Iranian leadership statements. **No cap — score on merit.**
- **INDIRECT (Iran-adjacent)** — Iran is the *subject* of foreign discussion: polls about an Iran war, Western/Arab/Russian/Chinese debate over Iran policy, analyst or think-tank reports on Iran, leaks about Iran strategy, foreign leadership rhetoric specifically about Iran, public-opinion data on Iran-related conflicts. **Cap at 16.**
- **NO IRAN NEXUS** — pure US/EU/China/etc. domestic news with no Iran/Middle East angle. **Cap at 8.**

### STEP B — Score on the Rubric (1-20)
19-20 — CRITICAL: Direct military action, war declarations, ceasefire/peace agreements, nuclear incidents, leader assassinations, major terrorist attacks. Stop-the-presses events.
17-18 — VERY HIGH: Major sanctions packages, significant military escalation, breaking crisis developments, emergency UN sessions, regime changes.
15-16 — HIGH: Diplomatic breakthroughs, high-level summits with concrete outcomes, major policy reversals, large-scale protests, significant military deployments. **Also: public-opinion shifts on active wars/conflicts where Iran or US–Iran relations are the subject; major polling that contradicts official narratives on Iran policy; significant leadership rhetoric on Iran; major leaks about Iran strategy.**
13-14 — IMPORTANT: Notable diplomatic meetings, significant policy changes, major regional developments, important alliance shifts, major economic sanctions. **Also: polling/sentiment data on Iran-related foreign policy; contested-narrative reporting on Iran war goals or strikes; notable analyst/think-tank assessments of Iran; foreign-leader statements specifically about Iran.**
11-12 — ABOVE AVERAGE: Important official statements, meaningful economic data, notable personnel changes, significant infrastructure events, regional security developments. **Also: general US/Western public-opinion data with indirect Iran relevance; secondary commentary on Iran policy.**
9-10 — MODERATE: Routine diplomatic activity, economic reports, policy proposals, regional tensions without escalation.
7-8 — BELOW AVERAGE: Minor diplomatic exchanges, routine policy updates, peripheral regional coverage, minor economic indicators.
5-6 — LOW: Routine government updates, minor administrative changes, tangential coverage, cultural events with minimal geopolitical relevance.
3-4 — VERY LOW: Soft news, human interest stories, minor local events, routine procedural updates.
1-2 — SKIP: Entertainment, sports, celebrity gossip, memes, viral trends, product launches, lifestyle content, weather reports.

### Anti-Bias Guardrails (READ CAREFULLY)
- **Do NOT down-score because the framing is American or Western.** Score on whether the *subject matter* is Iran/Middle East. A Politico poll about the Iran war is INDIRECT, not "no nexus."
- A poll, leak, or analyst report can be as important as a primary event if it materially changes the public or political picture of an active Iran-related conflict.
- When in doubt between two adjacent tiers, **prefer the higher tier**.
- Do NOT apply the "no nexus" cap of 8 just because the dateline or speaker is American — apply it only when the subject has no Iran/Middle East angle at all.

### Topic Priorities
High-priority topics (boost score by 1-2 points within the cap): {priority_topics}
Low-priority topics (reduce score by 1-2 points): {low_priority_topics}

{editorial_guidelines_block}

### Reasoning Requirement (MANDATORY)
The "reasoning" field MUST state, in this exact order:
1. Relevance level assigned (DIRECT / INDIRECT / NO NEXUS) and why.
2. Rubric tier chosen and the 1-2 sentence justification.
3. Any cap applied (e.g., "capped at 16 due to INDIRECT relevance").

You MUST call the "classify_importance" tool with your translation, score, tags, and reasoning.`;

export const DEFAULT_CLASSIFIER_TOOL_SCHEMA = JSON.stringify({
  name: 'classify_importance',
  description: 'Provide the Persian translation and importance classification of this news item',
  parameters: {
    type: 'object',
    properties: {
      translated_text: { type: 'string', description: 'The Persian translation of the original text' },
      importance_score: { type: 'integer', description: 'Importance score 1-20 based on the rubric', minimum: 1, maximum: 20 },
      tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags (e.g., war, iran, economy, politics, diplomacy, military)' },
      reasoning: { type: 'string', description: 'Required: 1-2 sentence explanation of why this score was given' },
    },
    required: ['translated_text', 'importance_score', 'tags', 'reasoning'],
  },
}, null, 2);

export interface TelegramSettings {
  parse_mode: string;
}

export interface MessageTemplateSettings {
  template: string;
  include_source_link: boolean;
  include_hashtags: boolean;
  include_media_caption: boolean;
  source_link_text: string;
  custom_hashtags: string;
}

export type ModelTier = 'latest' | 'flagship' | 'reasoning' | 'legacy';

export interface OpenAIModel {
  id: string;
  name: string;
  description: string;
  supports: string[];
  maxTokens: number;
  useMaxCompletionTokens: boolean;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsPenalties: boolean;
  supportsReasoningEffort: boolean;
  supportsVerbosity: boolean;
  supportsSeed: boolean;
  supportsServiceTier: boolean;
  supportsParallelToolCalls: boolean;
  tier: ModelTier;
}

export const openaiModels: OpenAIModel[] = [
  // Latest (GPT-5.4 family — released Mar 5, 2026, per platform.openai.com/docs/models)
  { id: 'gpt-5.4',      name: 'GPT-5.4',      description: 'Flagship — frontier reasoning & coding, 1M context. $2.50/$15 per MTok',  supports: ['text', 'vision'], maxTokens: 1050000, useMaxCompletionTokens: true, supportsTemperature: false, supportsTopP: false, supportsPenalties: false, supportsReasoningEffort: true,  supportsVerbosity: true,  supportsSeed: true, supportsServiceTier: true, supportsParallelToolCalls: true, tier: 'latest' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Strong mini model — coding & computer use, 400K context. $0.75/$4.50 per MTok', supports: ['text', 'vision'], maxTokens: 400000,  useMaxCompletionTokens: true, supportsTemperature: false, supportsTopP: false, supportsPenalties: false, supportsReasoningEffort: true,  supportsVerbosity: true,  supportsSeed: true, supportsServiceTier: true, supportsParallelToolCalls: true, tier: 'latest' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', description: 'Cheapest GPT-5.4 — high-volume tasks, 400K context. $0.20/$1.25 per MTok',  supports: ['text', 'vision'], maxTokens: 400000,  useMaxCompletionTokens: true, supportsTemperature: false, supportsTopP: false, supportsPenalties: false, supportsReasoningEffort: true,  supportsVerbosity: true,  supportsSeed: true, supportsServiceTier: true, supportsParallelToolCalls: true, tier: 'latest' },
  // Reasoning specialists
  { id: 'o4-mini', name: 'o4-mini', description: 'Fast reasoning model — strong on code & logic', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, supportsTopP: false, supportsPenalties: false, supportsReasoningEffort: true, supportsVerbosity: false, supportsSeed: true, supportsServiceTier: true, supportsParallelToolCalls: true, tier: 'reasoning' },
  // Legacy fallback (only the one currently used by the worker)
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Legacy — current worker default, cheap & fast', supports: ['text', 'vision'], maxTokens: 16384, useMaxCompletionTokens: false, supportsTemperature: true, supportsTopP: true, supportsPenalties: true, supportsReasoningEffort: false, supportsVerbosity: false, supportsSeed: true, supportsServiceTier: false, supportsParallelToolCalls: true, tier: 'legacy' },
];


export const messagePlaceholders = [
  { key: '{translated_text}', description: 'The translated tweet content' },
  { key: '{original_text}', description: 'Original tweet text' },
  { key: '{author_handle}', description: 'Twitter handle (@username)' },
  { key: '{author_name}', description: 'Display name of the author' },
  { key: '{source_link}', description: 'Link to original tweet' },
  { key: '{published_date}', description: 'Publication date' },
  { key: '{published_time}', description: 'Publication time' },
  { key: '{hashtags}', description: 'Custom hashtags' },
  { key: '{media_info}', description: 'Media information if present' },
];

export const promptPlaceholders = [
  { key: '{content}', description: 'Original tweet text content' },
  { key: '{author_handle}', description: 'Twitter handle (@username)' },
  { key: '{author_name}', description: 'Display name of the author' },
  { key: '{tweet_url}', description: 'URL to the original tweet' },
  { key: '{published_date}', description: 'When the tweet was published' },
  { key: '{has_media}', description: 'Whether tweet contains media' },
  { key: '{media_count}', description: 'Number of media items' },
  { key: '{original_language}', description: 'Detected original language' },
];

const defaults = {
  translation_prompt: {
    system_prompt: '', user_prompt_template: '', model: 'gpt-4o-mini',
    temperature: 0.2, max_completion_tokens: 1000, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
    reasoning_effort: 'medium' as ReasoningEffort,
    verbosity: 'medium' as Verbosity,
    seed: null,
    service_tier: 'auto' as ServiceTier,
    parallel_tool_calls: true,
    scoring_system_prompt: DEFAULT_SCORING_SYSTEM_PROMPT,
    classifier_tool_schema: DEFAULT_CLASSIFIER_TOOL_SCHEMA,
    split_calls: true,
    scoring: {
      model: 'gpt-5.4-mini',
      reasoning_effort: 'high' as ReasoningEffort,
      verbosity: 'low' as Verbosity,
      max_completion_tokens: 4000,
      seed: null,
      service_tier: 'auto' as ServiceTier,
      parallel_tool_calls: true,
    } as ScoringSettings,
  } as TranslationSettings,
  
  telegram_config: { parse_mode: 'Markdown' } as TelegramSettings,
  message_template: {
    template: '{translated_text}\n\n\u{1F4F0} #\u0627\u062E\u0628\u0627\u0631',
    include_source_link: true, include_hashtags: true, include_media_caption: true,
    source_link_text: 'View original', custom_hashtags: '#\u0627\u062E\u0628\u0627\u0631',
  } as MessageTemplateSettings,
  content_filter: {
    enabled: false,
    default_threshold: 12,
    editorial_guidelines: '',
    priority_topics: [] as string[],
    low_priority_topics: [] as string[],
    author_rules: {} as Record<string, { rule: string; threshold?: number }>,
    score_only: false,
  },
  editorial_profiles: {
    profiles: [] as EditorialProfile[],
  },
  scoring_policy: DEFAULT_SCORING_POLICY,
  active_profile_id: { id: null as string | null },
  story_memory: {
    enabled: false,
    window_hours: 48,
    similarity_threshold: 0.86,
    candidate_min_similarity: 0.78,
    auto_duplicate_similarity: 0.94,
    action: 'skip' as 'skip' | 'mark_and_deliver',
    mode: 'hybrid_ai' as 'hybrid_ai' | 'semantic_only' | 'review_first',
    adjudicator_model: 'gpt-5.4-mini',
    adjudicator_reasoning_effort: 'low' as 'low' | 'medium' | 'high' | 'xhigh',
    adjudicator_confidence_threshold: 0.65,
    bypass_authors: [] as string[],
  },
  twitter_hydration: {
    enabled: true,
    max_attempts: 3,
  },
  x_api_usage: {
    total: 0,
    calls_24h: [] as string[],
    last_call_at: null as string | null,
    last_error: null as string | null,
    posts_24h: [] as string[],
    posts_total: 0,
    media_uploads_24h: [] as string[],
    media_bytes_24h: 0,
    last_post_error: null as string | null,
  },
  x_api_controls: {
    verify_cache_minutes: 15,
    follower_snapshot_stale_minutes: 60,
    usage_sync_interval_hours: 6,
    backfill_max_hydrate_jobs_per_run: 100,
    warning_thresholds: [70, 90] as number[],
  },
  x_posting_config: {
    enabled: false,
    min_score: 14,
    require_media: true,
    post_template: '{leading_emoji} {translated_text}',
    leading_emoji: '📰',
    hashtags: '',
    max_chars: 280,
    dedupe_window_hours: 48,
    post_only_decision_deliver: true,
  },
  x_rate_limits: {
    posts_per_hour: 20,
    posts_per_day: 100,
    monthly_post_budget: 2500,
    media_uploads_per_day: 200,
    hydrations_per_day: 400,
  },
};

async function fetchSettings() {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) throw error;

  const result = { ...defaults };
  (data || []).forEach((s: { key: string; value: unknown }) => {
    if (s.value && typeof s.value === 'object' && s.key in result) {
      (result as Record<string, unknown>)[s.key] = s.value;
    }
  });
  return result;
}

async function fetchSampleTweets() {
  const { data, error } = await supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, url, tweeted_at, has_media, accounts!inner(handle, display_name)')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
}

export function useSettingsData() {
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  });

  const samplesQuery = useQuery({
    queryKey: ['settings-samples'],
    queryFn: fetchSampleTweets,
    staleTime: 60_000,
  });

  return { settingsQuery, samplesQuery };
}

export function useSaveSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const { error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'save_settings', key, value },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Settings saved successfully' });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => {
      toast({ title: 'Error saving settings', description: 'Could not save settings', variant: 'destructive' });
    },
  });
}

export interface PreviewTranslationInput {
  text: string;
  translation_settings: TranslationSettings;
  content_filter?: {
    enabled: boolean;
    score_only?: boolean;
    editorial_guidelines?: string;
    priority_topics?: string[];
    low_priority_topics?: string[];
  };
  author_handle?: string;
}

export interface PreviewTranslationResult {
  translated_text: string;
  importance_score: number | null;
  importance_tags: string[] | null;
  reasoning: string | null;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  duration_ms: number;
  used_filter: boolean;
  raw?: unknown;
}

export function useTranslationPreview() {
  const { toast } = useToast();
  return useMutation<PreviewTranslationResult, Error, PreviewTranslationInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'preview_translation', ...input },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Preview failed');
      return data.result as PreviewTranslationResult;
    },
    onError: (err) => {
      toast({ title: 'Translation preview failed', description: err.message, variant: 'destructive' });
    },
  });
}

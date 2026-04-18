import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TranslationSettings {
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_completion_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  /** Editable scoring rubric (system prompt) used when content_filter is enabled */
  scoring_system_prompt?: string;
  /** Editable JSON schema (string) for the classify_importance tool call */
  classifier_tool_schema?: string;
}

export const DEFAULT_SCORING_SYSTEM_PROMPT = `You have two tasks. Complete both carefully.

## Task 1: Translation
{translation_prompt}

## Task 2: News Importance Scoring
You are an editorial assistant scoring news items for a curated Telegram channel. Your score determines whether this item gets delivered to subscribers.

### Scoring Rubric (1-20 scale)
19-20 — CRITICAL: Direct military action, war declarations, ceasefire/peace agreements, nuclear incidents, leader assassinations, major terrorist attacks. Stop-the-presses, history-making events.
17-18 — VERY HIGH: Major sanctions packages, significant military escalation, breaking crisis developments, emergency UN sessions, regime changes.
15-16 — HIGH: Diplomatic breakthroughs, high-level summits with concrete outcomes, major policy reversals, large-scale protest movements, significant military deployments.
13-14 — IMPORTANT: Notable diplomatic meetings, significant policy changes, major regional developments, important alliance shifts, major economic sanctions.
11-12 — ABOVE AVERAGE: Important official statements, meaningful economic data, notable personnel changes, significant infrastructure events, regional security developments.
9-10 — MODERATE: Noteworthy but routine diplomatic activity, economic reports, policy proposals, regional tensions without escalation.
7-8 — BELOW AVERAGE: Minor diplomatic exchanges, routine policy updates, peripheral regional coverage, minor economic indicators.
5-6 — LOW: Routine government updates, minor administrative changes, tangential coverage, cultural events with minimal geopolitical relevance.
3-4 — VERY LOW: Soft news, human interest stories, minor local events, routine procedural updates.
1-2 — SKIP: Entertainment, sports, celebrity gossip, memes, viral trends, product launches, lifestyle content, weather reports.

### CRITICAL — Iran/Middle East Relevance Gate
If the content has NO direct connection to Iran, the Middle East region, or entities that directly affect Iran (e.g., sanctions, nuclear negotiations, proxy conflicts), cap the score at 8 MAXIMUM — regardless of how globally significant the event is. Only content with a clear Iran/Middle East nexus should score above 8.

### Topic Priorities
High-priority topics (boost score by 1-2 points): {priority_topics}
Low-priority topics (reduce score by 1-2 points): {low_priority_topics}

{editorial_guidelines_block}

You MUST call the "classify_importance" tool with your translation and score. The "reasoning" field is required — explain your score in 1-2 sentences.`;

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

export interface OpenAISettings {
  model: string;
  temperature: number;
  max_completion_tokens: number;
}

export interface TelegramSettings {
  parse_mode: string;
}

export interface DigestSettings {
  frequency_minutes: number;
  max_bullets: number;
  min_posts: number;
  header_format: string;
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
  tier: ModelTier;
}

export const openaiModels: OpenAIModel[] = [
  // Latest (2026)
  { id: 'gpt-5.1', name: 'GPT-5.1', description: 'Newest flagship — best reasoning, vision, 400K context', supports: ['text', 'vision'], maxTokens: 400000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'latest' },
  { id: 'gpt-5.1-mini', name: 'GPT-5.1 Mini', description: 'Fast, cost-efficient version of GPT-5.1', supports: ['text', 'vision'], maxTokens: 400000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'latest' },
  // Flagship (current production)
  { id: 'gpt-5-2025-08-07', name: 'GPT-5', description: 'Highly capable, proven in production', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'flagship' },
  { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini', description: 'Fast and efficient version of GPT-5', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'flagship' },
  { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano', description: 'Fastest, cheapest GPT-5 variant', supports: ['text'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'flagship' },
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', description: 'Stable GPT-4 flagship', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'flagship' },
  { id: 'gpt-4.1-mini-2025-04-14', name: 'GPT-4.1 Mini', description: 'Efficient GPT-4 model', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'flagship' },
  // Reasoning
  { id: 'o3-2025-04-16', name: 'o3', description: 'Deep reasoning model — slow, high quality', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'reasoning' },
  { id: 'o4-mini-2025-04-16', name: 'o4-mini', description: 'Fast reasoning model', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false, tier: 'reasoning' },
  // Legacy
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Legacy — current default in worker, cheap & fast', supports: ['text', 'vision'], maxTokens: 16384, useMaxCompletionTokens: false, supportsTemperature: true, tier: 'legacy' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Legacy multimodal model', supports: ['text', 'vision'], maxTokens: 4096, useMaxCompletionTokens: false, supportsTemperature: true, tier: 'legacy' },
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
  } as TranslationSettings,
  openai_config: { model: 'gpt-4o-mini', temperature: 0.2, max_completion_tokens: 1000 } as OpenAISettings,
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
  digest_config: {
    frequency_minutes: 30,
    max_bullets: 10,
    min_posts: 2,
    header_format: '📰 News Digest — {time}',
  } as DigestSettings,
  twitter_hydration: {
    enabled: true,
    max_attempts: 3,
  },
  x_api_usage: {
    total: 0,
    calls_24h: [] as string[],
    last_call_at: null as string | null,
    last_error: null as string | null,
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

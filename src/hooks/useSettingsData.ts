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
}

export interface OpenAISettings {
  model: string;
  temperature: number;
  max_completion_tokens: number;
}

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

export interface OpenAIModel {
  id: string;
  name: string;
  description: string;
  supports: string[];
  maxTokens: number;
  useMaxCompletionTokens: boolean;
  supportsTemperature: boolean;
}

export const openaiModels: OpenAIModel[] = [
  { id: 'gpt-5-2025-08-07', name: 'GPT-5', description: 'Most capable model', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini', description: 'Fast and efficient version of GPT-5', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano', description: 'Fastest, cheapest version', supports: ['text'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', description: 'Flagship GPT-4 model', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4.1-mini-2025-04-14', name: 'GPT-4.1 Mini', description: 'Efficient GPT-4 model', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'o3-2025-04-16', name: 'O3', description: 'Powerful reasoning model', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'o4-mini-2025-04-16', name: 'O4 Mini', description: 'Fast reasoning model', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Legacy)', description: 'Fast and cheap legacy model', supports: ['text', 'vision'], maxTokens: 16384, useMaxCompletionTokens: false, supportsTemperature: true },
  { id: 'gpt-4o', name: 'GPT-4o (Legacy)', description: 'Powerful legacy model', supports: ['text', 'vision'], maxTokens: 4096, useMaxCompletionTokens: false, supportsTemperature: true },
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

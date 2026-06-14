import type { ChatMessage } from "../_shared/openai.ts";

export type TranslationUserPromptInput = {
  template?: string | null;
  content: string;
  authorDisplay: string;
  accountName?: string | null;
  publishedAt: string;
};

export type TranslationCallConfig = {
  translationPrompt: string;
  openaiModel: string;
  openaiMaxCompletionTokens?: number | null;
  openaiTemperature?: number | null;
  openaiTopP?: number | null;
  openaiFrequencyPenalty?: number | null;
  openaiPresencePenalty?: number | null;
  openaiReasoningEffort?: string | null;
  openaiVerbosity?: string | null;
  openaiSeed?: number | null;
  openaiServiceTier?: string | null;
  openaiParallelToolCalls?: boolean | null;
};

export type TranslationCallOptions = {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  seed?: number | null;
  serviceTier?: string | null;
  parallelToolCalls?: boolean | null;
};

export function renderTranslationUserPrompt(
  input: TranslationUserPromptInput,
): string {
  const template = input.template;
  if (template && template.trim()) {
    return template
      .replace(/\{content\}/g, input.content)
      .replace(/\{author\}/g, `@${input.authorDisplay}`)
      .replace(/\{author_handle\}/g, `@${input.authorDisplay}`)
      .replace(/\{author_name\}/g, input.accountName ?? "")
      .replace(/\{published_at\}/g, input.publishedAt)
      .replace(/\{published_date\}/g, input.publishedAt);
  }

  return input.content;
}

export function buildTranslationCallOptions(
  config: TranslationCallConfig,
  userPrompt: string,
): TranslationCallOptions {
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: config.translationPrompt },
      { role: "user", content: userPrompt },
    ],
    maxOutputTokens: config.openaiMaxCompletionTokens,
    temperature: config.openaiTemperature,
    topP: config.openaiTopP,
    frequencyPenalty: config.openaiFrequencyPenalty,
    presencePenalty: config.openaiPresencePenalty,
    reasoningEffort: config.openaiReasoningEffort,
    verbosity: config.openaiVerbosity,
    seed: config.openaiSeed,
    serviceTier: config.openaiServiceTier,
    parallelToolCalls: config.openaiParallelToolCalls,
  };
}

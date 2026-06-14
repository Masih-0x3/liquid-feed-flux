export type TranslationUserPromptInput = {
  template?: string | null;
  content: string;
  authorDisplay: string;
  accountName?: string | null;
  publishedAt: string;
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

export const OPENAI_MAX_COMPLETION_TOKENS_LIMIT = 8_000;

export function clampOpenAiMaxCompletionTokens(
  value: number,
  fallback: number | null,
  max = OPENAI_MAX_COMPLETION_TOKENS_LIMIT,
): number {
  if (!Number.isFinite(value)) {
    return Math.max(1, Math.min(max, fallback ?? max));
  }
  return Math.max(1, Math.min(max, Math.round(value)));
}

export function validateOpenAiMaxCompletionTokens(
  field: string,
  value: unknown,
  max = OPENAI_MAX_COMPLETION_TOKENS_LIMIT,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${field} must be a number`;
  }
  if (value < 1 || value > max) {
    return `${field} must be 1-${max}`;
  }
  return null;
}

import type {
  ChatMessage,
  NormalizedOpenAIResponse,
  OpenAICallParams,
} from "./openai.ts";

export const TRANSLATION_READABILITY_TARGET_CHARS = 450;
export const TRANSLATION_READABILITY_MAX_CHARS = 650;
export const TRANSLATION_READABILITY_MAX_PARAGRAPHS = 2;

export const TRANSLATION_READABILITY_PROMPT_BLOCK = `X feed readability rules:
- Write native Persian for an Iranian audience. The output should read right-to-left naturally.
- Target 280-450 Persian characters. Hard cap 650 characters unless the source is a rare major breaking-news update where detail is essential.
- If the source is too long, do not translate sentence-by-sentence. Digest it into one concise news headline/brief with the key facts.
- Use one short paragraph by default. Use two short paragraphs only when it materially improves clarity.
- End every sentence with proper Persian punctuation. Do not leave sentence fragments dangling.
- Do not start the post with Latin text, an English outlet name, or an acronym.
- Persianize/transliterate common names, outlets, programs, and institutions where readable. Avoid raw multi-word English spans like "The Michael Knowles Show".
- Preserve URLs, @mentions, and hashtags only when they are essential to the post.`;

export type TranslationReadabilityIssueCode =
  | "empty"
  | "too_long"
  | "starts_latin"
  | "too_many_paragraphs"
  | "raw_english_span"
  | "missing_final_punctuation"
  | "excessive_latin_density"
  | "not_persian";

export type TranslationReadabilityIssue = {
  code: TranslationReadabilityIssueCode;
  message: string;
};

export type TranslationReadabilityMetrics = {
  chars: number;
  paragraphs: number;
  latinTokens: number;
  totalTokens: number;
  rawEnglishSpans: number;
  persianChars: number;
};

export type TranslationReadabilityAnalysis = {
  ok: boolean;
  issues: TranslationReadabilityIssue[];
  metrics: TranslationReadabilityMetrics;
};

export type TranslationReadabilityRepairResult = {
  text: string;
  repaired: boolean;
  acceptedRepair: boolean;
  initial: TranslationReadabilityAnalysis;
  final: TranslationReadabilityAnalysis;
  repairStatus: "not_needed" | "accepted" | "rejected" | "failed";
  repairError?: string;
  repairUsage?: Record<string, number> | null;
  repairEndpoint?: NormalizedOpenAIResponse["endpoint"];
};

type ReadabilityOptions = {
  maxChars?: number;
  targetChars?: number;
  maxParagraphs?: number;
};

type RepairOptions = ReadabilityOptions & {
  apiKey: string;
  model: string;
  originalText: string;
  translatedText: string;
  callOpenAI: (
    params: OpenAICallParams,
  ) => Promise<NormalizedOpenAIResponse>;
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

const BIDI_CONTROL_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const HANDLE_RE = /(^|\s)@\w+/g;
const HASHTAG_RE = /(^|\s)#\w+/g;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9&.'-]*/g;
const PERSIAN_CHAR_RE = /[\u0600-\u06ff]/g;
const FIRST_STRONG_RE = /[A-Za-z\u0600-\u06ff]/;
const RAW_ENGLISH_SPAN_RE =
  /\b[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)+\b/g;
const FINAL_PUNCTUATION_RE = /[.!?؟…»”)\]]$/;

export function normalizeTranslationReadabilityText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function analyzeTranslationReadability(
  text: string,
  options: ReadabilityOptions = {},
): TranslationReadabilityAnalysis {
  const maxChars = options.maxChars ?? TRANSLATION_READABILITY_MAX_CHARS;
  const maxParagraphs = options.maxParagraphs ??
    TRANSLATION_READABILITY_MAX_PARAGRAPHS;
  const normalized = normalizeTranslationReadabilityText(text);
  const scrubbed = normalized
    .replace(URL_RE, " ")
    .replace(HANDLE_RE, " ")
    .replace(HASHTAG_RE, " ");
  const latinTokens = scrubbed.match(LATIN_TOKEN_RE) ?? [];
  const totalTokens = scrubbed.split(/\s+/).filter(Boolean).length;
  const rawEnglishSpans = scrubbed.match(RAW_ENGLISH_SPAN_RE) ?? [];
  const persianChars = normalized.match(PERSIAN_CHAR_RE)?.length ?? 0;
  const paragraphs = normalized
    ? normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
      .length
    : 0;
  const firstStrong = normalized.replace(BIDI_CONTROL_RE, "").match(
    FIRST_STRONG_RE,
  )?.[0] ?? "";

  const issues: TranslationReadabilityIssue[] = [];
  if (!normalized) {
    issues.push({ code: "empty", message: "translation is empty" });
  }
  if (normalized.length > maxChars) {
    issues.push({
      code: "too_long",
      message: `translation is ${normalized.length} chars; max is ${maxChars}`,
    });
  }
  if (/^[A-Za-z]$/.test(firstStrong)) {
    issues.push({
      code: "starts_latin",
      message: "first strong character is Latin",
    });
  }
  if (paragraphs > maxParagraphs) {
    issues.push({
      code: "too_many_paragraphs",
      message:
        `translation has ${paragraphs} paragraphs; max is ${maxParagraphs}`,
    });
  }
  if (rawEnglishSpans.length > 0) {
    issues.push({
      code: "raw_english_span",
      message: "translation contains raw multi-word English spans",
    });
  }
  if (normalized && !FINAL_PUNCTUATION_RE.test(normalized)) {
    issues.push({
      code: "missing_final_punctuation",
      message: "translation does not end with sentence punctuation",
    });
  }
  const latinShare = totalTokens > 0 ? latinTokens.length / totalTokens : 0;
  if (
    latinTokens.length >= 8 || (latinTokens.length >= 4 && latinShare > 0.2)
  ) {
    issues.push({
      code: "excessive_latin_density",
      message: "translation contains too many Latin tokens",
    });
  }
  if (normalized && persianChars === 0) {
    issues.push({
      code: "not_persian",
      message: "translation has no Persian characters",
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      chars: normalized.length,
      paragraphs,
      latinTokens: latinTokens.length,
      totalTokens,
      rawEnglishSpans: rawEnglishSpans.length,
      persianChars,
    },
  };
}

export function buildTranslationReadabilityRepairMessages(input: {
  originalText: string;
  translatedText: string;
  analysis: TranslationReadabilityAnalysis;
  targetChars?: number;
  maxChars?: number;
}): ChatMessage[] {
  const targetChars = input.targetChars ?? TRANSLATION_READABILITY_TARGET_CHARS;
  const maxChars = input.maxChars ?? TRANSLATION_READABILITY_MAX_CHARS;
  const issues = input.analysis.issues.map((issue) => issue.code).join(", ");
  return [
    {
      role: "system",
      content:
        `You are a senior Persian editor for an X news feed. Rewrite drafts into concise, natural Persian. Return only the final Persian post text, with no notes or labels.`,
    },
    {
      role: "user",
      content:
        `Repair this Persian X post draft.\n\nRules:\n${TRANSLATION_READABILITY_PROMPT_BLOCK}\n- Target ${targetChars} characters or less when possible.\n- Never exceed ${maxChars} characters.\n- If the source is long, summarize/digest it instead of translating every sentence.\n- Use Persian punctuation and avoid raw English multi-word spans.\n\nIssues detected: ${
          issues || "none"
        }\n\nOriginal English source:\n${input.originalText}\n\nCurrent Persian draft:\n${input.translatedText}`,
    },
  ];
}

export async function repairTranslationReadability(
  options: RepairOptions,
): Promise<TranslationReadabilityRepairResult> {
  const maxChars = options.maxChars ?? TRANSLATION_READABILITY_MAX_CHARS;
  const targetChars = options.targetChars ??
    TRANSLATION_READABILITY_TARGET_CHARS;
  const original = normalizeTranslationReadabilityText(
    options.translatedText,
  );
  const initial = analyzeTranslationReadability(original, {
    maxChars,
    targetChars,
    maxParagraphs: options.maxParagraphs,
  });
  if (initial.ok) {
    return {
      text: original,
      repaired: false,
      acceptedRepair: false,
      initial,
      final: initial,
      repairStatus: "not_needed",
    };
  }

  try {
    const maxOutputTokens = Math.min(
      4000,
      Math.max(1200, Number(options.maxOutputTokens ?? 2000)),
    );
    const result = await options.callOpenAI({
      apiKey: options.apiKey,
      model: options.model,
      messages: buildTranslationReadabilityRepairMessages({
        originalText: options.originalText,
        translatedText: original,
        analysis: initial,
        targetChars,
        maxChars,
      }),
      maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      reasoningEffort: options.reasoningEffort,
      verbosity: options.verbosity,
      seed: options.seed,
      serviceTier: options.serviceTier,
      parallelToolCalls: options.parallelToolCalls,
    });
    if (!result.ok) {
      return {
        text: original,
        repaired: false,
        acceptedRepair: false,
        initial,
        final: initial,
        repairStatus: "failed",
        repairError: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}`,
        repairUsage: result.usage,
        repairEndpoint: result.endpoint,
      };
    }

    const candidate = normalizeTranslationReadabilityText(result.content);
    if (!candidate) {
      return {
        text: original,
        repaired: false,
        acceptedRepair: false,
        initial,
        final: initial,
        repairStatus: "failed",
        repairError: "empty_readability_repair",
        repairUsage: result.usage,
        repairEndpoint: result.endpoint,
      };
    }

    const final = analyzeTranslationReadability(candidate, {
      maxChars,
      targetChars,
      maxParagraphs: options.maxParagraphs,
    });
    const improves = final.issues.length < initial.issues.length &&
      final.metrics.chars <= maxChars;
    const accepted = final.ok || improves;
    return {
      text: accepted ? candidate : original,
      repaired: true,
      acceptedRepair: accepted,
      initial,
      final: accepted ? final : initial,
      repairStatus: accepted ? "accepted" : "rejected",
      repairUsage: result.usage,
      repairEndpoint: result.endpoint,
    };
  } catch (error) {
    return {
      text: original,
      repaired: false,
      acceptedRepair: false,
      initial,
      final: initial,
      repairStatus: "failed",
      repairError: (error as Error).message,
    };
  }
}

export function translationReadabilityMeta(
  result: TranslationReadabilityRepairResult,
): Record<string, unknown> {
  return {
    repaired: result.repaired,
    accepted_repair: result.acceptedRepair,
    repair_status: result.repairStatus,
    initial_issue_codes: result.initial.issues.map((issue) => issue.code),
    final_issue_codes: result.final.issues.map((issue) => issue.code),
    initial_metrics: result.initial.metrics,
    final_metrics: result.final.metrics,
    repair_error: result.repairError ?? null,
    repair_endpoint: result.repairEndpoint ?? null,
    repair_usage: result.repairUsage ?? null,
  };
}

import { transcribeWithDeepgram } from "./deepgram.js";
import { transcribeAudio as transcribeWithOpenAI } from "./openai.js";
import { hasUsableSubtitleText } from "./subtitles.js";

function normalizeProvider(value, fallback = "deepgram") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["deepgram", "openai"].includes(raw)) return raw;
  return fallback;
}

function isNoTimedSegmentsError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /returned no timed segments/i.test(message);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countWords(text) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function rawWordConfidences(raw) {
  const words = raw?.results?.channels?.[0]?.alternatives?.[0]?.words;
  if (!Array.isArray(words)) return [];
  return words
    .map((word) => Number(word?.confidence))
    .filter(Number.isFinite);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasHebrewFallback(options = {}) {
  const configuredLanguage = String(options.deepgramLanguage ?? options.language ?? "").trim().toLowerCase();
  if (configuredLanguage && !configuredLanguage.startsWith("he")) return false;
  if (configuredLanguage.startsWith("he")) return true;
  const fallbacks = Array.isArray(options.deepgramLanguageFallbacks ?? options.languageFallbacks)
    ? options.deepgramLanguageFallbacks ?? options.languageFallbacks
    : String(options.deepgramLanguageFallbacks ?? options.languageFallbacks ?? "").split(",");
  return fallbacks.some((language) => String(language ?? "").trim().toLowerCase().startsWith("he"));
}

function transcriptText(transcription) {
  return (Array.isArray(transcription?.segments) ? transcription.segments : [])
    .map((segment) => segment?.text ?? "")
    .join(" ");
}

function segmentSpeechSeconds(segments) {
  return segments.reduce((sum, segment) => {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? sum + (end - start) : sum;
  }, 0);
}

function isDeepgramNoTimedSegmentsReason(reason) {
  return /deepgram transcription returned no timed segments|returned no timed segments/i.test(String(reason ?? ""));
}

export function isLikelyNonSpeechDescription(transcription) {
  const text = cleanText(transcriptText(transcription)).toLowerCase();
  if (!text) return false;
  return [
    /\b(?:multiple|several|many|crowd|people|players|protesters|demonstrators|speakers?|voices?)\b.{0,80}\b(?:chanting|cheering|shouting|yelling|screaming)\b/,
    /\b(?:chanting|cheering|shouting|yelling|screaming)\b.{0,80}\b(?:same word|slogan|in unison)\b/,
    /\b(?:music|sirens?|noise|explosion|gunfire|applause|laughter)\b.{0,40}\b(?:playing|continues|sounding|heard)\b/,
    /\b(?:no speech|inaudible|unintelligible)\b/,
  ].some((pattern) => pattern.test(text));
}

export function isLikelyGenericOutroTranscript(transcription) {
  const text = cleanText(transcriptText(transcription))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return [
    /^(?:thank you|thanks) for (?:watching|viewing)(?: this video)?$/,
    /^(?:please )?(?:like and )?subscribe(?: to (?:the|our) channel)?$/,
    /^(?:don'?t forget to )?(?:like|subscribe|share)(?: and (?:subscribe|share|like))*$/,
    /^see you (?:next time|in the next video)$/,
  ].some((pattern) => pattern.test(text));
}

function wordTokens(value) {
  return cleanText(value)
    .toLowerCase()
    .match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];
}

export function isLikelyContextMismatchedRepetitiveTranscript(transcription, contextText = "") {
  const tokens = wordTokens(transcriptText(transcription));
  if (tokens.length < 6) return false;

  const uniqueTokens = new Set(tokens);
  if (uniqueTokens.size / tokens.length > 0.55) return false;

  const stopwords = new Set([
    "a", "an", "and", "are", "as", "at", "de", "el", "for", "in", "is", "la", "le", "of", "on", "or", "the", "to",
  ]);
  const meaningful = [...uniqueTokens].filter((token) => token.length >= 4 && !stopwords.has(token));
  if (meaningful.length === 0) return false;

  const context = cleanText(contextText).toLowerCase();
  return !meaningful.some((token) => context.includes(token));
}

export function isSparseContextMismatchedTranscript(transcription, options = {}) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (segments.length === 0 || segments.length > 2) return false;
  const text = transcriptText(transcription);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latinLetters = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)?.length ?? 0;
  if (letters === 0 || latinLetters / letters < 0.6) return false;
  const durationSeconds = Number(options.durationMs) > 0 ? Number(options.durationMs) / 1000 : null;
  if (durationSeconds === null || durationSeconds < 8) return false;

  const speechSeconds = segmentSpeechSeconds(segments);
  const speechCoverage = speechSeconds / durationSeconds;
  const tokens = wordTokens(text);
  if (speechSeconds <= 0 || speechSeconds > 5 || speechCoverage > 0.35 || tokens.length > 14) return false;

  const stopwords = new Set(["a", "an", "and", "are", "as", "at", "de", "do", "e", "el", "for", "in", "is", "la", "le", "o", "of", "on", "or", "os", "the", "to"]);
  const meaningful = [...new Set(tokens)].filter((token) => token.length >= 4 && !stopwords.has(token));
  if (meaningful.length === 0) return false;

  const context = cleanText(options.contextText).toLowerCase();
  return !meaningful.some((token) => context.includes(token));
}

function contextSuggestsHebrewSpeech(contextText) {
  return /\b(?:hebrew|israeli|israel\s+katz|netanyahu|knesset|idf|likud|mossad|shin\s+bet)\b/i.test(String(contextText ?? ""));
}

function romanizedHebrewMarkerScore(text) {
  const value = ` ${String(text ?? "").toLowerCase()} `;
  const markers = [
    /\banach(?:nu|no|lo)\b/,
    /\b(?:locha?me(?:nu|inu|im)|lochamim|lohamim)\b/,
    /\bneged\b/,
    /\b(?:mechab|mehab|machab)\w*/,
    /\bhizb(?:al|ul)l?a?h?\b/,
    /\b(?:ha[-\s]?)?mishtara\b/,
    /\birani\b/,
    /\blevanon\b/,
    /\bmedinat\b/,
    /\byisra?el\b/,
    /\b(?:tizkor|tizkov|tizpog)\b/,
    /\blitkov\b/,
    /\bbeiran\b/,
    /\bbegav(?:a|e)r\b/,
    /\bmachase\b/,
    /\btamid\b/,
    /\bdarom\b/,
    /\bsafon\b/,
    /\bmamash\b/,
    /\bbislihut\b/,
  ];
  return markers.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0);
}

function normalizedToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function isLikelyRepeatedFillerTranscript(transcription) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  const tokens = segments
    .flatMap((segment) => String(segment?.text ?? "").split(/\s+/))
    .map(normalizedToken)
    .filter((token) => token && !["و", "and"].includes(token));
  if (tokens.length < 4) return false;

  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const dominant = [...counts.entries()].find(([, count]) => count === maxCount)?.[0] ?? "";
  const fillerTokens = new Set(["هی", "هه", "ها", "heh", "hehe", "haha", "ha", "huh"]);
  return maxCount >= 4 && maxCount / tokens.length >= 0.75 && fillerTokens.has(dominant);
}

export function isLikelyRomanizedHebrewTranscript(transcription, options = {}) {
  if (!hasHebrewFallback(options)) return false;
  const language = String(transcription?.language ?? "").toLowerCase();
  if (!["", "und", "multi", "en"].includes(language)) return false;
  const text = transcriptText(transcription);
  if (!/[A-Za-z]/.test(text) || /[\u0590-\u05FF]/.test(text)) return false;
  const score = romanizedHebrewMarkerScore(text);
  return score >= 4 || (score >= 2 && contextSuggestsHebrewSpeech(options.contextText));
}

export function isWeakSpeechDetection(transcription, options = {}) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (segments.length === 0) return false;

  const durationSeconds = Number(options.durationMs) > 0 ? Number(options.durationMs) / 1000 : null;
  const speechSeconds = segmentSpeechSeconds(segments);
  const speechCoverage = durationSeconds ? speechSeconds / durationSeconds : null;
  const text = segments.map((segment) => segment?.text ?? "").join(" ");
  const words = countWords(text);
  const language = String(transcription?.language ?? "").toLowerCase();
  const confidence = Number(transcription?.confidence);
  const languageConfidence = Number(transcription?.languageConfidence);
  const avgWordConfidence = average(rawWordConfidences(transcription?.raw));

  const shortSparseCue = speechSeconds > 0 && speechSeconds <= 2.5 && words > 0 && words <= 6;
  const sparseInClip = speechCoverage === null || speechCoverage <= 0.25;
  const uncertainLanguage = ["", "und", "multi"].includes(language) || (Number.isFinite(languageConfidence) && languageConfidence <= 0.15);
  const weakTranscriptConfidence = Number.isFinite(confidence) && confidence > 0 && confidence < 0.62;
  const weakWords = avgWordConfidence === null || avgWordConfidence < 0.55;
  const sparseLowInformation = durationSeconds !== null &&
    durationSeconds >= 8 &&
    segments.length <= 3 &&
    words > 0 &&
    words <= 3 &&
    speechCoverage !== null &&
    speechCoverage <= 0.12 &&
    (uncertainLanguage || (Number.isFinite(languageConfidence) && languageConfidence < 0.65)) &&
    (avgWordConfidence === null || avgWordConfidence < 0.9 || (Number.isFinite(confidence) && confidence < 0.9));

  return Boolean(
    (shortSparseCue && sparseInClip && uncertainLanguage && weakTranscriptConfidence && weakWords) ||
    sparseLowInformation
  );
}

function asNoUsableSpeech(result, reason) {
  return {
    ...result,
    segments: [],
    rejectedSegments: result?.segments ?? [],
    noUsableSpeech: true,
    noUsableSpeechReason: reason,
  };
}

export function shouldRetryWithEnhancedAudio(transcription, options = {}) {
  if (options.enabled === false) return false;
  if (!transcription || String(transcription.provider ?? "").toLowerCase() !== "deepgram") return false;
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  if (segments.length > 0 && transcription.onlyWeakCandidates !== true) return false;
  const reason = String(transcription.noUsableSpeechReason ?? transcription.fallbackReason ?? "");
  return transcription.noUsableSpeech === true ||
    transcription.onlyWeakCandidates === true ||
    /returned no timed segments|weak low-confidence speech detection/i.test(reason);
}

export function markEnhancedAudioRetry(transcription, retryReason) {
  return {
    ...transcription,
    enhancedAudioRetry: true,
    enhancedAudioRetryReason: retryReason,
  };
}

async function runOpenAITranscription({
  openaiTranscribe = transcribeWithOpenAI,
  openaiApiKey,
  audioPath,
  openaiModel,
  openaiFallbackModel,
  durationMs,
}) {
  const result = await openaiTranscribe({
    apiKey: openaiApiKey,
    audioPath,
    model: openaiModel,
    fallbackModel: openaiFallbackModel,
    durationMs,
  });
  return {
    provider: "openai",
    ...result,
  };
}

async function runDeepgramTranscription({
  deepgramApiKey,
  audioPath,
  deepgramModel,
  deepgramLanguage,
  deepgramLanguageFallbacks,
  deepgramDetectLanguage,
  contextText,
  durationMs,
  acceptResult,
  fetchImpl,
  readFileImpl,
}) {
  return await transcribeWithDeepgram({
    apiKey: deepgramApiKey,
    audioPath,
    model: deepgramModel,
    language: deepgramLanguage,
    languageFallbacks: deepgramLanguageFallbacks,
    detectLanguage: deepgramDetectLanguage,
    contextText,
    durationMs,
    acceptResult,
    fetchImpl,
    readFileImpl,
  });
}

function weakDeepgramReason(transcription, options = {}) {
  if (!transcription || String(transcription.provider ?? "").toLowerCase() !== "deepgram") return "";
  if (transcription.noUsableSpeech === true) return transcription.noUsableSpeechReason || "no usable speech";
  if (isWeakSpeechDetection(transcription, { durationMs: options.durationMs })) return "weak low-confidence speech detection";
  if (isLikelyRepeatedFillerTranscript(transcription)) return "repeated filler transcript";
  if (isLikelyNonSpeechDescription(transcription)) return "non-speech descriptive transcript";
  if (isLikelyContextMismatchedRepetitiveTranscript(transcription, options.contextText)) return "repetitive transcript does not match context";
  if (transcription.onlyWeakCandidates === true) return transcription.fallbackReason || "only weak Deepgram candidates";
  return "";
}

async function maybeRunOpenAIFallback(options, reason) {
  const fallbackProvider = normalizeProvider(options.fallbackProvider, "");
  if (fallbackProvider !== "openai") return null;
  if (isDeepgramNoTimedSegmentsReason(reason)) return null;
  const fallback = await runOpenAITranscription(options);
  const rejected = !hasUsableSubtitleText(fallback.segments) ||
    isLikelyNonSpeechDescription(fallback) ||
    isLikelyGenericOutroTranscript(fallback) ||
    isLikelyContextMismatchedRepetitiveTranscript(fallback, options.contextText) ||
    isSparseContextMismatchedTranscript(fallback, { contextText: options.contextText, durationMs: options.durationMs }) ||
    isWeakSpeechDetection(fallback, { durationMs: options.durationMs });
  if (rejected) {
    return asNoUsableSpeech({
      ...fallback,
      fallback: true,
      fallbackReason: reason,
    }, `OpenAI fallback produced no usable speech after ${reason}`);
  }
  return {
    ...fallback,
    fallback: true,
    fallbackReason: reason,
  };
}

export async function transcribeAudio(options = {}) {
  const provider = normalizeProvider(options.provider, "deepgram");
  const fallbackProvider = normalizeProvider(options.fallbackProvider, "");

  try {
    let result;
    if (provider === "openai") {
      result = await runOpenAITranscription(options);
    } else {
      result = await runDeepgramTranscription({
        deepgramModel: "nova-3",
        deepgramDetectLanguage: true,
        ...options,
        acceptResult: (candidate) => (
          hasUsableSubtitleText(candidate.segments) &&
          !isWeakSpeechDetection(candidate, { durationMs: options.durationMs }) &&
          !isLikelyRepeatedFillerTranscript(candidate) &&
          !isLikelyNonSpeechDescription(candidate) &&
          !isLikelyContextMismatchedRepetitiveTranscript(candidate, options.contextText) &&
          !isLikelyRomanizedHebrewTranscript(candidate, {
            deepgramLanguage: options.deepgramLanguage,
            deepgramLanguageFallbacks: options.deepgramLanguageFallbacks,
            contextText: options.contextText,
          })
        ),
      });
    }
    if (options.rejectWeakSpeech !== false) {
      const reason = weakDeepgramReason(result, options);
      if (reason) {
        const fallback = await maybeRunOpenAIFallback(options, reason);
        return fallback ?? asNoUsableSpeech(result, reason);
      }
    }
    return result;
  } catch (error) {
    if (provider === "deepgram" && isNoTimedSegmentsError(error)) {
      const noSegmentsResult = {
        provider: "deepgram",
        model: options.deepgramModel || "nova-3",
        raw: null,
        segments: [],
        language: "und",
        noUsableSpeech: true,
        noUsableSpeechReason: error instanceof Error ? error.message : String(error),
      };
      const fallback = await maybeRunOpenAIFallback(options, noSegmentsResult.noUsableSpeechReason);
      return fallback ?? noSegmentsResult;
    }
    if (provider === "deepgram" && fallbackProvider === "openai") {
      const fallback = await runOpenAITranscription(options);
      return {
        ...fallback,
        fallback: true,
        fallbackReason: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

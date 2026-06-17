import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

function normalizeLanguage(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "und";
  if (raw.startsWith("fa") || raw.includes("persian") || raw.includes("farsi")) return "fa";
  if (raw.startsWith("he") || raw.includes("hebrew")) return "he";
  if (raw.startsWith("ar") || raw.includes("arabic")) return "ar";
  if (raw.startsWith("en") || raw.includes("english")) return "en";
  return raw.split("-")[0].slice(0, 12) || "und";
}

function cleanSegmentText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSegment(segment, index) {
  const start = Number(segment?.start ?? 0);
  const end = Number(segment?.end ?? 0);
  const text = cleanSegmentText(segment?.transcript ?? segment?.text ?? "");
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { id: index + 1, start, end, text };
}

function normalizeSentenceSegments(paragraphs) {
  const rawParagraphs = Array.isArray(paragraphs?.paragraphs) ? paragraphs.paragraphs : [];
  const sentences = rawParagraphs.flatMap((paragraph) => Array.isArray(paragraph?.sentences) ? paragraph.sentences : []);
  return sentences.map(normalizeSegment).filter(Boolean);
}

function wordText(word) {
  return cleanSegmentText(word?.punctuated_word ?? word?.word ?? "");
}

function normalizeWordSegments(words = []) {
  const normalizedWords = words
    .map((word) => ({
      text: wordText(word),
      start: Number(word?.start ?? 0),
      end: Number(word?.end ?? 0),
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
  if (normalizedWords.length === 0) return [];

  const segments = [];
  let current = null;
  for (const word of normalizedWords) {
    const gap = current ? word.start - current.end : 0;
    const nextText = current ? `${current.text} ${word.text}` : word.text;
    const tooLong = current && (word.end - current.start > 4.8 || nextText.length > 92 || gap > 0.75);
    if (!current || tooLong) {
      if (current) segments.push(current);
      current = { start: word.start, end: word.end, text: word.text };
    } else {
      current = { ...current, end: word.end, text: nextText };
    }
  }
  if (current) segments.push(current);
  return segments.map((segment, index) => ({ id: index + 1, ...segment }));
}

function shouldPreferWordSegments(utteranceSegments = [], wordSegments = []) {
  if (wordSegments.length === 0) return false;
  if (utteranceSegments.length === 0) return true;
  return utteranceSegments.some((segment) => (
    segment.end - segment.start > 4.8 ||
    String(segment.text ?? "").length > 92
  ));
}

function transcriptText(result) {
  return (Array.isArray(result?.segments) ? result.segments : [])
    .map((segment) => String(segment?.text ?? ""))
    .join(" ");
}

function languageScriptScore(result) {
  const language = normalizeLanguage(result?.language);
  const text = transcriptText(result);
  const arabicScript = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const persianSpecific = (text.match(/[پچژگک‌ی]/g) || []).length;
  const hebrewScript = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const latinScript = (text.match(/[A-Za-z]/g) || []).length;

  if (language === "ar") return arabicScript >= 2 ? 0.08 : -0.25;
  if (language === "fa") {
    if (persianSpecific >= 1) return 0.1;
    if (arabicScript >= 2) return 0.03;
    return -0.25;
  }
  if (language === "he") return hebrewScript >= 2 ? 0.08 : -0.25;
  if (language === "en") return latinScript >= 2 ? 0.05 : -0.18;
  return 0;
}

function resultQuality(result) {
  const confidence = Number(result?.confidence);
  const languageConfidence = Number(result?.languageConfidence);
  const words = result?.raw?.results?.channels?.[0]?.alternatives?.[0]?.words;
  const wordConfidences = Array.isArray(words)
    ? words.map((word) => Number(word?.confidence)).filter(Number.isFinite)
    : [];
  const averageWordConfidence = wordConfidences.length
    ? wordConfidences.reduce((sum, value) => sum + value, 0) / wordConfidences.length
    : 0;
  return (Number.isFinite(confidence) ? confidence : 0)
    + (Number.isFinite(languageConfidence) ? languageConfidence * 0.1 : 0)
    + averageWordConfidence * 0.05
    + languageScriptScore(result);
}

function contentTypeForAudioPath(audioPath) {
  const ext = extname(audioPath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "application/octet-stream";
}

function uniquePush(values, value) {
  const cleaned = cleanSegmentText(value).replace(/^['"“”‘’]+|['"“”‘’]+$/g, "");
  if (!cleaned || cleaned.length < 2) return;
  if (!values.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) values.push(cleaned);
}

function keytermContextText(contextText) {
  const text = sectionizedContextText(contextText);
  if (!/^(?:Post context|Visible OCR text|Visual note):/im.test(text)) return text;

  const selected = [];
  let include = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^Post context:/i.test(line)) {
      include = true;
      selected.push(line.replace(/^Post context:\s*/i, ""));
      continue;
    }
    if (/^(?:Visible OCR text|Visual note):/i.test(line)) {
      include = false;
      continue;
    }
    if (include && !/^Existing translated post:/i.test(line)) selected.push(line);
  }
  return selected.join("\n");
}

function visualContextText(contextText, options = {}) {
  const text = sectionizedContextText(contextText);
  if (!/^(?:Post context|Visible OCR text|Visual note):/im.test(text)) return "";
  const includeOcr = options.includeOcr !== false;

  const selected = [];
  let include = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^Visible OCR text:/i.test(line)) {
      include = includeOcr;
      if (includeOcr) selected.push(line.replace(/^Visible OCR text:\s*/i, ""));
      continue;
    }
    if (/^Visual note:/i.test(line)) {
      include = true;
      selected.push(line.replace(/^Visual note:\s*/i, ""));
      continue;
    }
    if (/^Post context:/i.test(line)) {
      include = false;
      continue;
    }
    if (include) selected.push(line);
  }
  return selected.join("\n");
}

function sectionizedContextText(contextText) {
  return String(contextText ?? "")
    .replace(/\s+(Post context:)/gi, "\n$1")
    .replace(/\s+(Author:)/gi, "\n$1")
    .replace(/\s+(Existing translated post:)/gi, "\n$1")
    .replace(/\s+(Post:)/g, "\n$1")
    .replace(/\s+(URL:)/gi, "\n$1")
    .replace(/\s+(Visible OCR text:)/gi, "\n$1")
    .replace(/\s+(Visual note:)/gi, "\n$1")
    .trim();
}

function speechHintContextText(contextText) {
  return [keytermContextText(contextText), visualContextText(contextText, { includeOcr: false })]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function pushAttempt(attempts, language, detectLanguage) {
  const normalizedLanguageValue = cleanSegmentText(language);
  if (attempts.some((attempt) => attempt.language === normalizedLanguageValue)) return;
  attempts.push({ language: normalizedLanguageValue, detectLanguage: Boolean(detectLanguage && !normalizedLanguageValue) });
}

function preferredLanguagesFromContext(contextText) {
  const text = speechHintContextText(contextText);
  const visualText = visualContextText(contextText, { includeOcr: false });
  if (/\b(?:tv\.)?snn(?:tv)?(?:\.ir)?\b/i.test(text)) return ["fa", "multi"];
  if (/\b(?:persian|farsi)\b/i.test(text)) return ["fa", "multi"];
  if (/\barabic\b/i.test(text)) return ["ar", "multi"];
  const persianSpecific = (visualText.match(/[پچژگک‌ی]/g) || []).length;
  const arabicScript = (visualText.match(/[\u0600-\u06FF]/g) || []).length;
  const hebrewScript = (visualText.match(/[\u0590-\u05FF]/g) || []).length;
  const latinScript = (text.match(/[A-Za-z]/g) || []).length;

  if (persianSpecific >= 2 || (arabicScript >= 8 && /(?:است|های|می|را|این|برای|کرد|شد)/.test(visualText))) return ["fa"];
  if (hebrewScript >= 4) return ["he"];
  if (arabicScript >= 8) return ["ar"];
  if (latinScript >= 12) return ["multi"];
  return [];
}

export function resolveDeepgramLanguageAttempts({
  language = "",
  detectLanguage = true,
  languageFallbacks = [],
  contextText = "",
} = {}) {
  const attempts = [];
  const initialLanguage = cleanSegmentText(language);
  if (initialLanguage) {
    pushAttempt(attempts, initialLanguage, false);
  } else {
    for (const preferredLanguage of preferredLanguagesFromContext(contextText)) {
      pushAttempt(attempts, preferredLanguage, false);
    }
    pushAttempt(attempts, "", detectLanguage);
  }
  for (const fallbackLanguage of languageFallbacks.map(cleanSegmentText).filter(Boolean)) {
    pushAttempt(attempts, fallbackLanguage, false);
  }
  return attempts;
}

export function extractDeepgramKeyterms(contextText, options = {}) {
  const text = keytermContextText(contextText);
  const max = Number(options.max ?? 8);
  const values = [];

  for (const match of text.matchAll(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/g)) {
    uniquePush(values, match[1]);
  }

  const ignoredSingles = new Set(["author", "post", "context", "existing", "translated", "url", "can", "could", "would", "this", "that", "from", "near"]);
  for (const match of text.matchAll(/\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,}))*\b/g)) {
    const value = cleanSegmentText(match[0]);
    const words = value.split(/\s+/);
    if (words.length === 1 && !/^[A-Z]{2,}$/.test(value)) continue;
    if (ignoredSingles.has(value.toLowerCase())) continue;
    uniquePush(values, value);
  }

  return values.slice(0, max);
}

function keytermMatchesLanguage(keyterm, language) {
  const value = String(keyterm ?? "");
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage || normalizedLanguage === "und" || normalizedLanguage === "multi") return true;
  if (normalizedLanguage === "ar" || normalizedLanguage === "fa") return /[\u0600-\u06FF]/.test(value);
  if (normalizedLanguage === "he") return /[\u0590-\u05FF]/.test(value);
  if (normalizedLanguage === "en") return /[A-Za-z]/.test(value);
  return true;
}

function keytermsForAttempt(keyterms, language) {
  return keyterms.filter((keyterm) => keytermMatchesLanguage(keyterm, language));
}

function hasVisualLanguageHint(contextText) {
  const visualText = visualContextText(contextText);
  return /\b(?:arabic|persian|farsi|hebrew|english)\b/i.test(visualText) ||
    /[\u0590-\u05FF\u0600-\u06FF]/.test(visualText);
}

function shouldCompareLanguageCandidates({ language = "", contextText = "" } = {}) {
  return !cleanSegmentText(language) && hasVisualLanguageHint(contextText);
}

export function buildDeepgramListenUrl({
  model = "nova-3",
  language = "",
  detectLanguage = true,
  smartFormat = true,
  punctuate = true,
  utterances = true,
  paragraphs = true,
  keyterms = [],
} = {}) {
  const url = new URL(DEEPGRAM_LISTEN_URL);
  url.searchParams.set("model", model || "nova-3");
  if (smartFormat) url.searchParams.set("smart_format", "true");
  if (punctuate) url.searchParams.set("punctuate", "true");
  if (utterances) url.searchParams.set("utterances", "true");
  if (paragraphs) url.searchParams.set("paragraphs", "true");
  if (language) url.searchParams.set("language", language);
  if (detectLanguage && !language) url.searchParams.set("detect_language", "true");
  for (const keyterm of keyterms.map(cleanSegmentText).filter(Boolean).slice(0, 24)) {
    url.searchParams.append("keyterm", keyterm);
  }
  return url;
}

export function normalizeDeepgramResponse(payload, fallbackDurationMs = null) {
  const channel = payload?.results?.channels?.[0] ?? {};
  const alternative = Array.isArray(channel?.alternatives) ? channel.alternatives[0] ?? {} : {};
  const utterances = Array.isArray(payload?.results?.utterances) ? payload.results.utterances : [];
  const sentenceSegments = normalizeSentenceSegments(alternative?.paragraphs);
  const wordSegments = normalizeWordSegments(alternative?.words ?? []);
  const fullTranscript = cleanSegmentText(alternative?.transcript);
  const fallbackDuration = Number(payload?.metadata?.duration ?? (fallbackDurationMs ? fallbackDurationMs / 1000 : 0));
  const utteranceSegments = utterances.map(normalizeSegment).filter(Boolean);
  const preferWordSegments = shouldPreferWordSegments(utteranceSegments, wordSegments);
  const segments = sentenceSegments.length > 0
    ? sentenceSegments
    : preferWordSegments
      ? wordSegments
      : utteranceSegments.length > 0
        ? utteranceSegments
        : wordSegments.length > 0
          ? wordSegments
        : fullTranscript && fallbackDuration > 0
          ? [{ id: 1, start: 0, end: fallbackDuration, text: fullTranscript }]
          : [];

  return {
    raw: payload,
    language: normalizeLanguage(channel?.detected_language ?? alternative?.detected_language ?? payload?.language),
    languageConfidence: Number(channel?.language_confidence ?? alternative?.language_confidence ?? 0) || 0,
    confidence: Number(alternative?.confidence ?? 0) || 0,
    segments,
    segmentation: sentenceSegments.length > 0 ? "sentences" : preferWordSegments ? "words" : utteranceSegments.length > 0 ? "utterances" : wordSegments.length > 0 ? "words" : fullTranscript ? "transcript" : "none",
  };
}

export async function transcribeWithDeepgram({
  apiKey,
  audioPath,
  model = "nova-3",
  language = "",
  languageFallbacks = [],
  detectLanguage = true,
  contextText = "",
  durationMs = null,
  acceptResult = null,
  fetchImpl = fetch,
  readFileImpl = readFile,
} = {}) {
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is required for Deepgram transcription");
  const keyterms = extractDeepgramKeyterms(contextText);
  const audio = await readFileImpl(audioPath);
  const attempts = resolveDeepgramLanguageAttempts({ language, detectLanguage, languageFallbacks, contextText });

  const attemptedLabels = [];
  const acceptedCandidates = [];
  const rejectedCandidates = [];
  let compareFallbackCandidates = shouldCompareLanguageCandidates({ language, contextText });
  for (const attempt of attempts) {
    attemptedLabels.push(attempt.language || "auto");
    const url = buildDeepgramListenUrl({
      model,
      language: attempt.language,
      detectLanguage: attempt.detectLanguage,
      keyterms: keytermsForAttempt(keyterms, attempt.language),
    });
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentTypeForAudioPath(audioPath),
      },
      body: audio,
    });
    const rawText = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { text: rawText };
    }
    if (!response.ok) {
      throw new Error(`Deepgram transcription ${response.status}: ${rawText.slice(0, 500)}`);
    }
    const normalized = normalizeDeepgramResponse(payload, durationMs);
    if (normalized.segments.length > 0) {
      const result = {
        provider: "deepgram",
        model,
        ...normalized,
        language: normalized.language !== "und" ? normalized.language : normalizeLanguage(attempt.language),
        attemptedLanguages: attemptedLabels,
      };
      if (typeof acceptResult === "function" && !acceptResult(result)) {
        compareFallbackCandidates = true;
        rejectedCandidates.push(result);
        continue;
      }
      if (compareFallbackCandidates) {
        acceptedCandidates.push(result);
        continue;
      }
      return result;
    }
  }

  if (acceptedCandidates.length > 0) {
    const selected = acceptedCandidates
      .slice()
      .sort((a, b) => resultQuality(b) - resultQuality(a))[0];
    return {
      ...selected,
      attemptedLanguages: attemptedLabels,
      selectedFromFallbackCandidates: true,
      rejectedCandidateCount: rejectedCandidates.length,
    };
  }
  if (rejectedCandidates.length > 0) {
    return {
      ...rejectedCandidates[0],
      attemptedLanguages: attemptedLabels,
      rejectedCandidateCount: rejectedCandidates.length,
      onlyWeakCandidates: true,
    };
  }

  throw new Error(`Deepgram transcription returned no timed segments (attempted: ${attemptedLabels.join(", ")})`);
}

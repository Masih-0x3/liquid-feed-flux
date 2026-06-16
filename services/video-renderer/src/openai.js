import { readFile, stat } from "node:fs/promises";
import { validateTranslatedSegments } from "./subtitles.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 90_000;

function openAiRequestTimeoutMs() {
  const value = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
}

async function fetchOpenAI(fetchImpl, url, init, label) {
  const timeoutMs = openAiRequestTimeoutMs();
  if (timeoutMs === 0) return await fetchImpl(url, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTranscriptionSegments(payload, fallbackDurationMs = null) {
  const rawSegments = Array.isArray(payload?.segments)
    ? payload.segments
    : Array.isArray(payload?.words)
      ? payload.words
      : [];

  if (rawSegments.length > 0) {
    return rawSegments
      .map((segment, index) => ({
        id: index + 1,
        start: Number(segment.start ?? segment.start_time ?? 0),
        end: Number(segment.end ?? segment.end_time ?? 0),
        text: String(segment.text ?? segment.word ?? "").trim(),
      }))
      .filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
  }

  const text = String(payload?.text ?? "").trim();
  const duration = fallbackDurationMs ? fallbackDurationMs / 1000 : Math.max(2, text.length / 14);
  return text ? [{ id: 1, start: 0, end: duration, text }] : [];
}

function normalizedLanguage(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["fa", "fas", "per", "farsi", "persian", "فارسی"].includes(raw)) return "fa";
  if (["he", "heb", "hebrew", "עברית"].includes(raw)) return "he";
  if (["ar", "ara", "arabic", "العربية"].includes(raw)) return "ar";
  if (["en", "eng", "english"].includes(raw)) return "en";
  return raw.slice(0, 12);
}

export function detectLanguageFromTranscription(payload) {
  const explicit = normalizedLanguage(payload?.language);
  if (explicit) return explicit;

  const channels = Array.isArray(payload?.results?.channels) ? payload.results.channels : [];
  const deepgramAlternatives = channels.flatMap((channel) => Array.isArray(channel?.alternatives) ? channel.alternatives : []);
  const deepgramWords = deepgramAlternatives.flatMap((alternative) => Array.isArray(alternative?.words) ? alternative.words : []);
  const deepgramUtterances = Array.isArray(payload?.results?.utterances) ? payload.results.utterances : [];
  const text = [
    payload?.text,
    ...(Array.isArray(payload?.segments) ? payload.segments.map((segment) => segment?.text) : []),
    ...deepgramAlternatives.map((alternative) => alternative?.transcript),
    ...deepgramUtterances.map((utterance) => utterance?.transcript),
    ...deepgramWords.map((word) => word?.punctuated_word ?? word?.word),
  ].filter(Boolean).join(" ");

  const persianSpecific = (text.match(/[پچژگک‌ی]/g) || []).length;
  const arabicScript = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const hebrewScript = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const latinScript = (text.match(/[A-Za-z]/g) || []).length;

  if (persianSpecific >= 2 || (arabicScript >= 8 && /(?:است|های|می|را|این|برای|کرد|شد)/.test(text))) return "fa";
  if (hebrewScript >= 4) return "he";
  if (arabicScript >= 8) return "ar";
  if (latinScript >= 4) return "en";
  return "und";
}

async function postMultipart({ apiKey, fields, filePath }) {
  const fileInfo = await stat(filePath);
  if (fileInfo.size > MAX_TRANSCRIPTION_UPLOAD_BYTES) {
    throw new Error(`transcription upload is ${fileInfo.size} bytes; OpenAI audio uploads must stay under 25 MB`);
  }

  const fileBytes = await readFile(filePath);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  form.append("file", new Blob([fileBytes], { type: "audio/mpeg" }), filePath.split("/").pop() || "audio.mp3");

  const response = await fetchOpenAI(fetch, `${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, "OpenAI transcription");
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  if (!response.ok) {
    throw new Error(`OpenAI transcription ${response.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

export async function transcribeAudio({ apiKey, audioPath, model, fallbackModel = "whisper-1", durationMs = null }) {
  const primaryFields = model.includes("diarize")
    ? { model, response_format: "diarized_json", chunking_strategy: "auto" }
    : { model, response_format: "json" };

  const primary = await postMultipart({ apiKey, fields: primaryFields, filePath: audioPath });
  const primarySegments = normalizeTranscriptionSegments(primary, durationMs);
  if (primarySegments.length > 0) {
    return { model, raw: primary, segments: primarySegments, language: detectLanguageFromTranscription(primary) };
  }

  const fallback = await postMultipart({
    apiKey,
    fields: {
      model: fallbackModel,
      response_format: "verbose_json",
      "timestamp_granularities[]": "segment",
    },
    filePath: audioPath,
  });
  const fallbackSegments = normalizeTranscriptionSegments(fallback, durationMs);
  if (fallbackSegments.length === 0) throw new Error("transcription returned no timed segments");
  return { model: fallbackModel, raw: fallback, segments: fallbackSegments, language: detectLanguageFromTranscription(fallback), fallback: true };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01OrNull(value) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : clamp01(numeric);
}

function normalizeBox(value) {
  const box = value && typeof value === "object" ? value : {};
  return {
    x: clamp01(box.x ?? 0),
    y: clamp01(box.y ?? 0),
    w: clamp01(box.w ?? 0),
    h: clamp01(box.h ?? 0),
  };
}

function normalizeOverlay(overlay) {
  return {
    text: String(overlay?.text ?? ""),
    category: String(overlay?.category ?? "unknown"),
    action: String(overlay?.action ?? "keep"),
    confidence: clamp01(overlay?.confidence ?? 0),
    reason: String(overlay?.reason ?? ""),
    box: normalizeBox(overlay?.box),
  };
}

function normalizeDetectionBand(value, fallbackType = "none") {
  const input = value && typeof value === "object" ? value : {};
  return {
    detected: Boolean(input.detected),
    confidence: clamp01(input.confidence ?? 0),
    type: String(input.type ?? fallbackType),
    action: String(input.action ?? "keep"),
    box: normalizeBox(input.box),
    reason: String(input.reason ?? ""),
  };
}

function normalizeSubtitleZone(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    placement: String(input.placement ?? "bottom"),
    y: clamp01OrNull(input.y),
    maxWidth: clamp01OrNull(input.max_width ?? input.maxWidth),
    bottomMargin: clamp01OrNull(input.bottom_margin ?? input.safe_bottom_margin ?? input.bottomMargin),
    confidence: clamp01(input.confidence ?? 0),
    reason: String(input.reason ?? ""),
  };
}

function normalizeRenderDecision(value, shouldBlock = false, blockReason = "") {
  const input = value && typeof value === "object" ? value : {};
  const action = String(input.action ?? (shouldBlock ? "block" : "render"));
  return {
    action,
    confidence: clamp01(input.confidence ?? 0),
    reason: String(input.reason ?? blockReason ?? ""),
  };
}

function targetLanguageName(targetLanguage) {
  return targetLanguage === "en" ? "English" : "Persian";
}

function sourceLanguageName(sourceLanguage) {
  const normalized = normalizedLanguage(sourceLanguage) || "und";
  if (normalized === "fa") return "Persian";
  if (normalized === "he") return "Hebrew";
  if (normalized === "ar") return "Arabic";
  if (normalized === "en") return "English";
  return "the source language";
}

function compactContextText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
}

function subtitleSegmentsJsonSchema(name) {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "number" },
              start: { type: "number" },
              end: { type: "number" },
              text: { type: "string" },
            },
            required: ["id", "start", "end", "text"],
          },
        },
      },
      required: ["segments"],
    },
  };
}

export function buildTranscriptCleanupRequest({ model, segments, sourceLanguage = "und", contextText = "" }) {
  const normalizedSource = normalizedLanguage(sourceLanguage) || "und";
  const languageName = sourceLanguageName(normalizedSource);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `You clean the source-language subtitle transcript in ${languageName}.`,
              "Return strict JSON only.",
              "Do not translate.",
              "Keep the same cue ids and exact timings.",
              "Fix only obvious speech-to-text mistakes, broken punctuation, casing, names, slogans, chants, and quoted phrases.",
              "Use the provided context to correct noisy recognition, but do not add anything that was not spoken.",
              "If context or audio text points to \"Free Palestine\", never rewrite it as a near-sounding phrase like \"free pasta\" or \"free concert\".",
              "If context points to Jerry Seinfeld, correct obvious variants such as \"S ten\" or \"S10\" only when the cue clearly refers to that name.",
              "For protest/crowd chants, repeated official or politician names may be followed by a short demand such as \"resign\". If the cue is a protest chant and the recognized text has collapsed the demand into repeated names, restore the spoken demand, e.g. \"Araghchi, resign\" instead of a bare name loop. Do not add resignation language unless the source cue is a protest chant and the audio/context clearly supports that demand.",
              normalizedSource === "he" ? "For Hebrew political or military speech, fix obvious near-sounding recognition errors only when grammar and context make the intended phrase clear; for example צהל or פסל can be צה\"ל, מלאכה תמא can be מלאכה תמה, and מניסיוני לקשור בין הזירות can be ואת ניסיונותיה לקשור בין הזירות when discussing Iran linking fronts." : "",
              normalizedSource === "he" ? "Apply those Hebrew fixes even when the misrecognized phrase is split across adjacent short cues; preserve cue boundaries by correcting the cue text in place, e.g. a standalone מניסיוני followed by לקשור בין הזירות should become ואת ניסיונותיה followed by לקשור בין הזירות." : "",
              "Remove isolated repeated fragments only when they are clearly duplicated from a neighboring cue, such as a standalone \"Up?\" immediately after \"What up\".",
              "Keep each cue short enough for subtitles; do not merge or split cues.",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({ source_language: normalizedSource, context_text: context, segments }),
        }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("cleaned_transcript_segments"),
    },
  };
}

export function buildTranslationRequest({ model, segments, targetLanguage = "fa", contextText = "" }) {
  const normalizedTarget = targetLanguage === "en" ? "en" : "fa";
  const targetName = targetLanguageName(normalizedTarget);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `Translate subtitle cues into natural ${targetName}.`,
              "Return strict JSON only.",
              "Keep the same cue ids and exact timings.",
              "Translate each cue independently: cue N must contain only meaning from source cue N.",
              "Never move a sentence, phrase, or idea into an adjacent cue, even if that would read more smoothly.",
              `Each cue must be readable, at most two ${targetName} subtitle lines.`,
              "Preserve the meaning of quoted slogans, political phrases, named people, places, organizations, and common chants; do not substitute unrelated near-sounding words.",
              "Use provided source context only to correct obvious noisy-transcription mistakes in names, slogans, or quoted phrases; do not add context that was not spoken.",
              "Example: if source context says \"Free Palestine\", do not translate a noisy cue as \"free concert\".",
              normalizedTarget === "fa" ? "Use concise, spoken Persian fit for burned-in subtitles; avoid stiff literal Persian and do not over-explain." : "",
              normalizedTarget === "fa" ? "Make the Persian flow as natural subtitles, not word-for-word fragments; do not start a cue with a comma, punctuation mark, or awkward dangling connector when the idea can be phrased cleanly." : "",
              normalizedTarget === "fa" ? "For Persian output, translate English slogans semantically instead of transliterating them; render \"Free Palestine\" as \"فلسطین آزاد\" or \"فلسطین را آزاد کنید\", never \"فری فلسطین\"." : "",
              normalizedTarget === "fa" ? "For a cue like \"Can we get a Free Palestine?\", prefer a natural subtitle such as \"یه «فلسطین آزاد» می‌گی؟\" over a literal phrasing like \"می‌تونیم یه فلسطین آزاد داشته باشیم؟\"." : "",
              normalizedTarget === "fa" ? "For an English cue like \"Give me one Free Palestine\", treat \"give me one\" as asking someone to say or chant the slogan; prefer \"یه «فلسطین آزاد» بگو\" over \"بده\"." : "",
              normalizedTarget === "fa" ? "For resignation chants like \"Araghchi, resign\" or \"Ghalibaf, resign\", use short natural Persian chant wording such as \"عراقچی، استعفا\". For repeated chants like \"Araghchi, resign, resign\", prefer \"عراقچی، استعفا، استعفا\" over longer phrases like \"استعفا بده\" so narrow videos stay readable; do not output only the repeated name." : "",
              normalizedTarget === "fa" ? "Do not invent greetings such as \"سلام\"; translate \"what up\" or \"what's up\" as \"چه خبر\" or \"چطوری\" only when that greeting is actually in the source cue." : "",
              "Do not add source-language text.",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify({ target_language: normalizedTarget, context_text: context, segments }) }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("translated_subtitle_segments"),
    },
  };
}

export function buildTranslationRepairRequest({
  model,
  sourceSegments,
  draftSegments,
  targetLanguage = "fa",
  contextText = "",
  errorMessage = "",
}) {
  const normalizedTarget = targetLanguage === "en" ? "en" : "fa";
  const targetName = targetLanguageName(normalizedTarget);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `Repair an invalid ${targetName} subtitle translation.`,
              "Return strict JSON only.",
              "Use the source cues to fill any empty, punctuation-only, or malformed translated cue.",
              "Keep the same cue ids and exact timings from source_segments.",
              "Do not merge, split, drop, or reorder cues.",
              "Every output text must be non-empty and readable.",
              normalizedTarget === "fa" ? "For Persian, make short natural subtitle phrases and do not start a cue with punctuation." : "",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            target_language: normalizedTarget,
            context_text: context,
            validation_error: String(errorMessage ?? ""),
            source_segments: sourceSegments,
            draft_translated_segments: draftSegments,
          }),
        }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("repaired_translated_subtitle_segments"),
    },
  };
}

function parseSubtitleSegmentsResponse(payload, label) {
  const outputText = extractOutputText(payload);
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${error.message}; output=${outputText.slice(0, 300)}`);
  }
  return parsed;
}

export async function cleanupTranscriptSegments({
  apiKey,
  model,
  segments,
  sourceLanguage = "und",
  contextText = "",
  fetchImpl = fetch,
}) {
  const response = await fetchOpenAI(fetchImpl, `${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTranscriptCleanupRequest({ model, segments, sourceLanguage, contextText })),
  }, "OpenAI transcript cleanup");

  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { output_text: rawText };
  }
  if (!response.ok) {
    throw new Error(`OpenAI transcript cleanup ${response.status}: ${rawText.slice(0, 500)}`);
  }

  const parsed = parseSubtitleSegmentsResponse(payload, "transcript cleanup");
  const cleaned = validateTranslatedSegments(segments, parsed.segments);
  return { model, raw: payload, segments: cleaned };
}

export async function translateSegments({ apiKey, model, segments, targetLanguage = "fa", contextText = "", fetchImpl = fetch }) {
  const response = await fetchOpenAI(fetchImpl, `${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTranslationRequest({ model, segments, targetLanguage, contextText })),
  }, "OpenAI translation");

  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { output_text: rawText };
  }
  if (!response.ok) {
    throw new Error(`OpenAI translation ${response.status}: ${rawText.slice(0, 500)}`);
  }

  const parsed = parseSubtitleSegmentsResponse(payload, "translation");
  try {
    const translated = validateTranslatedSegments(segments, parsed.segments);
    return { model, raw: payload, segments: translated };
  } catch (error) {
    const repairResponse = await fetchOpenAI(fetchImpl, `${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTranslationRepairRequest({
        model,
        sourceSegments: segments,
        draftSegments: parsed.segments,
        targetLanguage,
        contextText,
        errorMessage: error instanceof Error ? error.message : String(error),
      })),
    }, "OpenAI translation repair");
    const repairRawText = await repairResponse.text();
    let repairPayload;
    try {
      repairPayload = JSON.parse(repairRawText);
    } catch {
      repairPayload = { output_text: repairRawText };
    }
    if (!repairResponse.ok) {
      throw new Error(`OpenAI translation repair ${repairResponse.status}: ${repairRawText.slice(0, 500)}`);
    }
    const repairedParsed = parseSubtitleSegmentsResponse(repairPayload, "translation repair");
    const repaired = validateTranslatedSegments(segments, repairedParsed.segments);
    return {
      model,
      raw: { initial: payload, repair: repairPayload },
      segments: repaired,
      repaired: true,
      repairReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseVisionWatermarkResult(text) {
  const payload = typeof text === "string" ? JSON.parse(text) : text;
  const overlays = Array.isArray(payload?.overlays)
    ? payload.overlays.map(normalizeOverlay)
    : [];
  const shouldBlock = Boolean(payload?.should_block ?? payload?.shouldSkip ?? payload?.should_skip);
  const blockReason = String(payload?.block_reason ?? "");
  const existingSubtitles = normalizeDetectionBand(payload?.existing_subtitles ?? payload?.existingSubtitles, "none");
  const lowerTextRegion = normalizeDetectionBand(payload?.lower_text_region ?? payload?.lowerTextRegion, "none");
  const subtitlePlacement = normalizeSubtitleZone(payload?.recommended_subtitle_zone ?? payload?.recommendedSubtitleZone ?? payload?.subtitle_zone);
  const renderDecision = normalizeRenderDecision(payload?.render_decision ?? payload?.renderDecision, shouldBlock, blockReason);
  return {
    hasWatermark: Boolean(payload?.has_watermark),
    confidence: clamp01(payload?.confidence ?? 0),
    location: String(payload?.location ?? "unknown"),
    detectedTextOrLogo: String(payload?.detected_text_or_logo ?? ""),
    hasSubtitles: Boolean(payload?.has_subtitles ?? existingSubtitles.detected),
    shouldSkip: shouldBlock,
    shouldBlock,
    blockReason,
    existingSubtitles,
    lowerTextRegion,
    subtitlePlacement,
    renderDecision,
    needsSpecialistReview: Boolean(payload?.needs_specialist_review ?? payload?.needsSpecialistReview),
    overlays,
  };
}

function normalizeWatermarkBox(value) {
  const box = normalizeBox(value);
  const area = box.w * box.h;
  const sentinel = box.x >= 0.95 && box.y >= 0.95 && box.w >= 0.9 && box.h >= 0.9;
  return {
    ...box,
    area,
    valid: box.w > 0 && box.h > 0 && area > 0 && !sentinel,
  };
}

function hasHandleDomainOrPlatformText(value) {
  return /(?:^|\s)@[\w.]{2,}|\b(?:t\.me|x\.com|twitter\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\b|\b[\w.-]+\.(?:com|net|org|io|ir|co)\b|\b(?:TikTok|Instagram|YouTube|Telegram|Twitter)\b/i
    .test(String(value ?? ""));
}

function hasNonLatinText(value) {
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(String(value ?? ""));
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function isOfficialSourceMark(candidate) {
  const text = String(candidate?.text ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const type = String(candidate?.type ?? "unknown");
  const reason = String(candidate?.reason ?? "");
  if (/(?:official_agency_label|broadcaster_branding|source_context)/i.test(type)) return true;
  if (/(?:official agency|government press office|source[- ]?context|original broadcaster|named source)/i.test(reason)) return true;
  return /^(?:GPO|CENTCOM|USCENTCOM|DVIDS|IDF|ISRAELI GPO|GOVERNMENT PRESS OFFICE)$/.test(text);
}

function shouldKeepMisclassifiedWatermark(candidate) {
  const text = String(candidate?.text ?? "").trim();
  const type = String(candidate?.type ?? "unknown");
  const reason = String(candidate?.reason ?? "");
  if (!text || hasHandleDomainOrPlatformText(text)) return false;

  if (isOfficialSourceMark(candidate)) return true;

  const handleType = /(?:repost_handle|creator_handle)/.test(type);
  const watermarkReason = /(?:watermark|logo|brand|branding|channel|creator|handle|telegram|platform|repost)/i.test(reason);
  if (handleType && watermarkReason) return false;

  if (handleType && (hasNonLatinText(text) || wordCount(text) >= 2)) return true;

  const contextReason = /(?:lower[- ]?third|chyron|ticker|caption|title|label|context|descriptive|news|banner)/i.test(reason);
  if (contextReason && !/(?:logo|domain|@|handle|username|repost|platform)/i.test(text)) return true;

  return false;
}

function removableToMustKeep(candidate) {
  return {
    text: candidate.text,
    type: isOfficialSourceMark(candidate) ? "source_context" : "lower_third",
    reason: isOfficialSourceMark(candidate)
      ? `Misclassified as ${candidate.type}; kept because it is an official/source-context mark.`
      : `Misclassified as ${candidate.type}; kept because it has no handle/domain/platform marker.`,
  };
}

function normalizeRemovableWatermark(candidate) {
  const box = normalizeWatermarkBox(candidate?.box);
  return {
    text: String(candidate?.text ?? ""),
    type: String(candidate?.type ?? "unknown"),
    confidence: clamp01(candidate?.confidence ?? 0),
    box,
    seenInFrames: Array.isArray(candidate?.seen_in_frames ?? candidate?.seenInFrames)
      ? (candidate.seen_in_frames ?? candidate.seenInFrames)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
      : [],
    safeToDelogo: Boolean(candidate?.safe_to_delogo ?? candidate?.safeToDelogo),
    reason: String(candidate?.reason ?? ""),
  };
}

function normalizeMustKeep(value) {
  return {
    text: String(value?.text ?? ""),
    type: String(value?.type ?? "unknown"),
    reason: String(value?.reason ?? ""),
  };
}

export function parseRemovableWatermarkResult(text) {
  const payload = typeof text === "string" ? JSON.parse(text) : text;
  const rawDecision = String(payload?.decision ?? "render").toLowerCase();
  const parsedDecision = ["render", "render_with_delogo", "block", "uncertain"].includes(rawDecision)
    ? rawDecision
    : "uncertain";
  const rawRemovableWatermarks = Array.isArray(payload?.removable_watermarks ?? payload?.removableWatermarks)
    ? (payload.removable_watermarks ?? payload.removableWatermarks).map(normalizeRemovableWatermark)
    : [];
  const protectedContext = rawRemovableWatermarks.filter(shouldKeepMisclassifiedWatermark);
  const removableWatermarks = rawRemovableWatermarks.filter((candidate) => !shouldKeepMisclassifiedWatermark(candidate));
  const mustKeep = Array.isArray(payload?.must_keep ?? payload?.mustKeep)
    ? (payload.must_keep ?? payload.mustKeep).map(normalizeMustKeep)
    : [];
  const decision = parsedDecision === "render_with_delogo" && removableWatermarks.length === 0
    ? "render"
    : parsedDecision;
  const reason = protectedContext.length > 0 && removableWatermarks.length === 0
    ? "No removable watermark after protecting descriptive lower-third/context text."
    : String(payload?.reason ?? "");

  return {
    decision,
    confidence: clamp01(payload?.confidence ?? 0),
    reason,
    removableWatermarks,
    mustKeep: [...mustKeep, ...protectedContext.map(removableToMustKeep)],
    shouldBlock: decision === "block" || decision === "uncertain",
  };
}

const BOX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
  required: ["x", "y", "w", "h"],
};

const REMOVABLE_WATERMARK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    type: {
      type: "string",
      enum: [
        "repost_handle",
        "creator_handle",
        "domain",
        "platform_logo",
        "platform_ui_repost",
        "third_party_watermark",
        "unknown",
      ],
    },
    confidence: { type: "number" },
    box: BOX_SCHEMA,
    seen_in_frames: {
      type: "array",
      items: { type: "number" },
    },
    safe_to_delogo: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["text", "type", "confidence", "box", "seen_in_frames", "safe_to_delogo", "reason"],
};

const MUST_KEEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    type: {
      type: "string",
      enum: [
        "broadcaster_branding",
        "official_agency_label",
        "classification_label",
        "map_label",
        "news_chyron",
        "ticker",
        "teletext",
        "hard_subtitle",
        "translated_subtitle",
        "lower_third",
        "program_graphic",
        "source_context",
        "other",
      ],
    },
    reason: { type: "string" },
  },
  required: ["text", "type", "reason"],
};

const DETECTION_BAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    detected: { type: "boolean" },
    confidence: { type: "number" },
    type: {
      type: "string",
      enum: [
        "none",
        "hard_subtitle",
        "translated_subtitle",
        "news_ticker",
        "teletext",
        "lower_third",
        "chyron",
        "platform_ui",
        "other",
      ],
    },
    action: { type: "string", enum: ["keep", "avoid", "mask_subtitle_band", "block"] },
    box: BOX_SCHEMA,
    reason: { type: "string" },
  },
  required: ["detected", "confidence", "type", "action", "box", "reason"],
};

const SUBTITLE_ZONE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    placement: {
      type: "string",
      enum: ["bottom", "above_lower_text", "middle_lower", "top", "manual_review"],
    },
    y: { type: "number" },
    max_width: { type: "number" },
    bottom_margin: { type: "number" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["placement", "y", "max_width", "bottom_margin", "confidence", "reason"],
};

const RENDER_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["render", "render_with_delogo", "manual_review", "block"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["action", "confidence", "reason"],
};

function modelSettings(options = {}) {
  const settings = {};
  const temperature = numberOrNull(options.temperature ?? 0);
  if (temperature !== null) settings.temperature = temperature;
  const topP = numberOrNull(options.topP ?? options.top_p);
  if (topP !== null) settings.top_p = Math.max(0, Math.min(1, topP));
  const maxOutputTokens = numberOrNull(options.maxOutputTokens ?? options.max_output_tokens ?? 1200);
  if (maxOutputTokens !== null) settings.max_output_tokens = Math.max(256, Math.round(maxOutputTokens));
  return settings;
}

function imagePart(base64, detail = "high") {
  const normalizedDetail = ["low", "high", "auto"].includes(String(detail)) ? String(detail) : "high";
  return {
    type: "input_image",
    image_url: `data:image/jpeg;base64,${base64}`,
    detail: normalizedDetail,
  };
}

export function buildRemovableWatermarkRequest({
  model,
  frameBase64s = [],
  inspectionBase64s = [],
  imageDetail = "high",
  temperature = 0,
  topP = null,
  maxOutputTokens = 1200,
}) {
  const frames = frameBase64s.filter(Boolean);
  const inspections = inspectionBase64s.filter(Boolean);
  const content = [
    {
      type: "input_text",
      text: [
        "You are doing one narrow task: detect removable third-party watermarks in sampled video frames.",
        `Images 1-${Math.max(1, frames.length)} are source-video frames, sometimes upscaled with the same aspect ratio for readability.`,
        inspections.length > 0
          ? `Images ${frames.length + 1}-${frames.length + inspections.length} are zoomed inspection sheets generated from those same source frames. Use inspection sheets only to read tiny handles/logos/domains. Never return coordinates from an inspection sheet.`
          : "No zoomed inspection sheets are attached.",
        "Return every box normalized to the source-video frame coordinates visible in Images 1 through the source-frame count.",
        "Only target marks that are not part of the original video content: repost handles, creator handles, domains, TikTok/Instagram/Telegram/X repost UI, or third-party watermark logos.",
        "A social @handle, username, domain, or channel tag is a removable watermark by default unless it clearly belongs to the original broadcaster, official agency, or named source shown in the video.",
        "Examples of removable marks: @some_user, @newsclipper, t.me/channel, instagram handles, X/Twitter repost handles, creator tags overlaid on a news clip.",
        "Do not classify plain descriptive phrases as creator handles. A phrase such as صواريخ الآن / missiles now is a contextual lower-third/title and must stay unless it also has a handle, domain, platform marker, or clear third-party logo.",
        "For non-Latin text, be extra conservative: Arabic, Persian, or Hebrew words on a lower-third bar are usually scene/news context, not a removable watermark.",
        "Do not target or remove source-context graphics: FOX NEWS, CNN, broadcaster logos, show bugs, CENTCOM, GPO/Government Press Office, UNCLASSIFIED, official agency marks, map labels, military/geographic labels, lower-thirds, chyrons, tickers, teletext, captions, or news banners.",
        "Always include visible lower burned-in dialogue subtitles, translation captions, teletext, tickers, chyrons, and lower-thirds in must_keep, even though they are not removable watermarks. This is required so our generated subtitle can be placed above them.",
        "For Hebrew, Arabic, Persian, Turkish, English, or any other existing dialogue subtitle near the bottom, return a must_keep item with type=hard_subtitle or translated_subtitle and a reason that says it occupies the lower caption area.",
        "Do not treat an unknown @handle or domain as source-context merely because it appears inside the video frame.",
        "If there is no removable third-party watermark, return decision=render and an empty removable_watermarks array.",
        "If a removable watermark exists, return decision=render_with_delogo. The box is advisory only; local computer-vision recovery will choose the final ffmpeg delogo rectangle.",
        "Provide the best approximate source-frame box when possible, but do not try to be pixel-perfect and do not pad the box.",
        "For moving or inconsistent marks, return decision=block unless a static local delogo rectangle is likely to cover all sampled frames.",
        "Use decision=uncertain only when you are not sure whether the mark is actually removable. Do not use uncertain merely because exact coordinates are hard. Do not use x=1,y=1,w=1,h=1 sentinel coordinates.",
        "Use decision=block for large, central, or content-overlapping watermarks that should make the video unpostable.",
        "Return strict JSON only.",
      ].join(" "),
    },
  ];
  for (const frame of frames) {
    content.push(imagePart(frame, imageDetail));
  }
  for (const inspection of inspections) {
    content.push(imagePart(inspection, imageDetail));
  }

  return {
    model,
    input: [{
      role: "user",
      content,
    }],
    ...modelSettings({ temperature, topP, maxOutputTokens }),
    text: {
      format: {
        type: "json_schema",
        name: "removable_watermark_detection",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decision: { type: "string", enum: ["render", "render_with_delogo", "block", "uncertain"] },
            confidence: { type: "number" },
            reason: { type: "string" },
            removable_watermarks: {
              type: "array",
              items: REMOVABLE_WATERMARK_SCHEMA,
            },
            must_keep: {
              type: "array",
              items: MUST_KEEP_SCHEMA,
            },
          },
          required: ["decision", "confidence", "reason", "removable_watermarks", "must_keep"],
        },
      },
    },
  };
}

function visionFocusText(focus) {
  if (focus === "watermark") {
    return "Focus especially on source/reposter watermarks and logos to remove. Distinguish them from broadcaster, agency, classification, map, and news context that must stay. For delogo boxes, cover only the source mark itself and do not include lower-third or ticker text.";
  }
  if (focus === "subtitles") {
    return "Focus especially on existing burned-in dialogue subtitles versus lower-third news graphics, chyrons, teletext, or tickers. Existing dialogue subtitles may need masking; news context should stay.";
  }
  if (focus === "placement") {
    return "Focus especially on the safest subtitle placement. If a ticker, teletext, lower-third, or chyron exists near the bottom, recommend a bottom_margin that places our subtitle just above it.";
  }
  return "Analyze all overlay layers together and return the best single preflight decision.";
}

export function buildVisionPreflightRequest({ model, imageBase64 = "", frameBase64 = "", frameBase64s = [], focus = "general" }) {
  const frames = frameBase64s.length > 0 ? frameBase64s : [frameBase64].filter(Boolean);
  const hasContactSheet = Boolean(imageBase64);
  const contactSheetIndex = frames.length + 1;
  const content = [
    {
      type: "input_text",
      text: [
        "Analyze these sampled images from one video and classify persistent visible overlays.",
        frames.length > 0 && hasContactSheet
          ? `Images 1-${frames.length} are individual source-video frames for exact coordinates. Image ${contactSheetIndex} is a contact sheet for persistence/context. Return all boxes normalized to the source-video frame coordinates, not the contact-sheet canvas.`
          : frames.length > 0
            ? `Images 1-${frames.length} are individual source-video frames for exact coordinates. Return all boxes normalized to the source-video frame coordinates.`
          : "Return box coordinates normalized to the original source-video frame, not the contact-sheet canvas. Infer the source-frame location from repeated positions across tiles.",
        "Return strict JSON only.",
        visionFocusText(focus),
        "For action=delogo, the box must fully cover the visible handle/logo/domain in Image 1. Err slightly wider and taller rather than too tight.",
        "If the source mark is near a lower-third, ticker, teletext, or chyron, do not include that contextual news text in the delogo box.",
        "Only mark action=delogo for source/reposter marks such as @handles, usernames, domains, Telegram/TikTok/Instagram/X repost tags, or creator watermarks that are not part of the original news content.",
        "Never mark a plain descriptive lower-third/title as delogo just because it is stable. For example, صواريخ الآن means missiles now and is contextual text that should stay.",
        "For Arabic, Persian, or Hebrew text without @, a domain, platform name, or obvious third-party logo, prefer action=keep and category=lower_third_or_chyron or map_label_or_context_text.",
        "Keep contextual source material: broadcaster logos such as FOX NEWS or CNN, official agency marks such as CENTCOM or GPO/Government Press Office, labels such as UNCLASSIFIED, map labels, military/geographic labels, chyrons, tickers, and lower-thirds.",
        "Report lower_text_region when a news ticker, teletext, chyron, or lower-third occupies the lower part of the frame. Keep it and avoid covering it.",
        "Report existing_subtitles only for burned-in dialogue subtitles or translation captions, not for news tickers, chyrons, or lower-thirds.",
        "recommended_subtitle_zone.bottom_margin is the normalized distance from the bottom edge to the bottom of our subtitle; use about 0.08 normally, and raise it when lower text should remain visible.",
        "Use action=block only for a large intrusive third-party watermark that cannot be safely delogoed.",
        "Use action=keep when the overlay is useful context or should remain visible.",
      ].join(" "),
    },
  ];
  for (const frame of frames) {
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${frame}` });
  }
  if (hasContactSheet) {
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` });
  }

  return {
    model,
    input: [{
      role: "user",
      content,
    }],
    text: {
      format: {
        type: "json_schema",
        name: "video_overlay_preflight",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            has_watermark: { type: "boolean" },
            confidence: { type: "number" },
            should_block: { type: "boolean" },
            block_reason: { type: "string" },
            needs_specialist_review: { type: "boolean" },
            overlays: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string" },
                  category: {
                    type: "string",
                    enum: [
                      "source_watermark_handle",
                      "source_watermark_domain",
                      "platform_repost_overlay",
                      "creator_watermark",
                      "broadcaster_branding",
                      "official_agency_label",
                      "classification_label",
                      "news_chyron_or_ticker",
                      "map_label_or_context_text",
                      "hard_subtitle",
                      "news_ticker_or_teletext",
                      "lower_third_or_chyron",
                      "platform_ui",
                      "unknown",
                    ],
                  },
                  action: { type: "string", enum: ["keep", "delogo", "mask_subtitle_band", "block"] },
                  confidence: { type: "number" },
                  box: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                      w: { type: "number" },
                      h: { type: "number" },
                    },
                    required: ["x", "y", "w", "h"],
                  },
                  reason: { type: "string" },
                },
                required: ["text", "category", "action", "confidence", "box", "reason"],
              },
            },
            existing_subtitles: DETECTION_BAND_SCHEMA,
            lower_text_region: DETECTION_BAND_SCHEMA,
            recommended_subtitle_zone: SUBTITLE_ZONE_SCHEMA,
            render_decision: RENDER_DECISION_SCHEMA,
          },
          required: [
            "has_watermark",
            "confidence",
            "should_block",
            "block_reason",
            "needs_specialist_review",
            "overlays",
            "existing_subtitles",
            "lower_text_region",
            "recommended_subtitle_zone",
            "render_decision",
          ],
        },
      },
    },
  };
}

function overlayKey(overlay) {
  const box = overlay?.box ?? {};
  return [
    String(overlay?.action ?? "keep"),
    String(overlay?.category ?? "unknown"),
    String(overlay?.text ?? "").trim().toLowerCase(),
    Math.round(clamp01(box.x) * 40),
    Math.round(clamp01(box.y) * 40),
    Math.round(clamp01(box.w) * 40),
    Math.round(clamp01(box.h) * 40),
  ].join(":");
}

function hasUsableDelogoBox(overlay) {
  if (overlay?.action !== "delogo") return true;
  const box = overlay?.box ?? {};
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return false;
  if ((x >= 0.98 && y >= 0.98) || w >= 0.95 || h >= 0.95) return false;
  return true;
}

function mergeOverlays(groups) {
  const merged = new Map();
  for (const overlay of groups.flat()) {
    const normalized = normalizeOverlay(overlay);
    if (!hasUsableDelogoBox(normalized)) continue;
    const key = overlayKey(normalized);
    const existing = merged.get(key);
    if (!existing || normalized.confidence > existing.confidence) merged.set(key, normalized);
  }
  return [...merged.values()];
}

function pickHighestConfidence(values, fallback) {
  return values
    .filter(Boolean)
    .reduce((best, value) => (Number(value?.confidence ?? 0) > Number(best?.confidence ?? 0) ? value : best), fallback);
}

export function shouldRunSpecialistVisionChecks(vision) {
  const overlays = Array.isArray(vision?.overlays) ? vision.overlays : [];
  const delogoCount = overlays.filter((overlay) => overlay?.action === "delogo").length;
  const uncertainAction = overlays.some((overlay) => {
    const confidence = clamp01(overlay?.confidence);
    return ["delogo", "block", "mask_subtitle_band", "unknown"].includes(String(overlay?.action ?? "")) && confidence >= 0.40 && confidence < 0.85;
  });
  const uncertainPlacement = Boolean(vision?.lowerTextRegion?.detected) && clamp01(vision?.subtitlePlacement?.confidence) < 0.78;
  const largeDelogoBox = overlays.some((overlay) => overlay?.action === "delogo" && clamp01(overlay?.box?.w) * clamp01(overlay?.box?.h) >= 0.035);
  const manualReview = String(vision?.renderDecision?.action ?? "") === "manual_review";
  return Boolean(vision?.needsSpecialistReview || manualReview || delogoCount >= 2 || uncertainAction || uncertainPlacement || largeDelogoBox);
}

function mergeVisionAnalyses(primary, specialistResults) {
  const successful = specialistResults.filter((item) => item.ok && item.result).map((item) => item.result);
  const watermarkSpecialist = specialistResults.find((item) => item.ok && item.focus === "watermark" && item.result)?.result ?? null;
  if (successful.length === 0) {
    return {
      ...primary,
      specialistChecks: specialistResults,
    };
  }

  const blockCandidate = [primary, ...successful].find((item) => {
    const decision = item?.renderDecision?.action;
    return item?.shouldBlock || decision === "block";
  });
  const renderDecision = blockCandidate
    ? normalizeRenderDecision({ action: "block", confidence: blockCandidate.confidence, reason: blockCandidate.blockReason || blockCandidate.renderDecision?.reason })
    : pickHighestConfidence(successful.map((item) => item.renderDecision), primary.renderDecision);

  return {
    ...primary,
    confidence: Math.max(primary.confidence, ...successful.map((item) => item.confidence ?? 0)),
    shouldBlock: Boolean(primary.shouldBlock || successful.some((item) => item.shouldBlock || item.renderDecision?.action === "block")),
    shouldSkip: Boolean(primary.shouldSkip || successful.some((item) => item.shouldSkip || item.renderDecision?.action === "block")),
    blockReason: primary.blockReason || successful.find((item) => item.blockReason)?.blockReason || "",
    overlays: mergeOverlays([
      primary.overlays?.filter((overlay) => overlay?.action !== "delogo") ?? [],
      watermarkSpecialist
        ? watermarkSpecialist.overlays?.filter((overlay) => overlay?.action === "delogo") ?? []
        : primary.overlays?.filter((overlay) => overlay?.action === "delogo") ?? [],
      ...successful.map((item) => item.overlays?.filter((overlay) => overlay?.action !== "delogo") ?? []),
    ]),
    existingSubtitles: pickHighestConfidence(successful.map((item) => item.existingSubtitles), primary.existingSubtitles),
    lowerTextRegion: pickHighestConfidence(successful.map((item) => item.lowerTextRegion), primary.lowerTextRegion),
    subtitlePlacement: pickHighestConfidence(successful.map((item) => item.subtitlePlacement), primary.subtitlePlacement),
    renderDecision,
    specialistChecks: specialistResults,
  };
}

async function postVisionPreflight({ apiKey, model, imageBase64, frameBase64s, focus }) {
  const response = await fetchOpenAI(fetch, `${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVisionPreflightRequest({ model, imageBase64, frameBase64s, focus })),
  }, "OpenAI vision");
  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { output_text: rawText };
  }
  if (!response.ok) throw new Error(`OpenAI vision ${response.status}: ${rawText.slice(0, 500)}`);
  return parseVisionWatermarkResult(extractOutputText(payload));
}

async function postRemovableWatermarkDetection({
  apiKey,
  model,
  frameBase64s,
  inspectionBase64s,
  imageDetail,
  temperature,
  topP,
  maxOutputTokens,
}) {
  const response = await fetchOpenAI(fetch, `${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRemovableWatermarkRequest({
      model,
      frameBase64s,
      inspectionBase64s,
      imageDetail,
      temperature,
      topP,
      maxOutputTokens,
    })),
  }, "OpenAI watermark detection");
  const rawText = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { output_text: rawText };
  }
  if (!response.ok) throw new Error(`OpenAI watermark detection ${response.status}: ${rawText.slice(0, 500)}`);
  return parseRemovableWatermarkResult(extractOutputText(payload));
}

async function safeSpecialistVisionCall(params) {
  try {
    return { ok: true, focus: params.focus, result: await postVisionPreflight(params) };
  } catch (error) {
    return { ok: false, focus: params.focus, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function analyzeWatermarkContactSheet({ apiKey, model = "gpt-5.4-mini", imagePath, framePath = "", framePaths = [], specialistMode = "auto", includeContactSheet = false }) {
  const contactSheetBase64 = imagePath ? (await readFile(imagePath)).toString("base64") : "";
  const imageBase64 = includeContactSheet ? contactSheetBase64 : "";
  const allFramePaths = framePaths.length > 0 ? framePaths : [framePath].filter(Boolean);
  const frameBase64s = await Promise.all(allFramePaths.map(async (path) => (await readFile(path)).toString("base64")));
  const mode = String(specialistMode || "auto").toLowerCase();
  if (mode === "always") {
    const [primary, ...specialistResults] = await Promise.all([
      postVisionPreflight({ apiKey, model, imageBase64, frameBase64s, focus: "general" }),
      ...["watermark", "subtitles", "placement"].map((focus) => safeSpecialistVisionCall({
        apiKey,
        model,
        imageBase64: focus === "watermark" ? contactSheetBase64 : imageBase64,
        frameBase64s,
        focus,
      })),
    ]);
    return mergeVisionAnalyses(primary, specialistResults);
  }

  const primary = await postVisionPreflight({ apiKey, model, imageBase64, frameBase64s, focus: "general" });
  const runSpecialists = mode === "always" || (mode === "auto" && shouldRunSpecialistVisionChecks(primary));
  if (!runSpecialists || mode === "off") {
    return { ...primary, specialistChecks: [] };
  }

  const specialistResults = await Promise.all(["watermark", "subtitles", "placement"].map((focus) => safeSpecialistVisionCall({
    apiKey,
    model,
    imageBase64: focus === "watermark" ? contactSheetBase64 : imageBase64,
    frameBase64s,
    focus,
  })));
  return mergeVisionAnalyses(primary, specialistResults);
}

export async function analyzeRemovableWatermarks({
  apiKey,
  model = "gpt-5.4-mini",
  framePath = "",
  framePaths = [],
  inspectionPaths = [],
  imageDetail = "high",
  temperature = 0,
  topP = null,
  maxOutputTokens = 1200,
}) {
  const allFramePaths = framePaths.length > 0 ? framePaths : [framePath].filter(Boolean);
  const frameBase64s = await Promise.all(allFramePaths.map(async (path) => (await readFile(path)).toString("base64")));
  const inspectionBase64s = await Promise.all(inspectionPaths.map(async (path) => (await readFile(path)).toString("base64")));
  return await postRemovableWatermarkDetection({
    apiKey,
    model,
    frameBase64s,
    inspectionBase64s,
    imageDetail,
    temperature,
    topP,
    maxOutputTokens,
  });
}

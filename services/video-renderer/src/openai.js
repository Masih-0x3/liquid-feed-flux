import { readFile, stat } from "node:fs/promises";
import { normalizedLanguage } from "./openaiSubtitles.js";
export {
  buildTranscriptCleanupRequest,
  buildTranslationRepairRequest,
  buildTranslationRequest,
  cleanupTranscriptSegments,
  translateSegments,
} from "./openaiSubtitles.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 25 * 1024 * 1024;

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

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
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
export {
  analyzeRemovableWatermarks,
  analyzeWatermarkContactSheet,
  buildRemovableWatermarkRequest,
  buildVisionPreflightRequest,
  parseRemovableWatermarkResult,
  parseVisionWatermarkResult,
  shouldRunSpecialistVisionChecks,
} from "./openaiVision.js";

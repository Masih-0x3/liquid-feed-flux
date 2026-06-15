import { buildAudioWindowExtractCommand, buildEnhancedAudioExtractCommand, runCommand } from "./ffmpeg.js";
import { markEnhancedAudioRetry, shouldRetryWithEnhancedAudio, transcribeAudio } from "./transcription.js";

function timedSegments(transcription) {
  return Array.isArray(transcription?.segments) ? transcription.segments : [];
}

function firstCueStart(transcription) {
  const starts = timedSegments(transcription)
    .map((segment) => Number(segment?.start))
    .filter(Number.isFinite);
  return starts.length ? Math.min(...starts) : null;
}

function isDeepgramNoTimedSegmentsReason(reason) {
  return /deepgram transcription returned no timed segments|returned no timed segments/i.test(String(reason ?? ""));
}

function normalizedLanguage(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("fa") || raw.includes("persian") || raw.includes("farsi")) return "fa";
  if (raw.startsWith("he") || raw.includes("hebrew")) return "he";
  if (raw.startsWith("ar") || raw.includes("arabic")) return "ar";
  if (raw.startsWith("en") || raw.includes("english")) return "en";
  if (raw.startsWith("multi")) return "multi";
  return raw.split("-")[0].slice(0, 12);
}

function earlyRescueLanguage(transcription, transcriptionOptions = {}) {
  const detected = normalizedLanguage(transcription?.language);
  if (detected) return detected;
  return normalizedLanguage(transcriptionOptions.deepgramLanguage ?? transcriptionOptions.language);
}

function buildEarlyRescueTranscriptionOptions(transcription, transcriptionOptions, audioPath, durationMs) {
  const language = earlyRescueLanguage(transcription, transcriptionOptions);
  const options = {
    ...transcriptionOptions,
    audioPath,
    durationMs,
    rejectWeakSpeech: false,
  };
  if (language && String(options.provider ?? "deepgram").toLowerCase() === "deepgram") {
    options.deepgramLanguage = language;
    options.deepgramLanguageFallbacks = [language];
    options.deepgramDetectLanguage = false;
  }
  return options;
}

function mergeEarlySegments(transcription, earlyTranscription, firstStart, options = {}) {
  const maxEnd = Number(firstStart) - Number(options.overlapToleranceSeconds ?? 0.2);
  const earlySegments = timedSegments(earlyTranscription)
    .filter((segment) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      return Number.isFinite(start) && Number.isFinite(end) && end > start && end <= maxEnd;
    });
  if (earlySegments.length === 0) return transcription;

  const mergedSegments = [...earlySegments, ...timedSegments(transcription)]
    .sort((a, b) => Number(a.start) - Number(b.start))
    .map((segment, index) => ({ ...segment, id: index + 1 }));
  const existingLanguage = normalizedLanguage(transcription?.language);
  const earlyLanguage = normalizedLanguage(earlyTranscription?.language);
  return {
    ...transcription,
    language: existingLanguage && existingLanguage !== "und" ? transcription.language : (earlyLanguage || transcription.language),
    segments: mergedSegments,
    earlyTranscriptRescue: true,
    earlyTranscriptRescueProvider: earlyTranscription?.provider ?? null,
    earlyTranscriptRescueModel: earlyTranscription?.model ?? null,
    earlyTranscriptRescueSegmentCount: earlySegments.length,
    earlyTranscriptRescueFirstCueStart: firstStart,
  };
}

async function rescueEarlyTranscriptGap({
  inputPath,
  transcription,
  transcriptionOptions,
  earlyAudioPath,
  enabled = true,
  minFirstCueStartSeconds = 8,
  windowSeconds = 14,
  runEarlyAudioExtract = (command) => runCommand(command, { label: "audio_extract_early" }),
  runTranscription = (options) => transcribeAudio(options),
} = {}) {
  if (enabled === false || !earlyAudioPath || !inputPath) return transcription;
  if (timedSegments(transcription).length === 0) return transcription;
  const firstStart = firstCueStart(transcription);
  if (!Number.isFinite(firstStart) || firstStart < Number(minFirstCueStartSeconds)) return transcription;

  await runEarlyAudioExtract(buildAudioWindowExtractCommand(inputPath, earlyAudioPath, {
    startSeconds: 0,
    durationSeconds: windowSeconds,
  }));
  const early = await runTranscription(buildEarlyRescueTranscriptionOptions(
    transcription,
    transcriptionOptions,
    earlyAudioPath,
    Number(windowSeconds) * 1000,
  ), "transcription_early");
  return mergeEarlySegments(transcription, early, firstStart);
}

export async function transcribeWithEnhancedAudioRetry({
  inputPath,
  audioPath,
  enhancedAudioPath,
  earlyAudioPath,
  transcriptionOptions = {},
  enabled = true,
  earlyTranscriptRescueEnabled = true,
  earlyTranscriptMinFirstCueStartSeconds = 8,
  earlyTranscriptWindowSeconds = 14,
  runEnhancedAudioExtract = (command) => runCommand(command, { label: "audio_extract_enhanced" }),
  runEarlyAudioExtract = (command) => runCommand(command, { label: "audio_extract_early" }),
  runTranscription = (options) => transcribeAudio(options),
} = {}) {
  const first = await runTranscription({ ...transcriptionOptions, audioPath }, "transcription");
  if (!shouldRetryWithEnhancedAudio(first, { enabled })) {
    return rescueEarlyTranscriptGap({
      inputPath,
      transcription: first,
      transcriptionOptions,
      earlyAudioPath,
      enabled: earlyTranscriptRescueEnabled,
      minFirstCueStartSeconds: earlyTranscriptMinFirstCueStartSeconds,
      windowSeconds: earlyTranscriptWindowSeconds,
      runEarlyAudioExtract,
      runTranscription,
    });
  }

  const retryReason = first.noUsableSpeechReason ?? first.fallbackReason ?? "weak Deepgram speech detection";
  await runEnhancedAudioExtract(buildEnhancedAudioExtractCommand(inputPath, enhancedAudioPath));
  const retryOptions = { ...transcriptionOptions, audioPath: enhancedAudioPath };
  if (isDeepgramNoTimedSegmentsReason(retryReason)) {
    retryOptions.fallbackProvider = "";
  }
  const retry = await runTranscription(retryOptions, "transcription_enhanced");
  const enhanced = markEnhancedAudioRetry(retry, retryReason);
  return rescueEarlyTranscriptGap({
    inputPath,
    transcription: enhanced,
    transcriptionOptions,
    earlyAudioPath,
    enabled: earlyTranscriptRescueEnabled,
    minFirstCueStartSeconds: earlyTranscriptMinFirstCueStartSeconds,
    windowSeconds: earlyTranscriptWindowSeconds,
    runEarlyAudioExtract,
    runTranscription,
  });
}

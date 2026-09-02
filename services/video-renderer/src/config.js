import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRenderConcurrency,
  parseRenderShutdownGraceMs,
} from "./rendererCapacity.js";

export {
  DEFAULT_RENDER_CONCURRENCY,
  DEFAULT_RENDER_SHUTDOWN_GRACE_MS,
  MAX_RENDER_CONCURRENCY,
  MAX_RENDER_SHUTDOWN_GRACE_MS,
  MIN_RENDER_SHUTDOWN_GRACE_MS,
  parseRenderConcurrency,
  parseRenderShutdownGraceMs,
} from "./rendererCapacity.js";

export const DEFAULT_RENDER_VERSION = "persian-subtitles-masihh-v1";
export const DEFAULT_TESSERACT_LANG = "eng+fas+ara+heb";
export const DEFAULT_OPENCV_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../scripts/opencv_inpaint_pipe.py");

function parseCsv(value, fallback = []) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function numberFromEnv(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveInterval(value, fallback, minimum) {
  return Math.max(minimum, numberFromEnv(value, fallback));
}

export function parseRenderPollingEnabled(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function parseRenderQueueCutoffAt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function normalizeTesseractLang(value) {
  return String(value || DEFAULT_TESSERACT_LANG).trim() || DEFAULT_TESSERACT_LANG;
}

export function normalizeRendererToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isAuthorizedRendererRequest(headers, token) {
  const expected = normalizeRendererToken(token);
  if (!expected) return false;
  return headers?.authorization === `Bearer ${expected}`;
}

export function loadConfigFromEnv(env = process.env) {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"];
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
  const transcriptionProvider = env.TRANSCRIPTION_PROVIDER || "deepgram";
  if (transcriptionProvider === "deepgram" && !env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is required when TRANSCRIPTION_PROVIDER=deepgram");
  }
  return {
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    workDir: env.WORK_DIR || "/tmp/xot-video-renderer",
    rendererId: env.RENDERER_ID || `renderer-${process.pid}`,
    renderVersion: env.RENDER_VERSION || DEFAULT_RENDER_VERSION,
    transcriptionProvider,
    transcriptionFallbackProvider: env.TRANSCRIPTION_FALLBACK_PROVIDER || "",
    enhancedAudioRetry: env.ENHANCED_AUDIO_RETRY !== "0",
    earlyTranscriptRescue: env.EARLY_TRANSCRIPT_RESCUE !== "0",
    earlyTranscriptMinFirstCueStartSeconds: numberFromEnv(env.EARLY_TRANSCRIPT_MIN_FIRST_CUE_START_SECONDS, 8),
    earlyTranscriptWindowSeconds: numberFromEnv(env.EARLY_TRANSCRIPT_WINDOW_SECONDS, 14),
    deepgramApiKey: env.DEEPGRAM_API_KEY || "",
    deepgramModel: env.DEEPGRAM_MODEL || "nova-3",
    deepgramLanguage: env.DEEPGRAM_LANGUAGE || "",
    deepgramLanguageFallbacks: parseCsv(env.DEEPGRAM_LANGUAGE_FALLBACKS, ["multi", "en", "fa", "he", "ar"]),
    deepgramDetectLanguage: env.DEEPGRAM_DETECT_LANGUAGE !== "0",
    transcriptionModel: env.SUBTITLE_TRANSCRIBE_MODEL || "gpt-4o-transcribe-diarize",
    fallbackTranscriptionModel: env.SUBTITLE_FALLBACK_TRANSCRIBE_MODEL || "whisper-1",
    cleanupModel: env.SUBTITLE_CLEANUP_MODEL || env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
    enableTranscriptCleanup: env.ENABLE_TRANSCRIPT_CLEANUP !== "0",
    translationModel: env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
    visionModel: env.WATERMARK_VISION_MODEL || env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
    watermarkVisionTemperature: numberFromEnv(env.WATERMARK_VISION_TEMPERATURE ?? 0, 0),
    watermarkVisionTopP: env.WATERMARK_VISION_TOP_P ? numberFromEnv(env.WATERMARK_VISION_TOP_P, null) : null,
    watermarkVisionMaxOutputTokens: numberFromEnv(env.WATERMARK_VISION_MAX_OUTPUT_TOKENS, 1200),
    watermarkVisionFrameWidth: numberFromEnv(env.WATERMARK_VISION_FRAME_WIDTH, 1440),
    watermarkVisionImageDetail: env.WATERMARK_VISION_IMAGE_DETAIL || "high",
    watermarkInspectionTileWidth: numberFromEnv(env.WATERMARK_INSPECTION_TILE_WIDTH, 720),
    watermarkInspectionTileHeight: numberFromEnv(env.WATERMARK_INSPECTION_TILE_HEIGHT, 360),
    enableWatermarkVisualRecovery: env.ENABLE_WATERMARK_VISUAL_RECOVERY !== "0",
    enableVisionPreflight: env.ENABLE_OPENAI_VISION_PREFLIGHT !== "0",
    visionSpecialistMode: env.VISION_SPECIALIST_MODE || "always",
    includeContactSheetInVision: env.INCLUDE_CONTACT_SHEET_IN_VISION === "1",
    enableAdaptiveSubtitleMask: env.ENABLE_ADAPTIVE_SUBTITLE_MASK === "1",
    watermarkBlockThreshold: numberFromEnv(env.WATERMARK_BLOCK_THRESHOLD, 0.85),
    watermarkUncertainThreshold: numberFromEnv(env.WATERMARK_UNCERTAIN_THRESHOLD, 0.60),
    blockUncertainWatermarks: env.BLOCK_UNCERTAIN_WATERMARKS !== "0",
    maxDelogoRegions: numberFromEnv(env.MAX_DELOGO_REGIONS, 2),
    maxSingleDelogoAreaRatio: numberFromEnv(env.MAX_SINGLE_DELOGO_AREA_RATIO, 0.10),
    maxTotalDelogoAreaRatio: numberFromEnv(env.MAX_TOTAL_DELOGO_AREA_RATIO, 0.15),
    minWatermarkOnlyConfidence: numberFromEnv(env.MIN_WATERMARK_ONLY_CONFIDENCE, 0.85),
    watermarkBoxPadRatio: numberFromEnv(env.WATERMARK_BOX_PAD_RATIO, 0),
    watermarkBoxHorizontalDilation: numberFromEnv(env.WATERMARK_BOX_HORIZONTAL_DILATION, 0),
    watermarkBoxVerticalDilation: numberFromEnv(env.WATERMARK_BOX_VERTICAL_DILATION, 0),
    crf: numberFromEnv(env.OUTPUT_CRF, 20),
    preset: env.OUTPUT_PRESET || "fast",
    maxOutputBytes: numberFromEnv(env.MAX_OUTPUT_BYTES, 49_000_000),
    outputRetryCrfStep: numberFromEnv(env.OUTPUT_SIZE_RETRY_CRF_STEP, 4),
    maxOutputRetryCrf: numberFromEnv(env.MAX_OUTPUT_RETRY_CRF, 30),
    delogoCrf: numberFromEnv(env.DELOGO_OUTPUT_CRF || env.OUTPUT_CRF, 18),
    delogoPreset: env.DELOGO_OUTPUT_PRESET || env.OUTPUT_PRESET || "fast",
    delogoEngine: env.DELOGO_ENGINE || "opencv",
    opencvPython: env.OPENCV_PYTHON || "python3",
    opencvScript: env.OPENCV_INPAINT_SCRIPT || DEFAULT_OPENCV_SCRIPT,
    opencvMode: env.OPENCV_INPAINT_MODE || "hybrid",
    opencvAlgorithm: env.OPENCV_INPAINT_ALGORITHM || "telea",
    opencvRadius: numberFromEnv(env.OPENCV_INPAINT_RADIUS, 2),
    opencvKernel: numberFromEnv(env.OPENCV_INPAINT_KERNEL, 7),
    opencvDilateIterations: numberFromEnv(env.OPENCV_INPAINT_DILATE_ITERATIONS, 2),
    opencvCloseIterations: numberFromEnv(env.OPENCV_INPAINT_CLOSE_ITERATIONS, 1),
    opencvFeather: numberFromEnv(env.OPENCV_INPAINT_FEATHER, 0),
    threads: numberFromEnv(env.FFMPEG_THREADS, 3),
    fontsDir: env.FONTS_DIR || "/usr/share/fonts",
    bucket: env.MEDIA_BUCKET || "temp-media",
    tesseractLang: normalizeTesseractLang(env.TESSERACT_LANG),
    keepPreflightWorkdir: env.KEEP_PREFLIGHT_WORKDIR === "1",
  };
}

export function loadServerRuntimeFromEnv(env = process.env) {
  const renderQueueCutoffAt = parseRenderQueueCutoffAt(env.RENDER_QUEUE_CUTOFF_AT);
  const renderPollingEnabled = parseRenderPollingEnabled(env.RENDER_POLLING_ENABLED);
  const renderQueueCutoffValid = renderQueueCutoffAt !== null;
  const renderPollingEffective = renderPollingEnabled && renderQueueCutoffValid;
  const renderPollingBlockReason = renderPollingEnabled && !renderQueueCutoffValid
    ? "missing_or_invalid_render_queue_cutoff_at"
    : null;
  return {
    token: normalizeRendererToken(env.VIDEO_RENDERER_TOKEN ?? ""),
    port: numberFromEnv(env.PORT, 8787),
    pollIntervalMs: positiveInterval(env.POLL_INTERVAL_MS, 5000, 1000),
    heartbeatIntervalMs: positiveInterval(env.HEARTBEAT_INTERVAL_MS, 30000, 5000),
    renderConcurrency: parseRenderConcurrency(env.RENDER_CONCURRENCY),
    shutdownGraceMs: parseRenderShutdownGraceMs(env.RENDER_SHUTDOWN_GRACE_MS),
    renderQueueCutoffAt,
    renderQueueCutoffValid,
    renderPollingEnabled,
    renderPollingEffective,
    renderPollingBlockReason,
    renderQueueCutoffBlockReason: renderPollingBlockReason,
    version: env.npm_package_version || "0.1.0",
  };
}

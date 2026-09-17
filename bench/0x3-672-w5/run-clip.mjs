// 0X3-672 W5 benchmark: drive one synthetic clip through the real
// processRenderRow with all external services stubbed. Local stages
// (ffprobe, ffmpeg, tesseract) run for real; provider HTTP is answered by
// deterministic stubs with fixed latency.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { createStubFetch } from "./stub-fetch.mjs";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const rendererSrc = arg("src");
const cohortDir = arg("cohort", "/bench/cohort");
const clipName = arg("clip");
const workRoot = arg("workdir", "/bench/work");
const outDir = arg("out", "/bench/out");

if (!rendererSrc || !clipName) {
  console.error("usage: run-clip.mjs --src <renderer-src-dir> --clip <clip-name> [--cohort dir] [--workdir dir] [--out dir]");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(join(cohortDir, "manifest.json"), "utf8"));
const clip = manifest.clips.find((entry) => entry.name === clipName);
if (!clip) throw new Error(`clip ${clipName} not in manifest`);

const providerCalls = [];
globalThis.fetch = createStubFetch(providerCalls);

const uploadDir = join(outDir, clipName);
await mkdir(uploadDir, { recursive: true });

const media = {
  id: `media-${clipName}`,
  tweet_id: `tw-${clipName}`,
  storage_path: clip.file,
  mime_type: "video/mp4",
  file_size: clip.bytes,
  duration_ms: Math.round(clip.duration_s * 1000),
  width: clip.width,
  height: clip.height,
};
const post = {
  text_original: `Benchmark fixture ${clipName}: a synthetic talking-head news clip.`,
  text_translated: null,
  author_handle: "@xot_bench",
  url: `https://x.com/xot_bench/status/${clipName}`,
};
const supabase = createFakeSupabase({ cohortDir, uploadDir, media, post });

const workDir = join(workRoot, clipName);
await mkdir(workDir, { recursive: true });

const config = {
  supabaseUrl: "https://bench.invalid",
  supabaseServiceRoleKey: "bench",
  openaiApiKey: "bench-openai",
  workDir,
  rendererId: `bench-renderer-${clipName}`,
  renderVersion: "bench-v1",
  transcriptionProvider: "deepgram",
  transcriptionFallbackProvider: "",
  enhancedAudioRetry: true,
  earlyTranscriptRescue: true,
  earlyTranscriptMinFirstCueStartSeconds: 8,
  earlyTranscriptWindowSeconds: 14,
  deepgramApiKey: "bench-deepgram",
  deepgramModel: "nova-3",
  deepgramLanguage: "",
  deepgramLanguageFallbacks: ["multi", "en", "fa", "he", "ar"],
  deepgramDetectLanguage: true,
  transcriptionModel: "gpt-4o-transcribe-diarize",
  fallbackTranscriptionModel: "whisper-1",
  cleanupModel: "gpt-5.4-mini",
  enableTranscriptCleanup: true,
  translationModel: "gpt-5.4-mini",
  visionModel: "gpt-5.4-mini",
  watermarkVisionTemperature: 0,
  watermarkVisionTopP: null,
  watermarkVisionMaxOutputTokens: 1200,
  watermarkVisionFrameWidth: 1440,
  watermarkVisionImageDetail: "high",
  watermarkInspectionTileWidth: 720,
  watermarkInspectionTileHeight: 360,
  enableWatermarkVisualRecovery: true,
  enableVisionPreflight: true,
  visionSpecialistMode: "always",
  includeContactSheetInVision: false,
  enableAdaptiveSubtitleMask: false,
  watermarkBlockThreshold: 0.85,
  watermarkUncertainThreshold: 0.60,
  blockUncertainWatermarks: true,
  maxDelogoRegions: 2,
  maxSingleDelogoAreaRatio: 0.10,
  maxTotalDelogoAreaRatio: 0.15,
  minWatermarkOnlyConfidence: 0.85,
  watermarkBoxPadRatio: 0,
  watermarkBoxHorizontalDilation: 0,
  watermarkBoxVerticalDilation: 0,
  crf: 20,
  preset: "fast",
  maxOutputBytes: 49_000_000,
  outputRetryCrfStep: 4,
  maxOutputRetryCrf: 30,
  delogoCrf: 18,
  delogoPreset: "fast",
  delogoEngine: "opencv",
  opencvPython: "python3",
  opencvScript: "/app/scripts/opencv_inpaint.py",
  opencvMode: "hybrid",
  opencvAlgorithm: "telea",
  opencvRadius: 2,
  opencvKernel: 7,
  opencvDilateIterations: 2,
  opencvCloseIterations: 1,
  opencvFeather: 0,
  threads: 3,
  fontsDir: process.env.BENCH_FONTS_DIR || "/usr/share/fonts/truetype/dejavu",
  bucket: "temp-media",
  tesseractLang: "eng",
  keepPreflightWorkdir: false,
};

const row = {
  id: `render-${clipName}`,
  tweet_id: media.tweet_id,
  source_media_id: media.id,
  claim_token: `bench-token-${clipName}`,
  claim_generation: 1,
};

const { processRenderRow } = await import(pathToFileURL(join(rendererSrc, "renderer.js")).href);

const started = Date.now();
let result;
let errorMessage = null;
try {
  result = await processRenderRow({ supabase, row, config });
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}
const totalMs = Date.now() - started;

const report = {
  clip: clipName,
  ok: Boolean(result?.ok) && !errorMessage,
  blocked: result?.blocked === true,
  error: errorMessage,
  total_ms: totalMs,
  metrics: result?.metrics ?? null,
  provider_calls: providerCalls,
  uploads: supabase.uploads.map((u) => ({ path: u.path, bytes: u.bytes, contentType: u.contentType })),
};

await writeFile(join(outDir, `${clipName}.result.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  clip: clipName,
  ok: report.ok,
  blocked: report.blocked,
  error: report.error,
  total_ms: totalMs,
}));

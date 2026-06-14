import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { buildAudioExtractCommand, buildContactSheetCommand, buildFrameSampleCommand, buildOpenCvInpaintRenderCommand, buildRenderCommand, buildWatermarkInspectionSheetCommand, probeVideo, runCommand } from "./ffmpeg.js";
import { analyzeRemovableWatermarks, cleanupTranscriptSegments, detectLanguageFromTranscription, translateSegments } from "./openai.js";
import { decidePreflightBlock, decideWatermarkOnlyBlock, delogoRegionsFromWatermarkOnly, evaluateDelogoPlan, normalizeLanguage, normalizeWatermarkOnlyDecision, recoverDelogoRegions, runOptionalOcr, runVisualPreflight, scoreWatermarkSignals, selectDelogoRegions, selectTargetLanguage, subtitlePlacementFromVision, visionFromWatermarkOnly } from "./preflight.js";
import { resolveRenderEffects } from "./renderEffects.js";
import { applyRenderSettings, loadRenderSettingsOrDefault } from "./settings.js";
import { hasUsableSubtitleText, sanitizeSubtitleSegments, segmentsToAss, segmentsToSrt, splitLongSubtitleSegments } from "./subtitles.js";
import { transcribeAudio } from "./transcription.js";
import { transcribeWithEnhancedAudioRetry } from "./transcriptionPipeline.js";

export { loadConfigFromEnv } from "./config.js";

export function createSupabase(config) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });
}

async function measure(metrics, name, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    metrics[`${name}_ms`] = Date.now() - started;
  }
}

function processedPathFor(row, renderVersion) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeTweetId = String(row.tweet_id).replace(/[^A-Za-z0-9_-]/g, "_");
  return `processed/${renderVersion}/${yyyy}/${mm}/${safeTweetId}/${row.id}.mp4`;
}

async function writeBlobToFile(blob, path) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(path, buffer);
  return buffer.byteLength;
}

async function maybeInvokePostingFunctions(supabase, rpcResult, tweetId) {
  const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  if (!result || typeof result !== "object") return;
  if (result.queued_deliver) {
    await supabase.functions.invoke("worker", {
      body: { trigger: "video-renderer", job_types: ["deliver"], batch_size: 1, target_tweet_id: tweetId },
    }).catch(() => null);
  }
  if (result.dispatch_x) {
    await supabase.functions.invoke("x-poster", {
      body: { source: "video-renderer", target_tweet_id: tweetId },
    }).catch(() => null);
  }
}

async function loadRenderSource(supabase, row) {
  const { data, error } = await supabase
    .from("media")
    .select("id, tweet_id, storage_path, mime_type, file_size, duration_ms, width, height")
    .eq("id", row.source_media_id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.storage_path) throw new Error(`source media ${row.source_media_id} has no storage_path`);
  return data;
}

function compactContextText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
}

async function loadPostContextText(supabase, tweetId) {
  const { data, error } = await supabase
    .from("posts")
    .select("text_original, text_translated, author_handle, url")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error) return "";
  return compactContextText([
    data?.author_handle ? `Author: ${data.author_handle}` : "",
    data?.text_original ? `Post: ${data.text_original}` : "",
    data?.text_translated ? `Existing translated post: ${data.text_translated}` : "",
    data?.url ? `URL: ${data.url}` : "",
  ].filter(Boolean).join("\n"));
}

function subtitleContextText({ postContext, preflight }) {
  return compactContextText([
    postContext ? `Post context: ${postContext}` : "",
    preflight?.ocr?.text ? `Visible OCR text: ${preflight.ocr.text}` : "",
    preflight?.watermarkOnly?.reason ? `Visual note: ${preflight.watermarkOnly.reason}` : "",
  ].filter(Boolean).join("\n"));
}

function resolveSourceLanguage(transcription) {
  const language = String(transcription?.language ?? "").toLowerCase();
  if (language && language !== "und" && language !== "multi") return transcription.language;
  return detectLanguageFromTranscription(transcription?.raw);
}

function sourceSrtLanguage(sourceLanguage) {
  return normalizeLanguage(sourceLanguage) === "fa" ? "fa" : "en";
}

function shouldRequireLocalDelogoCoordinates(watermarkOnly, vision = null) {
  const action = String(vision?.renderDecision?.action ?? watermarkOnly?.decision ?? "render");
  return action === "render_with_delogo";
}

function watermarkProtectedRegions(preflight) {
  const regions = [];
  const push = (value) => {
    const box = value?.box && typeof value.box === "object" ? value.box : value;
    if (!box || box.valid === false) return;
    const values = [box.x, box.y, box.w, box.h].map(Number);
    if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) return;
    regions.push(box);
  };
  for (const overlay of preflight?.vision?.overlays ?? []) {
    if (["keep", "avoid", "mask_subtitle_band"].includes(String(overlay?.action ?? ""))) push(overlay);
  }
  if (preflight?.vision?.existingSubtitles?.detected) push(preflight.vision.existingSubtitles);
  if (preflight?.vision?.lowerTextRegion?.detected) push(preflight.vision.lowerTextRegion);
  return regions;
}

function preflightOptions(config) {
  return {
    watermarkBlockThreshold: config.watermarkBlockThreshold,
    watermarkUncertainThreshold: config.watermarkUncertainThreshold,
    blockUncertainWatermarks: config.blockUncertainWatermarks,
    maxDelogoRegions: config.maxDelogoRegions,
    maxSingleDelogoAreaRatio: config.maxSingleDelogoAreaRatio,
    maxTotalDelogoAreaRatio: config.maxTotalDelogoAreaRatio,
    minWatermarkOnlyConfidence: config.minWatermarkOnlyConfidence,
    watermarkBoxPadRatio: config.watermarkBoxPadRatio,
    watermarkBoxHorizontalDilation: config.watermarkBoxHorizontalDilation,
    watermarkBoxVerticalDilation: config.watermarkBoxVerticalDilation,
  };
}

function hasAudioStream(probe) {
  return (probe?.raw?.streams ?? []).some((stream) => stream?.codec_type === "audio");
}

function visionFrameSeekSeconds(metrics) {
  const durationSeconds = Math.max(0, Number(metrics.duration_ms ?? 0) / 1000);
  if (!durationSeconds) return 1;
  return Math.min(Math.max(1, durationSeconds * 0.35), Math.max(1, durationSeconds - 1));
}

function visionFrameSeekTimes(metrics) {
  const durationSeconds = Math.max(0, Number(metrics.duration_ms ?? 0) / 1000);
  if (!durationSeconds || durationSeconds <= 2) return [1];
  const upper = Math.max(1, durationSeconds - 1);
  const candidates = [durationSeconds * 0.18, durationSeconds * 0.5, durationSeconds * 0.82]
    .map((value) => Math.min(Math.max(1, value), upper));
  return [...new Set(candidates.map((value) => Math.round(value * 10) / 10))].slice(0, 3);
}

function probeFrameRate(probe) {
  const video = (probe?.raw?.streams ?? []).find((stream) => stream?.codec_type === "video") ?? {};
  const value = String(video.r_frame_rate || video.avg_frame_rate || "").trim();
  const [num, den] = value.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) return num / den;
  const direct = Number(value);
  return Number.isFinite(direct) && direct > 0 ? direct : 30;
}

async function blockRender({ supabase, row, reason, preflight, metrics }) {
  const { data, error } = await supabase.rpc("block_video_render", {
    p_render_id: row.id,
    p_reason: reason,
    p_preflight: preflight,
    p_metrics: metrics,
  });
  if (error) throw error;
  await maybeInvokePostingFunctions(supabase, data, row.tweet_id);
  return {
    ok: true,
    blocked: true,
    reason,
    render_id: row.id,
    tweet_id: row.tweet_id,
    preflight,
    metrics,
  };
}

function resolveRenderQuality(effects, config) {
  const hasDelogo = Array.isArray(effects?.delogoRegions) && effects.delogoRegions.length > 0;
  return {
    crf: hasDelogo ? config.delogoCrf : config.crf,
    preset: hasDelogo ? config.delogoPreset : config.preset,
  };
}

async function renderAndComplete({
  supabase,
  row,
  config,
  source,
  inputPath,
  outputPath,
  assPath = null,
  ass = null,
  translatedSrt = null,
  persianSrt = null,
  sourceSegments = null,
  sourceLanguage = null,
  targetLanguage = null,
  preflight,
  metrics,
  probe,
  started,
}) {
  metrics.caption_detection = preflight.hardSubtitles?.raw ?? null;
  const effects = resolveRenderEffects(preflight, config, { hasSubtitleTrack: Boolean(assPath && ass) });
  const nextPreflight = {
    ...preflight,
    processingMode: effects.shouldRender ? "rendered" : "original_unmodified",
    processingReasons: effects.reasons,
    watermarkApplied: effects.shouldWatermark,
  };
  metrics.adaptive_mask = effects.enableAdaptiveMask;
  metrics.delogo_regions = effects.delogoRegions;
  metrics.delogo_plan = preflight.delogoPlan ?? null;
  metrics.subtitle_placement = preflight.subtitlePlacement ?? null;
  metrics.subtitle_track = Boolean(assPath && ass);
  metrics.processing_mode = nextPreflight.processingMode;
  metrics.processing_reasons = effects.reasons;
  let outputBytes = null;
  let outputStoragePath = null;
  if (effects.shouldRender) {
    const quality = resolveRenderQuality(effects, config);
    const useOpenCvDelogo = effects.delogoRegions.length > 0 && config.delogoEngine === "opencv";
    metrics.encode_quality = quality;
    metrics.delogo_engine = effects.delogoRegions.length > 0 ? config.delogoEngine : "none";
    const renderCommand = useOpenCvDelogo ? buildOpenCvInpaintRenderCommand({
      inputPath,
      assPath,
      outputPath,
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      fps: probeFrameRate(probe),
      enableWatermark: effects.shouldWatermark,
      enableAdaptiveMask: effects.enableAdaptiveMask,
      delogoRegions: effects.delogoRegions,
      subtitlePlacement: preflight.subtitlePlacement,
      protectedRegions: watermarkProtectedRegions(preflight),
      subtitleStyleConfig: config.subtitleStyleConfig,
      watermarkConfig: config.watermarkConfig,
      crf: quality.crf,
      preset: quality.preset,
      threads: config.threads,
      fontsDir: config.fontsDir,
      opencvPython: config.opencvPython,
      opencvScript: config.opencvScript,
      opencvMode: config.opencvMode,
      opencvAlgorithm: config.opencvAlgorithm,
      opencvRadius: config.opencvRadius,
      opencvKernel: config.opencvKernel,
      opencvDilateIterations: config.opencvDilateIterations,
      opencvCloseIterations: config.opencvCloseIterations,
      opencvFeather: config.opencvFeather,
    }) : buildRenderCommand({
      inputPath,
      assPath,
      outputPath,
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      enableWatermark: effects.shouldWatermark,
      enableAdaptiveMask: effects.enableAdaptiveMask,
      delogoRegions: effects.delogoRegions,
      subtitlePlacement: preflight.subtitlePlacement,
      protectedRegions: watermarkProtectedRegions(preflight),
      subtitleStyleConfig: config.subtitleStyleConfig,
      watermarkConfig: config.watermarkConfig,
      crf: quality.crf,
      preset: quality.preset,
      threads: config.threads,
      fontsDir: config.fontsDir,
    });
    await measure(metrics, "encode", () => runCommand(renderCommand, { label: useOpenCvDelogo ? "opencv_render" : "render" }));

    outputBytes = await readFile(outputPath);
    outputStoragePath = processedPathFor(row, config.renderVersion);
    await measure(metrics, "upload", async () => {
      const { error } = await supabase.storage.from(config.bucket).upload(outputStoragePath, outputBytes, {
        contentType: "video/mp4",
        upsert: true,
      });
      if (error) throw new Error(`upload ${outputStoragePath}: ${error.message}`);
    });
  }

  const originalSrt = Array.isArray(sourceSegments) && sourceSegments.length > 0 && sourceLanguage
    ? segmentsToSrt(sourceSegments, {
      language: sourceSrtLanguage(sourceLanguage),
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      durationMs: metrics.duration_ms ?? probe.durationMs,
      subtitleStyleConfig: config.subtitleStyleConfig,
    })
    : null;
  metrics.total_ms = Date.now() - started;
  const { data, error } = await supabase.rpc("complete_video_render", {
    p_render_id: row.id,
    p_output_storage_path: outputStoragePath,
    p_output_file_size: outputBytes?.byteLength ?? null,
    p_persian_srt: persianSrt,
    p_original_srt: originalSrt,
    p_ass_subtitles: ass,
    p_metrics: metrics,
    p_duration_ms: metrics.duration_ms,
    p_width: probe.width,
    p_height: probe.height,
    p_source_language: sourceLanguage,
    p_target_language: targetLanguage,
    p_translated_srt: translatedSrt,
    p_preflight: nextPreflight,
  });
  if (error) throw error;
  await maybeInvokePostingFunctions(supabase, data, row.tweet_id);

  return {
    ok: true,
    render_id: row.id,
    tweet_id: row.tweet_id,
    output_storage_path: outputStoragePath,
    original_selected: !effects.shouldRender,
    metrics,
  };
}

async function maybeRunVisionPreflight({ inputPath, workingDir, config, preflight, metrics }) {
  const contactSheetPath = join(workingDir, "contact-sheet.jpg");
  const frameSpecs = visionFrameSeekTimes(metrics).map((seekSeconds, index) => ({
    path: join(workingDir, `vision-frame-${index + 1}.jpg`),
    inspectionPath: join(workingDir, `vision-inspection-${index + 1}.jpg`),
    seekSeconds,
  }));
  await measure(metrics, "contact_sheet", () => runCommand(buildContactSheetCommand(inputPath, contactSheetPath), { label: "contact_sheet" }));
  await measure(metrics, "vision_frames", () => Promise.all(frameSpecs.map((frame) => runCommand(buildFrameSampleCommand(inputPath, frame.path, {
    seekSeconds: frame.seekSeconds,
    width: config.watermarkVisionFrameWidth,
  }), { label: `vision_frame_${frame.seekSeconds}` }))));
  await measure(metrics, "vision_inspection_sheets", () => Promise.all(frameSpecs.map((frame) => runCommand(buildWatermarkInspectionSheetCommand(frame.path, frame.inspectionPath, {
    tileWidth: config.watermarkInspectionTileWidth,
    tileHeight: config.watermarkInspectionTileHeight,
  }), { label: `vision_inspection_${frame.seekSeconds}` }))));
  const ocr = await measure(metrics, "local_ocr", () => runOptionalOcr(contactSheetPath, {
    tesseractLang: config.tesseractLang,
  }));
  let watermarkOnly = null;
  let vision = null;
  if (config.enableVisionPreflight) {
    watermarkOnly = await measure(metrics, "watermark_vision", () => analyzeRemovableWatermarks({
      apiKey: config.openaiApiKey,
      model: config.visionModel,
      framePaths: frameSpecs.map((frame) => frame.path),
      inspectionPaths: frameSpecs.map((frame) => frame.inspectionPath),
      imageDetail: config.watermarkVisionImageDetail,
      temperature: config.watermarkVisionTemperature,
      topP: config.watermarkVisionTopP,
      maxOutputTokens: config.watermarkVisionMaxOutputTokens,
    }));
    watermarkOnly = normalizeWatermarkOnlyDecision(watermarkOnly);
    vision = visionFromWatermarkOnly(watermarkOnly);
  }
  let watermark = scoreWatermarkSignals({
    stableOverlayScore: preflight.overlayDetection?.stableOverlayScore ?? preflight.watermark?.score ?? 0,
    repeatedCornerText: ocr.text ? [ocr.text] : preflight.watermark?.repeatedText ?? [],
    platformMatches: ocr.matches ?? preflight.watermark?.platformMatches ?? [],
    vision,
  });
  const modelDelogoRegions = delogoRegionsFromWatermarkOnly(watermarkOnly, {
    width: metrics.width,
    height: metrics.height,
  }, preflightOptions(config));
  const delogoRecovery = await measure(metrics, "delogo_recovery", () => recoverDelogoRegions({
    framePaths: frameSpecs.map((frame) => frame.path),
    vision,
    dimensions: { width: metrics.width, height: metrics.height },
    existingRegions: [],
    allowVisualRecovery: config.enableWatermarkVisualRecovery,
    tesseractLang: config.tesseractLang,
  }));
  const requireLocalDelogoCoordinates = shouldRequireLocalDelogoCoordinates(watermarkOnly, vision);
  const delogoRegions = selectDelogoRegions({
    recoveredRegions: delogoRecovery.regions,
    modelRegions: modelDelogoRegions,
    requireLocalDelogoCoordinates,
    options: preflightOptions(config),
  });
  const delogoPlan = evaluateDelogoPlan(delogoRegions, {
    width: metrics.width,
    height: metrics.height,
  }, {
    ...preflightOptions(config),
    requireDelogoCoordinates: requireLocalDelogoCoordinates,
  });
  const subtitlePlacement = subtitlePlacementFromVision(vision, {
    width: metrics.width,
    height: metrics.height,
  }, {
    overlayDetection: preflight.overlayDetection,
  });
  const watermarkOnlyBlock = decideWatermarkOnlyBlock(watermarkOnly, delogoPlan);
  const nextPreflight = {
    ...preflight,
    ocr,
    watermark,
    watermarkOnly,
    vision,
    visionFrames: frameSpecs.map((frame) => ({ path: frame.path, seekSeconds: frame.seekSeconds })),
    visionInspectionSheets: frameSpecs.map((frame) => ({ path: frame.inspectionPath, seekSeconds: frame.seekSeconds })),
    modelDelogoRegions,
    delogoRecovery,
    delogoCoordinatePolicy: requireLocalDelogoCoordinates
      ? delogoRecovery.regions.length > 0 ? "local_recovery" : delogoRegions.length > 0 ? "model_fallback" : "local_recovery_required"
      : "none",
    delogoRegions,
    delogoPlan,
    subtitlePlacement,
    contactSheetGenerated: true,
    block: watermarkOnlyBlock.blocked
      ? watermarkOnlyBlock
      : decidePreflightBlock({
        watermark,
        vision,
        delogoRegions,
        delogoPlan,
        hardSubtitles: preflight.hardSubtitles,
        hasUsableSpeech: true,
      }, preflightOptions(config)),
  };
  return nextPreflight;
}

export async function processRenderRow({ supabase, row, config }) {
  const metrics = {};
  const started = Date.now();
  const dbSettings = await measure(metrics, "config_load", () => loadRenderSettingsOrDefault(supabase, metrics));
  const runtimeConfig = applyRenderSettings(config, dbSettings);
  metrics.video_render_config = {
    mode: dbSettings.mode,
    transcription_provider: dbSettings.transcription_provider,
    transcription_model: dbSettings.transcription_model,
    translation_model: dbSettings.translation_model,
    vision_model: dbSettings.vision_model,
  };
  const workingDir = join(runtimeConfig.workDir, row.id);
  await mkdir(workingDir, { recursive: true });

  const inputPath = join(workingDir, "source.mp4");
  const audioPath = join(workingDir, "audio.mp3");
  const enhancedAudioPath = join(workingDir, "audio.enhanced.mp3");
  const earlyAudioPath = join(workingDir, "audio.early.mp3");
  const outputPath = join(workingDir, "rendered.mp4");

  try {
    const source = await measure(metrics, "source_lookup", () => loadRenderSource(supabase, row));
    const postContext = await measure(metrics, "post_context_lookup", () => loadPostContextText(supabase, row.tweet_id));
    metrics.subtitle_context_available = Boolean(postContext);

    await measure(metrics, "download", async () => {
      const { data, error } = await supabase.storage.from(runtimeConfig.bucket).download(source.storage_path);
      if (error || !data) throw new Error(`download ${source.storage_path}: ${error?.message || "no blob"}`);
      metrics.source_bytes = await writeBlobToFile(data, inputPath);
    });

    const probe = await measure(metrics, "probe", () => probeVideo(inputPath));
    metrics.width = probe.width;
    metrics.height = probe.height;
    metrics.duration_ms = probe.durationMs ?? source.duration_ms ?? null;

    let preflight = await measure(metrics, "preflight_visual", () => runVisualPreflight({
      inputPath,
      probe,
      options: preflightOptions(runtimeConfig),
    }));
    preflight = await maybeRunVisionPreflight({ inputPath, workingDir, config: runtimeConfig, preflight, metrics });
    metrics.preflight = preflight;
    if (preflight.block?.blocked) {
      metrics.total_ms = Date.now() - started;
      return await blockRender({ supabase, row, reason: preflight.block.reason, preflight, metrics });
    }

    if (!hasAudioStream(probe)) {
      preflight = {
        ...preflight,
        hasUsableSpeech: false,
        subtitleMode: "none",
        noSubtitleReason: "no_audio_stream",
        block: { blocked: false, reason: null },
      };
      metrics.no_subtitle_reason = "no_audio_stream";
      return await renderAndComplete({
        supabase,
        row,
        config: runtimeConfig,
        source,
        inputPath,
        outputPath,
        preflight,
        metrics,
        probe,
        started,
      });
    }

    await measure(metrics, "audio_extract", () => runCommand(buildAudioExtractCommand(inputPath, audioPath), { label: "audio_extract" }));

    const contextText = subtitleContextText({ postContext, preflight });
    const transcription = await transcribeWithEnhancedAudioRetry({
      inputPath,
      audioPath,
      enhancedAudioPath,
      earlyAudioPath,
      enabled: runtimeConfig.enhancedAudioRetry,
      earlyTranscriptRescueEnabled: runtimeConfig.earlyTranscriptRescue,
      earlyTranscriptMinFirstCueStartSeconds: runtimeConfig.earlyTranscriptMinFirstCueStartSeconds,
      earlyTranscriptWindowSeconds: runtimeConfig.earlyTranscriptWindowSeconds,
      transcriptionOptions: {
        provider: runtimeConfig.transcriptionProvider,
        fallbackProvider: runtimeConfig.transcriptionFallbackProvider,
        deepgramApiKey: runtimeConfig.deepgramApiKey,
        deepgramModel: runtimeConfig.deepgramModel,
        deepgramLanguage: runtimeConfig.deepgramLanguage,
        deepgramLanguageFallbacks: runtimeConfig.deepgramLanguageFallbacks,
        deepgramDetectLanguage: runtimeConfig.deepgramDetectLanguage,
        openaiApiKey: runtimeConfig.openaiApiKey,
        openaiModel: runtimeConfig.transcriptionModel,
        openaiFallbackModel: runtimeConfig.fallbackTranscriptionModel,
        durationMs: metrics.duration_ms,
        contextText,
      },
      runEnhancedAudioExtract: (command) => measure(metrics, "audio_extract_enhanced", () => runCommand(command, { label: "audio_extract_enhanced" })),
      runEarlyAudioExtract: (command) => measure(metrics, "audio_extract_early", () => runCommand(command, { label: "audio_extract_early" })),
      runTranscription: (options, label) => measure(metrics, label, () => transcribeAudio(options)),
    });
    metrics.transcription_provider = transcription.provider ?? runtimeConfig.transcriptionProvider;
    metrics.transcription_model = transcription.model;
    metrics.transcription_fallback = transcription.fallback === true;
    metrics.transcription_fallback_reason = transcription.fallbackReason ?? null;
    metrics.enhanced_audio_retry = transcription.enhancedAudioRetry === true;
    metrics.enhanced_audio_retry_reason = transcription.enhancedAudioRetryReason ?? null;
    metrics.early_transcript_rescue = transcription.earlyTranscriptRescue === true;
    metrics.early_transcript_rescue_segment_count = transcription.earlyTranscriptRescueSegmentCount ?? 0;
    metrics.early_transcript_rescue_first_cue_start = transcription.earlyTranscriptRescueFirstCueStart ?? null;
    metrics.deepgram_attempted_languages = transcription.attemptedLanguages ?? null;
    metrics.language_confidence = transcription.languageConfidence ?? null;
    metrics.segment_count = transcription.segments.length;
    if (transcription.segments.length === 0) {
      preflight = {
        ...preflight,
        hasUsableSpeech: false,
        subtitleMode: "none",
        noSubtitleReason: "no_usable_speech",
        block: { blocked: false, reason: null },
      };
      metrics.no_subtitle_reason = "no_usable_speech";
      return await renderAndComplete({
        supabase,
        row,
        config: runtimeConfig,
        source,
        inputPath,
        outputPath,
        preflight,
        metrics,
        probe,
        started,
      });
    }
    const timedSourceSegments = sanitizeSubtitleSegments(transcription.segments, { durationMs: metrics.duration_ms });
    if (!hasUsableSubtitleText(timedSourceSegments)) {
      preflight = {
        ...preflight,
        hasUsableSpeech: false,
        subtitleMode: "none",
        noSubtitleReason: "no_usable_speech",
        block: { blocked: false, reason: null },
      };
      metrics.no_subtitle_reason = "no_usable_speech";
      return await renderAndComplete({
        supabase,
        row,
        config: runtimeConfig,
        source,
        inputPath,
        outputPath,
        preflight,
        metrics,
        probe,
        started,
      });
    }
    const sourceLanguage = resolveSourceLanguage(transcription);
    const targetLanguage = selectTargetLanguage(sourceLanguage);
    preflight = {
      ...preflight,
      hasUsableSpeech: true,
      sourceLanguage,
      targetLanguage,
    };
    metrics.source_language = sourceLanguage;
    metrics.target_language = targetLanguage;

    const cleanup = runtimeConfig.enableTranscriptCleanup
      ? await measure(metrics, "transcript_cleanup", () => cleanupTranscriptSegments({
        apiKey: runtimeConfig.openaiApiKey,
        model: runtimeConfig.cleanupModel,
        segments: timedSourceSegments,
        sourceLanguage,
        contextText,
      }))
      : { model: null, segments: timedSourceSegments, skipped: true };
    const sourceSegments = sanitizeSubtitleSegments(cleanup.segments, { durationMs: metrics.duration_ms });
    const readableSourceSegments = splitLongSubtitleSegments(sourceSegments, {
      language: sourceSrtLanguage(sourceLanguage),
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      durationMs: metrics.duration_ms,
      subtitleStyleConfig: runtimeConfig.subtitleStyleConfig,
    });
    metrics.transcript_cleanup_model = cleanup.model;
    metrics.transcript_cleanup_enabled = runtimeConfig.enableTranscriptCleanup;
    metrics.transcript_cleanup_changed = JSON.stringify(sourceSegments) !== JSON.stringify(timedSourceSegments);
    metrics.translation_source_segment_count = readableSourceSegments.length;
    if (!hasUsableSubtitleText(readableSourceSegments)) {
      preflight = {
        ...preflight,
        hasUsableSpeech: false,
        subtitleMode: "none",
        noSubtitleReason: "no_usable_speech",
        block: { blocked: false, reason: null },
      };
      metrics.no_subtitle_reason = "no_usable_speech";
      return await renderAndComplete({
        supabase,
        row,
        config: runtimeConfig,
        source,
        inputPath,
        outputPath,
        sourceSegments: readableSourceSegments,
        sourceLanguage,
        targetLanguage,
        preflight,
        metrics,
        probe,
        started,
      });
    }

    const translation = await measure(metrics, "translation", () => translateSegments({
      apiKey: runtimeConfig.openaiApiKey,
      model: runtimeConfig.translationModel,
      segments: readableSourceSegments,
      targetLanguage,
      contextText,
    }));
    metrics.translation_model = translation.model;
    if (!hasUsableSubtitleText(translation.segments)) {
      throw new Error("translation produced no usable subtitle text");
    }

    const translatedSrt = segmentsToSrt(translation.segments, {
      language: targetLanguage,
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      durationMs: metrics.duration_ms,
      subtitleStyleConfig: runtimeConfig.subtitleStyleConfig,
    });
    const assPath = join(workingDir, `${targetLanguage}.ass`);
    const srtPath = join(workingDir, `${targetLanguage}.srt`);
    const persianSrt = targetLanguage === "fa" ? translatedSrt : null;
    const ass = segmentsToAss(translation.segments, {
      width: probe.width || source.width || 1080,
      height: probe.height || source.height || 1920,
      language: targetLanguage,
      subtitlePlacement: preflight.subtitlePlacement,
      subtitleStyleConfig: runtimeConfig.subtitleStyleConfig,
      durationMs: metrics.duration_ms,
    });
    await measure(metrics, "subtitle_generate", async () => {
      await writeFile(srtPath, translatedSrt);
      await writeFile(assPath, ass);
    });

    return await renderAndComplete({
      supabase,
      row,
      config: runtimeConfig,
      source,
      inputPath,
      outputPath,
      assPath,
      ass,
      translatedSrt,
      persianSrt,
      sourceSegments,
      sourceLanguage,
      targetLanguage,
      preflight,
      metrics,
      probe,
      started,
    });
  } catch (error) {
    metrics.total_ms = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    const { data } = await supabase.rpc("fail_video_render", {
      p_render_id: row.id,
      p_error: message,
      p_metrics: metrics,
    }).catch(() => ({ data: null }));
    await maybeInvokePostingFunctions(supabase, data, row.tweet_id);
    throw error;
  } finally {
    await rm(workingDir, { recursive: true, force: true }).catch(() => null);
  }
}

export async function runPreflightForRenderId({ supabase, renderId, config }) {
  const metrics = {};
  const dbSettings = await measure(metrics, "config_load", () => loadRenderSettingsOrDefault(supabase, metrics));
  const runtimeConfig = applyRenderSettings(config, dbSettings);
  metrics.video_render_config = { mode: dbSettings.mode };
  const workingDir = join(runtimeConfig.workDir, `preflight-${renderId}-${Date.now()}`);
  await mkdir(workingDir, { recursive: true });
  const inputPath = join(workingDir, "source.mp4");
  try {
    const { data: row, error } = await supabase
      .from("video_renders")
      .select("id, tweet_id, source_media_id")
      .eq("id", renderId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error(`render ${renderId} not found`);
    const source = await measure(metrics, "source_lookup", () => loadRenderSource(supabase, row));
    await measure(metrics, "download", async () => {
      const { data, error: downloadError } = await supabase.storage.from(runtimeConfig.bucket).download(source.storage_path);
      if (downloadError || !data) throw new Error(`download ${source.storage_path}: ${downloadError?.message || "no blob"}`);
      metrics.source_bytes = await writeBlobToFile(data, inputPath);
    });
    const probe = await measure(metrics, "probe", () => probeVideo(inputPath));
    metrics.width = probe.width;
    metrics.height = probe.height;
    metrics.duration_ms = probe.durationMs ?? source.duration_ms ?? null;
    let preflight = await measure(metrics, "preflight_visual", () => runVisualPreflight({
      inputPath,
      probe,
      options: preflightOptions(runtimeConfig),
    }));
    preflight = await maybeRunVisionPreflight({ inputPath, workingDir, config: runtimeConfig, preflight, metrics });
    preflight = {
      ...preflight,
      hasAudio: hasAudioStream(probe),
    };
    return { ok: true, render_id: renderId, tweet_id: row.tweet_id, preflight, metrics };
  } finally {
    if (!runtimeConfig.keepPreflightWorkdir) {
      await rm(workingDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}

export async function claimNextRender(supabase, config) {
  const { data, error } = await supabase.rpc("claim_video_renders", {
    batch_size: 1,
    worker_id: config.rendererId,
  });
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

export async function claimRenderById(supabase, config, renderId) {
  const { data, error } = await supabase.rpc("claim_video_render_by_id", {
    render_id,
    worker_id: config.rendererId,
  });
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

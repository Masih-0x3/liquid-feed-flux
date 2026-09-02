import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAudioExtractCommand, buildContactSheetCommand, buildFrameSampleCommand, buildOpenCvInpaintPreviewCommand, buildPreviewClipCommand, buildWatermarkInspectionSheetCommand, probeVideo, runCommand } from "./ffmpeg.js";
import { analyzeRemovableWatermarks, cleanupTranscriptSegments, detectLanguageFromTranscription, translateSegments } from "./openai.js";
import { decidePreflightBlock, decideWatermarkOnlyBlock, delogoRegionsFromWatermarkOnly, evaluateDelogoPlan, normalizeLanguage, normalizeWatermarkOnlyDecision, recoverDelogoRegions, runOptionalOcr, runVisualPreflight, scoreWatermarkSignals, selectDelogoRegions, selectTargetLanguage, subtitlePlacementFromVision, visionFromWatermarkOnly } from "./preflight.js";
import { resolveRenderEffects } from "./renderEffects.js";
import { hasUsableSubtitleText, sanitizeSubtitleSegments, segmentsToAss, segmentsToSrt, splitLongSubtitleSegments } from "./subtitles.js";
import { transcribeWithEnhancedAudioRetry } from "./transcriptionPipeline.js";

const DEFAULT_OPENCV_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../scripts/opencv_inpaint_pipe.py");

function visionFrameSeekTimes(probe) {
  const durationSeconds = Math.max(0, Number(probe?.durationMs ?? 0) / 1000);
  if (!durationSeconds || durationSeconds <= 2) return [1];
  const upper = Math.max(1, durationSeconds - 1);
  const candidates = [durationSeconds * 0.18, durationSeconds * 0.5, durationSeconds * 0.82]
    .map((value) => Math.min(Math.max(1, value), upper));
  return [...new Set(candidates.map((value) => Math.round(value * 10) / 10))].slice(0, 3);
}

function previewPreflightOptions() {
  return {
    maxDelogoRegions: Number(process.env.MAX_DELOGO_REGIONS || 2),
    maxSingleDelogoAreaRatio: Number(process.env.MAX_SINGLE_DELOGO_AREA_RATIO || 0.10),
    maxTotalDelogoAreaRatio: Number(process.env.MAX_TOTAL_DELOGO_AREA_RATIO || 0.15),
    minWatermarkOnlyConfidence: Number(process.env.MIN_WATERMARK_ONLY_CONFIDENCE || 0.85),
    watermarkBoxPadRatio: Number(process.env.WATERMARK_BOX_PAD_RATIO || 0),
    watermarkBoxHorizontalDilation: Number(process.env.WATERMARK_BOX_HORIZONTAL_DILATION || 0),
    watermarkBoxVerticalDilation: Number(process.env.WATERMARK_BOX_VERTICAL_DILATION || 0),
  };
}

function parseCsv(value, fallback = []) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
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

function compactContextText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
}

async function loadPreviewContextText(inputPath) {
  const explicit = compactContextText(process.env.PREVIEW_CONTEXT_TEXT);
  if (explicit) return explicit;

  const manifestPath = join(dirname(dirname(inputPath)), "manifest.json");
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : [];
    const fileName = basename(inputPath);
    const match = entries.find((entry) => entry?.local_file === inputPath || basename(String(entry?.local_file ?? "")) === fileName);
    return compactContextText(match?.text_preview);
  } catch {
    return "";
  }
}

function subtitleContextText({ postContext, preflight }) {
  return compactContextText([
    postContext ? `Post context: ${postContext}` : "",
    preflight?.ocr?.text ? `Visible OCR text: ${preflight.ocr.text}` : "",
    preflight?.watermarkOnly?.reason ? `Visual note: ${preflight.watermarkOnly.reason}` : "",
  ].filter(Boolean).join("\n"));
}

function resolveSourceLanguage(transcription) {
  const broadLanguage = ["", "und", "multi"].includes(String(transcription?.language ?? "").toLowerCase());
  return broadLanguage
    ? detectLanguageFromTranscription(transcription?.raw)
    : transcription.language;
}

function sourceSrtLanguage(sourceLanguage) {
  return normalizeLanguage(sourceLanguage) === "fa" ? "fa" : "en";
}

function hasAudioStream(probe) {
  return (probe?.raw?.streams ?? []).some((stream) => stream?.codec_type === "audio");
}

function probeFrameRate(probe) {
  const video = (probe?.raw?.streams ?? []).find((stream) => stream?.codec_type === "video") ?? {};
  const value = String(video.r_frame_rate || video.avg_frame_rate || "").trim();
  const [num, den] = value.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) return num / den;
  const direct = Number(value);
  return Number.isFinite(direct) && direct > 0 ? direct : 30;
}

function previewOpenCvOptions() {
  return {
    opencvPython: process.env.OPENCV_PYTHON || "python3",
    opencvScript: process.env.OPENCV_INPAINT_SCRIPT || DEFAULT_OPENCV_SCRIPT,
    opencvMode: process.env.OPENCV_INPAINT_MODE || "hybrid",
    opencvAlgorithm: process.env.OPENCV_INPAINT_ALGORITHM || "telea",
    opencvRadius: Number(process.env.OPENCV_INPAINT_RADIUS || 2),
    opencvKernel: Number(process.env.OPENCV_INPAINT_KERNEL || 7),
    opencvDilateIterations: Number(process.env.OPENCV_INPAINT_DILATE_ITERATIONS || 2),
    opencvCloseIterations: Number(process.env.OPENCV_INPAINT_CLOSE_ITERATIONS || 1),
    opencvFeather: Number(process.env.OPENCV_INPAINT_FEATHER || 0),
  };
}

function resolvePreviewEffects(preflight, { hasSubtitleTrack = false } = {}) {
  return resolveRenderEffects(preflight, {
    enableAdaptiveSubtitleMask: process.env.ENABLE_ADAPTIVE_SUBTITLE_MASK === "1",
    watermarkConfig: {
      enabled: process.env.PREVIEW_WATERMARK_ENABLED !== "0",
      apply_when: process.env.PREVIEW_WATERMARK_APPLY_WHEN,
      add_only_when_modified: process.env.PREVIEW_WATERMARK_ADD_ONLY_WHEN_MODIFIED === "0" ? false : undefined,
    },
  }, { hasSubtitleTrack });
}

function resolvePreviewQuality(effects) {
  const hasDelogo = Array.isArray(effects?.delogoRegions) && effects.delogoRegions.length > 0;
  return {
    crf: Number(
      process.env.PREVIEW_OUTPUT_CRF ||
      (hasDelogo ? process.env.DELOGO_OUTPUT_CRF : "") ||
      process.env.OUTPUT_CRF ||
      (hasDelogo ? 18 : 20),
    ),
    preset: process.env.PREVIEW_OUTPUT_PRESET ||
      (hasDelogo ? process.env.DELOGO_OUTPUT_PRESET : "") ||
      process.env.OUTPUT_PRESET ||
      "fast",
  };
}

async function selectOriginalPreview({ result, outDir, preflight, reason, extra = {} }) {
  const nextPreflight = {
    ...preflight,
    ...(extra.preflight ?? {}),
    hasUsableSpeech: false,
    subtitleMode: "none",
    noSubtitleReason: reason,
    processingMode: "original_unmodified",
    processingReasons: [],
    block: { blocked: false, reason: null },
  };
  const nextResult = { ...result, preflight: nextPreflight };
  await writeFile(join(outDir, "preflight.json"), JSON.stringify(nextResult, null, 2));
  console.log(JSON.stringify({
    ...nextResult,
    ...(extra.output ?? {}),
    subtitle: null,
    no_subtitle_reason: reason,
    original_selected: true,
    preview: result.input,
    preview_rendered: false,
  }, null, 2));
}

async function renderPreviewWithoutSubtitles({ result, outDir, inputPath, probe, preflight, reason, extra = {} }) {
  const previewPath = join(outDir, "preview.mp4");
  const effects = resolvePreviewEffects(preflight, { hasSubtitleTrack: false });
  if (!effects.shouldRender) {
    await selectOriginalPreview({ result, outDir, preflight, reason, extra });
    return;
  }
  const nextPreflight = {
    ...preflight,
    ...(extra.preflight ?? {}),
    hasUsableSpeech: false,
    subtitleMode: "none",
    noSubtitleReason: reason,
    processingMode: "rendered",
    processingReasons: effects.reasons,
    watermarkApplied: effects.shouldWatermark,
    block: { blocked: false, reason: null },
  };
  const nextResult = { ...result, preflight: nextPreflight };
  await writeFile(join(outDir, "preflight.json"), JSON.stringify(nextResult, null, 2));
  const quality = resolvePreviewQuality(effects);
  const useOpenCvDelogo = effects.delogoRegions.length > 0 && (process.env.DELOGO_ENGINE || "opencv") === "opencv";
  const renderCommand = useOpenCvDelogo ? buildOpenCvInpaintPreviewCommand({
    inputPath,
    assPath: null,
    outputPath: previewPath,
    width: probe.width || 1080,
    height: probe.height || 1920,
    fps: probeFrameRate(probe),
    enableWatermark: effects.shouldWatermark,
    enableAdaptiveMask: effects.enableAdaptiveMask,
    delogoRegions: effects.delogoRegions,
    subtitlePlacement: preflight.subtitlePlacement,
    protectedRegions: watermarkProtectedRegions(preflight),
    previewSeconds: Number(process.env.PREVIEW_SECONDS || 20),
    crf: quality.crf,
    preset: quality.preset,
    fontsDir: process.env.FONTS_DIR || "/usr/share/fonts",
    ...previewOpenCvOptions(),
  }) : buildPreviewClipCommand({
    inputPath,
    assPath: null,
    outputPath: previewPath,
    width: probe.width || 1080,
    height: probe.height || 1920,
    enableWatermark: effects.shouldWatermark,
    enableAdaptiveMask: effects.enableAdaptiveMask,
    delogoRegions: effects.delogoRegions,
    subtitlePlacement: preflight.subtitlePlacement,
    protectedRegions: watermarkProtectedRegions(preflight),
    previewSeconds: Number(process.env.PREVIEW_SECONDS || 20),
    crf: quality.crf,
    preset: quality.preset,
    fontsDir: process.env.FONTS_DIR || "/usr/share/fonts",
  });
  await runCommand(renderCommand, { label: useOpenCvDelogo ? "opencv_preview_render" : "preview_render", stage: "render" });
  console.log(JSON.stringify({
    ...nextResult,
    ...(extra.output ?? {}),
    subtitle: null,
    no_subtitle_reason: reason,
    processing_reasons: effects.reasons,
    original_selected: false,
    preview: previewPath,
    preview_rendered: true,
  }, null, 2));
}

async function main() {
  const inputPath = process.argv[2];
  const outDir = process.argv[3] || join(process.cwd(), `video-preview-${Date.now()}`);
  if (!inputPath) {
    console.error("Usage: node src/preview.js /path/source.mp4 /path/output-dir");
    process.exit(2);
  }

  await mkdir(outDir, { recursive: true });
  const probe = await probeVideo(inputPath);
  let preflight = await runVisualPreflight({ inputPath, probe });
  const contactSheetPath = join(outDir, "contact-sheet.jpg");
  const frameSpecs = visionFrameSeekTimes(probe).map((seekSeconds, index) => ({
    path: join(outDir, `vision-frame-${index + 1}.jpg`),
    inspectionPath: join(outDir, `vision-inspection-${index + 1}.jpg`),
    seekSeconds,
  }));
  await runCommand(buildContactSheetCommand(inputPath, contactSheetPath), { label: "contact_sheet", stage: "analysis" });
  await Promise.all(frameSpecs.map((frame) => runCommand(buildFrameSampleCommand(inputPath, frame.path, {
    seekSeconds: frame.seekSeconds,
    width: Number(process.env.WATERMARK_VISION_FRAME_WIDTH || 1440),
  }), { label: `vision_frame_${frame.seekSeconds}`, stage: "analysis" })));
  await Promise.all(frameSpecs.map((frame) => runCommand(buildWatermarkInspectionSheetCommand(frame.path, frame.inspectionPath, {
    tileWidth: Number(process.env.WATERMARK_INSPECTION_TILE_WIDTH || 720),
    tileHeight: Number(process.env.WATERMARK_INSPECTION_TILE_HEIGHT || 360),
  }), { label: `vision_inspection_${frame.seekSeconds}`, stage: "analysis" })));
  const apiKey = process.env.OPENAI_API_KEY || "";
  let vision = null;
  let watermarkOnly = null;
  let ocr = null;
  if (apiKey && process.env.ENABLE_OPENAI_VISION_PREFLIGHT !== "0") {
    ocr = await runOptionalOcr(contactSheetPath);
    watermarkOnly = await analyzeRemovableWatermarks({
      apiKey,
      model: process.env.WATERMARK_VISION_MODEL || process.env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
      framePaths: frameSpecs.map((frame) => frame.path),
      inspectionPaths: frameSpecs.map((frame) => frame.inspectionPath),
      imageDetail: process.env.WATERMARK_VISION_IMAGE_DETAIL || "high",
      temperature: Number(process.env.WATERMARK_VISION_TEMPERATURE ?? 0),
      topP: process.env.WATERMARK_VISION_TOP_P ? Number(process.env.WATERMARK_VISION_TOP_P) : null,
      maxOutputTokens: Number(process.env.WATERMARK_VISION_MAX_OUTPUT_TOKENS || 1200),
    });
    watermarkOnly = normalizeWatermarkOnlyDecision(watermarkOnly);
    vision = visionFromWatermarkOnly(watermarkOnly);
    const watermark = scoreWatermarkSignals({
      stableOverlayScore: preflight.overlayDetection?.stableOverlayScore ?? preflight.watermark?.score ?? 0,
      repeatedCornerText: ocr.text ? [ocr.text] : preflight.watermark?.repeatedText ?? [],
      platformMatches: ocr.matches ?? preflight.watermark?.platformMatches ?? [],
      vision,
    });
    const modelDelogoRegions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: probe.width, height: probe.height }, previewPreflightOptions());
    const delogoRecovery = await recoverDelogoRegions({
      framePaths: frameSpecs.map((frame) => frame.path),
      vision,
      dimensions: { width: probe.width, height: probe.height },
      existingRegions: [],
      allowVisualRecovery: process.env.ENABLE_WATERMARK_VISUAL_RECOVERY !== "0",
    });
    const requireLocalDelogoCoordinates = shouldRequireLocalDelogoCoordinates(watermarkOnly, vision);
    const delogoRegions = selectDelogoRegions({
      recoveredRegions: delogoRecovery.regions,
      modelRegions: modelDelogoRegions,
      requireLocalDelogoCoordinates,
      options: previewPreflightOptions(),
    });
    const delogoPlan = evaluateDelogoPlan(delogoRegions, { width: probe.width, height: probe.height }, {
      ...previewPreflightOptions(),
      requireDelogoCoordinates: requireLocalDelogoCoordinates,
    });
    const subtitlePlacement = subtitlePlacementFromVision(vision, { width: probe.width, height: probe.height }, {
      overlayDetection: preflight.overlayDetection,
    });
    const watermarkOnlyBlock = decideWatermarkOnlyBlock(watermarkOnly, delogoPlan);
    preflight = {
      ...preflight,
      ocr,
      watermarkOnly,
      vision,
      watermark,
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
      block: watermarkOnlyBlock.blocked ? watermarkOnlyBlock : decidePreflightBlock({
        watermark,
        vision,
        delogoRegions,
        delogoPlan,
        hardSubtitles: preflight.hardSubtitles,
        hasUsableSpeech: true,
      }, previewPreflightOptions()),
    };
  } else {
    preflight = { ...preflight, contactSheetGenerated: true };
  }

  const result = {
    input: inputPath,
    input_name: basename(inputPath),
    contact_sheet: contactSheetPath,
    vision_frame: frameSpecs[0]?.path ?? null,
    vision_frames: frameSpecs,
    vision_inspection_sheets: frameSpecs.map((frame) => ({ path: frame.inspectionPath, seekSeconds: frame.seekSeconds })),
    probe: { width: probe.width, height: probe.height, duration_ms: probe.durationMs },
    preflight,
  };
  await writeFile(join(outDir, "preflight.json"), JSON.stringify(result, null, 2));

  if (!apiKey || preflight.block?.blocked) {
    console.log(JSON.stringify({ ...result, preview_rendered: false }, null, 2));
    return;
  }

  const audioPath = join(outDir, "audio.mp3");
  const enhancedAudioPath = join(outDir, "audio.enhanced.mp3");
  const earlyAudioPath = join(outDir, "audio.early.mp3");
  const assPath = join(outDir, "preview.ass");
  const previewPath = join(outDir, "preview.mp4");
  const postContext = await loadPreviewContextText(inputPath);
  const contextText = subtitleContextText({ postContext, preflight });
  if (!hasAudioStream(probe)) {
    await renderPreviewWithoutSubtitles({
      result,
      outDir,
      inputPath,
      probe,
      preflight,
      reason: "no_audio_stream",
    });
    return;
  }
  await runCommand(buildAudioExtractCommand(inputPath, audioPath), { label: "audio_extract", stage: "analysis" });
  const transcription = await transcribeWithEnhancedAudioRetry({
    inputPath,
    audioPath,
    enhancedAudioPath,
    earlyAudioPath,
    enabled: process.env.ENHANCED_AUDIO_RETRY !== "0",
    earlyTranscriptRescueEnabled: process.env.EARLY_TRANSCRIPT_RESCUE !== "0",
    earlyTranscriptMinFirstCueStartSeconds: Number(process.env.EARLY_TRANSCRIPT_MIN_FIRST_CUE_START_SECONDS || 8),
    earlyTranscriptWindowSeconds: Number(process.env.EARLY_TRANSCRIPT_WINDOW_SECONDS || 14),
    transcriptionOptions: {
      provider: process.env.TRANSCRIPTION_PROVIDER || "deepgram",
      fallbackProvider: process.env.TRANSCRIPTION_FALLBACK_PROVIDER || "",
      deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
      deepgramModel: process.env.DEEPGRAM_MODEL || "nova-3",
      deepgramLanguage: process.env.DEEPGRAM_LANGUAGE || "",
      deepgramLanguageFallbacks: parseCsv(process.env.DEEPGRAM_LANGUAGE_FALLBACKS, ["multi", "en", "fa", "he", "ar"]),
      deepgramDetectLanguage: process.env.DEEPGRAM_DETECT_LANGUAGE !== "0",
      openaiApiKey: apiKey,
      openaiModel: process.env.SUBTITLE_TRANSCRIBE_MODEL || "gpt-4o-transcribe-diarize",
      openaiFallbackModel: process.env.SUBTITLE_FALLBACK_TRANSCRIBE_MODEL || "whisper-1",
      durationMs: probe.durationMs,
      contextText,
    },
  });
  const timedSourceSegments = sanitizeSubtitleSegments(transcription.segments, { durationMs: probe.durationMs });
  if (!hasUsableSubtitleText(timedSourceSegments)) {
    await renderPreviewWithoutSubtitles({
      result,
      outDir,
      inputPath,
      probe,
      preflight,
      reason: "no_usable_speech",
    });
    return;
  }
  const sourceLanguage = resolveSourceLanguage(transcription);
  const rawSourceSrtPath = join(outDir, "preview.raw-source.srt");
  await writeFile(rawSourceSrtPath, segmentsToSrt(timedSourceSegments, {
    language: sourceSrtLanguage(sourceLanguage),
    width: probe.width || 1080,
    height: probe.height || 1920,
    durationMs: probe.durationMs,
  }));
  const cleanup = process.env.ENABLE_TRANSCRIPT_CLEANUP === "0"
    ? { model: null, segments: timedSourceSegments, skipped: true }
    : await cleanupTranscriptSegments({
      apiKey,
      model: process.env.SUBTITLE_CLEANUP_MODEL || process.env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
      segments: timedSourceSegments,
      sourceLanguage,
      contextText,
    });
  const sourceSegments = sanitizeSubtitleSegments(cleanup.segments, { durationMs: probe.durationMs });
  const readableSourceSegments = splitLongSubtitleSegments(sourceSegments, {
    language: sourceSrtLanguage(sourceLanguage),
    width: probe.width || 1080,
    height: probe.height || 1920,
    durationMs: probe.durationMs,
  });
  const cleanedSourceSrtPath = join(outDir, "preview.cleaned-source.srt");
  await writeFile(cleanedSourceSrtPath, segmentsToSrt(readableSourceSegments, {
    language: sourceSrtLanguage(sourceLanguage),
    width: probe.width || 1080,
    height: probe.height || 1920,
    durationMs: probe.durationMs,
    splitLongCues: false,
  }));
  if (!hasUsableSubtitleText(readableSourceSegments)) {
    await renderPreviewWithoutSubtitles({
      result,
      outDir,
      inputPath,
      probe,
      preflight,
      reason: "no_usable_speech",
      extra: {
        preflight: { sourceLanguage },
        output: {
          source_language: sourceLanguage,
          raw_source_subtitle: rawSourceSrtPath,
          cleaned_source_subtitle: cleanedSourceSrtPath,
        },
      },
    });
    return;
  }
  const targetLanguage = selectTargetLanguage(sourceLanguage);
  const translation = await translateSegments({
    apiKey,
    model: process.env.SUBTITLE_TRANSLATE_MODEL || "gpt-5.4-mini",
    segments: readableSourceSegments,
    targetLanguage,
    contextText,
  });
  if (!hasUsableSubtitleText(translation.segments)) {
    throw new Error("translation produced no usable subtitle text");
  }
  const srtPath = join(outDir, targetLanguage === "en" ? "preview.en.srt" : "preview.fa.srt");
  await writeFile(srtPath, segmentsToSrt(translation.segments, {
    language: targetLanguage,
    width: probe.width || 1080,
    height: probe.height || 1920,
    durationMs: probe.durationMs,
  }));
  const effects = resolvePreviewEffects(preflight, { hasSubtitleTrack: true });
  await writeFile(assPath, segmentsToAss(translation.segments, {
    width: probe.width || 1080,
    height: probe.height || 1920,
    language: targetLanguage,
    subtitlePlacement: preflight.subtitlePlacement,
    durationMs: probe.durationMs,
  }));
  const quality = resolvePreviewQuality(effects);
  const useOpenCvDelogo = effects.delogoRegions.length > 0 && (process.env.DELOGO_ENGINE || "opencv") === "opencv";
  const renderCommand = useOpenCvDelogo ? buildOpenCvInpaintPreviewCommand({
    inputPath,
    assPath,
    outputPath: previewPath,
    width: probe.width || 1080,
    height: probe.height || 1920,
    fps: probeFrameRate(probe),
    enableWatermark: effects.shouldWatermark,
    enableAdaptiveMask: effects.enableAdaptiveMask,
    delogoRegions: effects.delogoRegions,
    subtitlePlacement: preflight.subtitlePlacement,
    protectedRegions: watermarkProtectedRegions(preflight),
    previewSeconds: Number(process.env.PREVIEW_SECONDS || 20),
    crf: quality.crf,
    preset: quality.preset,
    fontsDir: process.env.FONTS_DIR || "/usr/share/fonts",
    ...previewOpenCvOptions(),
  }) : buildPreviewClipCommand({
    inputPath,
    assPath,
    outputPath: previewPath,
    width: probe.width || 1080,
    height: probe.height || 1920,
    enableWatermark: effects.shouldWatermark,
    enableAdaptiveMask: effects.enableAdaptiveMask,
    delogoRegions: effects.delogoRegions,
    subtitlePlacement: preflight.subtitlePlacement,
    protectedRegions: watermarkProtectedRegions(preflight),
    previewSeconds: Number(process.env.PREVIEW_SECONDS || 20),
    crf: quality.crf,
    preset: quality.preset,
    fontsDir: process.env.FONTS_DIR || "/usr/share/fonts",
  });
  await runCommand(renderCommand, { label: useOpenCvDelogo ? "opencv_preview_render" : "preview_render", stage: "render" });

  const nextPreflight = {
    ...preflight,
    sourceLanguage,
    targetLanguage,
    hasUsableSpeech: true,
    subtitleMode: targetLanguage,
    processingMode: "rendered",
    processingReasons: effects.reasons,
    watermarkApplied: effects.shouldWatermark,
    block: { blocked: false, reason: null },
  };
  const nextResult = { ...result, preflight: nextPreflight };
  await writeFile(join(outDir, "preflight.json"), JSON.stringify(nextResult, null, 2));
  console.log(JSON.stringify({
    ...nextResult,
    source_language: sourceLanguage,
    target_language: targetLanguage,
    raw_source_subtitle: rawSourceSrtPath,
    cleaned_source_subtitle: cleanedSourceSrtPath,
    transcript_cleanup_model: cleanup.model,
    subtitle: srtPath,
    processing_reasons: effects.reasons,
    original_selected: false,
    preview: previewPath,
    preview_rendered: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

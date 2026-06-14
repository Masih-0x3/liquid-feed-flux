import type { VideoRenderFailurePolicy } from "./videoRenderGate.ts";

export type VideoRenderMode = "disabled" | "shadow" | "enabled";
export type VideoRenderWatermarkApplyWhen = "subtitle_track" | "modified" | "always" | "never";

export interface VideoRenderConfig {
  mode: VideoRenderMode;
  enabled: boolean;
  renderVersion: string;
  failurePolicy: VideoRenderFailurePolicy;
  retentionHours: number;
  rendererUrl: string | null;
  transcriptionProvider: "deepgram" | "openai";
  transcriptionModel: string;
  translationModel: string;
  visionModel: string;
  targetLanguageRule: "fa_except_fa_to_en";
  subtitleStyle: {
    textColor: string;
    backgroundColor: string;
    fontScale: number;
    maxWidthPct: number;
    bottomPaddingPct: number;
    collisionGapPct: number;
  };
  delogo: {
    visionMode: "off" | "auto" | "always";
    engine: "opencv" | "ffmpeg";
    maxRegions: number;
    maxSingleAreaRatio: number;
    maxTotalAreaRatio: number;
    opencvRadius: number;
    opencvKernel: number;
    opencvDilateIterations: number;
    opencvFeather: number;
  };
  watermark: {
    applyWhen: VideoRenderWatermarkApplyWhen;
    opacity: number;
    topRightOpacity: number;
    coverOpacity: number;
    multiple: boolean;
    coverDelogo: boolean;
    coverPaddingPct: number;
  };
}

const DEFAULT_RENDER_VERSION = "persian-subtitles-masihh-v1";

export const DEFAULT_VIDEO_RENDER_CONFIG: VideoRenderConfig = {
  mode: "disabled",
  enabled: false,
  renderVersion: DEFAULT_RENDER_VERSION,
  failurePolicy: "post_original",
  retentionHours: 24,
  rendererUrl: null,
  transcriptionProvider: "deepgram",
  transcriptionModel: "nova-3",
  translationModel: "gpt-5.4-mini",
  visionModel: "gpt-5.4-mini",
  targetLanguageRule: "fa_except_fa_to_en",
  subtitleStyle: {
    textColor: "#FFE45C",
    backgroundColor: "#000000",
    fontScale: 1.18,
    maxWidthPct: 0.92,
    bottomPaddingPct: 0.06,
    collisionGapPct: 0.015,
  },
  delogo: {
    visionMode: "always",
    engine: "opencv",
    maxRegions: 2,
    maxSingleAreaRatio: 0.10,
    maxTotalAreaRatio: 0.15,
    opencvRadius: 2,
    opencvKernel: 7,
    opencvDilateIterations: 2,
    opencvFeather: 0,
  },
  watermark: {
    applyWhen: "subtitle_track",
    opacity: 0.16,
    topRightOpacity: 0.34,
    coverOpacity: 0.34,
    multiple: true,
    coverDelogo: true,
    coverPaddingPct: 0,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string, max = 120): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : fallback;
}

function nullableUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(value, fallback, min, max));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback;
}

function mode(value: unknown, legacyEnabled: unknown): VideoRenderMode {
  if (value === "enabled" || value === "shadow" || value === "disabled") return value;
  if (legacyEnabled === true) return "enabled";
  return "disabled";
}

function failurePolicy(value: unknown): VideoRenderFailurePolicy {
  return value === "block" ? "block" : "post_original";
}

function watermarkApplyWhen(value: unknown): VideoRenderWatermarkApplyWhen {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : "";
  if (raw === "modified" || raw === "always" || raw === "never" || raw === "subtitle_track") return raw;
  if (raw === "subtitle" || raw === "subtitles" || raw === "subtitle_added") return "subtitle_track";
  return DEFAULT_VIDEO_RENDER_CONFIG.watermark.applyWhen;
}

export function normalizeVideoRenderConfigValue(input: unknown): VideoRenderConfig {
  const value = isRecord(input) ? input : {};
  const subtitleStyle = isRecord(value.subtitle_style) ? value.subtitle_style : {};
  const delogo = isRecord(value.delogo) ? value.delogo : {};
  const watermark = isRecord(value.watermark) ? value.watermark : {};
  const resolvedMode = mode(value.mode, value.enabled);
  const visionMode = delogo.vision_mode === "off" || delogo.vision_mode === "auto" ? delogo.vision_mode : "always";
  const engine = delogo.engine === "ffmpeg" ? "ffmpeg" : "opencv";
  const transcriptionProvider = value.transcription_provider === "openai" ? "openai" : "deepgram";

  return {
    mode: resolvedMode,
    enabled: resolvedMode === "enabled",
    renderVersion: str(value.render_version, DEFAULT_VIDEO_RENDER_CONFIG.renderVersion, 160),
    failurePolicy: failurePolicy(value.failure_policy),
    retentionHours: integer(value.retention_hours, DEFAULT_VIDEO_RENDER_CONFIG.retentionHours, 1, 168),
    rendererUrl: nullableUrl(value.renderer_url),
    transcriptionProvider,
    transcriptionModel: str(value.transcription_model, DEFAULT_VIDEO_RENDER_CONFIG.transcriptionModel, 100),
    translationModel: str(value.translation_model, DEFAULT_VIDEO_RENDER_CONFIG.translationModel, 100),
    visionModel: str(value.vision_model, DEFAULT_VIDEO_RENDER_CONFIG.visionModel, 100),
    targetLanguageRule: "fa_except_fa_to_en",
    subtitleStyle: {
      textColor: color(subtitleStyle.text_color, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.textColor),
      backgroundColor: color(subtitleStyle.background_color, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.backgroundColor),
      fontScale: num(subtitleStyle.font_scale, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.fontScale, 0.8, 1.8),
      maxWidthPct: num(subtitleStyle.max_width_pct, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.maxWidthPct, 0.55, 0.96),
      bottomPaddingPct: num(subtitleStyle.bottom_padding_pct, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.bottomPaddingPct, 0.02, 0.18),
      collisionGapPct: num(subtitleStyle.collision_gap_pct, DEFAULT_VIDEO_RENDER_CONFIG.subtitleStyle.collisionGapPct, 0, 0.08),
    },
    delogo: {
      visionMode,
      engine,
      maxRegions: integer(delogo.max_regions, DEFAULT_VIDEO_RENDER_CONFIG.delogo.maxRegions, 0, 6),
      maxSingleAreaRatio: num(delogo.max_single_area_ratio, DEFAULT_VIDEO_RENDER_CONFIG.delogo.maxSingleAreaRatio, 0, 0.25),
      maxTotalAreaRatio: num(delogo.max_total_area_ratio, DEFAULT_VIDEO_RENDER_CONFIG.delogo.maxTotalAreaRatio, 0, 0.35),
      opencvRadius: integer(delogo.opencv_radius, DEFAULT_VIDEO_RENDER_CONFIG.delogo.opencvRadius, 1, 8),
      opencvKernel: integer(delogo.opencv_kernel, DEFAULT_VIDEO_RENDER_CONFIG.delogo.opencvKernel, 3, 21),
      opencvDilateIterations: integer(delogo.opencv_dilate_iterations, DEFAULT_VIDEO_RENDER_CONFIG.delogo.opencvDilateIterations, 0, 8),
      opencvFeather: integer(delogo.opencv_feather, DEFAULT_VIDEO_RENDER_CONFIG.delogo.opencvFeather, 0, 12),
    },
    watermark: {
      applyWhen: watermarkApplyWhen(watermark.apply_when),
      opacity: num(watermark.opacity, DEFAULT_VIDEO_RENDER_CONFIG.watermark.opacity, 0.04, 0.45),
      topRightOpacity: num(watermark.top_right_opacity, DEFAULT_VIDEO_RENDER_CONFIG.watermark.topRightOpacity, 0.08, 0.70),
      coverOpacity: num(watermark.cover_opacity, DEFAULT_VIDEO_RENDER_CONFIG.watermark.coverOpacity, 0.08, 0.70),
      multiple: bool(watermark.multiple, DEFAULT_VIDEO_RENDER_CONFIG.watermark.multiple),
      coverDelogo: bool(watermark.cover_delogo, DEFAULT_VIDEO_RENDER_CONFIG.watermark.coverDelogo),
      coverPaddingPct: num(watermark.cover_padding_pct, DEFAULT_VIDEO_RENDER_CONFIG.watermark.coverPaddingPct, 0, 0.08),
    },
  };
}

export function serializeVideoRenderConfig(config: VideoRenderConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    enabled: config.mode === "enabled",
    render_version: config.renderVersion,
    failure_policy: config.failurePolicy,
    retention_hours: config.retentionHours,
    renderer_url: config.rendererUrl,
    transcription_provider: config.transcriptionProvider,
    transcription_model: config.transcriptionModel,
    translation_model: config.translationModel,
    vision_model: config.visionModel,
    target_language_rule: config.targetLanguageRule,
    subtitle_style: {
      text_color: config.subtitleStyle.textColor,
      background_color: config.subtitleStyle.backgroundColor,
      font_scale: config.subtitleStyle.fontScale,
      max_width_pct: config.subtitleStyle.maxWidthPct,
      bottom_padding_pct: config.subtitleStyle.bottomPaddingPct,
      collision_gap_pct: config.subtitleStyle.collisionGapPct,
    },
    delogo: {
      vision_mode: config.delogo.visionMode,
      engine: config.delogo.engine,
      max_regions: config.delogo.maxRegions,
      max_single_area_ratio: config.delogo.maxSingleAreaRatio,
      max_total_area_ratio: config.delogo.maxTotalAreaRatio,
      opencv_radius: config.delogo.opencvRadius,
      opencv_kernel: config.delogo.opencvKernel,
      opencv_dilate_iterations: config.delogo.opencvDilateIterations,
      opencv_feather: config.delogo.opencvFeather,
    },
    watermark: {
      apply_when: config.watermark.applyWhen,
      opacity: config.watermark.opacity,
      top_right_opacity: config.watermark.topRightOpacity,
      cover_opacity: config.watermark.coverOpacity,
      multiple: config.watermark.multiple,
      cover_delogo: config.watermark.coverDelogo,
      cover_padding_pct: config.watermark.coverPaddingPct,
    },
  };
}

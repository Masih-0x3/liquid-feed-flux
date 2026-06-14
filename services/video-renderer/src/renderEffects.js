import { shouldEnableAdaptiveMask } from "./ffmpeg.js";

const DEFAULT_WATERMARK_APPLY_WHEN = "subtitle_track";

export function normalizeWatermarkApplyWhen(value, fallback = DEFAULT_WATERMARK_APPLY_WHEN) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (["subtitle", "subtitles", "subtitle_track", "subtitle_added", "caption", "captions"].includes(raw)) return "subtitle_track";
  if (["modified", "when_modified", "any_modified"].includes(raw)) return "modified";
  if (["always", "all"].includes(raw)) return "always";
  if (["never", "off", "none"].includes(raw)) return "never";
  return fallback;
}

function resolveWatermarkApplyWhen(watermarkConfig) {
  const configured = watermarkConfig?.apply_when ?? watermarkConfig?.applyWhen;
  if (configured !== undefined && configured !== null && String(configured).trim()) {
    return normalizeWatermarkApplyWhen(configured);
  }
  if (watermarkConfig?.add_only_when_modified === false) return "always";
  if (watermarkConfig?.add_only_when_modified === true) return "modified";
  return DEFAULT_WATERMARK_APPLY_WHEN;
}

export function resolveRenderEffects(preflight, config = {}, { hasSubtitleTrack = false } = {}) {
  const delogoRegions = Array.isArray(preflight?.delogoRegions) ? preflight.delogoRegions : [];
  const enableAdaptiveMask = config.enableAdaptiveSubtitleMask && shouldEnableAdaptiveMask(preflight?.hardSubtitles?.raw);
  const reasons = [
    hasSubtitleTrack ? "subtitle_track" : "",
    delogoRegions.length > 0 ? "delogo" : "",
    enableAdaptiveMask ? "adaptive_subtitle_mask" : "",
  ].filter(Boolean);
  const watermarkConfig = config.watermarkConfig && typeof config.watermarkConfig === "object" ? config.watermarkConfig : {};
  const watermarkEnabled = watermarkConfig.enabled !== false;
  const applyWhen = resolveWatermarkApplyWhen(watermarkConfig);
  const shouldWatermark = watermarkEnabled && (
    applyWhen === "always" ||
    (applyWhen === "modified" && reasons.length > 0) ||
    (applyWhen === "subtitle_track" && hasSubtitleTrack)
  );
  return {
    delogoRegions,
    enableAdaptiveMask,
    shouldRender: reasons.length > 0,
    shouldWatermark,
    watermarkApplyWhen: applyWhen,
    reasons,
  };
}

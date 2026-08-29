const DEFAULT_RENDER_SETTINGS = {
  mode: "disabled",
  render_version: "persian-subtitles-masihh-v1",
  transcription_provider: "deepgram",
  transcription_model: "nova-3",
  translation_model: "gpt-5.4-mini",
  vision_model: "gpt-5.4-mini",
  subtitle_style: {
    text_color: "#FFE45C",
    background_color: "#000000",
    font_scale: 1.18,
    max_width_pct: 0.92,
    bottom_padding_pct: 0.06,
  },
  delogo: {
    vision_mode: "always",
    max_regions: 2,
    max_single_area_ratio: 0.10,
    max_total_area_ratio: 0.15,
    engine: "opencv",
    opencv_radius: 2,
    opencv_kernel: 7,
    opencv_dilate_iterations: 2,
    opencv_feather: 0,
  },
  watermark: {
    enabled: true,
    apply_when: "subtitle_track",
    opacity: 0.16,
    top_right_opacity: 0.34,
    cover_opacity: 0.34,
    multiple: true,
    cover_delogo: true,
    cover_padding_pct: 0,
  },
};

export const RENDER_SETTINGS_ERROR_MARKER = "renderer_error";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function oneOf(value, allowed, fallback) {
  const raw = String(value ?? "").toLowerCase();
  return allowed.includes(raw) ? raw : fallback;
}

function hexColor(value, fallback) {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

export function normalizeRenderSettings(input = {}) {
  const raw = isRecord(input) ? input : {};
  const subtitleRaw = isRecord(raw.subtitle_style) ? raw.subtitle_style : {};
  const delogoRaw = isRecord(raw.delogo) ? raw.delogo : {};
  const watermarkRaw = isRecord(raw.watermark) ? raw.watermark : {};
  return {
    mode: oneOf(raw.mode, ["disabled", "shadow", "enabled"], DEFAULT_RENDER_SETTINGS.mode),
    render_version: String(raw.render_version || DEFAULT_RENDER_SETTINGS.render_version),
    transcription_provider: oneOf(raw.transcription_provider, ["deepgram", "openai"], DEFAULT_RENDER_SETTINGS.transcription_provider),
    transcription_model: String(raw.transcription_model || DEFAULT_RENDER_SETTINGS.transcription_model),
    translation_model: String(raw.translation_model || DEFAULT_RENDER_SETTINGS.translation_model),
    vision_model: String(raw.vision_model || raw.translation_model || DEFAULT_RENDER_SETTINGS.vision_model),
    subtitle_style: {
      text_color: hexColor(subtitleRaw.text_color, DEFAULT_RENDER_SETTINGS.subtitle_style.text_color),
      background_color: hexColor(subtitleRaw.background_color, DEFAULT_RENDER_SETTINGS.subtitle_style.background_color),
      font_scale: clampNumber(subtitleRaw.font_scale, 0.75, 1.35, DEFAULT_RENDER_SETTINGS.subtitle_style.font_scale),
      max_width_pct: clampNumber(subtitleRaw.max_width_pct, 0.72, 0.96, DEFAULT_RENDER_SETTINGS.subtitle_style.max_width_pct),
      bottom_padding_pct: clampNumber(subtitleRaw.bottom_padding_pct, 0.025, 0.14, DEFAULT_RENDER_SETTINGS.subtitle_style.bottom_padding_pct),
    },
    delogo: {
      vision_mode: oneOf(delogoRaw.vision_mode, ["off", "auto", "always"], DEFAULT_RENDER_SETTINGS.delogo.vision_mode),
      max_regions: Math.round(clampNumber(delogoRaw.max_regions, 0, 4, DEFAULT_RENDER_SETTINGS.delogo.max_regions)),
      max_single_area_ratio: clampNumber(delogoRaw.max_single_area_ratio, 0.01, 0.30, DEFAULT_RENDER_SETTINGS.delogo.max_single_area_ratio),
      max_total_area_ratio: clampNumber(delogoRaw.max_total_area_ratio, 0.02, 0.45, DEFAULT_RENDER_SETTINGS.delogo.max_total_area_ratio),
      engine: oneOf(delogoRaw.engine, ["opencv", "ffmpeg"], DEFAULT_RENDER_SETTINGS.delogo.engine),
      opencv_radius: Math.round(clampNumber(delogoRaw.opencv_radius, 1, 8, DEFAULT_RENDER_SETTINGS.delogo.opencv_radius)),
      opencv_kernel: Math.round(clampNumber(delogoRaw.opencv_kernel, 3, 21, DEFAULT_RENDER_SETTINGS.delogo.opencv_kernel)),
      opencv_dilate_iterations: Math.round(clampNumber(delogoRaw.opencv_dilate_iterations, 0, 8, DEFAULT_RENDER_SETTINGS.delogo.opencv_dilate_iterations)),
      opencv_feather: Math.round(clampNumber(delogoRaw.opencv_feather, 0, 12, DEFAULT_RENDER_SETTINGS.delogo.opencv_feather)),
    },
    watermark: {
      enabled: watermarkRaw.enabled !== false,
      apply_when: oneOf(watermarkRaw.apply_when ?? watermarkRaw.applyWhen, ["subtitle_track", "modified", "always", "never"], DEFAULT_RENDER_SETTINGS.watermark.apply_when),
      opacity: clampNumber(watermarkRaw.opacity, 0.03, 0.35, DEFAULT_RENDER_SETTINGS.watermark.opacity),
      top_right_opacity: clampNumber(watermarkRaw.top_right_opacity, 0.12, 0.70, DEFAULT_RENDER_SETTINGS.watermark.top_right_opacity),
      cover_opacity: clampNumber(watermarkRaw.cover_opacity, 0.12, 0.70, DEFAULT_RENDER_SETTINGS.watermark.cover_opacity),
      multiple: watermarkRaw.multiple !== false,
      cover_delogo: watermarkRaw.cover_delogo !== false,
      cover_padding_pct: clampNumber(watermarkRaw.cover_padding_pct, 0, 0.08, DEFAULT_RENDER_SETTINGS.watermark.cover_padding_pct),
    },
  };
}

export async function loadRenderSettings(supabase) {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "video_render_config")
    .maybeSingle();
  if (error) throw error;
  return normalizeRenderSettings(data?.value);
}

export async function loadRenderSettingsOrDefault(supabase, metrics = null) {
  try {
    return await loadRenderSettings(supabase);
  } catch (error) {
    if (metrics) metrics.video_render_config_error = RENDER_SETTINGS_ERROR_MARKER;
    return normalizeRenderSettings();
  }
}

export function applyRenderSettings(config, settings) {
  const normalized = normalizeRenderSettings(settings);
  const next = {
    ...config,
    renderVersion: normalized.render_version || config.renderVersion,
    transcriptionProvider: normalized.transcription_provider,
    translationModel: normalized.translation_model,
    cleanupModel: normalized.translation_model,
    visionModel: normalized.vision_model,
    visionSpecialistMode: normalized.delogo.vision_mode,
    maxDelogoRegions: normalized.delogo.max_regions,
    maxSingleDelogoAreaRatio: normalized.delogo.max_single_area_ratio,
    maxTotalDelogoAreaRatio: normalized.delogo.max_total_area_ratio,
    delogoEngine: normalized.delogo.engine,
    opencvRadius: normalized.delogo.opencv_radius,
    opencvKernel: normalized.delogo.opencv_kernel,
    opencvDilateIterations: normalized.delogo.opencv_dilate_iterations,
    opencvFeather: normalized.delogo.opencv_feather,
    subtitleStyleConfig: normalized.subtitle_style,
    watermarkConfig: normalized.watermark,
    videoRenderMode: normalized.mode,
  };
  if (normalized.transcription_provider === "deepgram") {
    next.deepgramModel = normalized.transcription_model || config.deepgramModel;
  } else {
    next.transcriptionModel = normalized.transcription_model || config.transcriptionModel;
  }
  return next;
}

import { spawn } from "node:child_process";

export function shouldEnableAdaptiveMask(result) {
  const score = Number(result?.captionBandScore ?? 0);
  const regions = Number(result?.textLikeRegions ?? 0);
  return score >= 0.65 && regions >= 3;
}

export function captionDetectionFps(probe, frames = 6) {
  const durationSeconds = Number(probe?.durationMs ?? 0) / 1000;
  const frameCount = Math.max(1, Number(frames) || 6);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= frameCount) return 1;
  return Math.min(1, frameCount / durationSeconds);
}

function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function drawText(text, opts = {}) {
  const fontColor = opts.fontColor ?? "white@0.14";
  const fontSize = opts.fontSize ?? 22;
  const x = opts.x ?? "(w-text_w)/2";
  const y = opts.y ?? "(h-text_h)/2";
  const boxColor = opts.boxColor ?? "black@0.10";
  const boxBorder = opts.boxBorder ?? 10;
  const box = opts.box === false ? "" : `:box=1:boxcolor=${boxColor}:boxborderw=${boxBorder}`;
  const border = opts.border
    ? `:borderw=${opts.border.width ?? 1}:bordercolor=${opts.border.color ?? "black@0.16"}`
    : "";
  const shadow = opts.shadow
    ? `:shadowcolor=${opts.shadow.color ?? "black@0.20"}:shadowx=${opts.shadow.x ?? 1}:shadowy=${opts.shadow.y ?? 1}`
    : "";
  return `drawtext=text='${escapeFilterValue(text)}':fontcolor=${fontColor}:fontsize=${fontSize}:x=${x}:y=${y}${box}${border}${shadow}`;
}

function offsetExpression(value, offset) {
  const raw = String(value ?? "0");
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return String(Math.round(numeric + offset));
  return offset >= 0 ? `(${raw})+${offset}` : `(${raw})${offset}`;
}

function delogoFilter(region) {
  const x = Math.max(0, Math.round(Number(region?.x) || 0));
  const y = Math.max(0, Math.round(Number(region?.y) || 0));
  const w = Math.max(1, Math.round(Number(region?.w) || 1));
  const h = Math.max(1, Math.round(Number(region?.h) || 1));
  const show = region?.show === true ? ":show=1" : "";
  return `delogo=x=${x}:y=${y}:w=${w}:h=${h}${show}`;
}

function normalizedRegion(region) {
  return {
    x: Math.max(0, Math.round(Number(region?.x) || 0)),
    y: Math.max(0, Math.round(Number(region?.y) || 0)),
    w: Math.max(1, Math.round(Number(region?.w) || 1)),
    h: Math.max(1, Math.round(Number(region?.h) || 1)),
  };
}

function clampRegion(region, width, height) {
  const raw = normalizedRegion(region);
  const x = Math.max(0, Math.min(width - 1, raw.x));
  const y = Math.max(0, Math.min(height - 1, raw.y));
  const w = Math.max(1, Math.min(width - x, raw.w));
  const h = Math.max(1, Math.min(height - y, raw.h));
  return { x, y, w, h };
}

function normalizeLayoutRegion(region, width, height) {
  const box = region?.box && typeof region.box === "object" ? region.box : region;
  if (box?.valid === false) return null;
  const values = [box?.x, box?.y, box?.w, box?.h].map(Number);
  if (!values.every(Number.isFinite)) return null;
  let [x, y, w, h] = values;
  if (w <= 0 || h <= 0) return null;
  const normalized = x >= 0 && y >= 0 && x <= 1 && y <= 1 && w <= 1 && h <= 1;
  if (normalized) {
    x *= width;
    y *= height;
    w *= width;
    h *= height;
  }
  if (x >= width || y >= height) return null;
  return clampRegion({ x, y, w, h }, width, height);
}

function padRegion(region, padding, width, height) {
  return clampRegion({
    x: region.x - padding,
    y: region.y - padding,
    w: region.w + padding * 2,
    h: region.h + padding * 2,
  }, width, height);
}

function regionsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function estimateTextRegion(text, opts, width, height) {
  const fontSize = Math.max(1, Number(opts.fontSize) || 24);
  const boxBorder = opts.box === false ? 0 : Number(opts.boxBorder ?? 10);
  const textWidth = Math.ceil(String(text).length * fontSize * 0.58);
  const textHeight = Math.ceil(fontSize * 1.18);
  return clampRegion({
    x: Number(opts.x) || 0,
    y: Number(opts.y) || 0,
    w: textWidth + boxBorder * 2,
    h: textHeight + boxBorder * 2,
  }, width, height);
}

function subtitleOccupiedRegion({ subtitlePlacement, height, width }) {
  const marginV = Number(subtitlePlacement?.marginV);
  const bottomMargin = Number(subtitlePlacement?.bottomMargin);
  const resolvedMargin = Number.isFinite(marginV) && marginV > 0
    ? marginV
    : Number.isFinite(bottomMargin) && bottomMargin > 0
      ? height * bottomMargin
      : Math.max(56, height * 0.08);
  const subtitleHeight = Math.max(80, Math.round(height * 0.18));
  return clampRegion({
    x: 0,
    y: height - resolvedMargin - subtitleHeight,
    w: width,
    h: subtitleHeight + resolvedMargin,
  }, width, height);
}

function textPlacement(text, opts, width, height) {
  return {
    text,
    opts,
    region: estimateTextRegion(text, opts, width, height),
  };
}

function placeFirstNonOverlapping(candidates, occupied, width, height, padding = 10) {
  for (const candidate of candidates) {
    const region = padRegion(candidate.region, padding, width, height);
    if (occupied.some((item) => regionsOverlap(region, item))) continue;
    occupied.push(region);
    return candidate;
  }
  return null;
}

function delogoReplacementPlacement(region, width, height) {
  const { x, y, w, h } = normalizedRegion(region);
  const label = w >= 120 ? "X @Masihh" : "@Masihh";
  const widthFit = Math.floor((w * 0.90) / Math.max(1, label.length * 0.58));
  const heightFit = Math.floor(h * 0.82);
  const fontSize = Math.max(12, Math.min(180, widthFit, heightFit));
  const lowerCenteredRepair = y >= height * 0.50 && x >= width * 0.20 && x + w <= width * 0.80 && h >= height * 0.09;
  const centeredY = y + (h - fontSize * 1.18) / 2;
  const lowerY = y + h - fontSize * 1.18 - h * 0.10;
  return textPlacement(label, {
    fontColor: "white@0.32",
    fontSize,
    x: Math.max(0, Math.round(x + (w - label.length * fontSize * 0.58) / 2)),
    y: Math.max(0, Math.round(lowerCenteredRepair ? lowerY : centeredY)),
    box: false,
    border: { width: 1, color: "black@0.24" },
    sideShadow: { color: "black@0.24", offset: 1 },
  }, width, height);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function watermarkConfig(options = {}) {
  return options.watermarkConfig && typeof options.watermarkConfig === "object"
    ? options.watermarkConfig
    : {};
}

function alpha(value, fallback) {
  return clampNumber(value, 0.03, 0.75, fallback).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function white(value, fallback) {
  return `white@${alpha(value, fallback)}`;
}

export function resolveWatermarkLayout(options = {}) {
  const width = Math.max(320, Number(options.width) || 1080);
  const height = Math.max(320, Number(options.height) || 1080);
  const wm = watermarkConfig(options);
  const baseOpacity = clampNumber(wm.opacity, 0.03, 0.35, 0.16);
  const badgeOpacity = clampNumber(wm.top_right_opacity, 0.12, 0.70, 0.34);
  const coverOpacity = clampNumber(wm.cover_opacity, 0.12, 0.70, 0.34);
  const coverPadding = Math.round(Math.min(width, height) * clampNumber(wm.cover_padding_pct, 0, 0.08, 0));
  const multiple = wm.multiple !== false;
  const coverDelogo = wm.cover_delogo !== false;
  const sideMargin = Math.max(18, Math.round(width * 0.035));
  const topMargin = Math.max(18, Math.round(height * 0.035));
  const centerSize = Math.min(Math.max(48, Math.round(height / 7.2)), Math.round(width / 5));
  const badgeSize = Math.min(Math.max(30, Math.round(height / 24)), Math.round(width / 7.5));
  const ghostSize = Math.max(20, Math.round(height / 42));
  const delogoReplacementRegions = Array.isArray(options.delogoReplacementRegions)
    ? options.delogoReplacementRegions
    : Array.isArray(options.delogoRegions)
      ? options.delogoRegions
      : [];
  const occupied = [];
  for (const region of options.protectedRegions ?? []) {
    const normalized = normalizeLayoutRegion(region, width, height);
    if (normalized) occupied.push(padRegion(normalized, 10, width, height));
  }
  if (options.hasSubtitleTrack) {
    occupied.push(subtitleOccupiedRegion({ subtitlePlacement: options.subtitlePlacement, width, height }));
  }

  const local = coverDelogo ? delogoReplacementRegions
    .map((region) => {
      const normalized = normalizeLayoutRegion(region, width, height);
      const coveredRegion = normalized ? padRegion(normalized, coverPadding, width, height) : null;
      const placement = coveredRegion ? delogoReplacementPlacement(coveredRegion, width, height) : null;
      if (placement) {
        placement.opts.fontColor = white(coverOpacity, 0.34);
        placement.opts.border = { width: 1, color: "black@0.28" };
        placement.opts.sideShadow = { color: "black@0.22", offset: 1 };
      }
      return placement;
    })
    .filter(Boolean) : [];
  for (const placement of local) {
    occupied.push(padRegion(placement.region, Math.max(10, Math.round(height * 0.012)), width, height));
  }

  const centerText = "@Masihh";
  const centerApproxW = centerText.length * centerSize * 0.58;
  const centerApproxH = centerSize * 1.18;
  const centerStyle = {
    fontColor: white(baseOpacity, 0.11),
    fontSize: centerSize,
    box: false,
    border: { width: 1, color: "black@0.16" },
    sideShadow: { color: "black@0.22", offset: 2 },
  };
  const centerCandidates = [
    [width / 2 - centerApproxW / 2, height / 2 - centerApproxH / 2],
    [width / 2 - centerApproxW / 2, height * 0.30 - centerApproxH / 2],
    [width / 2 - centerApproxW / 2, height * 0.66 - centerApproxH / 2],
  ].map(([x, y]) => textPlacement(centerText, {
    ...centerStyle,
    x: Math.round(x),
    y: Math.round(y),
  }, width, height));

  const badgeText = "X @Masihh";
  const badgeBoxBorder = 0;
  const badgeApproxW = badgeText.length * badgeSize * 0.58 + badgeBoxBorder * 2;
  const badgeApproxH = badgeSize * 1.18 + badgeBoxBorder * 2;
  const badgeStyle = {
    fontColor: white(badgeOpacity, 0.42),
    fontSize: badgeSize,
    box: false,
    boxColor: "black@0.00",
    boxBorder: badgeBoxBorder,
    border: { width: 1, color: "black@0.34" },
    shadow: {
      color: "black@0.36",
      x: Math.max(1, Math.round(badgeSize / 22)),
      y: Math.max(1, Math.round(badgeSize / 22)),
    },
    sideShadow: { color: "black@0.18", offset: Math.max(1, Math.round(badgeSize / 20)) },
  };
  const badgeCandidates = [
    [width - badgeApproxW - sideMargin, topMargin],
    [sideMargin, topMargin],
    [width - badgeApproxW - sideMargin, height - badgeApproxH - topMargin],
    [sideMargin, height - badgeApproxH - topMargin],
  ].map(([x, y]) => textPlacement(badgeText, {
    ...badgeStyle,
    x: Math.round(x),
    y: Math.round(y),
  }, width, height));

  const ghosts = [];
  const ghostStyle = {
    box: false,
    sideShadow: { color: "black@0.16", offset: 1 },
  };
  const ghostCandidates = [
    [white(baseOpacity * 0.82, 0.09), 0.10, 0.15],
    [white(baseOpacity * 0.82, 0.09), 0.70, 0.18],
    [white(baseOpacity * 0.78, 0.085), 0.17, 0.34],
    [white(baseOpacity * 0.78, 0.085), 0.67, 0.40],
    [white(baseOpacity * 0.72, 0.08), 0.38, 0.13],
    [white(baseOpacity * 0.72, 0.08), 0.49, 0.53],
    [white(baseOpacity * 0.68, 0.075), 0.08, 0.54],
    [white(baseOpacity * 0.68, 0.075), 0.78, 0.56],
  ].map(([fontColor, xRatio, yRatio]) => textPlacement("@Masihh", {
    ...ghostStyle,
    fontColor,
    fontSize: ghostSize,
    x: Math.round(width * xRatio),
    y: Math.round(height * yRatio),
  }, width, height));

  const center = multiple ? placeFirstNonOverlapping(centerCandidates, occupied, width, height, Math.round(height * 0.018)) : null;
  const badge = placeFirstNonOverlapping(badgeCandidates, occupied, width, height, Math.round(height * 0.012));
  if (multiple) {
    for (const candidate of ghostCandidates) {
      if (ghosts.length >= 6) break;
      const placed = placeFirstNonOverlapping([candidate], occupied, width, height, Math.round(height * 0.010));
      if (placed) ghosts.push(placed);
    }
  }

  return {
    local,
    center,
    badge,
    ghosts,
    occupied,
  };
}

function drawPlacement(placement) {
  const opts = {
    ...placement.opts,
    x: String(placement.opts.x),
    y: String(placement.opts.y),
  };
  const sideShadow = opts.sideShadow;
  delete opts.sideShadow;
  if (!sideShadow) return [drawText(placement.text, opts)];
  const offset = Math.max(1, Number(sideShadow.offset ?? 1));
  const shadowBase = {
    ...opts,
    fontColor: sideShadow.color ?? "black@0.16",
    box: false,
    border: null,
    shadow: null,
  };
  return [
    drawText(placement.text, { ...shadowBase, x: offsetExpression(opts.x, -offset) }),
    drawText(placement.text, { ...shadowBase, x: offsetExpression(opts.x, offset) }),
    drawText(placement.text, opts),
  ];
}

function renderFilters(options, settings = {}) {
  const includeDelogo = settings.includeDelogo !== false;
  const {
    assPath,
    enableWatermark = Boolean(assPath),
    enableAdaptiveMask = false,
    fontsDir = "/usr/share/fonts",
    delogoRegions = [],
    delogoReplacementRegions = delogoRegions,
    adaptiveMaskOpacity = 0.18,
  } = options;
  const watermarkLayout = enableWatermark
    ? resolveWatermarkLayout({
      ...options,
      delogoReplacementRegions,
      hasSubtitleTrack: Boolean(assPath),
    })
    : { local: [], center: null, badge: null, ghosts: [] };

  const filters = [];
  if (includeDelogo) {
    for (const region of delogoRegions) {
      filters.push(delogoFilter(region));
    }
  }
  filters.push(...watermarkLayout.local.flatMap(drawPlacement));
  if (enableAdaptiveMask) {
    filters.push(`drawbox=x=0:y=ih*0.70:w=iw:h=ih*0.24:color=black@${adaptiveMaskOpacity}:t=fill`);
  }
  if (watermarkLayout.center) filters.push(...drawPlacement(watermarkLayout.center));
  if (watermarkLayout.badge) filters.push(...drawPlacement(watermarkLayout.badge));
  filters.push(...watermarkLayout.ghosts.flatMap(drawPlacement));
  if (assPath) {
    filters.push(`subtitles='${escapeFilterValue(assPath)}':fontsdir='${escapeFilterValue(fontsDir)}'`);
  }
  if (filters.length === 0) filters.push("null");
  return filters;
}

function filterGraph(options, settings = {}) {
  const inputIndex = Number(settings.inputIndex ?? 0);
  return `[${inputIndex}:v]${renderFilters(options, settings).join(",")}[v]`;
}

function encodeArgs({ filter, outputPath, crf, preset, threads, audioMap = "0:a?", shortest = false }) {
  return [
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", audioMap,
    "-sn",
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", String(crf),
    "-threads", String(threads),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    ...(shortest ? ["-shortest"] : []),
    "-movflags", "+faststart",
    outputPath,
  ];
}

export function buildRenderCommand(options) {
  const {
    inputPath,
    outputPath,
    crf = 23,
    preset = "veryfast",
    threads = 3,
  } = options;

  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-i", inputPath,
      ...encodeArgs({
        filter: filterGraph(options),
        outputPath,
        crf,
        preset,
        threads,
      }),
    ],
  };
}

function fpsValue(fps) {
  const value = Number(fps);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function opencvRectArgs(regions) {
  return regions
    .map(normalizedRegion)
    .flatMap((region) => ["--rect", `${region.x},${region.y},${region.w},${region.h}`]);
}

export function buildOpenCvInpaintRenderCommand(options) {
  const {
    inputPath,
    outputPath,
    crf = 23,
    preset = "veryfast",
    threads = 3,
    delogoRegions = [],
    opencvPython = "python3",
    opencvScript,
    opencvMode = "hybrid",
    opencvAlgorithm = "telea",
    opencvRadius = 2,
    opencvKernel = 7,
    opencvDilateIterations = 2,
    opencvCloseIterations = 1,
    opencvFeather = 0,
    maxFrames = 0,
  } = options;
  if (!opencvScript) throw new Error("opencvScript is required for OpenCV delogo rendering");
  const width = Math.max(2, Math.round(Number(options.width) || 0));
  const height = Math.max(2, Math.round(Number(options.height) || 0));
  if (!width || !height) throw new Error("width and height are required for OpenCV delogo rendering");
  const fps = fpsValue(options.fps);
  return {
    bin: "pipeline",
    pipeline: [
      {
        bin: opencvPython,
        args: [
          opencvScript,
          inputPath,
          ...opencvRectArgs(delogoRegions),
          "--mode", opencvMode,
          "--algorithm", opencvAlgorithm,
          "--radius", String(opencvRadius),
          "--kernel", String(opencvKernel),
          "--dilate-iterations", String(opencvDilateIterations),
          "--close-iterations", String(opencvCloseIterations),
          "--feather", String(opencvFeather),
          ...(Number(maxFrames) > 0 ? ["--max-frames", String(Math.round(Number(maxFrames)))] : []),
        ],
      },
      {
        bin: "ffmpeg",
        args: [
          "-hide_banner",
          "-y",
          "-f", "rawvideo",
          "-pix_fmt", "bgr24",
          "-s", `${width}x${height}`,
          "-r", String(fps),
          "-i", "pipe:0",
          "-i", inputPath,
          ...encodeArgs({
            filter: filterGraph({
              ...options,
              delogoRegions: [],
              delogoReplacementRegions: delogoRegions,
            }, { includeDelogo: false, inputIndex: 0 }),
            outputPath,
            crf,
            preset,
            threads,
            audioMap: "1:a?",
            shortest: true,
          }),
        ],
      },
    ],
  };
}

export function buildContactSheetCommand(inputPath, outputPath, options = {}) {
  const width = Number(options.width || 360);
  const columns = Number(options.columns || 4);
  const rows = Number(options.rows || 3);
  const fps = Number(options.fps || 1);
  const frames = Math.max(1, columns * rows);
  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-i", inputPath,
      "-vf", `fps=${fps},scale=${width}:-1,tile=${columns}x${rows}`,
      "-frames:v", "1",
      "-q:v", "4",
      "-update", "1",
      outputPath,
    ],
    frames,
  };
}

export function buildFrameSampleCommand(inputPath, outputPath, options = {}) {
  const seekSeconds = Math.max(0, Number(options.seekSeconds ?? 1));
  const width = Number(options.width ?? 0);
  const scaleArgs = width > 0 ? ["-vf", `scale=${Math.round(width)}:-1:flags=lanczos`] : [];
  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-ss", String(seekSeconds),
      "-i", inputPath,
      ...scaleArgs,
      "-frames:v", "1",
      "-q:v", "3",
      "-update", "1",
      outputPath,
    ],
  };
}

function zoomTile(label, crop, tileWidth, tileHeight) {
  return `[0:v]crop=${crop},scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[${label}]`;
}

export function buildWatermarkInspectionSheetCommand(inputPath, outputPath, options = {}) {
  const tileWidth = Math.max(320, Math.round(Number(options.tileWidth ?? 720)));
  const tileHeight = Math.max(180, Math.round(Number(options.tileHeight ?? 360)));
  const crops = [
    zoomTile("tl", "iw*0.50:ih*0.34:0:0", tileWidth, tileHeight),
    zoomTile("tr", "iw*0.50:ih*0.34:iw*0.50:0", tileWidth, tileHeight),
    zoomTile("mc", "iw*0.62:ih*0.36:iw*0.19:ih*0.32", tileWidth, tileHeight),
    zoomTile("ll", "iw*0.50:ih*0.38:0:ih*0.56", tileWidth, tileHeight),
    zoomTile("lc", "iw*0.62:ih*0.38:iw*0.19:ih*0.56", tileWidth, tileHeight),
    zoomTile("lr", "iw*0.50:ih*0.38:iw*0.50:ih*0.56", tileWidth, tileHeight),
  ];
  const layout = [
    `0_0`,
    `${tileWidth}_0`,
    `0_${tileHeight}`,
    `${tileWidth}_${tileHeight}`,
    `0_${tileHeight * 2}`,
    `${tileWidth}_${tileHeight * 2}`,
  ].join("|");

  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-i", inputPath,
      "-filter_complex", `${crops.join(";")};[tl][tr][mc][ll][lc][lr]xstack=inputs=6:layout=${layout}`,
      "-frames:v", "1",
      "-q:v", "3",
      "-update", "1",
      outputPath,
    ],
  };
}

export function buildPreviewClipCommand(options) {
  const command = buildRenderCommand(options);
  return {
    ...command,
    args: [
      "-hide_banner",
      "-y",
      "-t", String(options.previewSeconds ?? 20),
      "-i", options.inputPath,
      ...command.args.slice(4),
    ],
  };
}

export function buildOpenCvInpaintPreviewCommand(options) {
  const fps = fpsValue(options.fps);
  return buildOpenCvInpaintRenderCommand({
    ...options,
    maxFrames: Math.max(1, Math.round(Number(options.previewSeconds ?? 20) * fps)),
    fps,
  });
}

export function buildAudioExtractCommand(inputPath, outputPath) {
  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "48k",
      outputPath,
    ],
  };
}

export function buildAudioWindowExtractCommand(inputPath, outputPath, options = {}) {
  const startSeconds = Math.max(0, Number(options.startSeconds ?? 0));
  const durationSeconds = Math.max(0.5, Number(options.durationSeconds ?? 14));
  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-ss", String(startSeconds),
      "-t", String(durationSeconds),
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "48k",
      outputPath,
    ],
  };
}

export function buildEnhancedAudioExtractCommand(inputPath, outputPath) {
  return {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-af", "highpass=f=120,lowpass=f=3800,afftdn=nf=-25,dynaudnorm=f=150:g=15:p=0.95",
      "-b:a", "64k",
      outputPath,
    ],
  };
}

export function runCommand(command, options = {}) {
  if (Array.isArray(command?.pipeline)) {
    return runPipelineCommand(command, options);
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command.bin, command.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout, stderr, durationMs: Date.now() - startedAt };
      if (code === 0) resolve(result);
      else reject(new Error(`${options.label ?? command.bin} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function runPipelineCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const [producerCommand, consumerCommand] = command.pipeline;
    const startedAt = Date.now();
    const producer = spawn(producerCommand.bin, producerCommand.args, { stdio: ["ignore", "pipe", "pipe"] });
    const consumer = spawn(consumerCommand.bin, consumerCommand.args, { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let stdout = "";
    let stderr = "";
    let producerCode = null;
    let consumerCode = null;

    function done(error) {
      if (settled) return;
      if (error) {
        settled = true;
        producer.kill("SIGTERM");
        consumer.kill("SIGTERM");
        reject(error);
        return;
      }
      if (producerCode === null || consumerCode === null) return;
      const result = { code: consumerCode, stdout, stderr, durationMs: Date.now() - startedAt };
      if (producerCode === 0 && consumerCode === 0) {
        settled = true;
        resolve(result);
      } else {
        settled = true;
        reject(new Error(`${options.label ?? command.bin} exited producer=${producerCode} consumer=${consumerCode}: ${stderr.slice(-2000)}`));
      }
    }

    producer.stdout.pipe(consumer.stdin);
    producer.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    consumer.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    consumer.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    producer.on("error", done);
    consumer.on("error", done);
    producer.on("close", (code) => {
      producerCode = code;
      done();
    });
    consumer.on("close", (code) => {
      consumerCode = code;
      done();
    });
  });
}

function runBufferCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.bin, command.args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${options.label ?? command.bin} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export async function probeVideo(inputPath) {
  const command = {
    bin: "ffprobe",
    args: [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      inputPath,
    ],
  };
  const result = await runCommand(command, { label: "ffprobe" });
  const parsed = JSON.parse(result.stdout || "{}");
  const video = (parsed.streams || []).find((stream) => stream.codec_type === "video") || {};
  const duration = Number(video.duration ?? parsed.format?.duration ?? 0);
  return {
    width: Number(video.width ?? 0) || null,
    height: Number(video.height ?? 0) || null,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
    raw: parsed,
  };
}

export async function detectCaptionBand(inputPath, probe, options = {}) {
  const sourceWidth = Number(probe?.width || 0);
  const sourceHeight = Number(probe?.height || 0);
  if (!sourceWidth || !sourceHeight) {
    return { captionBandScore: 0, textLikeRegions: 0, frames: 0 };
  }

  const width = Number(options.width || 160);
  const height = Math.max(2, Math.round((sourceHeight / sourceWidth) * width));
  const frames = Number(options.frames || 6);
  const fps = Number(options.fps || captionDetectionFps(probe, frames));
  const command = {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-v", "error",
      "-i", inputPath,
      "-vf", `fps=${fps},scale=${width}:${height},format=gray`,
      "-frames:v", String(frames),
      "-f", "rawvideo",
      "pipe:1",
    ],
  };

  let bytes;
  try {
    bytes = await runBufferCommand(command, { label: "caption_detect" });
  } catch {
    return { captionBandScore: 0, textLikeRegions: 0, frames: 0 };
  }

  const frameSize = width * height;
  const frameCount = Math.floor(bytes.length / frameSize);
  if (frameCount === 0) return { captionBandScore: 0, textLikeRegions: 0, frames: 0 };

  const yStart = Math.floor(height * 0.66);
  const yEnd = Math.floor(height * 0.92);
  const bandPixels = Math.max(1, (yEnd - yStart) * width);
  let confidentFrames = 0;
  let scoreTotal = 0;

  for (let f = 0; f < frameCount; f += 1) {
    const offset = f * frameSize;
    let brightContrast = 0;
    let activeRows = 0;
    for (let y = yStart; y < yEnd; y += 1) {
      let rowBrightContrast = 0;
      for (let x = 1; x < width - 1; x += 1) {
        const value = bytes[offset + y * width + x];
        if (value < 205) continue;
        const left = bytes[offset + y * width + x - 1];
        const right = bytes[offset + y * width + x + 1];
        const above = y > 0 ? bytes[offset + (y - 1) * width + x] : value;
        const below = y < height - 1 ? bytes[offset + (y + 1) * width + x] : value;
        if (Math.min(left, right, above, below) < 120 || Math.max(Math.abs(value - left), Math.abs(value - right), Math.abs(value - above), Math.abs(value - below)) > 70) {
          brightContrast += 1;
          rowBrightContrast += 1;
        }
      }
      if (rowBrightContrast / width > 0.012) activeRows += 1;
    }
    const frameScore = Math.min(1, (brightContrast / bandPixels) * 12);
    scoreTotal += frameScore;
    if (frameScore >= 0.65 && activeRows >= 3) confidentFrames += 1;
  }

  return {
    captionBandScore: scoreTotal / frameCount,
    textLikeRegions: confidentFrames,
    frames: frameCount,
    sampleFps: fps,
  };
}

function textLikeDensity(bytes, offset, width, xStart, xEnd, yStart, yEnd) {
  const total = Math.max(1, (xEnd - xStart) * (yEnd - yStart));
  let textLike = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = Math.max(1, xStart); x < Math.min(width - 1, xEnd); x += 1) {
      const value = bytes[offset + y * width + x];
      if (value < 185) continue;
      const left = bytes[offset + y * width + x - 1];
      const right = bytes[offset + y * width + x + 1];
      if (Math.min(left, right) < 130 || Math.max(Math.abs(value - left), Math.abs(value - right)) > 60) {
        textLike += 1;
      }
    }
  }
  return textLike / total;
}

export async function detectWatermarkOverlay(inputPath, probe, options = {}) {
  const sourceWidth = Number(probe?.width || 0);
  const sourceHeight = Number(probe?.height || 0);
  if (!sourceWidth || !sourceHeight) {
    return { stableOverlayScore: 0, regions: [], frames: 0 };
  }

  const width = Number(options.width || 180);
  const height = Math.max(2, Math.round((sourceHeight / sourceWidth) * width));
  const frames = Number(options.frames || 8);
  const command = {
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-v", "error",
      "-i", inputPath,
      "-vf", `fps=1,scale=${width}:${height},format=gray`,
      "-frames:v", String(frames),
      "-f", "rawvideo",
      "pipe:1",
    ],
  };

  let bytes;
  try {
    bytes = await runBufferCommand(command, { label: "watermark_detect" });
  } catch {
    return { stableOverlayScore: 0, regions: [], frames: 0 };
  }

  const frameSize = width * height;
  const frameCount = Math.floor(bytes.length / frameSize);
  if (frameCount === 0) return { stableOverlayScore: 0, regions: [], frames: 0 };

  const regions = [
    { name: "top_left", x0: 0, x1: 0.36, y0: 0, y1: 0.22 },
    { name: "top_right", x0: 0.64, x1: 1, y0: 0, y1: 0.22 },
    { name: "bottom_left", x0: 0, x1: 0.36, y0: 0.76, y1: 0.98 },
    { name: "bottom_right", x0: 0.64, x1: 1, y0: 0.76, y1: 0.98 },
  ];

  const scored = regions.map((region) => {
    const densities = [];
    const xStart = Math.floor(width * region.x0);
    const xEnd = Math.floor(width * region.x1);
    const yStart = Math.floor(height * region.y0);
    const yEnd = Math.floor(height * region.y1);
    for (let frame = 0; frame < frameCount; frame += 1) {
      densities.push(textLikeDensity(bytes, frame * frameSize, width, xStart, xEnd, yStart, yEnd));
    }
    const activeFrames = densities.filter((density) => density >= 0.0075).length;
    const averageDensity = densities.reduce((sum, value) => sum + value, 0) / densities.length;
    const activeRatio = activeFrames / frameCount;
    const score = Math.min(1, averageDensity * 42) * activeRatio;
    return {
      name: region.name,
      score,
      averageDensity,
      activeFrames,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    stableOverlayScore: scored[0]?.score ?? 0,
    regions: scored.filter((region) => region.score >= 0.2),
    frames: frameCount,
  };
}

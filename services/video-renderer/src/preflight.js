import { spawn } from "node:child_process";
import { detectCaptionBand, detectWatermarkOverlay } from "./ffmpeg.js";

const PLATFORM_PATTERNS = [
  /tiktok/i,
  /instagram/i,
  /youtube/i,
  /youtu\.be/i,
  /telegram/i,
  /twitter/i,
  /x\.com/i,
  /@[\w.]{2,}/i,
  /\b[\w.-]+\.(?:com|net|org|io|ir|co)\b/i,
];

const PLATFORM_EXTRACTORS = [
  /\bTikTok\b/gi,
  /\bInstagram\b/gi,
  /\bYouTube\b/gi,
  /\bTelegram\b/gi,
  /\bTwitter\b/gi,
  /\bX\.com\b/gi,
  /@[\w.]{2,}/g,
  /\b[\w.-]+\.(?:com|net|org|io|ir|co)\b/gi,
];

export const DEFAULT_TESSERACT_LANG = "eng+fas+ara+heb";

export function tesseractArgs(imagePath, outputFormat = null) {
  const language = String(process.env.TESSERACT_LANG || DEFAULT_TESSERACT_LANG).trim() || DEFAULT_TESSERACT_LANG;
  return [
    imagePath,
    "stdout",
    "-l",
    language,
    "--psm",
    "6",
    ...(outputFormat ? [outputFormat] : []),
  ];
}

function hasWatermarkTextMarker(value) {
  return PLATFORM_PATTERNS.some((pattern) => pattern.test(String(value ?? "")));
}

function hasNonLatinText(value) {
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(String(value ?? ""));
}

function plainWordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function isProtectedSourceLogo(value = {}) {
  const text = normalizedText(value.text);
  const category = String(value.category ?? value.type ?? "unknown");
  const reason = String(value.reason ?? "");
  const protectedShortMarks = new Set(["ap", "afp", "reuters"]);
  if (protectedShortMarks.has(text)) return true;
  const sourceContext = /(?:agency|wire|broadcaster|broadcast|news|official|source[-_ ]?context|stage|background|lower[-_ ]?third|subtitle|caption|date|event)/i.test(`${category} ${reason}`);
  return protectedShortMarks.has(text) && sourceContext;
}

function sourceContextAcronym(value) {
  const cleaned = String(value ?? "")
    .replace(/source\s*:/ig, " ")
    .replace(/copyright|©|\(c\)|202\d|19\d\d|20\d\d/ig, " ");
  const words = cleaned.match(/[A-Za-z]+/g)
    ?.filter((word) => !/^(?:source|a|an|of|and|by)$/i.test(word)) ?? [];
  if (words.length < 2) return "";
  return words.map((word) => word[0].toLowerCase()).join("");
}

function creatorBrandKeysFromDelogoable(items = []) {
  const keys = new Set();
  for (const item of items) {
    const rawText = String(item?.text ?? "");
    const normalized = normalizedText(rawText);
    if (rawText.includes("@") && normalized.length >= 5) keys.add(normalized);
    const noAt = normalizedText(rawText.replace(/^@+/, ""));
    if (noAt.length >= 5 && /(?:creator|handle|watermark|repost|platform)/i.test(String(item?.type ?? item?.category ?? ""))) {
      keys.add(noAt);
    }
  }
  return [...keys];
}

function isSameCreatorBrandLogoMark(item = {}, brandKeys = []) {
  if (brandKeys.length === 0) return false;
  const text = String(item?.text ?? "");
  const type = String(item?.type ?? item?.category ?? "");
  const reason = String(item?.reason ?? "");
  const haystack = `${type} ${reason} ${text}`;
  const logoLike = /(?:logo|brand|branding|source[_ -]?logo|source graphic|embedded in the source graphic)/i.test(haystack);
  const contextualShow = /(?:show branding|program graphic|lower[_ -]?third|chyron|ticker|news banner|broadcaster source)/i.test(haystack);
  if (!logoLike || contextualShow) return false;
  const normalized = normalizedText(text);
  const acronym = sourceContextAcronym(text);
  return brandKeys.some((key) => {
    if (key.length < 5) return false;
    return normalized.includes(key) || key.includes(normalized) || (acronym.length >= 2 && key.includes(acronym));
  });
}

function isSameCreatorSourceAttributionMark(item = {}, brandKeys = []) {
  if (brandKeys.length === 0) return false;
  const text = String(item?.text ?? "");
  const haystack = `${item?.type ?? item?.category ?? ""} ${item?.reason ?? ""} ${text}`;
  const attributionLike = isSourceAttributionLike(item);
  const contextualShow = /(?:show branding|program graphic|lower[_ -]?third|chyron|ticker|news banner|broadcaster source|official agency|wire service)/i.test(haystack);
  if (!attributionLike || contextualShow) return false;
  const normalized = normalizedText(text);
  return brandKeys.some((key) => key.length >= 5 && normalized.includes(key));
}

function isSourceAttributionLike(item = {}) {
  const text = String(item?.text ?? "");
  const type = String(item?.type ?? item?.category ?? "");
  const reason = String(item?.reason ?? "");
  const textAttribution = /(?:source\s*:|copyright|©|\(c\))/i.test(text);
  const typedAttribution = /(?:source attribution|attribution|credit)/i.test(`${type} ${reason}`) &&
    /(?:source|credit|attribution)/i.test(text);
  return textAttribution || typedAttribution;
}

function isPolicyPromotedCreatorMark(item = {}) {
  return item?.safeToDelogo === true &&
    /(?:creator_watermark|creator_handle)/i.test(String(item?.type ?? item?.category ?? "")) &&
    /same creator brand as removable handle/i.test(String(item?.reason ?? ""));
}

function isMisprotectedStockOrRepostWatermark(item = {}) {
  const text = normalizedText(item?.text);
  const haystack = `${item?.text ?? ""} ${item?.type ?? item?.category ?? ""} ${item?.reason ?? ""}`;
  const knownWatermark = /(?:shutterstock|osinttechnical)/i.test(text);
  const watermarkContext = /(?:watermark|stock|repost|misclassified|third[_ -]?party|creator)/i.test(haystack);
  return knownWatermark && watermarkContext;
}

function isProtectedSourceContextMark(value = {}, mustKeep = []) {
  const rawText = String(value.text ?? "");
  if (hasWatermarkTextMarker(rawText)) return false;
  const text = normalizedText(rawText);
  if (!text) return false;
  return mustKeep.some((item) => {
    const keepText = String(item?.text ?? "");
    const keepType = String(item?.type ?? item?.category ?? "");
    const keepReason = String(item?.reason ?? "");
    const sourceContext = /(?:source|attribution|chart|program_graphic|source_context)/i.test(`${keepType} ${keepReason} ${keepText}`);
    if (!sourceContext) return false;
    const normalizedKeep = normalizedText(keepText);
    if (text.length >= 5 && (normalizedKeep.includes(text) || text.includes(normalizedKeep))) return true;
    return text.length >= 2 && text === sourceContextAcronym(keepText);
  });
}

function isRemovableDelogoCandidate(value = {}) {
  const text = String(value.text ?? "").trim();
  const category = String(value.category ?? value.type ?? "unknown");
  const reason = String(value.reason ?? "");
  if (isProtectedSourceLogo({ text, category, reason })) return false;
  if (/(?:shutterstock|osinttechnical)/i.test(normalizedText(text)) && /(?:watermark|stock|repost|third[_ -]?party|creator|source)/i.test(reason)) return true;
  if (hasWatermarkTextMarker(text)) return true;
  if (/(?:source_watermark_domain|platform_repost|platform_ui_repost|platform_logo|domain)/.test(category)) return true;
  if (/(?:repost_handle)/.test(category)) {
    const watermarkReason = /(?:watermark|logo|channel|creator|handle|telegram|platform|repost)/i.test(reason);
    const contextualReason = /(?:lower[- ]?third|chyron|ticker|caption|title|label|context|descriptive|news|banner|source attribution)/i.test(reason);
    return watermarkReason && !contextualReason && !(hasNonLatinText(text) && plainWordCount(text) >= 2);
  }
  if (/(?:third_party_watermark|creator_watermark|creator_handle)/.test(category)) {
    const contextualReason = /(?:lower[- ]?third|chyron|ticker|caption|title|label|context|descriptive|news|banner)/i.test(reason);
    const watermarkReason = /(?:watermark|logo|channel|creator|handle|telegram|platform|repost)/i.test(reason);
    return watermarkReason && !contextualReason && !(hasNonLatinText(text) && plainWordCount(text) >= 2);
  }
  return false;
}

export function normalizeWatermarkOnlyDecision(watermarkOnly) {
  if (!watermarkOnly) return watermarkOnly;
  const removable = Array.isArray(watermarkOnly.removableWatermarks) ? watermarkOnly.removableWatermarks : [];
  const mustKeep = Array.isArray(watermarkOnly.mustKeep) ? [...watermarkOnly.mustKeep] : [];
  const delogoable = removable.filter((item) => (isPolicyPromotedCreatorMark(item) || !isProtectedSourceContextMark(item, mustKeep)) && isRemovableDelogoCandidate({
    text: item.text,
    category: item.type,
    reason: item.reason,
  }));
  const creatorBrandKeys = creatorBrandKeysFromDelogoable(delogoable);
  const promotedCreatorMarks = mustKeep
    .filter((item) => isSameCreatorBrandLogoMark(item, creatorBrandKeys) || isSameCreatorSourceAttributionMark(item, creatorBrandKeys))
    .map((item) => ({
      ...item,
      type: "creator_watermark",
      confidence: Math.max(0.92, clamp01(item?.confidence ?? watermarkOnly.confidence ?? 0.92)),
      safeToDelogo: true,
      seenInFrames: item?.seenInFrames ?? delogoable[0]?.seenInFrames ?? [],
      reason: item?.reason
        ? `Same creator brand as removable handle; remove as creator watermark. ${item.reason}`
        : "Same creator brand as removable handle; remove as creator watermark.",
    }));
  const promotedStockWatermarks = mustKeep
    .filter(isMisprotectedStockOrRepostWatermark)
    .map((item) => ({
      ...item,
      type: "third_party_watermark",
      confidence: Math.max(0.92, clamp01(item?.confidence ?? watermarkOnly.confidence ?? 0.92)),
      safeToDelogo: true,
      seenInFrames: item?.seenInFrames ?? delogoable[0]?.seenInFrames ?? [1, 2, 3],
      reason: item?.reason
        ? `Known stock/repost watermark protected by mistake; remove as third-party watermark. ${item.reason}`
        : "Known stock/repost watermark protected by mistake; remove as third-party watermark.",
    }));
  const promotedMarks = [...promotedCreatorMarks, ...promotedStockWatermarks];
  const promotedTexts = new Set(promotedMarks.map((item) => normalizedText(item?.text)));
  const keptMustKeep = mustKeep.filter((item) => !promotedTexts.has(normalizedText(item?.text)));
  const protectedItems = removable.filter((item) => !delogoable.includes(item));
  const rawDecision = String(watermarkOnly.decision ?? "render");
  const shouldKeepProtectedOnly = delogoable.length === 0
    && protectedItems.length > 0
    && (rawDecision === "render_with_delogo" || rawDecision === "uncertain");
  const decision = shouldKeepProtectedOnly ? "render" : rawDecision === "render" && promotedMarks.length > 0 ? "render_with_delogo" : rawDecision;

  if (decision === rawDecision && protectedItems.length === 0 && promotedMarks.length === 0) return watermarkOnly;

  const seen = new Set(keptMustKeep.map((item) => `${normalizedText(item?.text)}:${String(item?.type ?? "")}`));
  for (const item of protectedItems) {
    const text = String(item?.text ?? "").trim();
    const type = "source_logo";
    const key = `${normalizedText(text)}:${type}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    keptMustKeep.push({
      text,
      type,
      reason: item?.reason
        ? `Protected source mark kept by local policy: ${item.reason}`
        : "Protected source mark kept by local policy.",
      box: item?.box ?? null,
    });
  }

  return {
    ...watermarkOnly,
    decision,
    reason: shouldKeepProtectedOnly
      ? `${String(watermarkOnly.reason ?? "").trim()} Protected source marks were kept by local policy.`.trim()
      : watermarkOnly.reason,
    removableWatermarks: [...delogoable, ...promotedMarks],
    protectedWatermarks: protectedItems,
    mustKeep: keptMustKeep,
  };
}

function isCenteredTextWatermarkHint(value = {}) {
  const text = String(value.text ?? "").trim();
  const category = String(value.category ?? value.type ?? "unknown");
  return hasWatermarkTextMarker(text) ||
    /(?:handle|domain|platform|repost|watermark|logo|channel|source_watermark|creator_handle)/i.test(category);
}

function isCreatorLogoHint(value = {}) {
  const text = String(value.text ?? "").trim();
  const category = String(value.category ?? value.type ?? "unknown");
  const reason = String(value.reason ?? "");
  return /(?:creator|watermark|logo|brand)/i.test(`${text} ${category} ${reason}`);
}

function isLowerCenteredCandidate(candidate = {}, dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const x = Number(candidate.x ?? 0);
  const y = Number(candidate.y ?? 0);
  const w = Number(candidate.w ?? 0);
  return y >= height * 0.52 && x >= width * 0.20 && x + w <= width * 0.80;
}

function isIconTextWatermarkHint(value = {}) {
  const text = `${value.text ?? ""} ${value.category ?? value.type ?? ""} ${value.reason ?? ""}`;
  return /(?:telegram|logo|icon|channel|platform)/i.test(text);
}

export function chooseCenteredVisualCandidate(candidates = [], hint = {}, dimensions = {}) {
  const eligible = candidates.filter((candidate) => Number(candidate?.score ?? 0) >= 0.56);
  if (eligible.length === 0) return null;
  if (!isIconTextWatermarkHint(hint)) return eligible[0];

  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const candidateScore = (candidate) => {
    const centerX = Number(candidate.x ?? 0) + Number(candidate.w ?? 0) / 2;
    const centerDelta = Math.abs(centerX - width / 2);
    const centerScore = 1 - Math.min(1, centerDelta / Math.max(1, width * 0.34));
    const widthScore = Math.min(1, Number(candidate.w ?? 0) / Math.max(1, width * 0.34));
    const heightScore = Math.min(1, Number(candidate.h ?? 0) / Math.max(1, height * 0.13));
    const lowerScore = Number(candidate.y ?? 0) >= height * 0.35 ? 1 : 0;
    return Number(candidate.score ?? 0) * 0.46 +
      centerScore * 0.14 +
      widthScore * 0.18 +
      heightScore * 0.18 +
      lowerScore * 0.04;
  };

  return eligible
    .slice()
    .sort((a, b) => candidateScore(b) - candidateScore(a))[0];
}

function lowerCenterLogoHint(hints = [], coveredHintTexts = new Set()) {
  return hints.find((hint) => {
    if (coveredHintTexts.has(normalizedText(hint.text))) return false;
    const text = `${hint.text ?? ""} ${hint.category ?? ""} ${hint.reason ?? ""}`;
    return isCreatorLogoHint(hint) && /(?:lower[-_ ]?center|lower center|near the lower center|lower-center)/i.test(text);
  }) ?? null;
}

function sameCreatorGraphicLogoHint(hints = [], coveredHintTexts = new Set()) {
  return lowerCenterLogoHint(hints, coveredHintTexts) ?? hints.find((hint) => {
    if (coveredHintTexts.has(normalizedText(hint.text))) return false;
    const text = `${hint.text ?? ""} ${hint.category ?? ""} ${hint.reason ?? ""}`;
    return !isSourceAttributionLike(hint) &&
      isCreatorLogoHint(hint) &&
      /(?:same creator brand|source graphic|chart graphic|brand\/logo|brand logo|creator logo|embedded)/i.test(text);
  }) ?? null;
}

function lowerCenterLogoFallbackRegion(hint, dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  return regionWithMetadata({
    x: width * 0.40,
    y: height * 0.755,
    w: width * 0.22,
    h: height * 0.17,
  }, hint, { width, height }, "lower_center_position_fallback");
}

function isBroadLowerMiddleWatermarkHint(hint = {}) {
  const text = `${hint.text ?? ""} ${hint.category ?? ""} ${hint.reason ?? ""}`;
  const watermarkish = /(?:third_party_watermark|source_watermark|platform_repost|platform_logo|domain|channel|watermark)/i.test(text);
  const broad = /(?:translucent|semi[- ]?transparent|faint|stock[- ]?watermark|large|broad|spans|across|full wordmark)/i.test(text);
  const lowerMiddle = /(?:lower[-_ ]?(?:middle|center)|middle|center|central|city view)/i.test(text);
  const knownBroadWatermark = /(?:shutterstock|osinttechnical)/i.test(normalizedText(text));
  return watermarkish && ((broad && lowerMiddle) || knownBroadWatermark);
}

function broadLowerMiddleWatermarkHint(hints = [], coveredHintTexts = new Set()) {
  return hints.find((hint) => {
    if (coveredHintTexts.has(normalizedText(hint.text))) return false;
    return isBroadLowerMiddleWatermarkHint(hint);
  }) ?? null;
}

export function broadLowerMiddleWatermarkFallbackRegions(hint, dimensions = {}) {
  if (!isBroadLowerMiddleWatermarkHint(hint)) return [];
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  return [
    regionWithMetadata({
      x: width * 0.38,
      y: height * 0.48,
      w: width * 0.23,
      h: height * 0.30,
    }, hint, { width, height }, "broad_lower_middle_icon_fallback"),
    regionWithMetadata({
      x: width * 0.30,
      y: height * 0.65,
      w: width * 0.46,
      h: height * 0.15,
    }, hint, { width, height }, "broad_lower_middle_text_fallback"),
  ].filter((region) => region.areaRatio <= 0.09);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function normalizeLanguage(language) {
  const raw = String(language ?? "").trim().toLowerCase();
  if (["fa", "fas", "per", "farsi", "persian", "فارسی"].includes(raw)) return "fa";
  return raw || "und";
}

export function selectTargetLanguage(sourceLanguage) {
  return normalizeLanguage(sourceLanguage) === "fa" ? "en" : "fa";
}

export function parseSubtitleStreams(ffprobePayload) {
  return (ffprobePayload?.streams ?? [])
    .filter((stream) => stream?.codec_type === "subtitle")
    .map((stream) => ({
      index: Number(stream.index),
      codec: String(stream.codec_name ?? "unknown"),
      language: String(stream.tags?.language ?? "und"),
      title: String(stream.tags?.title ?? ""),
    }));
}

export function extractPlatformMatches(text) {
  const found = [];
  for (const pattern of PLATFORM_EXTRACTORS) {
    for (const match of String(text ?? "").matchAll(pattern)) {
      found.push(match[0]);
    }
  }
  return [...new Set(found)];
}

export function runOptionalOcr(imagePath) {
  return new Promise((resolve) => {
    const child = spawn("tesseract", tesseractArgs(imagePath), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      resolve({ available: false, text: "", matches: [], error: error.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ available: false, text: "", matches: [], error: stderr.slice(-500) });
        return;
      }
      resolve({ available: true, text: stdout.trim(), matches: extractPlatformMatches(stdout) });
    });
  });
}

export function parseOcrTsv(tsv) {
  const lines = String(tsv ?? "").split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split("\t") ?? [];
  return lines.map((line) => {
    const values = line.split("\t");
    const row = Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
    return {
      level: Number(row.level),
      block: Number(row.block_num),
      paragraph: Number(row.par_num),
      line: Number(row.line_num),
      word: Number(row.word_num),
      x: Number(row.left),
      y: Number(row.top),
      w: Number(row.width),
      h: Number(row.height),
      confidence: Number(row.conf),
      text: String(row.text ?? "").trim(),
    };
  }).filter((row) => row.text && Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.w) && Number.isFinite(row.h));
}

function parseOcrPageDimensions(tsv) {
  const lines = String(tsv ?? "").split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split("\t") ?? [];
  for (const line of lines) {
    const values = line.split("\t");
    const row = Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
    if (Number(row.level) !== 1) continue;
    const width = Number(row.width);
    const height = Number(row.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
  }
  return null;
}

function runOcrTsv(imagePath) {
  return new Promise((resolve) => {
    const child = spawn("tesseract", tesseractArgs(imagePath, "tsv"), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      resolve({ available: false, words: [], dimensions: null, error: error.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ available: false, words: [], dimensions: null, error: stderr.slice(-500) });
        return;
      }
      resolve({ available: true, words: parseOcrTsv(stdout), dimensions: parseOcrPageDimensions(stdout) });
    });
  });
}

function readGrayImage(imagePath, dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-v", "error",
      "-i", imagePath,
      "-vf", `scale=${width}:${height},format=gray`,
      "-f", "rawvideo",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`ocr_recovery_frame exited ${code}: ${stderr.slice(-500)}`));
      else resolve(Buffer.concat(stdout));
    });
  });
}

function normalizedText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function allVisionOverlays(vision) {
  return [
    ...(Array.isArray(vision?.overlays) ? vision.overlays : []),
    ...(Array.isArray(vision?.specialistChecks)
      ? vision.specialistChecks.flatMap((check) => Array.isArray(check?.result?.overlays) ? check.result.overlays : [])
      : []),
  ];
}

function delogoHintsFromVision(vision) {
  const globalReason = String(vision?.renderDecision?.reason ?? "");
  return allVisionOverlays(vision)
    .filter((overlay) => overlay?.action === "delogo")
    .filter((overlay) => Number(overlay?.confidence ?? 0) >= 0.75)
    .filter(isRemovableDelogoCandidate)
    .map((overlay) => ({
      text: String(overlay.text ?? "").trim(),
      category: String(overlay.category ?? "unknown"),
      confidence: clamp01(overlay.confidence),
      reason: [overlay.reason, globalReason].map((value) => String(value ?? "").trim()).filter(Boolean).join(" "),
    }))
    .filter((hint) => hint.text || hint.reason);
}

function wordsToLineBoxes(words = [], dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const grouped = new Map();
  for (const word of words) {
    if (Number(word.confidence) < 20) continue;
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(word);
  }

  return [...grouped.values()].map((lineWords) => {
    const sortedWords = lineWords
      .map((word) => ({ ...word }))
      .sort((a, b) => a.x - b.x);
    const x1 = Math.min(...lineWords.map((word) => word.x));
    const y1 = Math.min(...lineWords.map((word) => word.y));
    const x2 = Math.max(...lineWords.map((word) => word.x + word.w));
    const y2 = Math.max(...lineWords.map((word) => word.y + word.h));
    const confidence = lineWords.reduce((sum, word) => sum + Math.max(0, Number(word.confidence) || 0), 0) / Math.max(1, lineWords.length);
    return {
      text: sortedWords.map((word) => word.text).join(" "),
      x: Math.max(0, x1),
      y: Math.max(0, y1),
      w: Math.max(1, Math.min(width - x1 - 1, x2 - x1)),
      h: Math.max(1, Math.min(height - y1 - 1, y2 - y1)),
      confidence: clamp01(confidence / 100),
      words: sortedWords,
    };
  });
}

function scaleOcrWordsToDimensions(words, ocrDimensions = {}, dimensions = {}) {
  const sourceWidth = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const sourceHeight = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const ocrWidth = Math.max(1, Number(ocrDimensions?.width ?? sourceWidth) || sourceWidth);
  const ocrHeight = Math.max(1, Number(ocrDimensions?.height ?? sourceHeight) || sourceHeight);
  const scaleX = sourceWidth / ocrWidth;
  const scaleY = sourceHeight / ocrHeight;
  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return words;
  return words.map((word) => ({
    ...word,
    x: word.x * scaleX,
    y: word.y * scaleY,
    w: word.w * scaleX,
    h: word.h * scaleY,
  }));
}

function matchOcrLineToHints(line, hints) {
  const lineText = String(line.text ?? "");
  const normalizedLine = normalizedText(lineText);
  if (normalizedLine.length < 4) return null;
  return hints.find((hint) => ocrLineMatchesHint(line, hint)) ?? null;
}

function ocrLineMatchesHint(line, hint) {
  const lineText = String(line.text ?? "");
  const normalizedLine = normalizedText(lineText);
  if (normalizedLine.length < 4) return false;
    const hintText = String(hint.text ?? "");
    const normalizedHintText = normalizedText(hintText);
    if (isSourceAttributionLike(hint)) {
      const sourceLine = /(?:source|credit|copyright|©|\(c\))/i.test(lineText);
      const meaningfulTokens = hintText.match(/[A-Za-z0-9]+/g)
        ?.map((token) => normalizedText(token))
        .filter((token) => token.length >= 5 && !/^(?:source|copyright|credit|attribution)$/.test(token) && !/^(?:19|20)\d\d$/.test(token)) ?? [];
      if (sourceLine && meaningfulTokens.some((token) => normalizedLine.includes(token))) return true;
    }
    if (hintText.includes("@") && !lineText.includes("@")) return false;
    if (normalizedHintText.length >= 3) {
      return normalizedLine.includes(normalizedHintText) || normalizedHintText.includes(normalizedLine);
    }
    const normalizedHint = normalizedText(`${hint.text} ${hint.reason}`);
    if (normalizedHint.length < 4) return false;
    return normalizedHint.includes(normalizedLine) || normalizedLine.includes(normalizedHint.slice(0, Math.min(normalizedHint.length, 12)));
}

function ocrHintsForLine(line, hints) {
  const matches = hints.filter((hint) => ocrLineMatchesHint(line, hint));
  const seen = new Set();
  return matches.filter((hint) => {
    const key = `${normalizedText(hint.text)}:${hint.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lowerTextProtectedTop(vision, height, options = {}) {
  const lowerText = vision?.lowerTextRegion ?? null;
  if (!lowerText?.detected || lowerText?.action !== "keep" || Number(lowerText.confidence ?? 0) < 0.75 || !lowerText.box) {
    return Math.round(height * 0.88);
  }
  const pad = Number(options.lowerTextProtectionPad ?? 0.025);
  return Math.round(clamp01(Number(lowerText.box.y ?? 0.88) - pad) * height);
}

function focusedOcrRegionForHint(line, hint, dimensions = {}) {
  const hintText = String(hint?.text ?? "");
  const normalizedHintText = normalizedText(hintText);
  const words = Array.isArray(line.words) ? line.words : [];
  const isHandleOrDomain = hintText.includes("@") || /\b[\w.-]+\.(?:com|net|org|io|ir|co)\b/i.test(hintText);
  if (!isHandleOrDomain || normalizedHintText.length < 4 || words.length === 0) return line;

  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const sortedWords = words.slice().sort((a, b) => a.x - b.x);
  const hintRequiresAt = hintText.includes("@");
  const matchIndex = sortedWords.findIndex((word) => {
    if (hintRequiresAt && !String(word.text ?? "").includes("@")) return false;
    const normalizedWord = normalizedText(word.text);
    return normalizedWord.length >= 4 &&
      (normalizedWord === normalizedHintText ||
        normalizedWord.includes(normalizedHintText) ||
        normalizedHintText.includes(normalizedWord));
  });
  if (matchIndex < 0) return line;

  const included = [sortedWords[matchIndex]];
  let leftEdge = Number(sortedWords[matchIndex].x);
  for (let index = matchIndex - 1; index >= 0 && included.length < 4; index -= 1) {
    const previous = sortedWords[index];
    const gap = leftEdge - (Number(previous.x) + Number(previous.w));
    const token = normalizedText(previous.text);
    const isLeadIn = /^(follow|us|via|on|at|by)$/.test(token);
    if (!isLeadIn || gap > width * 0.045) break;
    included.unshift(previous);
    leftEdge = Number(previous.x);
  }

  const x1 = Math.min(...included.map((word) => word.x));
  const y1 = Math.min(...included.map((word) => word.y));
  const x2 = Math.max(...included.map((word) => word.x + word.w));
  const y2 = Math.max(...included.map((word) => word.y + word.h));
  return {
    ...line,
    text: included.map((word) => word.text).join(" "),
    x: x1,
    y: y1,
    w: Math.max(1, x2 - x1),
    h: Math.max(1, y2 - y1),
    words: included,
  };
}

function regionWithMetadata(region, hint, dimensions = {}, source = "ocr_recovery") {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const x = Math.min(Math.max(0, width - 2), Math.max(0, Math.round(region.x)));
  const y = Math.min(Math.max(0, height - 2), Math.max(0, Math.round(region.y)));
  const w = Math.max(1, Math.min(Math.max(1, width - x - 1), Math.round(region.w)));
  const h = Math.max(1, Math.min(Math.max(1, height - y - 1), Math.round(region.h)));
  const rect = { x, y, w, h };
  const center = { x: width * 0.25, y: height * 0.25, w: width * 0.5, h: height * 0.5 };
  return {
    ...rect,
    areaRatio: rectArea(rect) / Math.max(1, width * height),
    centerOverlapRatio: rectOverlap(rect, center) / Math.max(1, rectArea(rect)),
    text: hint?.text ?? "",
    category: hint?.category ?? "source_watermark_handle",
    confidence: Math.max(0.66, Number(hint?.confidence ?? 0.7) - 0.12),
    source,
  };
}

function mergeRecoveredDelogoRegions(regions = [], dimensions = {}, maxRegions = 2) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const merged = [];
  for (const region of regions) {
    if (!region) continue;
    const areaRatio = Number(region.areaRatio ?? rectArea(region) / Math.max(1, width * height));
    if (!Number.isFinite(areaRatio) || areaRatio <= 0 || areaRatio > 0.09) continue;
    let replacedExisting = false;
    const overlapsExisting = merged.some((existing, index) => {
      const broadPair = String(region.source ?? "").startsWith("broad_lower_middle_") &&
        String(existing.source ?? "").startsWith("broad_lower_middle_");
      if (broadPair) return false;
      const overlap = rectOverlap(region, existing);
      const smallerArea = Math.min(rectArea(region), rectArea(existing));
      if (smallerArea <= 0 || overlap / smallerArea <= 0.42) return false;
      const regionArea = rectArea(region);
      const existingArea = rectArea(existing);
      const sameCreatorBrand = /(?:creator_handle|creator_watermark)/i.test(String(region.category ?? "")) &&
        /(?:creator_handle|creator_watermark)/i.test(String(existing.category ?? ""));
      if (sameCreatorBrand && regionArea > existingArea * 1.35 && overlap / existingArea >= 0.84) {
        merged[index] = region;
        replacedExisting = true;
      }
      return true;
    });
    if (replacedExisting) continue;
    if (overlapsExisting) continue;
    merged.push(region);
    if (merged.length >= maxRegions) break;
  }
  return merged;
}

function maxRecoverableDelogoRegionsForHints(hints = []) {
  const creatorHints = hints.filter((hint) => /(?:creator_handle|creator_watermark)/i.test(String(hint?.category ?? "")));
  return creatorHints.length >= 3 ? 3 : 2;
}

export function recoverDelogoRegionsFromOcrWords(words, hints, dimensions = {}, vision = {}, ocrDimensions = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const protectedTop = lowerTextProtectedTop(vision, height);
  const lines = wordsToLineBoxes(scaleOcrWordsToDimensions(words, ocrDimensions, { width, height }), { width, height });
  const matches = [];

  for (const line of lines) {
    for (const hint of ocrHintsForLine(line, hints)) {
      const allowLowerMatch = isHandleLikeDelogo({ text: hint.text, category: hint.category });
      if (line.y + line.h >= protectedTop && !allowLowerMatch) continue;
      const matchedRegion = focusedOcrRegionForHint(line, hint, { width, height });
      const padX = Math.round(width * 0.018);
      const padY = Math.round(height * 0.018);
      matches.push(regionWithMetadata({
        x: matchedRegion.x - padX,
        y: matchedRegion.y - padY,
        w: matchedRegion.w + padX * 2,
        h: matchedRegion.h + padY * 2,
      }, hint, dimensions, "ocr_text_match"));
    }
  }

  return matches
    .filter((region) => region.areaRatio <= 0.08)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);
}

function activeTextPixel(bytes, width, height, x, y) {
  const offset = y * width + x;
  const value = bytes[offset];
  const left = bytes[offset - 1];
  const right = bytes[offset + 1];
  const above = bytes[offset - width];
  const below = bytes[offset + width];
  const contrast = Math.max(
    Math.abs(value - left),
    Math.abs(value - right),
    Math.abs(value - above),
    Math.abs(value - below),
  );
  return contrast >= 34 && (value >= 145 || value <= 105);
}

function softBrightTextPixel(bytes, width, height, x, y) {
  const offset = y * width + x;
  const value = bytes[offset];
  const left = bytes[offset - 1];
  const right = bytes[offset + 1];
  const above = bytes[offset - width];
  const below = bytes[offset + width];
  const neighborMin = Math.min(left, right, above, below);
  const contrast = Math.max(
    Math.abs(value - left),
    Math.abs(value - right),
    Math.abs(value - above),
    Math.abs(value - below),
  );
  return value >= 132 && contrast >= 10 && value - neighborMin >= 4;
}

function inferDenseLowerTextTop(rowCounts, width, yStart, yEnd) {
  const denseThreshold = Math.round(width * 0.58);
  const mediumThreshold = Math.round(width * 0.34);
  for (let y = yStart; y <= yEnd - 1; y += 1) {
    const current = Number(rowCounts.get(y) ?? 0);
    const next = Number(rowCounts.get(y + 1) ?? 0);
    if (current >= denseThreshold || (current >= mediumThreshold && next >= mediumThreshold)) return y;
  }
  return null;
}

function findActiveComponents(bytes, width, height, yStart, yEnd, isActive = activeTextPixel) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const seed = y * width + x;
      if (visited[seed] || !isActive(bytes, width, height, x, y)) continue;

      const queue = [{ x, y }];
      visited[seed] = 1;
      let head = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixels = 0;

      while (head < queue.length) {
        const point = queue[head];
        head += 1;
        pixels += 1;
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = point.x + dx;
            const ny = point.y + dy;
            if (nx <= 0 || nx >= width - 1 || ny < yStart || ny > yEnd) continue;
            const offset = ny * width + nx;
            if (visited[offset] || !isActive(bytes, width, height, nx, ny)) continue;
            visited[offset] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (pixels < 2 || w > width * 0.24 || h > height * 0.16) continue;
      components.push({ x: minX, y: minY, w, h, pixels, centerY: minY + h / 2 });
    }
  }

  return components;
}

function mergeComponentRun(components, width, height, protectedTop) {
  const x1 = Math.min(...components.map((component) => component.x));
  const y1 = Math.min(...components.map((component) => component.y));
  const x2 = Math.max(...components.map((component) => component.x + component.w));
  const y2 = Math.max(...components.map((component) => component.y + component.h));
  const region = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  if (region.w < Math.round(width * 0.07) || region.w > Math.round(width * 0.46)) return null;
  if (region.h < 5 || region.h > Math.round(height * 0.12)) return null;
  const lowerTextOverlapAllowance = Math.round(height * 0.016);
  if (region.y >= protectedTop) return null;
  if (region.y + region.h > protectedTop + lowerTextOverlapAllowance) return null;

  const activeArea = components.reduce((sum, component) => sum + component.pixels, 0);
  const density = activeArea / Math.max(1, region.w * region.h);
  if (density < 0.018 || density > 0.55) return null;

  const distanceFromLowerText = Math.max(0, protectedTop - (region.y + region.h));
  const verticalScore = 1 - Math.min(1, distanceFromLowerText / Math.max(1, height * 0.24));
  const widthScore = region.w >= width * 0.10 && region.w <= width * 0.34 ? 1 : 0.66;
  const densityScore = Math.min(1, density / 0.16);
  const componentScore = Math.min(1, components.length / 8);
  return {
    ...region,
    score: verticalScore * 0.48 + widthScore * 0.22 + densityScore * 0.18 + componentScore * 0.12,
    density,
    componentCount: components.length,
  };
}

function detectComponentTextLikeRegions(bytes, dimensions = {}, vision = {}, yStart, yEnd, rowCounts) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const defaultProtectedTop = lowerTextProtectedTop(vision, height);
  const inferredProtectedTop = inferDenseLowerTextTop(rowCounts, width, yStart, yEnd);
  const protectedTop = inferredProtectedTop
    ? Math.min(defaultProtectedTop, inferredProtectedTop)
    : defaultProtectedTop;
  const searchEnd = Math.min(yEnd, protectedTop - Math.max(3, Math.round(height * 0.008)));
  if (searchEnd <= yStart + 4) return [];

  const components = findActiveComponents(bytes, width, height, yStart, searchEnd)
    .filter((component) => component.w >= 1 && component.h >= 2)
    .filter((component) => component.w <= Math.round(width * 0.22))
    .filter((component) => component.y + component.h < protectedTop);
  const rowGroups = [];

  for (const component of components.sort((a, b) => a.centerY - b.centerY || a.x - b.x)) {
    const tolerance = Math.max(5, Math.min(15, component.h * 1.8));
    const group = rowGroups.find((candidate) => Math.abs(candidate.centerY - component.centerY) <= tolerance);
    if (group) {
      group.components.push(component);
      group.centerY = group.components.reduce((sum, item) => sum + item.centerY, 0) / group.components.length;
    } else {
      rowGroups.push({ centerY: component.centerY, components: [component] });
    }
  }

  const candidates = [];
  for (const group of rowGroups) {
    const sorted = group.components.sort((a, b) => a.x - b.x);
    let run = [];
    let lastRight = null;
    const flush = () => {
      const runWidth = run.length > 0
        ? Math.max(...run.map((component) => component.x + component.w)) - Math.min(...run.map((component) => component.x))
        : 0;
      if (run.length < 2 && runWidth < width * 0.08) {
        run = [];
        lastRight = null;
        return;
      }
      const candidate = mergeComponentRun(run, width, height, protectedTop);
      if (candidate) candidates.push(candidate);
      run = [];
      lastRight = null;
    };

    for (const component of sorted) {
      const gap = lastRight === null ? 0 : component.x - lastRight;
      if (lastRight !== null && gap > Math.max(14, width * 0.045)) flush();
      run.push(component);
      lastRight = Math.max(lastRight ?? 0, component.x + component.w);
    }
    flush();
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

function scoreCenteredTextRegion(region, width, height, activePixels, componentCount = 0, options = {}) {
  const minWidthRatio = Number(options.minWidthRatio ?? 0.18);
  const maxWidthRatio = Number(options.maxWidthRatio ?? 0.86);
  if (region.w < Math.round(width * minWidthRatio) || region.w > Math.round(width * maxWidthRatio)) return null;
  if (region.h < 5 || region.h > Math.round(height * 0.18)) return null;
  const centerX = region.x + region.w / 2;
  const centerDelta = Math.abs(centerX - width / 2);
  if (centerDelta > width * 0.34) return null;

  const density = activePixels / Math.max(1, region.w * region.h);
  if (density < 0.006 || density > 0.62) return null;

  const centerScore = 1 - Math.min(1, centerDelta / Math.max(1, width * 0.34));
  const idealMin = Math.max(minWidthRatio, Number(options.idealMinWidthRatio ?? 0.30));
  const idealMax = Math.min(maxWidthRatio, Number(options.idealMaxWidthRatio ?? 0.76));
  const widthScore = region.w >= width * idealMin && region.w <= width * idealMax ? 1 : 0.68;
  const densityScore = Math.min(1, density / 0.10);
  const componentScore = componentCount > 0 ? Math.min(1, componentCount / 9) : 0.72;
  return {
    ...region,
    score: centerScore * 0.34 + widthScore * 0.27 + densityScore * 0.23 + componentScore * 0.16,
    density,
    componentCount,
  };
}

function mergeCenteredComponentRun(components, width, height, options = {}) {
  const x1 = Math.min(...components.map((component) => component.x));
  const y1 = Math.min(...components.map((component) => component.y));
  const x2 = Math.max(...components.map((component) => component.x + component.w));
  const y2 = Math.max(...components.map((component) => component.y + component.h));
  const activePixels = components.reduce((sum, component) => sum + component.pixels, 0);
  return scoreCenteredTextRegion(
    { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
    width,
    height,
    activePixels,
    components.length,
    options,
  );
}

export function detectCenteredTextLikeRecoveryRegions(bytes, dimensions = {}, options = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  if (!bytes || bytes.length < width * height) return [];

  const yStart = Math.max(1, Math.round(height * 0.16));
  const yEnd = Math.min(height - 2, Math.round(height * 0.72));
  const isActive = softBrightTextPixel;
  const activeRows = [];
  const rowCounts = new Map();

  for (let y = yStart; y <= yEnd; y += 1) {
    let count = 0;
    for (let x = 1; x < width - 1; x += 1) {
      if (isActive(bytes, width, height, x, y)) count += 1;
    }
    rowCounts.set(y, count);
    if (count >= Math.max(4, Math.round(width * 0.008)) && count <= Math.round(width * 0.58)) {
      activeRows.push(y);
    }
  }

  const components = findActiveComponents(bytes, width, height, yStart, yEnd, isActive)
    .filter((component) => component.w >= 1 && component.h >= 2)
    .filter((component) => component.w <= Math.round(width * 0.38));
  const rowGroups = [];
  for (const component of components.sort((a, b) => a.centerY - b.centerY || a.x - b.x)) {
    const tolerance = Math.max(7, Math.min(24, component.h * 2.4));
    const group = rowGroups.find((candidate) => Math.abs(candidate.centerY - component.centerY) <= tolerance);
    if (group) {
      group.components.push(component);
      group.centerY = group.components.reduce((sum, item) => sum + item.centerY, 0) / group.components.length;
    } else {
      rowGroups.push({ centerY: component.centerY, components: [component] });
    }
  }

  const candidates = [];
  for (const group of rowGroups) {
    const sorted = group.components.sort((a, b) => a.x - b.x);
    let run = [];
    let lastRight = null;
    const flush = () => {
      const runWidth = run.length > 0
        ? Math.max(...run.map((component) => component.x + component.w)) - Math.min(...run.map((component) => component.x))
        : 0;
      const minRunWidthRatio = Number(options.minRunWidthRatio ?? 0.17);
      if (run.length < 2 || runWidth < width * minRunWidthRatio) {
        run = [];
        lastRight = null;
        return;
      }
      const candidate = mergeCenteredComponentRun(run, width, height, options);
      if (candidate) candidates.push(candidate);
      run = [];
      lastRight = null;
    };

    for (const component of sorted) {
      const gap = lastRight === null ? 0 : component.x - lastRight;
      const maxRunGapRatio = Number(options.maxRunGapRatio ?? 0.075);
      if (lastRight !== null && gap > Math.max(18, width * maxRunGapRatio)) flush();
      run.push(component);
      lastRight = Math.max(lastRight ?? 0, component.x + component.w);
    }
    flush();
  }

  const rowBands = groupRanges(activeRows, 2)
    .filter((range) => range.end - range.start + 1 >= 4 && range.end - range.start + 1 <= Math.round(height * 0.18));
  for (const band of rowBands) {
    const activeCols = [];
    for (let x = 1; x < width - 1; x += 1) {
      let count = 0;
      for (let y = band.start; y <= band.end; y += 1) {
        if (isActive(bytes, width, height, x, y)) count += 1;
      }
      if (count > 0) activeCols.push(x);
    }

    for (const colBand of groupRanges(activeCols, Math.max(10, Math.round(width * 0.045)))) {
      const region = {
        x: colBand.start,
        y: band.start,
        w: colBand.end - colBand.start + 1,
        h: band.end - band.start + 1,
      };
      let activePixels = 0;
      for (let y = region.y; y < region.y + region.h; y += 1) {
        for (let x = region.x; x < region.x + region.w; x += 1) {
          if (isActive(bytes, width, height, x, y)) activePixels += 1;
        }
      }
      const candidate = scoreCenteredTextRegion(region, width, height, activePixels, 0);
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

function hintPosition(value = {}) {
  const raw = `${value.text ?? ""} ${value.category ?? ""} ${value.reason ?? ""}`.toLowerCase();
  if (/(?:upper|top)[-_ ]?left|left[-_ ]?(?:upper|top)/i.test(raw)) return "upper_left";
  if (/(?:upper|top)[-_ ]?right|right[-_ ]?(?:upper|top)/i.test(raw)) return "upper_right";
  if (/(?:lower|bottom)[-_ ]?left|left[-_ ]?(?:lower|bottom)/i.test(raw)) return "lower_left";
  if (/(?:lower|bottom)[-_ ]?right|right[-_ ]?(?:lower|bottom)/i.test(raw)) return "lower_right";
  if (/\bcorner\b/.test(raw)) return "corner";
  return null;
}

function cornerSearchBox(position, width, height) {
  const top = position === "upper_left" || position === "upper_right" || position === "corner";
  const bottom = position === "lower_left" || position === "lower_right";
  const left = position === "upper_left" || position === "lower_left" || position === "corner";
  const right = position === "upper_right" || position === "lower_right";
  return {
    x1: right ? Math.round(width * 0.62) : 1,
    x2: left ? Math.round(width * 0.38) : width - 2,
    y1: bottom ? Math.round(height * 0.68) : 1,
    y2: top ? Math.round(height * 0.30) : height - 2,
  };
}

export function detectCornerTextLikeRecoveryRegions(bytes, dimensions = {}, position = "corner") {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  if (!bytes || bytes.length < width * height) return [];

  const box = cornerSearchBox(position, width, height);
  const components = findActiveComponents(bytes, width, height, Math.max(1, box.y1), Math.min(height - 2, box.y2), softBrightTextPixel)
    .filter((component) => component.x >= box.x1 && component.x + component.w <= box.x2)
    .filter((component) => component.pixels >= 2)
    .filter((component) => component.w <= Math.round(width * 0.20))
    .filter((component) => component.h <= Math.round(height * 0.16));
  if (components.length < 3) return [];

  const x1 = Math.min(...components.map((component) => component.x));
  const y1 = Math.min(...components.map((component) => component.y));
  const x2 = Math.max(...components.map((component) => component.x + component.w));
  const y2 = Math.max(...components.map((component) => component.y + component.h));
  const region = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  if (region.w < Math.round(width * 0.035) || region.w > Math.round(width * 0.36)) return [];
  if (region.h < Math.round(height * 0.025) || region.h > Math.round(height * 0.26)) return [];

  const activePixels = components.reduce((sum, component) => sum + component.pixels, 0);
  const density = activePixels / Math.max(1, region.w * region.h);
  if (density < 0.012 || density > 0.58) return [];

  const cornerX = position === "upper_right" || position === "lower_right" ? width : 0;
  const cornerY = position === "lower_left" || position === "lower_right" ? height : 0;
  const centerX = region.x + region.w / 2;
  const centerY = region.y + region.h / 2;
  const distance = Math.hypot((centerX - cornerX) / width, (centerY - cornerY) / height);
  const cornerScore = 1 - Math.min(1, distance / 0.62);
  const sizeScore = region.w <= width * 0.24 && region.h <= height * 0.20 ? 1 : 0.68;
  const densityScore = Math.min(1, density / 0.14);
  const componentScore = Math.min(1, components.length / 18);

  return [{
    ...region,
    score: cornerScore * 0.30 + sizeScore * 0.24 + densityScore * 0.24 + componentScore * 0.22,
    density,
    componentCount: components.length,
  }];
}

export function cornerPositionFallbackRegion(position, dimensions = {}, hint = {}) {
  if (!["upper_left", "upper_right", "lower_left", "lower_right"].includes(position)) return null;
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const regionWidth = Math.round(width * 0.22);
  const regionHeight = Math.round(height * 0.16);
  const x = position.endsWith("_right") ? width - regionWidth : 0;
  const y = position.startsWith("lower_") ? height - regionHeight : 0;
  return regionWithMetadata({
    x,
    y,
    w: regionWidth,
    h: regionHeight,
  }, {
    ...hint,
    confidence: Math.min(0.86, Math.max(0.7, Number(hint?.confidence ?? 0.76) - 0.1)),
  }, { width, height }, "corner_position_fallback");
}

function groupRanges(indexes, maxGap = 2) {
  const ranges = [];
  let start = null;
  let previous = null;
  for (const index of indexes) {
    if (start === null) {
      start = index;
      previous = index;
      continue;
    }
    if (index - previous <= maxGap) {
      previous = index;
      continue;
    }
    ranges.push({ start, end: previous });
    start = index;
    previous = index;
  }
  if (start !== null) ranges.push({ start, end: previous });
  return ranges;
}

export function detectTextLikeRecoveryRegions(bytes, dimensions = {}, vision = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  if (!bytes || bytes.length < width * height) return [];

  const protectedTop = lowerTextProtectedTop(vision, height);
  const yStart = Math.max(1, Math.round(protectedTop - height * 0.25));
  const yEnd = Math.min(height - 2, Math.max(yStart + 2, protectedTop - Math.max(3, Math.round(height * 0.012))));
  const activeRows = [];
  const rowCounts = new Map();

  for (let y = yStart; y <= yEnd; y += 1) {
    let count = 0;
    for (let x = 1; x < width - 1; x += 1) {
      if (activeTextPixel(bytes, width, height, x, y)) count += 1;
    }
    rowCounts.set(y, count);
    if (count >= Math.max(4, Math.round(width * 0.008)) && count <= Math.round(width * 0.45)) {
      activeRows.push(y);
    }
  }

  const componentCandidates = detectComponentTextLikeRegions(bytes, { width, height }, vision, yStart, yEnd, rowCounts);

  const rowBands = groupRanges(activeRows, 2)
    .filter((range) => range.end - range.start + 1 >= 4 && range.end - range.start + 1 <= Math.round(height * 0.13));
  const candidates = [];

  for (const band of rowBands) {
    const colCounts = new Map();
    const activeCols = [];
    for (let x = 1; x < width - 1; x += 1) {
      let count = 0;
      for (let y = band.start; y <= band.end; y += 1) {
        if (activeTextPixel(bytes, width, height, x, y)) count += 1;
      }
      colCounts.set(x, count);
      if (count > 0) activeCols.push(x);
    }

    for (const colBand of groupRanges(activeCols, 9)) {
      const region = {
        x: colBand.start,
        y: band.start,
        w: colBand.end - colBand.start + 1,
        h: band.end - band.start + 1,
      };
      if (region.w < Math.round(width * 0.08) || region.w > Math.round(width * 0.48)) continue;
      if (region.h < 5 || region.h > Math.round(height * 0.14)) continue;
      if (region.y + region.h >= protectedTop) continue;

      let activePixels = 0;
      for (let y = region.y; y < region.y + region.h; y += 1) {
        for (let x = region.x; x < region.x + region.w; x += 1) {
          if (activeTextPixel(bytes, width, height, x, y)) activePixels += 1;
        }
      }
      const density = activePixels / Math.max(1, region.w * region.h);
      if (density < 0.025 || density > 0.65) continue;

      const distanceFromLowerText = Math.max(0, protectedTop - (region.y + region.h));
      const verticalScore = 1 - Math.min(1, distanceFromLowerText / Math.max(1, height * 0.2));
      const widthScore = region.w >= width * 0.16 && region.w <= width * 0.36 ? 1 : 0.62;
      const densityScore = Math.min(1, density / 0.18);
      candidates.push({
        ...region,
        score: verticalScore * 0.55 + widthScore * 0.25 + densityScore * 0.2,
        density,
      });
    }
  }

  return [...componentCandidates, ...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function recoverDelogoRegions({ framePaths = [], vision = null, dimensions = {}, existingRegions = [], allowVisualRecovery = false } = {}) {
  const hints = delogoHintsFromVision(vision);
  const result = {
    attempted: false,
    reason: null,
    hints: hints.map((hint) => ({ text: hint.text, category: hint.category, confidence: hint.confidence })),
    regions: [],
  };
  if (existingRegions.length > 0) return { ...result, reason: "existing_delogo_region" };
  if (hints.length === 0) return { ...result, reason: "no_delogo_hint" };

  result.attempted = true;
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const framePath = framePaths[0];
  if (!framePath) return { ...result, reason: "no_frame" };

  const ocr = await runOcrTsv(framePath);
  let ocrRegions = [];
  if (ocr.available) {
    ocrRegions = recoverDelogoRegionsFromOcrWords(ocr.words, hints, { width, height }, vision, ocr.dimensions);
    const coveredHintTexts = new Set(ocrRegions.map((region) => normalizedText(region.text)));
    const shouldTryVisualFallbacks = allowVisualRecovery &&
      (Boolean(broadLowerMiddleWatermarkHint(hints, coveredHintTexts)) || Boolean(sameCreatorGraphicLogoHint(hints, coveredHintTexts)));
    if (ocrRegions.length > 0 && (!allowVisualRecovery || (ocrRegions.length >= Math.min(2, hints.length) && !shouldTryVisualFallbacks))) {
      return { ...result, reason: "ocr_text_match", regions: ocrRegions };
    }
  }
  if (!allowVisualRecovery) {
    return { ...result, reason: ocr.available ? "no_ocr_text_match" : "ocr_unavailable" };
  }

  try {
    const gray = await readGrayImage(framePath, { width, height });
    const recoveryMaxRegions = maxRecoverableDelogoRegionsForHints(hints);
    const coveredHintTexts = new Set(ocrRegions.map((region) => normalizedText(region.text)));

    const broadHint = broadLowerMiddleWatermarkHint(hints, coveredHintTexts);
    if (broadHint) {
      const fallbackRegions = broadLowerMiddleWatermarkFallbackRegions(broadHint, { width, height });
      const mergedRegions = mergeRecoveredDelogoRegions([...ocrRegions, ...fallbackRegions], { width, height }, Math.max(2, fallbackRegions.length + ocrRegions.length));
      if (mergedRegions.length > ocrRegions.length || ocrRegions.length === 0) {
        return {
          ...result,
          reason: ocrRegions.length > 0 ? "ocr_text_match+broad_lower_middle_position_fallback" : "broad_lower_middle_position_fallback",
          regions: mergedRegions,
        };
      }
    }

    const creatorGraphicHint = sameCreatorGraphicLogoHint(hints, coveredHintTexts);
    if (creatorGraphicHint) {
      const fallbackRegion = lowerCenterLogoFallbackRegion(creatorGraphicHint, { width, height });
      if (fallbackRegion && fallbackRegion.areaRatio <= 0.06) {
        const mergedRegions = mergeRecoveredDelogoRegions([...ocrRegions, fallbackRegion], { width, height }, recoveryMaxRegions);
        if (mergedRegions.length > ocrRegions.length || ocrRegions.length === 0) {
          return {
            ...result,
            reason: ocrRegions.length > 0 ? "ocr_text_match+same_creator_logo_position_fallback" : "same_creator_logo_position_fallback",
            regions: mergedRegions,
          };
        }
      }
    }

    const positionedHint = hints
      .map((hint) => ({ hint, position: hintPosition(hint) }))
      .find((entry) => entry.position);
    if (positionedHint) {
      const cornerCandidates = detectCornerTextLikeRecoveryRegions(gray, { width, height }, positionedHint.position);
      const cornerBest = cornerCandidates[0];
      if (cornerBest && cornerBest.score >= 0.52) {
        const safetyPad = Math.max(2, Math.min(10, Math.round(Math.min(width, height) * 0.014)));
        const region = regionWithMetadata({
          x: cornerBest.x - safetyPad,
          y: cornerBest.y - safetyPad,
          w: cornerBest.w + safetyPad * 2,
          h: cornerBest.h + safetyPad * 2,
        }, positionedHint.hint, { width, height }, "corner_visual_recovery");
        const recoveredRegion = {
          ...region,
          visualScore: cornerBest.score,
          density: cornerBest.density,
          componentCount: cornerBest.componentCount,
        };
        const visualRegions = recoveredRegion.areaRatio <= 0.06 ? [recoveredRegion] : [];
        const mergedRegions = mergeRecoveredDelogoRegions([...ocrRegions, ...visualRegions], { width, height }, recoveryMaxRegions);
        if (mergedRegions.length > ocrRegions.length || ocrRegions.length === 0) {
          return {
            ...result,
            reason: ocrRegions.length > 0 ? "ocr_text_match+corner_visual_recovery" : "corner_visual_recovery",
            visualCandidates: cornerCandidates,
            regions: mergedRegions,
          };
        }
      }
      const fallbackRegion = cornerPositionFallbackRegion(positionedHint.position, { width, height }, positionedHint.hint);
      if (fallbackRegion && fallbackRegion.areaRatio <= 0.06) {
        const mergedRegions = mergeRecoveredDelogoRegions([...ocrRegions, fallbackRegion], { width, height }, recoveryMaxRegions);
        if (mergedRegions.length > ocrRegions.length || ocrRegions.length === 0) {
          return {
            ...result,
            reason: ocrRegions.length > 0 ? "ocr_text_match+corner_position_fallback" : "corner_position_fallback",
            visualCandidates: cornerCandidates,
            regions: mergedRegions,
          };
        }
      }
    }

    const centeredHints = hints
      .filter((hint) => !coveredHintTexts.has(normalizedText(hint.text)))
      .filter((hint) => isCenteredTextWatermarkHint(hint));
    if (centeredHints.length > 0) {
      const primaryHint = centeredHints[0];
      const compactHintText = normalizedText(`${primaryHint.text ?? ""} ${primaryHint.category ?? ""}`);
      const isCompactTextWatermark = compactHintText.length > 0 &&
        compactHintText.length <= 42 &&
        /(?:third_party_watermark|creator_watermark|creator_handle|platform_logo|channel)/i.test(String(primaryHint.category ?? ""));
      const compactCandidates = isCompactTextWatermark
        ? detectCenteredTextLikeRecoveryRegions(gray, { width, height }, {
          minWidthRatio: 0.045,
          minRunWidthRatio: 0.045,
          maxWidthRatio: 0.46,
          idealMinWidthRatio: 0.06,
          idealMaxWidthRatio: 0.28,
          maxRunGapRatio: 0.032,
        })
        : [];
      const genericCandidates = detectCenteredTextLikeRecoveryRegions(gray, { width, height });
      const compactBest = compactCandidates[0];
      const centeredCandidates = compactBest && compactBest.score >= 0.48
        ? compactCandidates
        : genericCandidates;
      const centeredBest = chooseCenteredVisualCandidate(centeredCandidates, primaryHint, { width, height });
      if (centeredBest && centeredBest.score >= 0.56) {
        const hint = centeredHints[0];
        const hintText = `${hint.text ?? ""} ${hint.category ?? ""} ${hint.reason ?? ""}`;
        const safetyPad = Math.max(1, Math.min(4, Math.round(Math.min(width, height) * 0.006)));
        const lowerCenteredCreatorLogo = isCreatorLogoHint(hint) && isLowerCenteredCandidate(centeredBest, { width, height });
        const leftLogoPad = /(?:telegram|logo|icon|channel|platform)/i.test(hintText)
          ? Math.max(safetyPad, Math.round(width * 0.085))
          : safetyPad;
        const padX = lowerCenteredCreatorLogo ? Math.max(leftLogoPad, Math.round(width * 0.025)) : leftLogoPad;
        const padY = lowerCenteredCreatorLogo ? Math.max(safetyPad, Math.round(height * 0.040)) : safetyPad;
        const region = regionWithMetadata({
          x: centeredBest.x - padX,
          y: centeredBest.y - padY,
          w: centeredBest.w + padX * 2,
          h: centeredBest.h + padY * 2,
        }, hint, { width, height }, "center_handle_visual_recovery");
        const recoveredRegion = {
          ...region,
          visualScore: centeredBest.score,
          density: centeredBest.density,
          componentCount: centeredBest.componentCount,
        };
        const visualRegions = recoveredRegion.areaRatio <= 0.09 ? [recoveredRegion] : [];
        return {
          ...result,
          reason: ocrRegions.length > 0 ? "ocr_text_match+center_handle_visual_recovery" : "center_handle_visual_recovery",
          visualCandidates: centeredCandidates,
          regions: mergeRecoveredDelogoRegions([...ocrRegions, ...visualRegions], { width, height }, recoveryMaxRegions),
        };
      }
    }

    const lowerCenterHint = lowerCenterLogoHint(hints, coveredHintTexts);
    if (lowerCenterHint) {
      const fallbackRegion = lowerCenterLogoFallbackRegion(lowerCenterHint, { width, height });
      if (fallbackRegion && fallbackRegion.areaRatio <= 0.06) {
        const mergedRegions = mergeRecoveredDelogoRegions([...ocrRegions, fallbackRegion], { width, height }, recoveryMaxRegions);
        if (mergedRegions.length > ocrRegions.length || ocrRegions.length === 0) {
          return {
            ...result,
            reason: ocrRegions.length > 0 ? "ocr_text_match+lower_center_position_fallback" : "lower_center_position_fallback",
            regions: mergedRegions,
          };
        }
      }
    }

    const visualCandidates = detectTextLikeRecoveryRegions(gray, { width, height }, vision);
    const best = visualCandidates[0];
    if (!best || best.score < 0.62) {
      if (ocrRegions.length > 0) {
        return { ...result, reason: "ocr_text_match", visualCandidates, regions: ocrRegions };
      }
      return { ...result, reason: "no_visual_candidate" };
    }
    const recoveredHintTexts = new Set(ocrRegions.map((region) => normalizedText(region.text)));
    const hint = hints.find((candidate) => !recoveredHintTexts.has(normalizedText(candidate.text)) && isCreatorLogoHint(candidate)) ?? hints[0];
    const safetyPad = Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.012)));
    const lowerCenteredCreatorLogo = isCreatorLogoHint(hint) && isLowerCenteredCandidate(best, { width, height });
    const padX = lowerCenteredCreatorLogo ? Math.max(safetyPad, Math.round(width * 0.025)) : safetyPad;
    const padY = lowerCenteredCreatorLogo ? Math.max(safetyPad, Math.round(height * 0.040)) : safetyPad;
    const region = regionWithMetadata({
      x: best.x - padX,
      y: best.y - padY,
      w: best.w + padX * 2,
      h: best.h + padY * 2,
    }, hint, { width, height }, "ocr_visual_recovery");
    const recoveredRegion = {
      ...region,
      visualScore: best.score,
      density: best.density,
      componentCount: best.componentCount,
    };
    const visualRegions = recoveredRegion.areaRatio <= 0.08 ? [recoveredRegion] : [];
    return {
      ...result,
      reason: ocrRegions.length > 0 ? "ocr_text_match+ocr_visual_recovery" : "ocr_visual_recovery",
      visualCandidates,
      regions: mergeRecoveredDelogoRegions([...ocrRegions, ...visualRegions], { width, height }, recoveryMaxRegions),
    };
  } catch (error) {
    if (ocrRegions.length > 0) {
      return { ...result, reason: "ocr_text_match", regions: ocrRegions };
    }
    return { ...result, reason: "visual_recovery_error", error: error instanceof Error ? error.message : String(error) };
  }
}

export function scoreWatermarkSignals(signals = {}) {
  const repeatedText = (signals.repeatedCornerText ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const platformMatches = (signals.platformMatches ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
  const textMatches = repeatedText.filter((text) => PLATFORM_PATTERNS.some((pattern) => pattern.test(text)));
  const stableOverlayScore = clamp01(signals.stableOverlayScore);
  const visionConfidence = clamp01(signals.vision?.confidence ?? 0);
  const visionOverlays = Array.isArray(signals.vision?.overlays) ? signals.vision.overlays : [];
  const visionRenderAction = String(signals.vision?.renderDecision?.action ?? "");
  const visionBlockScore = visionOverlays
    .filter((overlay) => overlay?.action === "block")
    .reduce((max, overlay) => Math.max(max, clamp01(overlay?.confidence)), 0);
  const visionDelogoCount = visionOverlays.filter((overlay) => overlay?.action === "delogo").length;
  const visionSkipScore = signals.vision?.shouldBlock || signals.vision?.shouldSkip
    ? Math.max(visionConfidence, visionBlockScore)
    : visionBlockScore;

  const reasons = [];
  let score = stableOverlayScore * 0.55;
  if (repeatedText.length > 0) {
    score += Math.min(0.25, repeatedText.length * 0.09);
    reasons.push("repeated_corner_text");
  }
  if (textMatches.length > 0 || platformMatches.length > 0) {
    score += 0.25;
    reasons.push("platform_or_handle_text");
  }
  if (visionSkipScore > 0) {
    score = Math.max(score, visionSkipScore);
    reasons.push("openai_vision");
  }
  if (visionDelogoCount > 0) reasons.push("vision_delogo");
  if (stableOverlayScore >= 0.65) reasons.push("stable_overlay");
  if (visionRenderAction === "render" && visionConfidence >= 0.85 && visionSkipScore === 0 && visionDelogoCount === 0 && textMatches.length === 0 && platformMatches.length === 0) {
    score = Math.min(score, 0.55);
    reasons.push("openai_vision_clear");
  }
  if (visionOverlays.length > 0 && visionSkipScore === 0) {
    score = Math.min(score, 0.55);
    reasons.push("vision_keep_or_delogo");
  }

  return {
    score: clamp01(score),
    reasons: [...new Set(reasons)],
    repeatedText,
    platformMatches,
    vision: signals.vision ?? null,
  };
}

export function decidePreflightBlock(preflight, options = {}) {
  if (preflight?.vision?.shouldBlock || preflight?.vision?.shouldSkip) {
    return { blocked: true, reason: preflight.vision.blockReason || "watermark_detected" };
  }
  if (preflight?.delogoPlan?.blocked) {
    return { blocked: true, reason: preflight.delogoPlan.reason || "delogo_risk_too_high" };
  }
  if (String(preflight?.vision?.renderDecision?.action ?? "") === "manual_review") {
    return { blocked: true, reason: "vision_manual_review" };
  }
  const blockOverlay = (preflight?.vision?.overlays ?? [])
    .filter((overlay) => overlay?.action === "block")
    .sort((a, b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0))[0];
  if (blockOverlay && Number(blockOverlay.confidence ?? 0) >= 0.75) {
    return { blocked: true, reason: "watermark_detected" };
  }

  const high = Number(options.watermarkBlockThreshold ?? 0.85);
  const uncertain = Number(options.watermarkUncertainThreshold ?? 0.60);
  const blockUncertain = options.blockUncertainWatermarks !== false;
  const watermarkScore = Number(preflight?.watermark?.score ?? 0);
  if (watermarkScore >= high) return { blocked: true, reason: "watermark_detected" };
  if (blockUncertain && watermarkScore >= uncertain) return { blocked: true, reason: "watermark_uncertain" };

  const hardSubtitleConfidence = Number(preflight?.hardSubtitles?.confidence ?? 0);
  const hardSubtitleLocation = String(preflight?.hardSubtitles?.location ?? "unknown");
  if (hardSubtitleConfidence >= 0.75 && hardSubtitleLocation !== "bottom") {
    return { blocked: true, reason: "subtitle_conflict_uncertain" };
  }

  return { blocked: false, reason: null };
}

export function visionFromWatermarkOnly(watermarkOnly) {
  watermarkOnly = normalizeWatermarkOnlyDecision(watermarkOnly);
  const removable = Array.isArray(watermarkOnly?.removableWatermarks) ? watermarkOnly.removableWatermarks : [];
  const delogoable = removable.filter((item) => isRemovableDelogoCandidate({
    text: item.text,
    category: item.type,
    reason: item.reason,
  }));
  const protectedContext = removable.filter((item) => !delogoable.includes(item));
  const mustKeep = Array.isArray(watermarkOnly?.mustKeep) ? watermarkOnly.mustKeep : [];
  const lowerTextHint = [...protectedContext, ...mustKeep].find((item) => {
    const text = String(item?.text ?? "");
    const type = String(item?.type ?? "");
    const reason = String(item?.reason ?? "");
    return /(?:subtitle|caption|lower[_ -]?third|ticker|teletext|chyron|news[_ -]?banner)/i.test(`${text} ${type} ${reason}`);
  });
  const hintedLowerTextRegion = lowerTextHint
    ? {
      detected: true,
      confidence: Math.max(0.78, clamp01(watermarkOnly?.confidence ?? 0)),
      type: String(lowerTextHint.type ?? "lower_third") || "lower_third",
      action: "keep",
      source: "watermark_only_hint",
      inferred: true,
      box: { x: 0, y: 0.72, w: 1, h: 0.24 },
      reason: String(lowerTextHint.reason ?? "Contextual lower-third/subtitle text must stay."),
    }
    : { detected: false, confidence: 0, type: "none", action: "keep", box: { x: 0, y: 0, w: 0, h: 0 }, reason: "" };
  const rawDecision = String(watermarkOnly?.decision ?? "render");
  const decision = rawDecision === "render_with_delogo" && delogoable.length === 0 ? "render" : rawDecision;
  return {
    hasWatermark: delogoable.length > 0,
    confidence: clamp01(watermarkOnly?.confidence ?? 0),
    location: "watermark_only",
    detectedTextOrLogo: delogoable.map((item) => item.text).filter(Boolean).join(", "),
    hasSubtitles: false,
    shouldSkip: decision === "block" || decision === "uncertain",
    shouldBlock: decision === "block" || decision === "uncertain",
    blockReason: decision === "uncertain" ? "watermark_coordinates_uncertain" : "",
    existingSubtitles: { detected: false, confidence: 0, type: "none", action: "keep", box: { x: 0, y: 0, w: 0, h: 0 }, reason: "" },
    lowerTextRegion: hintedLowerTextRegion,
    subtitlePlacement: { placement: "bottom", y: 0, maxWidth: 0.86, bottomMargin: 0.08, confidence: 0, reason: "" },
    renderDecision: {
      action: decision === "render_with_delogo" ? "render_with_delogo" : decision === "render" ? "render" : "block",
      confidence: clamp01(watermarkOnly?.confidence ?? 0),
      reason: String(watermarkOnly?.reason ?? ""),
    },
    needsSpecialistReview: decision === "uncertain",
    overlays: [
      ...delogoable.map((item) => ({
        text: item.text,
        category: item.type,
        action: item.safeToDelogo ? "delogo" : "block",
        confidence: item.confidence,
        reason: item.reason,
        box: item.box,
      })),
      ...protectedContext.map((item) => ({
        text: item.text,
        category: "lower_third",
        action: "keep",
        confidence: item.confidence,
        reason: `Protected contextual text: ${item.reason}`,
        box: item.box,
      })),
      ...mustKeep.map((item) => ({
        text: item.text,
        category: item.type,
        action: "keep",
        confidence: 1,
        reason: item.reason,
        box: { x: 0, y: 0, w: 0, h: 0 },
      })),
    ],
  };
}

function rectArea(rect) {
  return Math.max(0, Number(rect?.w ?? 0)) * Math.max(0, Number(rect?.h ?? 0));
}

function rectOverlap(a, b) {
  const ax2 = Number(a.x) + Number(a.w);
  const ay2 = Number(a.y) + Number(a.h);
  const bx2 = Number(b.x) + Number(b.w);
  const by2 = Number(b.y) + Number(b.h);
  const x = Math.max(0, Math.min(ax2, bx2) - Math.max(Number(a.x), Number(b.x)));
  const y = Math.max(0, Math.min(ay2, by2) - Math.max(Number(a.y), Number(b.y)));
  return x * y;
}

function candidateHasUsableBox(candidate) {
  const box = candidate?.box ?? {};
  const area = Number(box.area ?? Number(box.w ?? 0) * Number(box.h ?? 0));
  if (box.valid === false) return false;
  if (![box.x, box.y, box.w, box.h].map(Number).every(Number.isFinite)) return false;
  if (Number(box.w) <= 0 || Number(box.h) <= 0 || area <= 0) return false;
  if (Number(box.x) >= 0.95 && Number(box.y) >= 0.95 && Number(box.w) >= 0.9 && Number(box.h) >= 0.9) return false;
  return true;
}

export function delogoRegionsFromWatermarkOnly(watermarkOnly, dimensions = {}, options = {}) {
  watermarkOnly = normalizeWatermarkOnlyDecision(watermarkOnly);
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const minConfidence = Number(options.minWatermarkOnlyConfidence ?? 0.85);
  const pad = Number(options.watermarkBoxPadRatio ?? 0);
  const horizontalDilation = Number(options.watermarkBoxHorizontalDilation ?? 0);
  const verticalDilation = Number(options.watermarkBoxVerticalDilation ?? 0);
  const candidates = Array.isArray(watermarkOnly?.removableWatermarks) ? watermarkOnly.removableWatermarks : [];

  return candidates
    .filter((candidate) => candidate?.safeToDelogo === true)
    .filter((candidate) => isRemovableDelogoCandidate({
      text: candidate.text,
      category: candidate.type,
      reason: candidate.reason,
    }))
    .filter((candidate) => Number(candidate?.confidence ?? 0) >= minConfidence)
    .filter(candidateHasUsableBox)
    .map((candidate) => {
      const box = candidate.box;
      const padX = Math.max(pad, Number(box.w) * horizontalDilation);
      const padY = Math.max(pad, Number(box.h) * verticalDilation);
      const x = clamp01(Number(box.x) - padX);
      const y = clamp01(Number(box.y) - padY);
      const w = Math.min(1 - x, clamp01(Number(box.w) + padX * 2));
      const h = Math.min(1 - y, clamp01(Number(box.h) + padY * 2));
      const px = Math.min(Math.max(0, width - 2), Math.round(x * width));
      const py = Math.min(Math.max(0, height - 2), Math.round(y * height));
      const pw = Math.max(1, Math.min(Math.max(1, width - px - 1), Math.round(w * width)));
      const ph = Math.max(1, Math.min(Math.max(1, height - py - 1), Math.round(h * height)));
      const region = { x: px, y: py, w: pw, h: ph };
      const center = { x: width * 0.25, y: height * 0.25, w: width * 0.5, h: height * 0.5 };
      return {
        ...region,
        areaRatio: rectArea(region) / Math.max(1, width * height),
        centerOverlapRatio: rectOverlap(region, center) / Math.max(1, rectArea(region)),
        text: String(candidate.text ?? ""),
        category: String(candidate.type ?? "unknown"),
        confidence: clamp01(candidate.confidence),
        source: "watermark_only_vision",
        seenInFrames: candidate.seenInFrames ?? [],
      };
    });
}

export function decideWatermarkOnlyBlock(watermarkOnly, delogoPlan) {
  watermarkOnly = normalizeWatermarkOnlyDecision(watermarkOnly);
  const decision = String(watermarkOnly?.decision ?? "render");
  if (decision === "block") return { blocked: true, reason: "watermark_detected" };
  if (decision === "uncertain") return { blocked: true, reason: "watermark_coordinates_uncertain" };
  if (delogoPlan?.blocked) return { blocked: true, reason: delogoPlan.reason || "delogo_risk_too_high" };
  return { blocked: false, reason: null };
}

function isUsableVisionBox(box) {
  const rawX = Number(box?.x);
  const rawY = Number(box?.y);
  const rawW = Number(box?.w);
  const rawH = Number(box?.h);
  if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) return false;
  if (rawW <= 0 || rawH <= 0) return false;
  const impossibleSentinel = rawX >= 0.95 && rawY >= 0.95 && rawW >= 0.9 && rawH >= 0.9;
  if (impossibleSentinel) return false;
  return true;
}

function isHandleLikeDelogo(value = {}) {
  const category = String(value.category ?? "unknown");
  return /(?:source_watermark|creator_watermark|platform_repost)/.test(category)
    || /(?:^|\s)@[\w.]+|\b[\w.-]+\.(?:com|net|org|io|ir|co)\b/i.test(String(value.text ?? ""));
}

export function delogoRegionsFromVision(vision, dimensions = {}, options = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const minConfidence = Number(options.minConfidence ?? 0.55);
  const padX = Number(options.padX ?? 0.012);
  const padY = Number(options.padY ?? 0.012);
  const overlays = Array.isArray(vision?.overlays) ? vision.overlays : [];

  return overlays
    .filter((overlay) => overlay?.action === "delogo")
    .filter((overlay) => Number(overlay?.confidence ?? 0) >= minConfidence)
    .filter((overlay) => isUsableVisionBox(overlay?.box))
    .map((overlay) => {
      const category = String(overlay.category ?? "unknown");
      const isHandleLike = isHandleLikeDelogo(overlay);
      const rawW = clamp01(Number(overlay.box.w));
      const rawH = clamp01(Number(overlay.box.h));
      const needsAggressivePad = isHandleLike && rawW < 0.12 && rawH < 0.055;
      const nearLowerFrame = isHandleLike && clamp01(Number(overlay.box.y)) >= 0.58;
      const leftPad = isHandleLike ? Math.max(padX, needsAggressivePad ? 0.04 : 0.018) : padX;
      const handleRightPad = needsAggressivePad ? 0.24 : rawW < 0.32 ? 0.20 : 0.12;
      const rightPad = isHandleLike ? Math.max(padX, handleRightPad) : padX;
      const handleTopPad = nearLowerFrame ? 0.065 : needsAggressivePad ? 0.045 : 0.018;
      const topPad = isHandleLike ? Math.max(padY, handleTopPad) : padY;
      const bottomPad = isHandleLike ? Math.max(padY, needsAggressivePad ? 0.06 : 0.025) : padY;
      const x = clamp01(Number(overlay.box.x) - leftPad);
      const y = clamp01(Number(overlay.box.y) - topPad);
      const w = Math.min(1 - x, clamp01(rawW + leftPad + rightPad));
      const paddedH = clamp01(rawH + topPad + bottomPad);
      const h = Math.min(1 - y, isHandleLike ? Math.min(paddedH, 0.135) : paddedH);
      const px = Math.min(Math.max(0, width - 2), Math.round(x * width));
      const py = Math.min(Math.max(0, height - 2), Math.round(y * height));
      const pw = Math.max(1, Math.min(Math.max(1, width - px - 1), Math.round(w * width)));
      const ph = Math.max(1, Math.min(Math.max(1, height - py - 1), Math.round(h * height)));
      const region = { x: px, y: py, w: pw, h: ph };
      const center = { x: width * 0.25, y: height * 0.25, w: width * 0.5, h: height * 0.5 };
      const areaRatio = rectArea(region) / Math.max(1, width * height);
      return {
        x: px,
        y: py,
        w: pw,
        h: ph,
        areaRatio,
        centerOverlapRatio: rectOverlap(region, center) / Math.max(1, rectArea(region)),
        text: String(overlay.text ?? ""),
        category: String(overlay.category ?? "unknown"),
        confidence: clamp01(overlay.confidence),
      };
    });
}

export function evaluateDelogoPlan(regions = [], dimensions = {}, options = {}) {
  const width = Math.max(1, Number(dimensions.width ?? 0) || 1);
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const baseMaxRegions = Number(options.maxDelogoRegions ?? 2);
  const sameCreatorCleanup = regions.length <= 3 && regions.every((region) => {
    const category = String(region?.category ?? "");
    const reason = String(region?.reason ?? "");
    return /(?:creator_handle|creator_watermark)/i.test(category) || /same creator brand/i.test(reason);
  });
  const maxRegions = sameCreatorCleanup ? Math.max(baseMaxRegions, 3) : baseMaxRegions;
  const maxSingleAreaRatio = Number(options.maxSingleDelogoAreaRatio ?? 0.10);
  const maxTotalAreaRatio = Number(options.maxTotalDelogoAreaRatio ?? 0.15);
  const totalAreaRatio = regions.reduce((sum, region) => {
    const ratio = Number.isFinite(Number(region?.areaRatio))
      ? Number(region.areaRatio)
      : rectArea(region) / Math.max(1, width * height);
    return sum + ratio;
  }, 0);
  const largestAreaRatio = regions.reduce((max, region) => {
    const ratio = Number.isFinite(Number(region?.areaRatio))
      ? Number(region.areaRatio)
      : rectArea(region) / Math.max(1, width * height);
    return Math.max(max, ratio);
  }, 0);

  let reason = null;
  if (options.requireDelogoCoordinates === true && regions.length === 0) reason = "delogo_coordinates_uncertain";
  else if (regions.length > maxRegions) reason = "too_many_delogo_regions";
  else if (largestAreaRatio > maxSingleAreaRatio) reason = "single_delogo_region_too_large";
  else if (totalAreaRatio > maxTotalAreaRatio) reason = "total_delogo_area_too_large";

  return {
    blocked: Boolean(reason),
    reason,
    regionCount: regions.length,
    maxRegions,
    totalAreaRatio,
    largestAreaRatio,
  };
}

export function selectDelogoRegions({ recoveredRegions = [], modelRegions = [], requireLocalDelogoCoordinates = false, options = {} } = {}) {
  if (!requireLocalDelogoCoordinates) return [];
  if (Array.isArray(recoveredRegions) && recoveredRegions.length > 0) return recoveredRegions;

  const candidates = Array.isArray(modelRegions) ? modelRegions : [];
  if (candidates.length === 0) return [];

  const maxRegions = Number(options.maxDelogoRegions ?? 2);
  const minConfidence = Number(options.minModelDelogoFallbackConfidence ?? 0.95);
  const minFrames = Number(options.minModelDelogoFallbackFrames ?? 2);
  const maxSingleAreaRatio = Math.min(
    Number(options.maxSingleDelogoAreaRatio ?? 0.10),
    Number(options.maxModelDelogoFallbackAreaRatio ?? 0.04),
  );
  if (candidates.length > maxRegions) return [];

  const safe = candidates.filter((region) => {
    const confidence = Number(region?.confidence ?? 0);
    const areaRatio = Number(region?.areaRatio ?? 1);
    const frames = Array.isArray(region?.seenInFrames) ? region.seenInFrames.length : 0;
    const hasWatermarkMarker = hasWatermarkTextMarker(region?.text) ||
      /(?:repost|platform|domain|watermark|handle)/i.test(String(region?.category ?? ""));
    return confidence >= minConfidence &&
      areaRatio > 0 &&
      areaRatio <= maxSingleAreaRatio &&
      frames >= minFrames &&
      hasWatermarkMarker;
  });

  return safe.length === candidates.length
    ? safe.map((region) => ({ ...region, selectedBy: "model_delogo_fallback" }))
    : [];
}

export function protectDelogoRegionsFromLowerText(regions = [], vision, dimensions = {}, options = {}) {
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const lowerText = vision?.lowerTextRegion ?? null;
  if (!lowerText?.detected || lowerText?.action !== "keep" || Number(lowerText.confidence ?? 0) < 0.75 || !lowerText.box) {
    return regions;
  }

  const protectedTop = Math.round(clamp01(lowerText.box.y) * height);
  if (protectedTop <= 0 || protectedTop >= height) return regions;
  const gap = Math.max(2, Math.round(height * Number(options.lowerTextDelogoGap ?? 0.012)));
  const handleOverlapAllowance = Math.round(height * Number(options.handleLowerTextOverlapAllowance ?? 0.035));

  return regions.map((region) => {
    const y = Math.max(0, Math.round(Number(region.y) || 0));
    const h = Math.max(1, Math.round(Number(region.h) || 1));
    const allowedBottom = isHandleLikeDelogo(region) && Number(region.areaRatio ?? 1) <= 0.08
      ? protectedTop + handleOverlapAllowance
      : protectedTop - gap;
    if (y + h <= allowedBottom) return region;
    const shiftedY = Math.max(0, allowedBottom - h);
    return {
      ...region,
      y: shiftedY,
      adjustedForLowerText: shiftedY !== y,
    };
  });
}

export function subtitlePlacementFromVision(vision, dimensions = {}, options = {}) {
  const height = Math.max(1, Number(dimensions.height ?? 0) || 1);
  const minBottomMargin = Number(options.minSubtitleBottomMargin ?? 0.08);
  const maxBottomMargin = Number(options.maxSubtitleBottomMargin ?? 0.34);
  const maxSubtitleLowerTextBottomMargin = Number(options.maxSubtitleLowerTextBottomMargin ?? 0.20);
  const maxNonSubtitleLowerTextBottomMargin = Number(options.maxNonSubtitleLowerTextBottomMargin ?? 0.22);
  const maxHintedSubtitleLowerTextBottomMargin = Number(options.maxHintedSubtitleLowerTextBottomMargin ?? 0.20);
  const maxHintedNonSubtitleLowerTextBottomMargin = Number(options.maxHintedNonSubtitleLowerTextBottomMargin ?? 0.15);
  const bottomOverlaySubtitleMargin = Number(options.bottomOverlaySubtitleMargin ?? 0.22);
  const singleBottomOverlaySubtitleMargin = Number(options.singleBottomOverlaySubtitleMargin ?? 0.15);
  const lowerText = vision?.lowerTextRegion ?? null;
  const recommended = vision?.subtitlePlacement ?? null;
  const overlayDetection = options.overlayDetection ?? null;
  let bottomMargin = Number(recommended?.bottomMargin);
  let source = "vision_recommendation";

  if (!Number.isFinite(bottomMargin) || bottomMargin <= 0) {
    bottomMargin = minBottomMargin;
    source = "default";
  }

  if (lowerText?.detected && lowerText.box && Number(lowerText.confidence ?? 0) >= 0.55) {
    const lowerTop = clamp01(lowerText.box.y);
    const aboveLowerText = clamp01(1 - lowerTop + Number(options.subtitleTickerGap ?? 0.025));
    const lowerTextType = String(lowerText.type ?? "").toLowerCase();
    const lowerTextKind = lowerTextType || String(lowerText.reason ?? "").toLowerCase();
    const subtitleLikeLowerText = /subtitle|caption|dialogue/.test(lowerTextKind);
    const inferredLowerText = lowerText.inferred === true || String(lowerText.source ?? "") === "watermark_only_hint";
    const lowerTextCap = inferredLowerText
      ? (subtitleLikeLowerText ? maxHintedSubtitleLowerTextBottomMargin : maxHintedNonSubtitleLowerTextBottomMargin)
      : (subtitleLikeLowerText ? maxSubtitleLowerTextBottomMargin : maxNonSubtitleLowerTextBottomMargin);
    const cappedAboveLowerText = Math.min(aboveLowerText, lowerTextCap);
    if (cappedAboveLowerText > bottomMargin) {
      bottomMargin = cappedAboveLowerText;
      source = "lower_text_region";
    }
  }

  const bottomOverlayScoreThreshold = Number(options.bottomOverlayScoreThreshold ?? 0.74);
  const bottomOverlayDensityThreshold = Number(options.bottomOverlayDensityThreshold ?? 0.012);
  const bottomOverlayRegions = Array.isArray(overlayDetection?.regions)
    ? overlayDetection.regions
      .filter((region) => String(region?.name ?? "").startsWith("bottom_"))
      .filter((region) => Number(region?.score ?? 0) >= bottomOverlayScoreThreshold && Number(region?.averageDensity ?? 0) >= bottomOverlayDensityThreshold)
    : [];
  const bottomOverlayScore = bottomOverlayRegions.reduce((max, region) => Math.max(max, Number(region?.score ?? 0) || 0), 0);
  if (bottomOverlayRegions.length > 0) {
    const broadBottomOverlay = bottomOverlayRegions.length >= Number(options.minBottomOverlayRegionsForFullMargin ?? 2);
    const overlayMargin = broadBottomOverlay ? bottomOverlaySubtitleMargin : singleBottomOverlaySubtitleMargin;
    if (overlayMargin > bottomMargin) {
      bottomMargin = overlayMargin;
      source = "stable_bottom_overlay";
    }
  }

  const clamped = Math.max(minBottomMargin, Math.min(maxBottomMargin, bottomMargin));
  return {
    placement: recommended?.placement ?? (source === "lower_text_region" || source === "stable_bottom_overlay" ? "above_lower_text" : "bottom"),
    bottomMargin: clamped,
    marginV: Math.round(height * clamped),
    confidence: Math.max(Number(recommended?.confidence ?? 0), Number(lowerText?.confidence ?? 0), bottomOverlayScore, source === "default" ? 0 : 0.55),
    source,
    reason: recommended?.reason ?? lowerText?.reason ?? "",
  };
}

export function mergePreflight(existing, patch) {
  return {
    ...(existing ?? {}),
    ...(patch ?? {}),
    softSubtitles: patch?.softSubtitles ?? existing?.softSubtitles ?? [],
    hardSubtitles: patch?.hardSubtitles ?? existing?.hardSubtitles ?? null,
    watermark: patch?.watermark ?? existing?.watermark ?? null,
  };
}

export async function runVisualPreflight({ inputPath, probe, vision = null, options = {} }) {
  const [captionDetection, overlayDetection] = await Promise.all([
    detectCaptionBand(inputPath, probe),
    detectWatermarkOverlay(inputPath, probe),
  ]);
  const hardSubtitleConfidence = clamp01(captionDetection.captionBandScore);
  const hardSubtitles = {
    detected: hardSubtitleConfidence >= 0.65 && Number(captionDetection.textLikeRegions ?? 0) >= 3,
    confidence: hardSubtitleConfidence,
    location: "bottom",
    raw: captionDetection,
  };

  const watermark = scoreWatermarkSignals({
    stableOverlayScore: Number(options.stableOverlayScore ?? overlayDetection.stableOverlayScore ?? 0),
    repeatedCornerText: options.repeatedCornerText ?? [],
    platformMatches: options.platformMatches ?? [],
    vision,
  });

  return {
    softSubtitles: parseSubtitleStreams(probe?.raw),
    hardSubtitles,
    watermark,
    overlayDetection,
    block: decidePreflightBlock({ watermark, hardSubtitles, hasUsableSpeech: true }, options),
  };
}

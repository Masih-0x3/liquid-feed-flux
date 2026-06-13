const RTL_MARK = "\u200f";
const RTL_EMBEDDING = "\u202b";
const POP_DIRECTIONAL_FORMATTING = "\u202c";

export function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const msTotal = Math.round(safe * 1000);
  const ms = msTotal % 1000;
  const totalSeconds = Math.floor(msTotal / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function formatAssTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const csTotal = Math.round(safe * 100);
  const cs = csTotal % 100;
  const totalSeconds = Math.floor(csTotal / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function normalizeSegment(segment, index) {
  const id = Number(segment.id ?? index + 1);
  const start = Number(segment.start);
  const end = Number(segment.end);
  const text = String(segment.text ?? "").trim();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`invalid cue timing for id ${id}`);
  }
  if (!text) throw new Error(`empty cue text for id ${id}`);
  return { id, start, end, text };
}

export function sanitizeSubtitleSegments(segments, options = {}) {
  if (!Array.isArray(segments)) return [];
  const durationSeconds = Number.isFinite(Number(options.durationSeconds)) && Number(options.durationSeconds) > 0
    ? Number(options.durationSeconds)
    : Number.isFinite(Number(options.durationMs)) && Number(options.durationMs) > 0
      ? Number(options.durationMs) / 1000
      : null;
  const minGap = Math.max(0, Number(options.minGap ?? 0.02));
  const minDuration = Math.max(0.05, Number(options.minDuration ?? 0.18));
  const normalized = segments
    .map((segment, index) => normalizeSegment(segment, index))
    .map((segment) => ({
      ...segment,
      start: Math.max(0, segment.start),
      end: durationSeconds ? Math.min(segment.end, durationSeconds) : segment.end,
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out = [];
  for (const segment of normalized) {
    let start = segment.start;
    let end = segment.end;
    const previous = out.at(-1);
    if (previous && start < previous.end + minGap) {
      const preferredPreviousEnd = Math.max(previous.start + minDuration, start - minGap);
      if (preferredPreviousEnd < previous.end) {
        previous.end = preferredPreviousEnd;
      }
      if (start < previous.end + minGap) {
        start = previous.end + minGap;
      }
    }
    if (durationSeconds && start >= durationSeconds) continue;
    if (durationSeconds) end = Math.min(end, durationSeconds);
    if (end - start < minDuration) {
      end = durationSeconds ? Math.min(durationSeconds, start + minDuration) : start + minDuration;
    }
    if (end <= start) continue;
    out.push({
      ...segment,
      id: out.length + 1,
      start,
      end,
    });
  }
  return out;
}

function normalizeTargetPunctuation(text, language) {
  if (language === "en") return text;
  return text
    .replace(/,/g, "،")
    .replace(/;/g, "؛")
    .replace(/\?/g, "؟")
    .replace(/^[\s\u200f،,؛;:.!?؟]+/u, "")
    .trim();
}

function isolateRtlLine(text) {
  const line = String(text ?? "").trim();
  if (!line) return "";
  return `${RTL_EMBEDDING}${line}${RTL_MARK}${POP_DIRECTIONAL_FORMATTING}`;
}

function subtitleStyleOptions(options = {}) {
  return options.subtitleStyleConfig && typeof options.subtitleStyleConfig === "object"
    ? options.subtitleStyleConfig
    : {};
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function assColorFromHex(value, fallback) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1];
  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

function subtitleFontSizeForHeight(height, language = "fa", options = {}) {
  const safeHeight = Math.max(320, Number(height) || 1920);
  const style = subtitleStyleOptions(options);
  const fontScale = clampNumber(style.font_scale, 0.75, 1.35, 1);
  const baseSize = Math.min(112, Math.max(42, Math.round(safeHeight / 12.8)));
  const scaledBase = Math.round(baseSize * fontScale);
  if (String(language).toLowerCase() === "en") {
    return Math.min(72, Math.max(22, Math.round(scaledBase * 0.54)));
  }
  return Math.min(128, Math.max(32, scaledBase));
}

function subtitleHorizontalMargin(width, options = {}) {
  const safeWidth = Math.max(320, Number(width) || 1080);
  const style = subtitleStyleOptions(options);
  const maxWidthPct = clampNumber(style.max_width_pct, 0.72, 0.96, 0.92);
  const margin = Math.round(safeWidth * (1 - maxWidthPct) / 2);
  return Math.max(12, Math.min(Math.round(safeWidth * 0.14), margin));
}

function maxLineCharsForLayout({ language = "fa", width = 1080, height = 1920, subtitleStyleConfig = null } = {}) {
  const safeWidth = Math.max(320, Number(width) || 1080);
  const options = { subtitleStyleConfig };
  const fontSize = subtitleFontSizeForHeight(height, language, options);
  const usableWidth = Math.max(240, safeWidth - subtitleHorizontalMargin(safeWidth, options) * 2);
  return language === "en"
    ? Math.max(36, Math.min(68, Math.round(usableWidth / Math.max(fontSize * 0.34, 1))))
    : Math.max(30, Math.min(56, Math.round(usableWidth / Math.max(fontSize * 0.36, 1))));
}

function subtitleAssVisualStyle({ height, outline, options = {} }) {
  const style = subtitleStyleOptions(options);
  const requestedStyle = String(options.subtitleStyle ?? process.env.SUBTITLE_STYLE ?? "yellow_box").toLowerCase();
  if (["yellow_box", "yellow-background", "yellow_black_box"].includes(requestedStyle)) {
    return {
      primaryColour: assColorFromHex(style.text_color, "&H0000FFFF"),
      outlineColour: "&H00000000",
      backColour: assColorFromHex(style.background_color, "&H40000000").replace("&H00", "&H40"),
      borderStyle: 3,
      outline: Math.max(5, Math.round(height / 120)),
      shadow: 0,
    };
  }
  return {
    primaryColour: "&H00FFFFFF",
    outlineColour: "&HCC000000",
    backColour: "&H88000000",
    borderStyle: 1,
    outline,
    shadow: 1,
  };
}

function defaultLineChars(language, options = {}) {
  if (options.width || options.height || options.maxLineChars) {
    return maxLineCharsForLayout({
      language,
      width: options.width,
      height: options.height,
      subtitleStyleConfig: options.subtitleStyleConfig,
    });
  }
  return language === "en" ? 42 : 34;
}

function hasTerminalPunctuation(text) {
  return /[.!?؟。]+["'”’»)\]\u200f\u202c]*$/u.test(String(text ?? "").trim());
}

function splitIntoSentenceParts(text) {
  const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?؟。]+[.!?؟。]+["'”’»)\]\u200f\u202c]*|[^.!?؟。]+$/gu) ?? [cleaned];
  return parts.map((part) => part.trim()).filter(Boolean);
}

function packSentenceParts(parts, maxCueChars) {
  const chunks = [];
  let current = "";
  for (const part of parts) {
    const next = current ? `${current} ${part}` : part;
    if (current && next.length > maxCueChars) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitTextForReadableCues(text, maxCueChars) {
  const sentenceParts = splitIntoSentenceParts(text);
  if (sentenceParts.length > 1 && sentenceParts.every((part) => part.length <= Math.round(maxCueChars * 1.12))) {
    return packSentenceParts(sentenceParts, maxCueChars);
  }

  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxCueChars) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  const merged = [];
  const minChunkChars = Math.max(8, Math.round(maxCueChars * 0.18));
  for (const chunk of chunks) {
    const previous = merged.at(-1);
    const canMergeBack = previous && chunk.length < minChunkChars && `${previous} ${chunk}`.length <= Math.round(maxCueChars * 1.28);
    if (canMergeBack) {
      merged[merged.length - 1] = `${previous} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  if (merged.length > 1 && merged.at(-1).length < minChunkChars) {
    const last = merged.pop();
    merged[merged.length - 1] = `${merged.at(-1)} ${last}`;
  }
  return merged.length > 0 ? merged : [String(text ?? "").trim()];
}

function mergeShortAdjacentSegments(segments, options = {}) {
  const maxCueChars = Number(options.maxCueChars ?? 68);
  const maxMergedChars = Number(options.maxMergedChars ?? Math.round(maxCueChars * 1.35));
  const maxMergedDuration = Number(options.maxMergedDuration ?? 7.2);
  const maxSentenceMergeDuration = Number(options.maxSentenceMergeDuration ?? maxMergedDuration);
  const maxMergeGap = Number(options.maxMergeGap ?? 0.9);
  const minReadableChars = Number(options.minReadableChars ?? Math.max(8, Math.round(maxCueChars * 0.14)));
  const minReadableDuration = Number(options.minReadableDuration ?? 1.05);
  const merged = [];

  for (const segment of segments) {
    const previous = merged.at(-1);
    const currentText = String(segment.text ?? "").trim();
    if (!previous) {
      merged.push({ ...segment, text: currentText });
      continue;
    }
    const previousText = String(previous.text ?? "").trim();
    const previousShort = previousText.length < minReadableChars || previous.end - previous.start < minReadableDuration;
    const currentShort = currentText.length < minReadableChars || segment.end - segment.start < minReadableDuration;
    const gap = segment.start - previous.end;
    const combinedText = `${previousText} ${currentText}`.trim();
    const canMergeShortCue = (previousShort || currentShort) &&
      gap >= 0 &&
      gap <= maxMergeGap &&
      segment.end - previous.start <= maxMergedDuration &&
      combinedText.length <= maxMergedChars;
    const canCompleteSentence = !hasTerminalPunctuation(previousText) &&
      gap >= 0 &&
      gap <= maxMergeGap &&
      segment.end - previous.start <= maxSentenceMergeDuration &&
      combinedText.length <= maxMergedChars;
    const canMerge = canMergeShortCue || canCompleteSentence;
    if (canMerge) {
      previous.end = segment.end;
      previous.text = combinedText;
    } else {
      merged.push({ ...segment, text: currentText });
    }
  }

  return merged.map((segment, index) => ({ ...segment, id: index + 1 }));
}

function normalizedCaptionLabel(value) {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/^[\s*_[\](){}"'“”‘’«»<>-]+|[\s*_[\](){}"'“”‘’«»<>-]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isNonSpeechCaption(value) {
  const normalized = normalizedCaptionLabel(value);
  if (!normalized) return true;
  return new Set([
    "music",
    "background music",
    "applause",
    "clapping",
    "laughter",
    "laughing",
    "silence",
    "noise",
    "موسیقی",
    "موسیقی متن",
    "موسيقى",
    "موسيقى خلفية",
    "موسيقي",
    "موزیک",
    "موسيقا",
    "מנגינה",
  ]).has(normalized);
}

export function splitLongSubtitleSegments(segments, options = {}) {
  const language = String(options.language ?? "fa").toLowerCase();
  const maxLineChars = Number(options.maxLineChars ?? defaultLineChars(language, options));
  const defaultMaxCueChars = language === "en"
    ? Math.round(maxLineChars * 2.20)
    : Math.round(maxLineChars * 2.00);
  const maxCueChars = Number(options.maxCueChars ?? defaultMaxCueChars);
  const maxCueDuration = Number(options.maxCueDuration ?? 6);
  const minSplitChars = Number(options.minSplitChars ?? Math.round(maxCueChars * 0.9));
  const out = [];
  const timedSegments = sanitizeSubtitleSegments(segments, options);

  for (const normalized of timedSegments) {
    const text = normalizeTargetPunctuation(normalized.text.replace(/\s+/g, " ").trim(), language);
    const duration = normalized.end - normalized.start;
    const lengthChunkCount = Math.ceil(text.length / maxCueChars);
    const durationChunkCount = duration > maxCueDuration && text.length > minSplitChars
      ? Math.ceil(duration / maxCueDuration)
      : 1;
    const targetChunkCount = Math.max(lengthChunkCount, durationChunkCount);
    const shouldSplit = targetChunkCount > 1;
    const targetCueChars = targetChunkCount > lengthChunkCount
      ? Math.min(maxCueChars, Math.max(16, Math.ceil(text.length / targetChunkCount)))
      : maxCueChars;
    const chunks = shouldSplit ? splitTextForReadableCues(text, targetCueChars) : [text];
    if (chunks.length <= 1) {
      out.push({ ...normalized, id: out.length + 1, text });
      continue;
    }

    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0);
    let cursor = normalized.start;
    chunks.forEach((chunk, index) => {
      const isLast = index === chunks.length - 1;
      const chunkDuration = durationChunkCount > lengthChunkCount
        ? duration / chunks.length
        : isLast
          ? normalized.end - cursor
          : duration * (Math.max(1, chunk.length) / totalWeight);
      const nextEnd = isLast ? normalized.end : Math.min(normalized.end, cursor + chunkDuration);
      out.push({
        id: out.length + 1,
        start: cursor,
        end: nextEnd,
        text: chunk,
      });
      cursor = nextEnd;
    });
  }

  return mergeShortAdjacentSegments(out, {
    maxCueChars,
    maxMergedChars: Math.round(maxCueChars * 1.05),
    maxMergedDuration: language === "en" ? 9.2 : 9.2,
    maxSentenceMergeDuration: language === "en" ? 12.4 : 12.4,
  });
}

export function hasUsableSubtitleText(segments, options = {}) {
  const minLetters = Number(options.minLetters ?? 2);
  const minAlphaNumeric = Number(options.minAlphaNumeric ?? 3);
  const values = Array.isArray(segments)
    ? segments.map((segment) => String(segment?.text ?? ""))
    : [String(segments ?? "")];
  const text = values
    .filter((value) => !isNonSpeechCaption(value))
    .join(" ");
  if (!text.trim()) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const alphaNumeric = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return letters >= minLetters || alphaNumeric >= minAlphaNumeric;
}

export function validateTranslatedSegments(sourceSegments, translatedSegments, options = {}) {
  if (!Array.isArray(sourceSegments) || !Array.isArray(translatedSegments)) {
    throw new Error("segments must be arrays");
  }
  if (sourceSegments.length !== translatedSegments.length) {
    throw new Error(`cue count mismatch: source=${sourceSegments.length} translated=${translatedSegments.length}`);
  }

  const strictTiming = Boolean(options.strictTiming ?? false);
  const tolerance = Number(options.timingToleranceSeconds ?? 0.05);
  return translatedSegments.map((segment, index) => {
    const source = normalizeSegment(sourceSegments[index], index);
    const translated = normalizeSegment(segment, index);
    if (translated.id !== source.id) {
      throw new Error(`cue id mismatch at index ${index}: source=${source.id} translated=${translated.id}`);
    }
    if (strictTiming && (Math.abs(translated.start - source.start) > tolerance || Math.abs(translated.end - source.end) > tolerance)) {
      throw new Error(`cue timing mismatch for id ${source.id}`);
    }
    return {
      id: source.id,
      start: source.start,
      end: source.end,
      text: translated.text,
    };
  });
}

export function wrapCue(text, options = {}) {
  const language = String(options.language ?? "fa").toLowerCase();
  const maxChars = Number(options.maxChars ?? defaultLineChars(language, options));
  const maxLines = 2;
  const rtl = language !== "en";
  const cleaned = normalizeTargetPunctuation(
    String(text ?? "").replace(/\s+/g, " ").trim(),
    language,
  );
  if (cleaned.length <= maxChars) return rtl ? isolateRtlLine(cleaned) : cleaned;
  const words = cleaned.split(" ");
  const lines = [""];
  for (const word of words) {
    const current = lines[lines.length - 1];
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || lines.length >= maxLines) {
      lines[lines.length - 1] = next;
    } else {
      lines.push(word);
    }
  }
  return lines.filter(Boolean).map((line) => rtl ? isolateRtlLine(line) : line).join("\n");
}

export function wrapPersianCue(text, maxChars = 34) {
  return wrapCue(text, { language: "fa", maxChars });
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

export function resolveSubtitleMarginV(subtitlePlacement, height, options = {}) {
  const safeHeight = Math.max(320, Number(height) || 1920);
  const style = subtitleStyleOptions(options);
  const defaultMargin = Math.max(20, Math.round(safeHeight * clampNumber(style.bottom_padding_pct, 0.025, 0.14, 0.06)));
  const minimumMargin = Math.max(20, Math.round(safeHeight * 0.025));
  const placement = subtitlePlacement && typeof subtitlePlacement === "object" ? subtitlePlacement : null;
  const explicitMargin = Number(placement?.marginV);
  if (Number.isFinite(explicitMargin) && explicitMargin > 0) {
    return Math.max(minimumMargin, Math.min(Math.round(safeHeight * 0.34), Math.round(explicitMargin)));
  }
  const bottomMargin = Number(placement?.bottomMargin);
  if (Number.isFinite(bottomMargin) && bottomMargin > 0) {
    return Math.max(minimumMargin, Math.min(Math.round(safeHeight * 0.34), Math.round(safeHeight * bottomMargin)));
  }
  return defaultMargin;
}

export function segmentsToSrt(segments, options = {}) {
  const language = String(options.language ?? "fa").toLowerCase();
  const readableSegments = options.splitLongCues === false
    ? sanitizeSubtitleSegments(segments, options)
    : splitLongSubtitleSegments(segments, options);
  return readableSegments.map((segment, index) => {
    const normalized = normalizeSegment(segment, index);
    return [
      String(normalized.id),
      `${formatSrtTime(normalized.start)} --> ${formatSrtTime(normalized.end)}`,
      wrapCue(normalized.text, { ...options, language }),
      "",
    ].join("\n");
  }).join("\n");
}

export function segmentsToAss(segments, options = {}) {
  const width = Math.max(320, Number(options.width) || 1080);
  const height = Math.max(320, Number(options.height) || 1920);
  const language = String(options.language ?? "fa").toLowerCase();
  const styleName = language === "en" ? "TargetSubtitle" : "PersianSubtitle";
  const fontName = language === "en" ? "Arial" : "Vazirmatn";
  const subtitleFontSize = subtitleFontSizeForHeight(height, language, options);
  const marginV = resolveSubtitleMarginV(options.subtitlePlacement, height, options);
  const marginH = subtitleHorizontalMargin(width, options);
  const outline = Math.max(2, Math.round(height / 480));
  const maxChars = maxLineCharsForLayout({ language, width, height, subtitleStyleConfig: options.subtitleStyleConfig });
  const visualStyle = subtitleAssVisualStyle({ height, outline, options });

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${styleName},${fontName},${subtitleFontSize},${visualStyle.primaryColour},&H000000FF,${visualStyle.outlineColour},${visualStyle.backColour},-1,0,0,0,100,100,0,0,${visualStyle.borderStyle},${visualStyle.outline},${visualStyle.shadow},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const readableSegments = options.splitLongCues === false
    ? sanitizeSubtitleSegments(segments, options)
    : splitLongSubtitleSegments(segments, {
      ...options,
      width,
      height,
      language,
      maxLineChars: maxChars,
    });

  const events = readableSegments.map((segment, index) => {
    const normalized = normalizeSegment(segment, index);
    const wrapped = escapeAssText(wrapCue(normalized.text, { language, maxChars }));
    return `Dialogue: 0,${formatAssTime(normalized.start)},${formatAssTime(normalized.end)},${styleName},,0,0,0,,${wrapped}`;
  });

  return [...header, ...events, ""].join("\n");
}

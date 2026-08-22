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

function hasWatermarkTextMarker(value) {
  return PLATFORM_PATTERNS.some((pattern) => pattern.test(String(value ?? "")));
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
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

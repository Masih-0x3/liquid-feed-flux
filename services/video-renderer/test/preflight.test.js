import assert from "node:assert/strict";
import test from "node:test";
import {
  broadLowerMiddleWatermarkFallbackRegions,
  cornerPositionFallbackRegion,
  chooseCenteredVisualCandidate,
  decidePreflightBlock,
  decideWatermarkOnlyBlock,
  detectCornerTextLikeRecoveryRegions,
  delogoRegionsFromWatermarkOnly,
  delogoRegionsFromVision,
  detectCenteredTextLikeRecoveryRegions,
  detectTextLikeRecoveryRegions,
  evaluateDelogoPlan,
  extractPlatformMatches,
  normalizeWatermarkOnlyDecision,
  parseSubtitleStreams,
  parseOcrTsv,
  protectDelogoRegionsFromLowerText,
  recoverDelogoRegions,
  recoverDelogoRegionsFromOcrWords,
  scoreWatermarkSignals,
  selectDelogoRegions,
  selectTargetLanguage,
  subtitlePlacementFromVision,
  visionFromWatermarkOnly,
} from "../src/preflight.js";

test("parses soft subtitle streams from ffprobe output", () => {
  const streams = parseSubtitleStreams({
    streams: [
      { index: 0, codec_type: "video", codec_name: "h264" },
      { index: 1, codec_type: "audio", codec_name: "aac" },
      { index: 2, codec_type: "subtitle", codec_name: "mov_text", tags: { language: "eng", title: "English" } },
    ],
  });

  assert.deepEqual(streams, [{
    index: 2,
    codec: "mov_text",
    language: "eng",
    title: "English",
  }]);
});

test("parses OCR TSV word boxes", () => {
  const words = parseOcrTsv([
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t2\t1\t3\t1\t10\t20\t30\t8\t83.5\t@source",
  ].join("\n"));

  assert.deepEqual(words, [{
    level: 5,
    block: 2,
    paragraph: 1,
    line: 3,
    word: 1,
    x: 10,
    y: 20,
    w: 30,
    h: 8,
    confidence: 83.5,
    text: "@source",
  }]);
});

test("recovers scaled lower handle OCR boxes without matching source title text", () => {
  const words = [
    { block: 1, paragraph: 1, line: 1, word: 1, x: 681, y: 693, w: 58, h: 21, confidence: 80, text: "KOBEISSI" },
    { block: 1, paragraph: 1, line: 1, word: 2, x: 742, y: 693, w: 48, h: 21, confidence: 95, text: "LETTER" },
    { block: 1, paragraph: 1, line: 2, word: 1, x: 123, y: 771, w: 72, h: 15, confidence: 96, text: "Source:" },
    { block: 1, paragraph: 1, line: 2, word: 2, x: 249, y: 770, w: 80, h: 16, confidence: 92, text: "Kobeissi" },
    { block: 1, paragraph: 1, line: 2, word: 3, x: 422, y: 771, w: 52, h: 15, confidence: 95, text: "2026." },
    { block: 1, paragraph: 1, line: 2, word: 4, x: 1021, y: 770, w: 62, h: 16, confidence: 95, text: "Follow" },
    { block: 1, paragraph: 1, line: 2, word: 5, x: 1090, y: 770, w: 24, h: 16, confidence: 95, text: "us" },
    { block: 1, paragraph: 1, line: 2, word: 6, x: 1120, y: 770, w: 160, h: 19, confidence: 91, text: "@KobeissiLetter" },
  ];
  const [region] = recoverDelogoRegionsFromOcrWords(words, [{
    text: "@KobeissiLetter",
    category: "creator_handle",
    confidence: 0.99,
    reason: "Creator social handle shown as a follow tag",
  }], { width: 1920, height: 1080 }, {}, { width: 1440, height: 810 });

  assert.equal(region.source, "ocr_text_match");
  assert.equal(region.text, "@KobeissiLetter");
  assert.equal(region.x > 1300, true);
  assert.equal(region.y > 950, true);
  assert.equal(region.w < 500, true);
});

test("recovers multiple same-brand OCR hints from one bottom credit line", () => {
  const words = [
    { block: 1, paragraph: 1, line: 1, word: 1, x: 151, y: 1009, w: 97, h: 20, confidence: 96, text: "Source:" },
    { block: 1, paragraph: 1, line: 1, word: 2, x: 319, y: 1007, w: 107, h: 22, confidence: 91, text: "Kobeissi" },
    { block: 1, paragraph: 1, line: 1, word: 3, x: 438, y: 1009, w: 73, h: 20, confidence: 95, text: "Letter" },
    { block: 1, paragraph: 1, line: 1, word: 4, x: 1382, y: 1007, w: 83, h: 22, confidence: 96, text: "Follow" },
    { block: 1, paragraph: 1, line: 1, word: 5, x: 1474, y: 1007, w: 28, h: 22, confidence: 96, text: "us" },
    { block: 1, paragraph: 1, line: 1, word: 6, x: 1514, y: 1007, w: 213, h: 26, confidence: 91, text: "@KobeissiLetter" },
  ];
  const regions = recoverDelogoRegionsFromOcrWords(words, [{
    text: "@KobeissiLetter",
    category: "creator_handle",
    confidence: 0.99,
    reason: "Creator social handle shown as a follow tag",
  }, {
    text: "Source: The Kobeissi Letter © 2026.",
    category: "creator_watermark",
    confidence: 0.98,
    reason: "Same creator brand as removable handle; remove as creator watermark. Source attribution within the graphic.",
  }], { width: 1920, height: 1080 }, {}, { width: 1920, height: 1080 });

  assert.equal(regions.some((region) => region.text === "@KobeissiLetter"), true);
  assert.equal(regions.some((region) => region.text === "Source: The Kobeissi Letter © 2026."), true);
  const sourceRegion = regions.find((region) => region.text === "Source: The Kobeissi Letter © 2026.");
  assert.equal(sourceRegion.x <= 120, true);
  assert.equal(sourceRegion.x + sourceRegion.w >= 1700, true);
});

test("selects English subtitles for Persian speech and Persian for all other speech", () => {
  assert.equal(selectTargetLanguage("fa"), "en");
  assert.equal(selectTargetLanguage("fas"), "en");
  assert.equal(selectTargetLanguage("Persian"), "en");
  assert.equal(selectTargetLanguage("Farsi"), "en");
  assert.equal(selectTargetLanguage("per"), "en");
  assert.equal(selectTargetLanguage("فارسی"), "en");
  assert.equal(selectTargetLanguage("he"), "fa");
  assert.equal(selectTargetLanguage("en"), "fa");
  assert.equal(selectTargetLanguage("ar"), "fa");
  assert.equal(selectTargetLanguage("tr"), "fa");
  assert.equal(selectTargetLanguage("ru"), "fa");
  assert.equal(selectTargetLanguage("und"), "fa");
});

test("scores repeated OCR/platform watermark signals conservatively", () => {
  assert.deepEqual(extractPlatformMatches("TikTok @source example.com"), ["TikTok", "@source", "example.com"]);

  assert.equal(scoreWatermarkSignals({
    repeatedCornerText: ["@somebody", "tiktok"],
    stableOverlayScore: 0.78,
    platformMatches: ["tiktok"],
  }).score >= 0.85, true);

  assert.equal(scoreWatermarkSignals({
    repeatedCornerText: [],
    stableOverlayScore: 0.2,
    platformMatches: [],
  }).score < 0.6, true);
});

test("blocks high and uncertain watermark scores before render fallback can post original", () => {
  assert.deepEqual(decidePreflightBlock({
    watermark: { score: 0.91, reasons: ["stable_overlay"] },
    hardSubtitles: { confidence: 0.2, location: "bottom" },
    hasUsableSpeech: true,
  }), { blocked: true, reason: "watermark_detected" });

  assert.deepEqual(decidePreflightBlock({
    watermark: { score: 0.7, reasons: ["vision_uncertain"] },
    hardSubtitles: { confidence: 0.2, location: "bottom" },
    hasUsableSpeech: true,
  }), { blocked: true, reason: "watermark_uncertain" });
});

test("blocks uncertain hard subtitles outside the expected bottom band but not silent videos", () => {
  assert.deepEqual(decidePreflightBlock({
    watermark: { score: 0.2, reasons: [] },
    hardSubtitles: { confidence: 0.82, location: "middle" },
    hasUsableSpeech: true,
  }), { blocked: true, reason: "subtitle_conflict_uncertain" });

  assert.deepEqual(decidePreflightBlock({
    watermark: { score: 0.1, reasons: [] },
    hardSubtitles: { confidence: 0.1, location: "bottom" },
    hasUsableSpeech: false,
  }), { blocked: false, reason: null });
});

test("vision keep decisions prevent contextual graphics from blocking", () => {
  const watermark = scoreWatermarkSignals({
    repeatedCornerText: ["FOX NEWS UNCLASSIFIED CENTCOM"],
    stableOverlayScore: 1,
    platformMatches: [],
    vision: {
      shouldBlock: false,
      overlays: [
        {
          text: "UNCLASSIFIED",
          category: "classification_label",
          action: "keep",
          confidence: 0.96,
          box: { x: 0.1, y: 0.02, w: 0.2, h: 0.06 },
        },
      ],
    },
  });

  assert.equal(watermark.score < 0.6, true);
  assert.deepEqual(decidePreflightBlock({
    watermark,
    vision: { shouldBlock: false, overlays: [] },
    hardSubtitles: { confidence: 0.2, location: "bottom" },
    hasUsableSpeech: true,
  }), { blocked: false, reason: null });
});

test("high-confidence clean vision result suppresses local stable-overlay false positives", () => {
  const watermark = scoreWatermarkSignals({
    repeatedCornerText: [],
    stableOverlayScore: 0.92,
    platformMatches: [],
    vision: {
      confidence: 0.98,
      shouldBlock: false,
      shouldSkip: false,
      overlays: [],
      renderDecision: { action: "render", confidence: 0.98, reason: "no removable watermark" },
    },
  });

  assert.equal(watermark.score < 0.6, true);
  assert.equal(watermark.reasons.includes("openai_vision_clear"), true);
  assert.deepEqual(decidePreflightBlock({
    watermark,
    vision: { shouldBlock: false, shouldSkip: false, overlays: [] },
    hardSubtitles: { confidence: 0.2, location: "bottom" },
    hasUsableSpeech: true,
  }), { blocked: false, reason: null });
});

test("vision delogo overlays become padded pixel regions", () => {
  const regions = delogoRegionsFromVision({
    overlays: [
      {
        text: "@Americana.ir",
        category: "source_watermark_handle",
        action: "delogo",
        confidence: 0.94,
        box: { x: 0.31, y: 0.68, w: 0.28, h: 0.09 },
      },
      {
        text: "CENTCOM",
        category: "official_agency_label",
        action: "keep",
        confidence: 0.98,
        box: { x: 0.12, y: 0.04, w: 0.2, h: 0.05 },
      },
    ],
  }, { width: 480, height: 256 });

  assert.equal(regions.length, 1);
  assert.equal(regions[0].text, "@Americana.ir");
  assert.equal(regions[0].category, "source_watermark_handle");
  assert.equal(regions[0].x > 0, true);
  assert.equal(regions[0].w > 100, true);
  assert.equal(regions[0].areaRatio > 0, true);
});

test("invalid model delogo boxes are discarded so recovery can run", () => {
  const regions = delogoRegionsFromVision({
    overlays: [
      {
        text: "@source",
        category: "creator_watermark",
        action: "delogo",
        confidence: 0.99,
        box: { x: 1, y: 1, w: 1, h: 1 },
      },
    ],
  }, { width: 480, height: 256 });

  assert.deepEqual(regions, []);
});

test("watermark-only candidates become delogo regions without broad overlay recovery", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.96,
    removableWatermarks: [{
      text: "@source",
      type: "repost_handle",
      confidence: 0.94,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      box: { x: 0.2, y: 0.7, w: 0.18, h: 0.06, valid: true },
    }],
    mustKeep: [{ text: "FOX NEWS", type: "broadcaster_branding", reason: "context" }],
  };
  const regions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 480, height: 256 });
  const vision = visionFromWatermarkOnly(watermarkOnly);
  const plan = evaluateDelogoPlan(regions, { width: 480, height: 256 }, { requireDelogoCoordinates: true });

  assert.equal(regions.length, 1);
  assert.equal(regions[0].x, 96);
  assert.equal(regions[0].y, 179);
  assert.equal(regions[0].w, 86);
  assert.equal(regions[0].h, 15);
  assert.equal(regions[0].source, "watermark_only_vision");
  assert.equal(regions[0].areaRatio < 0.06, true);
  assert.equal(vision.overlays.some((overlay) => overlay.action === "delogo"), true);
  assert.deepEqual(decideWatermarkOnlyBlock(watermarkOnly, plan), { blocked: false, reason: null });
});

test("watermark-only lower-third phrases without handle markers are kept", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.99,
    removableWatermarks: [{
      text: "صواريخ الان",
      type: "creator_handle",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Static Arabic text on a lower-third bar",
      box: { x: 0.36, y: 0.84, w: 0.28, h: 0.06, valid: true },
    }],
    mustKeep: [],
  };
  const regions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 720, height: 1280 });
  const vision = visionFromWatermarkOnly(watermarkOnly);
  const plan = evaluateDelogoPlan(regions, { width: 720, height: 1280 }, { requireDelogoCoordinates: false });

  assert.deepEqual(regions, []);
  assert.equal(vision.renderDecision.action, "render");
  assert.equal(vision.hasWatermark, false);
  assert.equal(vision.overlays[0].action, "keep");
  assert.deepEqual(decideWatermarkOnlyBlock({ ...watermarkOnly, decision: "render" }, plan), { blocked: false, reason: null });
});

test("watermark-only protected source logos like AP are kept", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.98,
    reason: "A small AP logo watermark appears near source date text",
    removableWatermarks: [{
      text: "AP",
      type: "third_party_watermark",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Small news agency logo near original event/date background text",
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
    mustKeep: [{
      text: "6 Haziran 2026",
      type: "source_context",
      reason: "Event/date background display",
    }],
  };

  const regions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 640, height: 360 });
  const normalized = normalizeWatermarkOnlyDecision(watermarkOnly);
  const vision = visionFromWatermarkOnly(watermarkOnly);
  const plan = evaluateDelogoPlan(regions, { width: 640, height: 360 }, { requireDelogoCoordinates: false });

  assert.deepEqual(regions, []);
  assert.equal(normalized.decision, "render");
  assert.deepEqual(normalized.removableWatermarks, []);
  assert.equal(normalized.protectedWatermarks.length, 1);
  assert.equal(normalized.mustKeep.some((item) => item.text === "AP" && item.type === "source_logo"), true);
  assert.equal(vision.hasWatermark, false);
  assert.equal(vision.renderDecision.action, "render");
  assert.equal(vision.overlays[0].action, "keep");
  assert.deepEqual(decideWatermarkOnlyBlock(watermarkOnly, plan), { blocked: false, reason: null });
});

test("watermark-only stock/repost marks misprotected as source context are promoted to delogo", () => {
  const watermarkOnly = {
    decision: "render",
    confidence: 0.98,
    reason: "No removable watermark after protecting descriptive lower-third/context text.",
    removableWatermarks: [],
    mustKeep: [{
      text: "shutterstock",
      type: "source_context",
      reason: "Misclassified as third_party_watermark; kept because it is an official/source-context mark.",
    }],
  };
  const normalized = normalizeWatermarkOnlyDecision(watermarkOnly);
  const vision = visionFromWatermarkOnly(normalized);

  assert.equal(normalized.decision, "render_with_delogo");
  assert.deepEqual(normalized.mustKeep, []);
  assert.equal(normalized.removableWatermarks[0].type, "third_party_watermark");
  assert.equal(vision.hasWatermark, true);
  assert.equal(vision.overlays[0].action, "delogo");
});

test("watermark-only Telegram repost handles remain removable even with invalid coordinates", () => {
  const watermarkOnly = {
    decision: "render",
    confidence: 0.99,
    reason: "A static third-party Telegram-style watermark is visible across sampled frames.",
    removableWatermarks: [{
      text: "Alibk3",
      type: "repost_handle",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Persistent overlaid repost/creator handle with platform icon, centered and static across sampled frames.",
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
    mustKeep: [],
  };

  const normalized = normalizeWatermarkOnlyDecision(watermarkOnly);
  const vision = visionFromWatermarkOnly(watermarkOnly);

  assert.equal(normalized.removableWatermarks.length, 1);
  assert.equal(normalized.removableWatermarks[0].text, "Alibk3");
  assert.deepEqual(normalized.protectedWatermarks ?? [], []);
  assert.equal(vision.hasWatermark, true);
  assert.equal(vision.overlays.some((overlay) => overlay.action === "delogo" && overlay.text === "Alibk3"), true);
});

test("watermark-only same-brand creator chart logos are removable with creator handles", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.98,
    removableWatermarks: [
      {
        text: "TKL",
        type: "creator_handle",
        confidence: 0.99,
        safeToDelogo: true,
        seenInFrames: [1, 2, 3],
        reason: "Creator logo overlaid on a chart",
        box: { x: 1, y: 1, w: 1, h: 1, valid: false },
      },
      {
        text: "@KobeissiLetter",
        type: "creator_handle",
        confidence: 0.99,
        safeToDelogo: true,
        seenInFrames: [1, 2, 3],
        reason: "Social handle watermark in the lower-right corner",
        box: { x: 1, y: 1, w: 1, h: 1, valid: false },
      },
    ],
    mustKeep: [{
      text: "Source: The Kobeissi Letter © 2026.",
      type: "source_context",
      reason: "Source attribution within the chart graphic.",
    }, {
      text: "TKL / THE KOBEISSI LETTER",
      type: "broadcaster_branding",
      reason: "Brand/logo embedded in the source graphic.",
    }],
  };
  const normalized = normalizeWatermarkOnlyDecision(watermarkOnly);
  const vision = visionFromWatermarkOnly(normalized);

  assert.deepEqual(normalized.removableWatermarks.map((item) => item.text), [
    "@KobeissiLetter",
    "Source: The Kobeissi Letter © 2026.",
    "TKL / THE KOBEISSI LETTER",
  ]);
  assert.equal(normalized.mustKeep.some((item) => item.text === "Source: The Kobeissi Letter © 2026."), false);
  assert.equal(vision.overlays.some((overlay) => overlay.text === "Source: The Kobeissi Letter © 2026." && overlay.action === "delogo"), true);
  assert.equal(vision.overlays.some((overlay) => overlay.text === "TKL / THE KOBEISSI LETTER" && overlay.action === "delogo"), true);
  assert.equal(vision.overlays.some((overlay) => overlay.text === "@KobeissiLetter" && overlay.action === "delogo"), true);
});

test("watermark-only show branding stays protected even when a matching social handle is removed", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.99,
    removableWatermarks: [{
      text: "@piersmorganuncensored",
      type: "creator_handle",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Social handle in the bottom banner; removable third-party watermark.",
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
    mustKeep: [{
      text: "PIERS MORGAN UNCENSORED",
      type: "broadcaster_branding",
      reason: "Show branding/source context, not a removable watermark.",
    }],
  };
  const normalized = normalizeWatermarkOnlyDecision(watermarkOnly);
  const vision = visionFromWatermarkOnly(normalized);

  assert.deepEqual(normalized.removableWatermarks.map((item) => item.text), ["@piersmorganuncensored"]);
  assert.equal(normalized.mustKeep.some((item) => item.text === "PIERS MORGAN UNCENSORED"), true);
  assert.equal(vision.overlays.some((overlay) => overlay.text === "PIERS MORGAN UNCENSORED" && overlay.action === "keep"), true);
});

test("same-creator cleanup can safely use three small delogo regions", () => {
  const plan = evaluateDelogoPlan([
    { x: 100, y: 900, w: 320, h: 58, areaRatio: 0.009, category: "creator_watermark" },
    { x: 820, y: 820, w: 360, h: 150, areaRatio: 0.026, category: "creator_watermark" },
    { x: 1350, y: 910, w: 410, h: 64, areaRatio: 0.013, category: "creator_handle" },
  ], { width: 1920, height: 1080 }, { maxDelogoRegions: 2 });

  assert.equal(plan.blocked, false);
  assert.equal(plan.maxRegions, 3);
});

test("broad lower-middle translucent watermark fallback covers icon and wordmark separately", () => {
  const regions = broadLowerMiddleWatermarkFallbackRegions({
    text: "osinttechnical",
    category: "third_party_watermark",
    confidence: 0.99,
    reason: "Large translucent third-party watermark spans across the lower-middle city view.",
  }, { width: 1920, height: 1080 });

  assert.equal(regions.length, 2);
  assert.equal(regions[0].source, "broad_lower_middle_icon_fallback");
  assert.equal(regions[1].source, "broad_lower_middle_text_fallback");
  assert.equal(regions[0].x <= 760, true);
  assert.equal(regions[1].x <= 600, true);
  assert.equal(regions[1].x + regions[1].w >= 1400, true);
  assert.equal(regions.every((region) => region.areaRatio <= 0.09), true);
});

test("unknown delogo overlays with watermark text still create broad fallback hints", async () => {
  const vision = visionFromWatermarkOnly({
    decision: "render_with_delogo",
    confidence: 0.98,
    reason: "A faint repeated watermark is visible across the lower-middle source frames.",
    removableWatermarks: [{
      text: "@... (faint lower-center watermark text)",
      type: "unknown",
      confidence: 0.91,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Semi-transparent repeated overlay across the lower-middle image; static watermark.",
      box: { x: 0, y: 0, w: 0, h: 0, valid: false },
    }],
    mustKeep: [],
  });
  const recovery = await recoverDelogoRegions({
    framePaths: [],
    vision,
    dimensions: { width: 1920, height: 1080 },
    allowVisualRecovery: true,
  });

  assert.equal(vision.hasWatermark, true);
  assert.equal(recovery.attempted, true);
  assert.equal(recovery.hints[0].category, "unknown");
});

test("watermark-only creator channel text can become a delogo hint without handle markers", () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.99,
    reason: "Persistent centered Telegram channel watermark/logo",
    removableWatermarks: [{
      text: "Alibk3",
      type: "creator_handle",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Persistent centered overlay watermark/logo from a third-party Telegram channel",
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
    mustKeep: [],
  };

  const regions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 1920, height: 1080 });
  const vision = visionFromWatermarkOnly(watermarkOnly);

  assert.deepEqual(regions, []);
  assert.equal(vision.hasWatermark, true);
  assert.equal(vision.renderDecision.action, "render_with_delogo");
  assert.equal(vision.overlays.some((overlay) => overlay.action === "delogo" && overlay.text === "Alibk3"), true);
});

test("watermark-only third-party marks with invalid boxes still enter local recovery", async () => {
  const watermarkOnly = {
    decision: "render_with_delogo",
    confidence: 0.99,
    reason: "Static third-party watermark overlaid on the source video",
    removableWatermarks: [{
      text: "CLASH REPORT",
      type: "third_party_watermark",
      confidence: 0.99,
      safeToDelogo: true,
      seenInFrames: [1, 2, 3],
      reason: "Clear third-party watermark/logo overlaid near the center of the source frames",
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
    mustKeep: [],
  };
  const vision = visionFromWatermarkOnly(watermarkOnly);
  const recovery = await recoverDelogoRegions({
    framePaths: [],
    vision,
    dimensions: { width: 1920, height: 1080 },
    existingRegions: [],
    allowVisualRecovery: true,
  });

  assert.deepEqual(delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 1920, height: 1080 }), []);
  assert.equal(vision.hasWatermark, true);
  assert.equal(recovery.attempted, true);
  assert.equal(recovery.reason, "no_frame");
  assert.deepEqual(recovery.hints, [{
    text: "CLASH REPORT",
    category: "third_party_watermark",
    confidence: 0.99,
  }]);
});

test("watermark-only uncertain coordinates block instead of guessed rendering", () => {
  const watermarkOnly = {
    decision: "uncertain",
    confidence: 0.92,
    removableWatermarks: [{
      text: "@source",
      type: "repost_handle",
      confidence: 0.94,
      safeToDelogo: false,
      box: { x: 1, y: 1, w: 1, h: 1, valid: false },
    }],
  };
  const regions = delogoRegionsFromWatermarkOnly(watermarkOnly, { width: 480, height: 256 });
  const plan = evaluateDelogoPlan(regions, { width: 480, height: 256 }, { requireDelogoCoordinates: true });

  assert.deepEqual(regions, []);
  assert.equal(plan.reason, "delogo_coordinates_uncertain");
  assert.deepEqual(decideWatermarkOnlyBlock(watermarkOnly, plan), { blocked: true, reason: "watermark_coordinates_uncertain" });
});

test("safe repeated model delogo boxes can fallback when local recovery misses", () => {
  const selected = selectDelogoRegions({
    recoveredRegions: [],
    modelRegions: [{
      x: 260,
      y: 795,
      w: 183,
      h: 76,
      areaRatio: 0.0156,
      confidence: 0.97,
      text: "صابرين نيوز / on telegram",
      category: "repost_handle",
      seenInFrames: [1, 2, 3],
    }],
    requireLocalDelogoCoordinates: true,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].selectedBy, "model_delogo_fallback");
});

test("model delogo fallback rejects low confidence, broad, or single-frame boxes", () => {
  assert.deepEqual(selectDelogoRegions({
    recoveredRegions: [],
    modelRegions: [{ areaRatio: 0.02, confidence: 0.7, text: "@source", category: "repost_handle", seenInFrames: [1, 2, 3] }],
    requireLocalDelogoCoordinates: true,
  }), []);

  assert.deepEqual(selectDelogoRegions({
    recoveredRegions: [],
    modelRegions: [{ areaRatio: 0.07, confidence: 0.99, text: "@source", category: "repost_handle", seenInFrames: [1, 2, 3] }],
    requireLocalDelogoCoordinates: true,
  }), []);

  assert.deepEqual(selectDelogoRegions({
    recoveredRegions: [],
    modelRegions: [{ areaRatio: 0.02, confidence: 0.99, text: "@source", category: "repost_handle", seenInFrames: [1] }],
    requireLocalDelogoCoordinates: true,
  }), []);
});

test("handle delogo boxes include enough right padding for partial model boxes", () => {
  const regions = delogoRegionsFromVision({
    overlays: [
      {
        text: "@Americans.ir",
        category: "creator_watermark",
        action: "delogo",
        confidence: 0.98,
        box: { x: 0.115, y: 0.815, w: 0.235, h: 0.065 },
      },
    ],
  }, { width: 480, height: 256 });

  assert.equal(regions.length, 1);
  assert.equal(regions[0].x <= 48, true);
  assert.equal(regions[0].y <= 193, true);
  assert.equal(regions[0].x + regions[0].w >= 260, true);
  assert.equal(regions[0].areaRatio < 0.08, true);
});

test("handle delogo boxes keep a small lower-third overlap to cover the tag bottom", () => {
  const [region] = delogoRegionsFromVision({
    overlays: [
      {
        text: "@Americana_ir",
        category: "creator_watermark",
        action: "delogo",
        confidence: 0.99,
        box: { x: 0.105, y: 0.78, w: 0.39, h: 0.145 },
      },
    ],
  }, { width: 480, height: 256 });
  const shifted = protectDelogoRegionsFromLowerText([region], {
    lowerTextRegion: {
      detected: true,
      confidence: 0.99,
      action: "keep",
      box: { x: 0, y: 0.79, w: 1, h: 0.21 },
    },
  }, { width: 480, height: 256 });
  const lowerTextTop = Math.round(256 * 0.79);

  assert.equal(region.h <= Math.round(256 * 0.135), true);
  assert.equal(shifted[0].adjustedForLowerText, true);
  assert.equal(shifted[0].y + shifted[0].h > lowerTextTop, true);
  assert.equal(shifted[0].y + shifted[0].h <= lowerTextTop + Math.round(256 * 0.035), true);
  assert.equal(shifted[0].areaRatio < 0.08, true);
});

test("delogo plan blocks too many or too large regions", () => {
  const missingCoordinates = evaluateDelogoPlan([], { width: 100, height: 100 }, { requireDelogoCoordinates: true });
  assert.equal(missingCoordinates.blocked, true);
  assert.equal(missingCoordinates.reason, "delogo_coordinates_uncertain");

  assert.deepEqual(evaluateDelogoPlan([
    { x: 0, y: 0, w: 20, h: 20, areaRatio: 0.01 },
    { x: 30, y: 0, w: 20, h: 20, areaRatio: 0.01 },
  ], { width: 100, height: 100 }, { maxDelogoRegions: 2 }).blocked, false);

  const tooMany = evaluateDelogoPlan([
    { x: 0, y: 0, w: 20, h: 20, areaRatio: 0.01 },
    { x: 30, y: 0, w: 20, h: 20, areaRatio: 0.01 },
    { x: 60, y: 0, w: 20, h: 20, areaRatio: 0.01 },
  ], { width: 100, height: 100 }, { maxDelogoRegions: 2 });
  assert.equal(tooMany.blocked, true);
  assert.equal(tooMany.reason, "too_many_delogo_regions");

  const tooLarge = evaluateDelogoPlan([
    { x: 0, y: 0, w: 60, h: 30, areaRatio: 0.18 },
  ], { width: 100, height: 100 }, { maxSingleDelogoAreaRatio: 0.10 });
  assert.equal(tooLarge.blocked, true);
  assert.equal(tooLarge.reason, "single_delogo_region_too_large");

  assert.deepEqual(decidePreflightBlock({
    watermark: { score: 0.1, reasons: [] },
    delogoPlan: tooMany,
    hardSubtitles: { confidence: 0.2, location: "bottom" },
    hasUsableSpeech: true,
  }), { blocked: true, reason: "too_many_delogo_regions" });
});

test("subtitle placement rises above lower news text", () => {
  const placement = subtitlePlacementFromVision({
    lowerTextRegion: {
      detected: true,
      confidence: 0.94,
      type: "news_ticker",
      box: { x: 0, y: 0.82, w: 1, h: 0.14 },
      reason: "ticker",
    },
    subtitlePlacement: {
      placement: "bottom",
      bottomMargin: 0.08,
      confidence: 0.6,
      reason: "default",
    },
  }, { width: 1920, height: 1080 });

  assert.equal(placement.placement, "bottom");
  assert.equal(placement.source, "lower_text_region");
  assert.equal(placement.marginV > Math.round(1080 * 0.18), true);
});

test("subtitle placement rises above stable bottom overlays", () => {
  const placement = subtitlePlacementFromVision({
    subtitlePlacement: {
      placement: "bottom",
      bottomMargin: 0.08,
      confidence: 0.6,
      reason: "default",
    },
  }, { width: 1920, height: 1080 }, {
    overlayDetection: {
      regions: [
        { name: "bottom_left", score: 0.88, averageDensity: 0.021 },
        { name: "bottom_right", score: 0.80, averageDensity: 0.019 },
      ],
    },
  });

  assert.equal(placement.placement, "bottom");
  assert.equal(placement.source, "stable_bottom_overlay");
  assert.equal(placement.marginV, 238);
});

test("single-sided bottom overlays use a lower subtitle margin", () => {
  const placement = subtitlePlacementFromVision({
    subtitlePlacement: {
      placement: "bottom",
      bottomMargin: 0.08,
      confidence: 0.6,
      reason: "default",
    },
  }, { width: 1920, height: 1080 }, {
    overlayDetection: {
      regions: [
        { name: "bottom_left", score: 1, averageDensity: 0.040 },
      ],
    },
  });

  assert.equal(placement.placement, "bottom");
  assert.equal(placement.source, "stable_bottom_overlay");
  assert.equal(placement.bottomMargin, 0.15);
  assert.equal(placement.marginV, 162);
});

test("watermark-only lower-third hints raise subtitle placement without exact boxes", () => {
  const vision = visionFromWatermarkOnly({
    decision: "render",
    confidence: 0.98,
    removableWatermarks: [],
    mustKeep: [{
      text: "Arabic subtitles/lower-third text",
      type: "lower_third",
      reason: "Contextual subtitles/lower-third text; not a watermark.",
    }],
  });
  const placement = subtitlePlacementFromVision(vision, { width: 1280, height: 720 });

  assert.equal(vision.lowerTextRegion.detected, true);
  assert.equal(placement.source, "lower_text_region");
  assert.equal(vision.lowerTextRegion.inferred, true);
  assert.equal(placement.bottomMargin, 0.15);
  assert.equal(placement.marginV, 108);
});

test("inferred non-caption lower thirds do not pin subtitles near the middle", () => {
  const vision = visionFromWatermarkOnly({
    decision: "render_with_delogo",
    confidence: 0.99,
    removableWatermarks: [{
      text: "@showhandle",
      type: "creator_handle",
      confidence: 0.99,
      safeToDelogo: true,
      box: { x: 0.55, y: 0.93, w: 0.22, h: 0.05 },
      reason: "Creator handle in lower social banner.",
    }],
    mustKeep: [{
      text: "FOLLOW US",
      type: "program_graphic",
      reason: "Program graphic/lower-third content.",
    }],
  });
  const placement = subtitlePlacementFromVision(vision, { width: 1920, height: 1080 });

  assert.equal(vision.lowerTextRegion.detected, true);
  assert.equal(vision.lowerTextRegion.source, "watermark_only_hint");
  assert.equal(placement.source, "lower_text_region");
  assert.equal(placement.bottomMargin, 0.15);
  assert.equal(placement.marginV, 162);
});

test("watermark-only hard subtitle hints raise subtitle placement", () => {
  const vision = visionFromWatermarkOnly({
    decision: "render",
    confidence: 0.98,
    removableWatermarks: [],
    mustKeep: [{
      text: "Hebrew burned-in dialogue subtitles",
      type: "hard_subtitle",
      reason: "Existing Hebrew subtitle occupies the lower caption area.",
    }],
  });
  const placement = subtitlePlacementFromVision(vision, { width: 640, height: 360 });

  assert.equal(vision.lowerTextRegion.detected, true);
  assert.equal(placement.source, "lower_text_region");
  assert.equal(placement.bottomMargin, 0.20);
  assert.equal(placement.marginV, 72);
});

test("hard subtitle placement is capped below center for broad lower text boxes", () => {
  const placement = subtitlePlacementFromVision({
    lowerTextRegion: {
      detected: true,
      confidence: 0.98,
      type: "hard_subtitle",
      box: { x: 0, y: 0.72, w: 1, h: 0.24 },
      reason: "Burned-in caption occupying the lower caption area; must be kept.",
    },
    subtitlePlacement: {
      placement: "bottom",
      bottomMargin: 0.08,
      confidence: 0.6,
      reason: "default",
    },
  }, { width: 1080, height: 1080 });

  assert.equal(placement.source, "lower_text_region");
  assert.equal(placement.bottomMargin, 0.20);
  assert.equal(placement.marginV, 216);
});

test("news chyron placement is capped so subtitles do not jump into the center", () => {
  const placement = subtitlePlacementFromVision({
    lowerTextRegion: {
      detected: true,
      confidence: 0.98,
      type: "news_chyron",
      box: { x: 0, y: 0.72, w: 1, h: 0.24 },
      reason: "News lower-third source graphic.",
    },
    subtitlePlacement: {
      placement: "bottom",
      bottomMargin: 0.08,
      confidence: 0.6,
      reason: "default",
    },
  }, { width: 720, height: 406 });

  assert.equal(placement.source, "lower_text_region");
  assert.equal(placement.bottomMargin, 0.22);
  assert.equal(placement.marginV, 89);
});

test("delogo regions are shifted above protected lower text", () => {
  const shifted = protectDelogoRegionsFromLowerText([
    { x: 105, y: 203, w: 143, h: 31 },
  ], {
    lowerTextRegion: {
      detected: true,
      confidence: 0.99,
      action: "keep",
      box: { x: 0, y: 0.84, w: 1, h: 0.16 },
    },
  }, { width: 480, height: 256 });

  assert.equal(shifted[0].adjustedForLowerText, true);
  assert.equal(shifted[0].y + shifted[0].h < Math.round(256 * 0.84), true);
});

test("detects visual text-like recovery regions above lower text", () => {
  const width = 120;
  const height = 80;
  const bytes = Buffer.alloc(width * height, 128);
  for (let y = 48; y <= 54; y += 1) {
    for (let x = 36; x <= 73; x += 4) {
      bytes[y * width + x] = 235;
      bytes[y * width + x + 1] = 35;
    }
  }

  const candidates = detectTextLikeRecoveryRegions(bytes, { width, height }, {
    lowerTextRegion: {
      detected: true,
      confidence: 0.99,
      action: "keep",
      box: { x: 0, y: 0.78, w: 1, h: 0.2 },
    },
  });

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].y < Math.round(height * 0.78), true);
  assert.equal(candidates[0].w >= 30, true);
});

test("detects centered handle-like recovery regions", () => {
  const width = 160;
  const height = 120;
  const bytes = Buffer.alloc(width * height, 90);
  const letters = [
    [38, 48, 10, 16],
    [52, 48, 7, 16],
    [63, 48, 8, 16],
    [75, 48, 7, 16],
    [86, 48, 7, 16],
    [97, 48, 8, 16],
    [110, 48, 6, 16],
  ];
  for (const [x0, y0, w, h] of letters) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) bytes[y * width + x] = 232;
    }
  }

  const candidates = detectCenteredTextLikeRecoveryRegions(bytes, { width, height });

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].x <= 38, true);
  assert.equal(candidates[0].x + candidates[0].w >= 116, true);
  assert.equal(candidates[0].y >= 44 && candidates[0].y <= 52, true);
});

test("detects compact centered watermark logos when semantic hint is short", () => {
  const width = 300;
  const height = 120;
  const bytes = Buffer.alloc(width * height, 82);
  const letters = [
    [126, 51, 7, 12],
    [137, 51, 6, 12],
    [148, 51, 8, 12],
    [161, 51, 6, 12],
    [171, 51, 7, 12],
  ];
  for (const [x0, y0, w, h] of letters) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) bytes[y * width + x] = 232;
    }
  }

  assert.equal(detectCenteredTextLikeRecoveryRegions(bytes, { width, height }).length, 0);

  const candidates = detectCenteredTextLikeRecoveryRegions(bytes, { width, height }, {
    minWidthRatio: 0.045,
    minRunWidthRatio: 0.045,
    maxWidthRatio: 0.46,
    idealMinWidthRatio: 0.06,
    idealMaxWidthRatio: 0.28,
    maxRunGapRatio: 0.032,
  });

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].w <= 70, true);
  assert.equal(candidates[0].x >= 120 && candidates[0].x <= 130, true);
});

test("centered Telegram logo recovery prefers the full icon and text candidate over city-light noise", () => {
  const selected = chooseCenteredVisualCandidate([
    {
      x: 1016,
      y: 392,
      w: 311,
      h: 48,
      score: 0.805,
      density: 0.079,
      componentCount: 7,
    },
    {
      x: 870,
      y: 525,
      w: 626,
      h: 161,
      score: 0.750,
      density: 0.079,
      componentCount: 14,
    },
  ], {
    text: "Alibk3",
    category: "creator_handle",
    reason: "Persistent centered overlay watermark/logo from a third-party Telegram channel",
  }, { width: 1920, height: 1080 });

  assert.equal(selected.x, 870);
  assert.equal(selected.y, 525);
  assert.equal(selected.w, 626);
  assert.equal(selected.h, 161);
});

test("detects upper-left corner watermark logos from position hints", () => {
  const width = 240;
  const height = 160;
  const bytes = Buffer.alloc(width * height, 148);
  const letters = [
    [18, 16, 34, 10],
    [18, 38, 15, 32],
    [38, 38, 13, 32],
    [56, 38, 12, 32],
    [74, 38, 10, 32],
    [18, 78, 12, 18],
    [36, 78, 11, 18],
    [53, 78, 13, 18],
    [72, 78, 10, 18],
  ];
  for (const [x0, y0, w, h] of letters) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) bytes[y * width + x] = 235;
    }
  }
  for (let x = 95; x < 210; x += 1) bytes[50 * width + x] = 230;

  const candidates = detectCornerTextLikeRecoveryRegions(bytes, { width, height }, "upper_left");

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].x <= 18, true);
  assert.equal(candidates[0].y <= 16, true);
  assert.equal(candidates[0].x + candidates[0].w >= 84, true);
  assert.equal(candidates[0].w < 100, true);
});

test("corner position fallback stays constrained to the hinted corner", () => {
  const region = cornerPositionFallbackRegion("upper_left", { width: 1920, height: 1080 }, {
    text: "RAPID RESPONSE",
    category: "third_party_watermark",
    confidence: 0.99,
  });

  assert.equal(region.x, 0);
  assert.equal(region.y, 0);
  assert.equal(region.source, "corner_position_fallback");
  assert.equal(region.text, "RAPID RESPONSE");
  assert.equal(region.areaRatio <= 0.06, true);
  assert.equal(region.centerOverlapRatio, 0);
});

test("detects wide connected handle-like text just above dense lower thirds", () => {
  const width = 120;
  const height = 80;
  const bytes = Buffer.alloc(width * height, 180);
  for (let y = 56; y <= 62; y += 1) {
    for (let x = 30; x <= 51; x += 1) bytes[y * width + x] = 35;
    for (let x = 55; x <= 79; x += 1) bytes[y * width + x] = 35;
  }
  for (let y = 66; y <= 70; y += 1) {
    for (let x = 0; x < width; x += 2) bytes[y * width + x] = 35;
  }

  const candidates = detectTextLikeRecoveryRegions(bytes, { width, height }, {});

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].x <= 30, true);
  assert.equal(candidates[0].x + candidates[0].w >= 79, true);
  assert.equal(candidates[0].y < 66, true);
});

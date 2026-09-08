import assert from "node:assert/strict";
import test from "node:test";
import { runPreviewPreflightStage } from "../src/preview.js";
import { decidePreflightBlock, scoreWatermarkSignals } from "../src/preflight.js";

// Regression coverage for the local "no-upload" preview preflight stage
// (services/video-renderer/src/preview.js). Production (renderer.js) runs
// runOptionalOcr and recomputes the watermark score OUTSIDE its vision gate so
// OCR-derived platform handles / corner text always factor into the block
// decision. The preview previously ran OCR only inside its vision gate, so the
// no-vision path (ENABLE_OPENAI_VISION_PREFLIGHT=0) skipped OCR and the block
// recompute, blocking strictly less than production. These tests pin the
// preview's no-vision path to the renderer's behavior and guard the vision
// branch's OCR-signal preservation against future refactors.

const DEFAULT_OPTIONS = {
  maxDelogoRegions: 2,
  maxSingleDelogoAreaRatio: 0.10,
  maxTotalDelogoAreaRatio: 0.15,
  minWatermarkOnlyConfidence: 0.85,
  watermarkBoxPadRatio: 0,
  watermarkBoxHorizontalDilation: 0,
  watermarkBoxVerticalDilation: 0,
};

function frameSpecs() {
  return [
    { path: "/tmp/preview-frame-1.jpg", inspectionPath: "/tmp/preview-inspection-1.jpg", seekSeconds: 1 },
    { path: "/tmp/preview-frame-2.jpg", inspectionPath: "/tmp/preview-inspection-2.jpg", seekSeconds: 2 },
  ];
}

function basePreflight({ stableOverlayScore = 0 } = {}) {
  return {
    overlayDetection: { stableOverlayScore },
    watermark: {
      score: stableOverlayScore * 0.55,
      repeatedText: [],
      platformMatches: [],
    },
    hardSubtitles: { confidence: 0, location: "unknown" },
  };
}

function ocrStub({ text = "", matches = [] } = {}, sink = {}) {
  return async (contactSheetPath, options) => {
    sink.contactSheetPath = contactSheetPath;
    sink.tesseractLang = options?.tesseractLang;
    sink.calls = (sink.calls ?? 0) + 1;
    return { available: true, text, matches };
  };
}

function analyzeWatermarksStub(response) {
  return async () => response;
}

function resolvePreflight(override) {
  if (!override) return basePreflight();
  return basePreflight({ stableOverlayScore: override.stableOverlayScore ?? 0 });
}

function callStage(overrides = {}) {
  const { preflight: preflightOverride, ...rest } = overrides;
  return runPreviewPreflightStage({
    preflight: resolvePreflight(preflightOverride),
    probe: { width: 1080, height: 1920 },
    contactSheetPath: "/tmp/preview-contact-sheet.jpg",
    frameSpecs: frameSpecs(),
    apiKey: "sk-test",
    enableVisionPreflight: false,
    tesseractLang: "eng",
    options: DEFAULT_OPTIONS,
    ...rest,
  });
}

test("no-vision path runs OCR and blocks on OCR-derived watermark signals (renderer parity)", async () => {
  // Reproduces the divergence scenario from the bug report: stableOverlayScore
  // 0.9 plus a tesseract-readable @handle. Before the fix the preview's else
  // branch skipped OCR + the watermark recompute, leaving the score at 0.495
  // (below the 0.60 uncertain threshold) and rendering content the production
  // renderer would have blocked as watermark_uncertain.
  const ocr = { text: "@user_name Follow for more!", matches: ["@user_name"] };
  const result = await callStage({ preflight: { stableOverlayScore: 0.9 }, runOcr: ocrStub(ocr) });

  const expectedWatermark = scoreWatermarkSignals({
    stableOverlayScore: 0.9,
    repeatedCornerText: ["@user_name Follow for more!"],
    platformMatches: ["@user_name"],
    vision: null,
  });

  assert.deepEqual(result.watermark, expectedWatermark);
  assert.equal(result.ocr.text, "@user_name Follow for more!");
  assert.deepEqual(result.ocr.matches, ["@user_name"]);
  assert.equal(result.block.blocked, true);
  assert.equal(result.block.reason, "watermark_uncertain");
});

test("no-vision path block decision matches renderer's decidePreflightBlock with identical OCR-enhanced watermark", async () => {
  const ocr = { text: "@user_name Follow for more!", matches: ["@user_name"] };
  const preflight = basePreflight({ stableOverlayScore: 0.9 });
  const result = await callStage({ preflight: { stableOverlayScore: 0.9 }, runOcr: ocrStub(ocr) });

  const watermark = scoreWatermarkSignals({
    stableOverlayScore: 0.9,
    repeatedCornerText: ["@user_name Follow for more!"],
    platformMatches: ["@user_name"],
    vision: null,
  });
  const expectedBlock = decidePreflightBlock({
    watermark,
    vision: null,
    delogoRegions: [],
    delogoPlan: null,
    hardSubtitles: preflight.hardSubtitles,
    hasUsableSpeech: true,
  }, DEFAULT_OPTIONS);

  assert.deepEqual(result.block, expectedBlock);
});

test("no-vision path does not block clean content (no OCR signals, no regression)", async () => {
  // With no OCR text, the score stays at stableOverlayScore * 0.55 (0.495 for
  // overlay 0.9), below the 0.60 uncertain threshold. This is the same outcome
  // as before the fix for clean content, ensuring no over-blocking regression.
  const result = await callStage({
    preflight: { stableOverlayScore: 0.9 },
    runOcr: ocrStub({ text: "", matches: [] }),
  });

  assert.ok(Math.abs(result.watermark.score - 0.495) < 1e-9, `score ${result.watermark.score} should be ~0.495`);
  assert.equal(result.block.blocked, false);
  assert.equal(result.block.reason, null);
});

test("no-vision path runs OCR unconditionally even without an API key", async () => {
  // The bug only manifests as a render when OPENAI_API_KEY is set, but OCR must
  // run regardless of the key so the watermark score is always OCR-informed.
  const sink = {};
  await callStage({
    apiKey: "",
    runOcr: ocrStub({ text: "", matches: [] }, sink),
  });

  assert.equal(sink.calls, 1);
});

test("no-vision path passes tesseractLang to OCR (renderer parity)", async () => {
  // The preview previously called runOptionalOcr(contactSheetPath) without
  // tesseractLang, diverging from the renderer whenever TESSERACT_LANG was
  // customized. The fix forwards normalizeTesseractLang(process.env.TESSERACT_LANG).
  const sink = {};
  await callStage({
    tesseractLang: "eng+fas+ara+heb",
    runOcr: ocrStub({ text: "", matches: [] }, sink),
  });

  assert.equal(sink.tesseractLang, "eng+fas+ara+heb");
});

test("vision path still runs OCR and produces a complete preflight (no regression in default path)", async () => {
  const ocrSink = {};
  const result = await callStage({
    preflight: { stableOverlayScore: 0.4 },
    enableVisionPreflight: true,
    runOcr: ocrStub({ text: "@handle", matches: ["@handle"] }, ocrSink),
    analyzeWatermarks: analyzeWatermarksStub({
      decision: "render",
      confidence: 0.9,
      removableWatermarks: [],
      mustKeep: [],
    }),
  });

  assert.equal(ocrSink.calls, 1);
  assert.equal(result.contactSheetGenerated, true);
  assert.equal(result.ocr.text, "@handle");
  assert.ok(result.vision, "vision should be populated when vision preflight runs");
  assert.ok(result.watermark, "watermark should be recomputed with vision");
  assert.ok(result.block, "block should be recomputed in the vision path");
  assert.ok(Array.isArray(result.delogoRegions));
  assert.equal(result.subtitlePlacement != null, true);
});

test("vision path short-circuits to watermarkOnly block decision when the model blocks", async () => {
  // When analyzeRemovableWatermarks returns decision: "block",
  // decideWatermarkOnlyBlock takes precedence over decidePreflightBlock.
  const result = await callStage({
    preflight: { stableOverlayScore: 0.4 },
    enableVisionPreflight: true,
    runOcr: ocrStub({ text: "@handle", matches: ["@handle"] }),
    analyzeWatermarks: analyzeWatermarksStub({
      decision: "block",
      confidence: 0.95,
      removableWatermarks: [],
      mustKeep: [],
    }),
  });

  assert.equal(result.block.blocked, true);
  assert.equal(result.block.reason, "watermark_detected");
});

test("vision path preserves OCR-derived signals when the model returns a clear render", async () => {
  // Guards against a future refactor that "simplifies" the vision branch to
  // recompute watermark from vision-only signals (dropping the OCR inputs):
  // scoreWatermarkSignals must fold in the OCR-derived repeated text and
  // platform matches even when the vision model returns a clear "render"
  // decision, so OCR signals remain visible on result.watermark.
  const result = await callStage({
    preflight: { stableOverlayScore: 0.9 },
    enableVisionPreflight: true,
    runOcr: ocrStub({ text: "@user_name Follow for more!", matches: ["@user_name"] }),
    analyzeWatermarks: analyzeWatermarksStub({
      decision: "render",
      confidence: 0.95,
      removableWatermarks: [],
      mustKeep: [],
    }),
  });

  assert.deepEqual(result.watermark.repeatedText, ["@user_name Follow for more!"]);
  assert.deepEqual(result.watermark.platformMatches, ["@user_name"]);
});

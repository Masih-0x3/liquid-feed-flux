import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWatermarkApplyWhen, resolveRenderEffects } from "../src/renderEffects.js";

test("watermark policy defaults to subtitle-track only", () => {
  assert.equal(normalizeWatermarkApplyWhen(), "subtitle_track");
  assert.equal(normalizeWatermarkApplyWhen("subtitle"), "subtitle_track");
  assert.equal(normalizeWatermarkApplyWhen("modified"), "modified");
});

test("delogo-only renders do not add our watermark by default", () => {
  const effects = resolveRenderEffects({
    delogoRegions: [{ x: 218, y: 1016, w: 286, h: 74 }],
  }, {
    enableAdaptiveSubtitleMask: false,
    watermarkConfig: { enabled: true },
  }, {
    hasSubtitleTrack: false,
  });

  assert.equal(effects.shouldRender, true);
  assert.deepEqual(effects.reasons, ["delogo"]);
  assert.equal(effects.shouldWatermark, false);
});

test("subtitle renders add our watermark", () => {
  const effects = resolveRenderEffects({}, {
    enableAdaptiveSubtitleMask: false,
    watermarkConfig: { enabled: true },
  }, {
    hasSubtitleTrack: true,
  });

  assert.equal(effects.shouldRender, true);
  assert.deepEqual(effects.reasons, ["subtitle_track"]);
  assert.equal(effects.shouldWatermark, true);
});

test("legacy modified watermark policy remains available explicitly", () => {
  const effects = resolveRenderEffects({
    delogoRegions: [{ x: 218, y: 1016, w: 286, h: 74 }],
  }, {
    enableAdaptiveSubtitleMask: false,
    watermarkConfig: { enabled: true, apply_when: "modified" },
  }, {
    hasSubtitleTrack: false,
  });

  assert.equal(effects.shouldRender, true);
  assert.equal(effects.shouldWatermark, true);
});

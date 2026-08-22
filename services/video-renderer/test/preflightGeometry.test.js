import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  delogoRegionsFromVision as publicDelogoRegionsFromVision,
  evaluateDelogoPlan as publicEvaluateDelogoPlan,
  protectDelogoRegionsFromLowerText as publicProtectDelogoRegionsFromLowerText,
  selectDelogoRegions as publicSelectDelogoRegions,
} from "../src/preflight.js";
import {
  delogoRegionsFromVision as geometryDelogoRegionsFromVision,
  evaluateDelogoPlan as geometryEvaluateDelogoPlan,
  protectDelogoRegionsFromLowerText as geometryProtectDelogoRegionsFromLowerText,
  selectDelogoRegions as geometrySelectDelogoRegions,
} from "../src/preflightGeometry.js";

const GEOMETRY_NAMES = [
  "delogoRegionsFromVision",
  "evaluateDelogoPlan",
  "selectDelogoRegions",
  "protectDelogoRegionsFromLowerText",
];

const GEOMETRY_IMPORT = `import {
  delogoRegionsFromVision,
  evaluateDelogoPlan,
  protectDelogoRegionsFromLowerText,
  selectDelogoRegions,
} from "./preflightGeometry.js";`;

const GEOMETRY_EXPORT = `export {
  delogoRegionsFromVision,
  evaluateDelogoPlan,
  protectDelogoRegionsFromLowerText,
  selectDelogoRegions,
} from "./preflightGeometry.js";`;

function assertGeometryArchitecture(source) {
  assert.match(source, /import \{\s*delogoRegionsFromVision,\s*evaluateDelogoPlan,\s*protectDelogoRegionsFromLowerText,\s*selectDelogoRegions,\s*\} from "\.\/preflightGeometry\.js";/s);
  assert.match(source, /export \{\s*delogoRegionsFromVision,\s*evaluateDelogoPlan,\s*protectDelogoRegionsFromLowerText,\s*selectDelogoRegions,\s*\} from "\.\/preflightGeometry\.js";/s);

  const implementation = source
    .replace(GEOMETRY_IMPORT, "")
    .replace(GEOMETRY_EXPORT, "");
  for (const name of GEOMETRY_NAMES) {
    const localBinding = new RegExp([
      `(?:^|\\n)\\s*(?:async\\s+)?function\\s+${name}\\s*\\(`,
      `(?:^|\\n)\\s*(?:const|let|var)\\s+${name}\\s*=`,
      `(?:^|\\n)\\s*class\\s+${name}\\b`,
      `(?:^|\\n)\\s*import\\b[^\\n;]*\\b${name}\\b`,
      `(?:^|\\n)\\s*(?:const|let|var)\\s+\\w+\\s*=\\s*[^\\n;]*\\b${name}\\b`,
    ].join("|"), "m");
    assert.doesNotMatch(implementation, localBinding, `${name} must remain owned by preflightGeometry.js`);
  }
}

const publicGeometryExports = [
  [publicDelogoRegionsFromVision, geometryDelogoRegionsFromVision],
  [publicEvaluateDelogoPlan, geometryEvaluateDelogoPlan],
  [publicSelectDelogoRegions, geometrySelectDelogoRegions],
  [publicProtectDelogoRegionsFromLowerText, geometryProtectDelogoRegionsFromLowerText],
];

test("normalizes a handle vision box into a bounded padded pixel region", () => {
  assert.deepEqual(publicDelogoRegionsFromVision({
    overlays: [{
      text: "@source",
      category: "creator_handle",
      action: "delogo",
      confidence: 0.99,
      box: { x: 0.4, y: 0.8, w: 0.05, h: 0.04 },
    }],
  }, { width: 100, height: 100 }), [{
    x: 36,
    y: 74,
    w: 33,
    h: 14,
    areaRatio: 0.0462,
    centerOverlapRatio: 0.07142857142857142,
    text: "@source",
    category: "creator_handle",
    confidence: 0.99,
  }]);
});

test("evaluates delogo area and coordinate limits as a pure plan", () => {
  assert.deepEqual(publicEvaluateDelogoPlan([
    { x: 0, y: 0, w: 20, h: 10 },
    { x: 40, y: 40, w: 10, h: 10 },
  ], { width: 100, height: 100 }), {
    blocked: false,
    reason: null,
    regionCount: 2,
    maxRegions: 2,
    totalAreaRatio: 0.03,
    largestAreaRatio: 0.02,
  });
});

test("selects only well-supported model fallback regions", () => {
  assert.deepEqual(publicSelectDelogoRegions({
    requireLocalDelogoCoordinates: true,
    modelRegions: [{
      x: 10,
      y: 80,
      w: 20,
      h: 8,
      areaRatio: 0.016,
      confidence: 0.98,
      seenInFrames: [1, 2],
      text: "@source",
      category: "creator_handle",
    }],
  }), [{
    x: 10,
    y: 80,
    w: 20,
    h: 8,
    areaRatio: 0.016,
    confidence: 0.98,
    seenInFrames: [1, 2],
    text: "@source",
    category: "creator_handle",
    selectedBy: "model_delogo_fallback",
  }]);
});

test("protects a lower text region while allowing a small handle overlap", () => {
  assert.deepEqual(publicProtectDelogoRegionsFromLowerText([
    { x: 10, y: 78, w: 20, h: 10, areaRatio: 0.02, text: "@source", category: "creator_handle" },
  ], {
    lowerTextRegion: {
      detected: true,
      action: "keep",
      confidence: 0.9,
      box: { x: 0, y: 0.8, w: 1, h: 0.2 },
    },
  }, { width: 100, height: 100 }), [{
    x: 10,
    y: 74,
    w: 20,
    h: 10,
    areaRatio: 0.02,
    text: "@source",
    category: "creator_handle",
    adjustedForLowerText: true,
  }]);
});

test("architecture seam keeps moved delogo geometry out of preflight orchestration", () => {
  const preflight = readFileSync(new URL("../src/preflight.js", import.meta.url), "utf8");
  for (const [publicExport, geometryExport] of publicGeometryExports) {
    assert.strictEqual(publicExport, geometryExport);
  }
  assertGeometryArchitecture(preflight);
  const mutations = [
    ["function declaration", (source) => `${source}\nfunction delogoRegionsFromVision() {}`],
    ["const arrow binding", (source) => `${source}\nconst evaluateDelogoPlan = () => null;`],
    ["let function expression", (source) => `${source}\nlet selectDelogoRegions = function () {};`],
    ["var imported binding", (source) => `${source}\nvar protectDelogoRegionsFromLowerText = imported;`],
    ["local alias binding", (source) => `${source}\nconst localGeometryAlias = delogoRegionsFromVision;`],
    ["class declaration", (source) => `${source}\nclass protectDelogoRegionsFromLowerText {}`],
    ["import alias", (source) => `${source}\nimport { evaluateDelogoPlan as localEvaluate } from "./preflightGeometry.js";`],
  ];

  for (const [label, mutate] of mutations) {
    assert.throws(() => assertGeometryArchitecture(mutate(preflight)), label);
  }
});

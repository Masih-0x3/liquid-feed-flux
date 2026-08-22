import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TRACKED_FILES = [
  "src/index.css",
  "tailwind.config.ts",
  "src/pages/AuthPage.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/Monitoring.tsx",
  "src/pages/Settings.tsx",
  "src/components/layout/AppLayout.tsx",
  "src/components/ui/card.tsx",
];

const REVIEWED_TRACKED_MANIFEST = [
  "src/index.css",
  "tailwind.config.ts",
  "src/pages/AuthPage.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/Monitoring.tsx",
  "src/pages/Settings.tsx",
  "src/components/layout/AppLayout.tsx",
  "src/components/ui/card.tsx",
];

const REQUIRED_TOKENS = [
  "glass-card",
  "glass-panel",
  "glass-input",
  "backdrop-blur-glass",
  "backdrop-blur-glass-lg",
];

function analyzeSource(path, source) {
  const count = (pattern) => source.match(pattern)?.length ?? 0;
  return {
    path,
    bytes: Buffer.byteLength(source),
    lines: source.split(/\n/).length,
    glass: count(/\bglass-(?:card|panel|input)\b/g),
    blur: count(/\bbackdrop-blur(?:-[A-Za-z0-9_-]+)?/g),
    shadow: count(/\bshadow(?:-[A-Za-z0-9_-]+)?/g),
    filter: count(/\b(?:filter|drop-shadow)(?:-[A-Za-z0-9_-]+)?/g),
  };
}

function validate(root = ROOT, overrides = {}) {
  const sources = Object.fromEntries(TRACKED_FILES.map((path) => [path, overrides[path] ?? readFileSync(join(root, path), "utf8")]));
  const css = sources["src/index.css"];
  for (const token of REQUIRED_TOKENS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(css, new RegExp(`(?:\\.|\\b)${escaped}(?![-A-Za-z0-9_])`), `shared visual token ${token} must remain defined`);
  }
  const inventory = Object.entries(sources).map(([path, source]) => analyzeSource(path, source));
  const layerTotals = inventory.reduce((totals, entry) => ({
    glass: totals.glass + entry.glass,
    blur: totals.blur + entry.blur,
    shadow: totals.shadow + entry.shadow,
    filter: totals.filter + entry.filter,
  }), { glass: 0, blur: 0, shadow: 0, filter: 0 });
  return { inventory, layerTotals };
}

function assertTrackedManifest(files) {
  assert.deepEqual(
    [...files].sort(),
    [...REVIEWED_TRACKED_MANIFEST].sort(),
    "visual-layer inventory must match the reviewed manifest",
  );
}

assertTrackedManifest(TRACKED_FILES);
const result = validate();
const reviewSignals = result.inventory
  .filter((entry) => entry.blur > 0 && entry.shadow > 0)
  .map((entry) => entry.path);

if (process.env.MUTATION_TEST === "1") {
  assert.throws(
    () => assertTrackedManifest(TRACKED_FILES.slice(1)),
    /visual-layer inventory must match the reviewed manifest/,
    "visual-layer inventory omission mutation must fail the manifest gate",
  );
  assert.throws(
    () => validate(ROOT, {
      "src/index.css": readFileSync(join(ROOT, "src/index.css"), "utf8").replaceAll("glass-card", "glass-card-mutated"),
    }),
    "visual token mutation must fail the characterization contract",
  );
}

console.log(`VISUAL_LAYER_CHARACTERIZATION_SOURCE_CONTRACT_PASS files=${TRACKED_FILES.length} reviewSignals=${reviewSignals.length} totals=${JSON.stringify(result.layerTotals)} mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
for (const path of reviewSignals) console.log(`VISUAL_LAYER_REVIEW_SIGNAL ${path}`);

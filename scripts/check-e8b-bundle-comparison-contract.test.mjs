import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { B0_SHA256, B1_SHA256, compareBundles, exactRoleForModuleId, sha256, stableJson } from "./e8bBundleComparison.mjs";
import { assertNoSymlinkAncestors, buildAndCompare, exactRole } from "./build-e8b-bundle-comparison.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "xot-e8b-b2-"));
  await mkdir(join(root, "assets"), { recursive: true });
  const files = {
    "index.html": "<!doctype html><script type=module src=/assets/index.js></script>",
    "assets/index.js": "import './runtime.js'; import('./sentry.js');",
    "assets/runtime.js": "export const runtime = true;",
    "assets/dashboard.js": "export const dashboard = true;",
    "assets/sentry.js": "export const sentry = true;",
    "assets/app.css": "body{color:#111}",
    "public/xot-logo.png": "old-logo",
    "public/favicon.png": "old-favicon",
    "public/apple-touch-icon.png": "old-touch",
    "public/xot-logo-full.webp": "full-webp",
    "public/xot-logo-compact.webp": "compact-webp",
  };
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, body);
  }
  const manifest = {
    "index.html": { file: "assets/index.js", isEntry: true, imports: ["_runtime.js"], dynamicImports: ["node_modules/@sentry/react/index.js"], css: ["assets/app.css"] },
    "_runtime.js": { file: "assets/runtime.js", imports: [] },
    "src/pages/Dashboard.tsx": { src: "src/pages/Dashboard.tsx", file: "assets/dashboard.js", isDynamicEntry: true, imports: [] },
    "node_modules/@sentry/react/index.js": { src: "node_modules/@sentry/react/index.js", file: "assets/sentry.js", isDynamicEntry: true, imports: ["_runtime.js"] },
  };
  const moduleEvidence = {
    schema: "xot-e8b-module-evidence-v1",
    inventoryComplete: true,
    modules: [
      { id: "src/components/ui/tooltip.tsx", role: "tooltip", chunks: ["assets/runtime.js"] },
      { id: "src/charts/Chart.tsx", role: "chart", chunks: ["assets/dashboard.js"] },
      { id: "node_modules/@sentry/react/index.js", role: "sentry", chunks: ["assets/sentry.js"] },
    ],
  };
  return { root, manifest, moduleEvidence };
}

function receipts() {
  return {
    baseline: {
      schema: "xot-e8b-bundle-asset-baseline-receipt-v1",
      status: "ACCEPTED_LOCAL_BASELINE_ONLY",
      build: {
        entryClosure: { totals: { bytes: 500, gzipBytes: 300 } },
        authLoginClosure: { totals: { bytes: 500, gzipBytes: 300 } },
        dashboardClosure: { totals: { bytes: 100, gzipBytes: 80 } },
        chunks: { metrics: {} },
      },
      assets: { files: [] },
    },
    acceptance: {
      schema: "xot-e8b-brand-asset-optimization-acceptance-receipt-v1",
      status: "ACCEPTED_PARTIAL_LOCAL_ASSET_OPTIMIZATION_VISUAL_LIMITS_DEFERRED",
      predecessor: {},
      assets: { originals: [], derivatives: [] },
    },
  };
}

test("compares an exact manifest closure and produces byte-stable normalized JSON", async () => {
  const { root, manifest, moduleEvidence } = await fixture();
  try {
    const result = compareBundles({
      ...receipts(),
      manifest,
      outputRoot: root,
      moduleEvidence,
      assetExpectations: {
        originals: ["public/xot-logo.png", "public/favicon.png", "public/apple-touch-icon.png"],
        derivatives: ["public/xot-logo-full.webp", "public/xot-logo-compact.webp"],
      },
    });
    assert.equal(result.schema, "xot-e8b-bundle-comparison-v1");
    assert.deepEqual(result.closures.initial.keys, ["_runtime.js", "index.html"]);
    assert.equal(result.modules.chart.initial.present, false);
    assert.equal(result.modules.chart.dashboard.present, true);
    assert.equal(result.modules.sentry.initial.present, false);
    assert.equal(result.assets.baselineBytes, 0);
    assert.equal(result.assets.currentBytes, 21);
    assert.equal(stableJson(result), stableJson(JSON.parse(stableJson(result))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function compareInput(root, manifest, moduleEvidence, overrides = {}) {
  return {
    ...receipts(),
    manifest,
    outputRoot: root,
    moduleEvidence,
    assetExpectations: {
      originals: ["public/xot-logo.png", "public/favicon.png", "public/apple-touch-icon.png"],
      derivatives: ["public/xot-logo-full.webp", "public/xot-logo-compact.webp"],
    },
    ...overrides,
  };
}

test("rejects a missing module inventory instead of guessing from chunk names", async () => {
  const { root, manifest } = await fixture();
  try {
    assert.throws(() => compareBundles(compareInput(root, manifest, null)), /moduleEvidence must be an object/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unresolved manifest closure references and path traversal", async () => {
  const { root, manifest, moduleEvidence } = await fixture();
  try {
    manifest["index.html"].imports = ["../outside.js"];
    assert.throws(() => compareBundles(compareInput(root, manifest, moduleEvidence)), /manifest reference does not resolve/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a tampered exact asset hash", async () => {
  const { root, manifest, moduleEvidence } = await fixture();
  try {
    assert.throws(() => compareBundles(compareInput(root, manifest, moduleEvidence, {
      assetExpectations: {
        originals: ["public/xot-logo.png", "public/favicon.png", "public/apple-touch-icon.png"],
        derivatives: [{ path: "public/xot-logo-full.webp", bytes: 9, sha256: "0".repeat(64) }, "public/xot-logo-compact.webp"],
      },
    })), /hash differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects symlinked artifact files and a changed closure threshold", async () => {
  const { root, manifest, moduleEvidence } = await fixture();
  try {
    const derivative = join(root, "public/xot-logo-full.webp");
    await rm(derivative);
    await writeFile(join(root, "public/xot-logo-full-source"), "full-webp");
    await (await import("node:fs/promises")).symlink("xot-logo-full-source", derivative);
    assert.throws(() => compareBundles(compareInput(root, manifest, moduleEvidence)), /regular file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const second = await fixture();
  try {
    const input = compareInput(second.root, second.manifest, second.moduleEvidence);
    input.baseline.build.entryClosure.totals = { bytes: 1, gzipBytes: 1 };
    assert.throws(() => compareBundles(input), /guard failed/);
  } finally {
    await rm(second.root, { recursive: true, force: true });
  }
});

test("raw checker CLI cannot accept an external manifest or module-evidence path", () => {
  const cli = fileURLToPath(new URL("./check-e8b-bundle-comparison-contract.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--module-evidence", "/tmp/external-evidence.json"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown argument --module-evidence/);
});

test("rejects a drifted immutable receipt hash before comparing candidate output", async () => {
  const { root, manifest, moduleEvidence } = await fixture();
  try {
    const input = compareInput(root, manifest, moduleEvidence);
    input.baseline.__sha256 = "f".repeat(64);
    assert.throws(() => compareBundles({ ...input, strictInputs: true }), /accepted immutable B0 hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("captures a real 71-entry Vite build, compares CSS-inclusive transfer, and cleans both builds", async () => {
  const built = await buildAndCompare({ repoRoot: process.cwd() });
  assert.equal(Object.keys(built.manifest).length, 71);
  assert.equal(built.result.closures.initial.totals.bytes, 600412);
  assert.equal(built.result.closures.dashboard.totals.bytes, 446932);
  assert.equal(built.result.assets.baselineBytes, 234001);
  assert.equal(built.result.assets.currentBytes, 16272);
  assert.equal(built.result.modules.tooltip.initial.present, true);
  assert.equal(built.result.modules.chart.initial.present, false);
  assert.equal(built.result.modules.chart.auth.present, false);
  assert.equal(built.result.sentry.initialPresent, false);
  assert.equal(existsSync(built.firstRoot), false);
  assert.equal(existsSync(built.secondRoot), false);
});

test("hermetically ignores hostile ambient VITE_* values and restores them exactly", async () => {
  const names = Object.keys(process.env).filter((name) => name.startsWith("VITE_"));
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const restore = () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("VITE_")) delete process.env[name];
    Object.assign(process.env, saved);
  };
  try {
    for (const name of names) delete process.env[name];
    const clean = await buildAndCompare({ repoRoot: process.cwd() });
    process.env.VITE_SUPABASE_URL = "https://zzzzzzzzzzzzzzzzzzzz.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hostile_override";
    process.env.VITE_SUPABASE_PROJECT_ID = "zzzzzzzzzzzzzzzzzzzzzz";
    process.env.VITE_FOGLAMP_HUD = "1";
    process.env.VITE_SENTRY_ENVIRONMENT = "hostile";
    const hostile = await buildAndCompare({ repoRoot: process.cwd() });
    assert.equal(stableJson(clean.result), stableJson(hostile.result));
    assert.equal(stableJson(hostile.result).includes("hostile"), false);
    assert.equal(process.env.VITE_SUPABASE_URL, "https://zzzzzzzzzzzzzzzzzzzz.supabase.co");
    await assert.rejects(() => buildAndCompare({
      repoRoot: join(tmpdir(), "xot-e8b-missing-repo"),
      baselinePath: join(process.cwd(), "docs/plans/2026-08-11-xot-e8b-bundle-asset-baseline.json"),
      acceptancePath: join(process.cwd(), "docs/plans/2026-08-11-xot-e8b-brand-asset-optimization-acceptance.json"),
    }));
    assert.equal(process.env.VITE_SUPABASE_URL, "https://zzzzzzzzzzzzzzzzzzzz.supabase.co");
  } finally {
    restore();
  }
  assert.deepEqual(Object.fromEntries(Object.keys(process.env).filter((name) => name.startsWith("VITE_")).map((name) => [name, process.env[name]])), saved);
});

test("rejects SENTRY_AUTH_TOKEN for internal synthetic evidence builds", async () => {
  const previous = process.env.SENTRY_AUTH_TOKEN;
  process.env.SENTRY_AUTH_TOKEN = "synthetic-secret-marker";
  try {
    await assert.rejects(() => buildAndCompare({ repoRoot: process.cwd() }), /SENTRY_AUTH_TOKEN must be unset/);
  } finally {
    if (previous === undefined) delete process.env.SENTRY_AUTH_TOKEN;
    else process.env.SENTRY_AUTH_TOKEN = previous;
  }
});

test("rejects bound-evidence mutations and real output asset drift", async () => {
  const built = await buildAndCompare({ repoRoot: process.cwd(), retainOutput: true });
  const baselineRaw = readFileSync("docs/plans/2026-08-11-xot-e8b-bundle-asset-baseline.json");
  const acceptanceRaw = readFileSync("docs/plans/2026-08-11-xot-e8b-brand-asset-optimization-acceptance.json");
  const baseline = JSON.parse(baselineRaw); baseline.__sha256 = B0_SHA256;
  const acceptance = JSON.parse(acceptanceRaw); acceptance.__sha256 = B1_SHA256;
  const input = () => ({
    baseline: structuredClone(baseline),
    acceptance: structuredClone(acceptance),
    manifest: built.manifest,
    manifestBytes: Buffer.byteLength(JSON.stringify(built.manifest)),
    manifestSha256: built.evidence.manifestSha256,
    outputRoot: built.secondRoot,
    moduleEvidence: structuredClone(built.evidence),
    strictInputs: true,
  });
  try {
    const omittedRole = input();
    const removed = omittedRole.moduleEvidence.modules.pop();
    for (const role of ["tooltip", "chart", "sentry"]) omittedRole.moduleEvidence.roleInventory[role] = omittedRole.moduleEvidence.modules.filter((item) => item.role === role).map((item) => item.id).sort();
    omittedRole.moduleEvidence.moduleInventorySha256 = sha256(Buffer.from(stableJson(omittedRole.moduleEvidence.modules.map((item) => ({ id: item.id, role: item.role, files: item.chunks })))));
    assert.throws(() => compareBundles(omittedRole), /omits captured modules/);

    const bindingDrift = input();
    bindingDrift.moduleEvidence.manifestSha256 = "0".repeat(64);
    assert.throws(() => compareBundles(bindingDrift), /manifest binding differs/);

    const duplicateClaim = input();
    duplicateClaim.moduleEvidence.modules[0].chunks.push(duplicateClaim.moduleEvidence.modules[0].chunks[0]);
    assert.throws(() => compareBundles(duplicateClaim), /duplicate module\/chunk claim/);

    const cssDrift = input();
    cssDrift.baseline.build.entryClosure.totals.bytes = 584167;
    assert.throws(() => compareBundles(cssDrift), /guard failed/);

    const assetPath = join(built.secondRoot, "xot-logo-full.webp");
    const original = readFileSync(assetPath);
    await writeFile(assetPath, Buffer.concat([original, Buffer.from([0]) ]));
    const assetDrift = input();
    assert.throws(() => compareBundles(assetDrift), /output binding differs|byte count differs|hash differs/);
  } finally {
    await rm(built.firstRoot, { recursive: true, force: true });
    await rm(built.secondRoot, { recursive: true, force: true });
  }
});

test("rejects a symlinked builder output destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "xot-e8b-link-"));
  const target = join(root, "result.json");
  const link = join(root, "link.json");
  try {
    await writeFile(target, "existing");
    await (await import("node:fs/promises")).symlink(target, link);
    assert.throws(() => assertNoSymlinkAncestors(link), /must not be a symlink|output parent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exact role classifiers match repo-relative module IDs that normalizeModuleId emits", () => {
  const cases = [
    { id: "src/components/ui/tooltip.tsx", role: "tooltip" },
    { id: "node_modules/@radix-ui/react-tooltip/dist/index.mjs", role: "tooltip" },
    { id: "src/components/ui/chart.tsx", role: "chart" },
    { id: "node_modules/recharts/lib/XAxis.js", role: "chart" },
    { id: "node_modules/@sentry/react/index.js", role: "sentry" },
    { id: "src/pages/Dashboard.tsx", role: null },
  ];
  for (const { id, role } of cases) {
    assert.equal(exactRole(id), role, `builder exactRole misclassified repo-relative id: ${id}`);
    assert.equal(exactRoleForModuleId(id), role, `contract exactRoleForModuleId misclassified repo-relative id: ${id}`);
    assert.equal(exactRole(id), exactRoleForModuleId(id), `builder and contract classifiers disagree on repo-relative id: ${id}`);
  }
  const absolutePrefix = "/Users/stevmq/Finalized%20XOT";
  for (const { id, role } of [
    { id: `${absolutePrefix}/src/components/ui/tooltip.tsx`, role: "tooltip" },
    { id: `${absolutePrefix}/node_modules/@sentry/react/esm/index.js`, role: "sentry" },
  ]) {
    assert.equal(exactRole(id), role, `builder exactRole misclassified absolute id: ${id}`);
    assert.equal(exactRoleForModuleId(id), role, `contract exactRoleForModuleId misclassified absolute id: ${id}`);
  }
  assert.equal(exactRole("src\\components\\ui\\tooltip.tsx"), "tooltip", "builder exactRole must normalize backslashes");
  assert.equal(exactRoleForModuleId("node_modules\\@sentry\\react\\index.js"), "sentry", "contract classifier must normalize backslashes");
});

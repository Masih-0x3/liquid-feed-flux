#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as viteBuild, loadConfigFromFile } from "vite";

import {
  B0_SHA256,
  B1_SHA256,
  compareBundles,
  fileRecord,
  sha256,
  stableJson,
  validateNormalizedComparison,
} from "./e8bBundleComparison.mjs";

const ROLE_RULES = "xot-e8b-exact-module-roles-v1";
const FIXED_APP_TIME = "2026-08-11T00:00:00.000Z";
const SYNTHETIC_ENV = {
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.synthetic-public-payload.synthetic-signature",
  VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
};

function fail(message) {
  throw new Error(`E8B_BUNDLE_BUILDER_INVALID: ${message}`);
}

function normalizeModuleId(id, repoRoot) {
  const normalized = id.replaceAll("\\", "/");
  const root = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

export function exactRole(id) {
  const normalized = id.replaceAll("\\", "/");
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  if (path.endsWith("/src/components/ui/tooltip.tsx")) return "tooltip";
  if (path.includes("/node_modules/@radix-ui/react-tooltip/")) return "tooltip";
  if (path.endsWith("/src/components/ui/chart.tsx")) return "chart";
  if (path.includes("/node_modules/recharts/")) return "chart";
  if (path.includes("/node_modules/@sentry/react/")) return "sentry";
  return null;
}

function withSyntheticEnvironment() {
  const original = new Map(Object.keys(process.env)
    .filter((name) => name.startsWith("VITE_"))
    .map((name) => [name, process.env[name]]));
  for (const name of Object.keys(process.env)) if (name.startsWith("VITE_")) delete process.env[name];
  Object.assign(process.env, SYNTHETIC_ENV);
  return () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("VITE_")) delete process.env[name];
    for (const [name, value] of original) process.env[name] = value;
  };
}

function parseJson(raw, name) {
  try { return JSON.parse(raw); } catch (error) { fail(`${name} is malformed JSON: ${error.message}`); }
}

function loadReceipt(path, expectedHash, name) {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !lstatSync(resolved).isFile() || lstatSync(resolved).isSymbolicLink()) fail(`${name} must be a regular file`);
  const raw = readFileSync(resolved);
  const hash = sha256(raw);
  if (hash !== expectedHash) fail(`${name} hash drifted from accepted immutable input`);
  const receipt = parseJson(raw.toString("utf8"), name);
  receipt.__sha256 = hash;
  return receipt;
}

function capturePlugin(repoRoot, state) {
  return {
    name: "xot-e8b-bundle-module-capture",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        state.chunks[item.fileName] = {
          file: item.fileName,
          modules: Object.keys(item.modules).map((id) => normalizeModuleId(id, repoRoot)).sort(),
        };
      }
    },
  };
}

async function buildOnce({ repoRoot, outputRoot }) {
  if (process.env.SENTRY_AUTH_TOKEN) fail("SENTRY_AUTH_TOKEN must be unset for synthetic evidence builds");
  const state = { chunks: {} };
  const restoreEnv = withSyntheticEnvironment();
  try {
    const configFile = join(repoRoot, "vite.config.ts");
    const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, configFile, repoRoot);
    if (!loaded?.config) fail("vite config could not be loaded");
    const config = loaded.config;
    const define = { ...(config.define ?? {}), __APP_VERSION_TIME__: JSON.stringify(FIXED_APP_TIME) };
    await viteBuild({
      ...config,
      root: repoRoot,
      logLevel: "silent",
      envFile: false,
      define,
      plugins: [...(config.plugins ?? []), capturePlugin(repoRoot, state)],
      build: {
        ...(config.build ?? {}),
        outDir: outputRoot,
        emptyOutDir: true,
        manifest: ".vite/manifest.json",
        sourcemap: false,
      },
    });
  } finally {
    restoreEnv();
  }
  const manifestPath = join(outputRoot, ".vite/manifest.json");
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = parseJson(manifestRaw, "candidate manifest");
  const manifestHash = sha256(Buffer.from(manifestRaw));
  const outputFiles = Object.values(manifest).map((entry) => fileRecord(outputRoot, entry.file)).sort((a, b) => a.file.localeCompare(b.file));
  const moduleMap = new Map();
  for (const chunk of Object.values(state.chunks)) {
    for (const id of chunk.modules) {
      const role = exactRole(id);
      if (!role) continue;
      const existing = moduleMap.get(id) ?? { id, role, chunks: new Set() };
      if (existing.role !== role) fail(`module role changed for ${id}`);
      existing.chunks.add(chunk.file);
      moduleMap.set(id, existing);
    }
  }
  const modules = [...moduleMap.values()].map((item) => ({ id: item.id, role: item.role, chunks: [...item.chunks].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  const roleInventory = Object.fromEntries(["tooltip", "chart", "sentry"].map((role) => [role, modules.filter((item) => item.role === role).map((item) => item.id).sort()]));
  for (const role of ["tooltip", "sentry"]) if (!roleInventory[role].length) fail(`exact ${role} role inventory is empty`);
  const moduleInventorySha256 = sha256(Buffer.from(stableJson(modules.map((item) => ({ id: item.id, role: item.role, files: item.chunks })) )));
  const evidence = {
    schema: "xot-e8b-module-evidence-v1",
    producer: "scripts/build-e8b-bundle-comparison.mjs",
    roleRules: ROLE_RULES,
    builderSourceSha256: sha256(readFileSync(new URL("./build-e8b-bundle-comparison.mjs", import.meta.url))),
    inventoryComplete: true,
    manifestSha256: manifestHash,
    outputFiles: outputFiles.map((item) => ({ file: item.file, bytes: item.bytes, sha256: item.sha256 })),
    chunkModules: Object.values(state.chunks).sort((a, b) => a.file.localeCompare(b.file)),
    chunkModulesSha256: sha256(Buffer.from(stableJson(Object.values(state.chunks).sort((a, b) => a.file.localeCompare(b.file))))),
    roleInventory,
    moduleInventorySha256,
    modules,
  };
  return { manifest, manifestRaw, manifestHash, evidence };
}

export async function buildAndCompare({
  repoRoot = resolve("."),
  baselinePath = join(repoRoot, "docs/plans/2026-08-11-xot-e8b-bundle-asset-baseline.json"),
  acceptancePath = join(repoRoot, "docs/plans/2026-08-11-xot-e8b-brand-asset-optimization-acceptance.json"),
  maxDeltaPercent = 2,
  retainOutput = false,
} = {}) {
  const baseline = loadReceipt(baselinePath, B0_SHA256, "B0 baseline");
  const acceptance = loadReceipt(acceptancePath, B1_SHA256, "B1 acceptance");
  const firstRoot = await mkdtemp(join(tmpdir(), "xot-e8b-b2-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "xot-e8b-b2-second-"));
  try {
    const first = await buildOnce({ repoRoot: resolve(repoRoot), outputRoot: firstRoot });
    const second = await buildOnce({ repoRoot: resolve(repoRoot), outputRoot: secondRoot });
    if (stableJson({ manifest: first.manifest, evidence: first.evidence }) !== stableJson({ manifest: second.manifest, evidence: second.evidence })) {
      fail("repeated fixed-time builds produced different normalized manifest/module evidence");
    }
    const result = compareBundles({
      baseline,
      acceptance,
      manifest: second.manifest,
      manifestBytes: Buffer.byteLength(second.manifestRaw),
      manifestSha256: second.manifestHash,
      outputRoot: secondRoot,
      moduleEvidence: second.evidence,
      maxDeltaPercent,
      strictInputs: true,
    });
    validateNormalizedComparison(result);
    return { result, outputRoot: secondRoot, manifest: second.manifest, evidence: second.evidence, firstRoot, secondRoot };
  } catch (error) {
    if (!retainOutput) await Promise.allSettled([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })]);
    throw error;
  } finally {
    if (!retainOutput) await Promise.allSettled([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })]);
  }
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set(["repo-root", "baseline", "acceptance", "out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail(`unexpected argument ${item}`);
    const [key, ...inlineParts] = item.slice(2).split("=");
    if (!allowed.has(key)) fail(`unknown argument --${key}`);
    if (values[key] !== undefined) fail(`duplicate argument --${key}`);
    values[key] = inlineParts.length ? inlineParts.join("=") : argv[++index];
    if (!values[key] || values[key].startsWith("--")) fail(`missing value for --${key}`);
  }
  return values;
}

export function assertNoSymlinkAncestors(target) {
  const resolvedTarget = resolve(target);
  if (existsSync(resolvedTarget) && lstatSync(resolvedTarget).isSymbolicLink()) fail("output destination must not be a symlink");
  let current = resolve(dirname(resolvedTarget));
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`output parent must not be a symlink: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function runBuilderCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const built = await buildAndCompare({
    repoRoot: options["repo-root"] ? resolve(options["repo-root"]) : resolve("."),
    baselinePath: options.baseline,
    acceptancePath: options.acceptance,
  });
  const output = `${stableJson(built.result)}\n`;
  if (options.out) {
    const outputPath = resolve(options.out);
    assertNoSymlinkAncestors(outputPath);
    if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) fail("--out must not be a symlink");
    await writeFile(outputPath, output);
  }
  process.stdout.write(output);
  return built.result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runBuilderCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

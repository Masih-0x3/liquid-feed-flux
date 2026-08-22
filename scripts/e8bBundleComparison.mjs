import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

export const COMPARISON_SCHEMA = "xot-e8b-bundle-comparison-v1";
export const B0_SHA256 = "872de30f6fe940ec1f416f147dc89cca02f4aae774b66cda2e19dab48222ffb1";
export const B1_SHA256 = "72f8e6302809969996d593ae02878ef6d34a2c090a44fdbca2f7e345f98ddaca";

const B0_SCHEMA = "xot-e8b-bundle-asset-baseline-receipt-v1";
const B1_SCHEMA = "xot-e8b-brand-asset-optimization-acceptance-receipt-v1";
const ROLES = new Set(["tooltip", "chart", "sentry"]);
const ROLE_RULES = "xot-e8b-exact-module-roles-v1";

function fail(message) {
  throw new Error(`E8B_BUNDLE_COMPARISON_INVALID: ${message}`);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function string(value, name) {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function array(value, name) {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value;
}

function integer(value, name) {
  if (!Number.isInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function safeRelativePath(value, name) {
  string(value, name);
  if (isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    fail(`${name} must be a safe relative path`);
  }
  const clean = normalize(value);
  if (clean === "." || clean.startsWith("../") || clean.includes("/../")) fail(`${name} escapes its root`);
  return clean;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stableJson(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
  };
  return JSON.stringify(sort(value));
}

export function fileRecord(root, relativePath) {
  const safe = safeRelativePath(relativePath, "artifact file");
  const target = resolve(root, safe);
  const rootResolved = resolve(root);
  const rel = relative(rootResolved, target);
  if (rel.startsWith("../") || isAbsolute(rel)) fail(`artifact path escapes output root: ${safe}`);
  if (!existsSync(target)) fail(`artifact file is missing: ${safe}`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`artifact file must be a regular file: ${safe}`);
  const bytes = readFileSync(target);
  return {
    file: safe,
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { mtime: 0 }).byteLength,
    sha256: sha256(bytes),
  };
}

function validateReceiptShape(baseline, acceptance, strictInputs) {
  object(baseline, "baseline");
  object(acceptance, "acceptance");
  if (baseline.schema !== B0_SCHEMA) fail(`baseline schema is ${String(baseline.schema)}`);
  if (acceptance.schema !== B1_SCHEMA) fail(`acceptance schema is ${String(acceptance.schema)}`);
  if (baseline.status !== "ACCEPTED_LOCAL_BASELINE_ONLY") fail("baseline is not an accepted local baseline");
  if (!String(acceptance.status ?? "").startsWith("ACCEPTED_")) fail("acceptance is not accepted");
  object(baseline.build, "baseline.build");
  for (const name of ["entryClosure", "authLoginClosure", "dashboardClosure"]) {
    integer(baseline.build[name]?.totals?.bytes, `baseline.build.${name}.totals.bytes`);
    integer(baseline.build[name]?.totals?.gzipBytes, `baseline.build.${name}.totals.gzipBytes`);
  }
  object(baseline.assets, "baseline.assets");
  object(acceptance.assets, "acceptance.assets");
  array(acceptance.assets.originals, "acceptance.assets.originals");
  array(acceptance.assets.derivatives, "acceptance.assets.derivatives");
  if (strictInputs) {
    if (baseline.__sha256 !== B0_SHA256) fail("baseline hash is not the accepted immutable B0 hash");
    if (acceptance.__sha256 !== B1_SHA256) fail("acceptance hash is not the accepted immutable B1 hash");
    if (acceptance.predecessor?.sha256 !== B0_SHA256) fail("B1 predecessor does not bind the accepted B0 hash");
  }
}

export function exactRoleForModuleId(id) {
  const normalized = id.replaceAll("\\", "/");
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  if (path.endsWith("/src/components/ui/tooltip.tsx")) return "tooltip";
  if (path.includes("/node_modules/@radix-ui/react-tooltip/")) return "tooltip";
  if (path.endsWith("/src/components/ui/chart.tsx")) return "chart";
  if (path.includes("/node_modules/recharts/")) return "chart";
  if (path.includes("/node_modules/@sentry/react/")) return "sentry";
  return null;
}

function manifestModel(manifest) {
  object(manifest, "manifest");
  const keys = Object.keys(manifest).sort();
  if (keys.length === 0) fail("manifest must contain entries");
  const byFile = new Map();
  for (const key of keys) {
    safeRelativePath(key, "manifest key");
    const entry = object(manifest[key], `manifest.${key}`);
    safeRelativePath(entry.file, `manifest.${key}.file`);
    for (const field of ["imports", "dynamicImports", "css", "assets"]) {
      if (entry[field] !== undefined) array(entry[field], `manifest.${key}.${field}`);
      for (const ref of entry[field] ?? []) string(ref, `manifest.${key}.${field} reference`);
    }
    if (byFile.has(entry.file)) fail(`manifest file is claimed by multiple entries: ${entry.file}`);
    byFile.set(entry.file, key);
  }
  const resolveRef = (ref) => {
    if (keys.includes(ref)) return ref;
    if (ref.startsWith("_") && keys.includes(ref)) return ref;
    const key = keys.find((candidate) => manifest[candidate]?.file === ref);
    if (key) return key;
    fail(`manifest reference does not resolve: ${ref}`);
  };
  const entries = keys.filter((key) => manifest[key].isEntry === true);
  const initialKey = keys.includes("index.html") ? "index.html" : entries[0];
  if (!initialKey) fail("manifest has no index.html or isEntry entry");
  const closure = (startKey, excluded = new Set()) => {
    const seen = new Set();
    const queue = [startKey];
    while (queue.length) {
      const key = queue.shift();
      if (excluded.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ref of manifest[key].imports ?? []) queue.push(resolveRef(ref));
    }
    return [...seen].sort();
  };
  const dynamicRefs = (keysForClosure) => keysForClosure.flatMap((key) => manifest[key].dynamicImports ?? []).map(resolveRef).sort();
  const routeKey = (needle) => keys.find((key) => key === needle || manifest[key].src === needle || manifest[key].src?.endsWith(needle));
  return { keys, manifest, resolveRef, closure, dynamicRefs, initialKey, initial: closure(initialKey), routeKey };
}

function metricsForClosure(root, model, keys) {
  const records = keys.map((key) => fileRecord(root, model.manifest[key].file));
  const files = records.map((record) => record.file).sort();
  const sorted = records.sort((a, b) => a.file.localeCompare(b.file));
  return {
    keys: [...keys].sort(),
    files,
    jsTotals: {
      bytes: sorted.reduce((sum, item) => sum + item.bytes, 0),
      gzipBytes: sorted.reduce((sum, item) => sum + item.gzipBytes, 0),
    },
    totals: {
      bytes: sorted.reduce((sum, item) => sum + item.bytes, 0),
      gzipBytes: sorted.reduce((sum, item) => sum + item.gzipBytes, 0),
    },
    metrics: sorted,
  };
}

function cssMetrics(root, model, keys) {
  const css = [...new Set(keys.flatMap((key) => model.manifest[key].css ?? []))].sort();
  return css.map((file) => fileRecord(root, file));
}

function totals(records) {
  return {
    bytes: records.reduce((sum, item) => sum + item.bytes, 0),
    gzipBytes: records.reduce((sum, item) => sum + item.gzipBytes, 0),
  };
}

function delta(baseline, current) {
  const percent = (field) => baseline[field] === 0 ? null : ((current[field] - baseline[field]) / baseline[field]) * 100;
  return {
    baseline,
    current,
    bytes: current.bytes - baseline.bytes,
    gzipBytes: current.gzipBytes - baseline.gzipBytes,
    bytesPercent: percent("bytes"),
    gzipBytesPercent: percent("gzipBytes"),
  };
}

function moduleModel(evidence, model, closures, { strictInputs, manifestSha256, outputFiles }) {
  object(evidence, "moduleEvidence");
  if (evidence.schema !== "xot-e8b-module-evidence-v1") fail("module evidence schema is invalid");
  if (evidence.inventoryComplete !== true) fail("module evidence must declare inventoryComplete=true");
  let expectedModules = null;
  if (strictInputs) {
    if (evidence.producer !== "scripts/build-e8b-bundle-comparison.mjs") fail("module evidence is not produced by the internal builder");
    if (evidence.roleRules !== ROLE_RULES) fail("module evidence role rules are not bound");
    const builderSource = readFileSync(new URL("./build-e8b-bundle-comparison.mjs", import.meta.url));
    if (evidence.builderSourceSha256 !== sha256(builderSource)) fail("module evidence builder source binding differs");
    if (evidence.manifestSha256 !== manifestSha256) fail("module evidence manifest binding differs");
    const expectedOutput = outputFiles.map((item) => ({ file: item.file, bytes: item.bytes, sha256: item.sha256 }));
    const actualOutput = array(evidence.outputFiles, "moduleEvidence.outputFiles").map((item, index) => {
      object(item, `moduleEvidence.outputFiles[${index}]`);
      return { file: safeRelativePath(item.file, "module evidence output file"), bytes: integer(item.bytes, "module evidence output bytes"), sha256: string(item.sha256, "module evidence output hash") };
    }).sort((a, b) => a.file.localeCompare(b.file));
    if (stableJson(actualOutput) !== stableJson(expectedOutput)) fail("module evidence output binding differs");
    const chunkModules = array(evidence.chunkModules, "moduleEvidence.chunkModules").map((item, index) => {
      object(item, `moduleEvidence.chunkModules[${index}]`);
      const file = safeRelativePath(item.file, "module evidence chunk file");
      if (!outputFiles.some((candidate) => candidate.file === file)) fail(`module evidence chunk is not in output binding: ${file}`);
      const moduleIds = array(item.modules, `moduleEvidence.chunkModules[${index}].modules`).map((id) => string(id, "module evidence module ID"));
      if (new Set(moduleIds).size !== moduleIds.length) fail(`duplicate module/chunk claim in ${file}`);
      return { file, modules: [...moduleIds].sort() };
    }).sort((a, b) => a.file.localeCompare(b.file));
    if (evidence.chunkModulesSha256 !== sha256(Buffer.from(stableJson(chunkModules)))) fail("module evidence chunk inventory digest differs");
    const expectedById = new Map();
    for (const chunk of chunkModules) {
      for (const id of chunk.modules) {
        const role = exactRoleForModuleId(id);
        if (!role) continue;
        const existing = expectedById.get(id) ?? { id, role, files: new Set() };
        if (existing.role !== role) fail(`module role changed for ${id}`);
        existing.files.add(chunk.file);
        expectedById.set(id, existing);
      }
    }
    expectedModules = [...expectedById.values()].map((item) => ({ id: item.id, role: item.role, files: [...item.files].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  }
  const modules = array(evidence.modules, "moduleEvidence.modules").map((item, index) => {
    object(item, `moduleEvidence.modules[${index}]`);
    const id = string(item.id, `moduleEvidence.modules[${index}].id`);
    const role = string(item.role, `moduleEvidence.modules[${index}].role`);
    if (!ROLES.has(role)) fail(`unsupported module role: ${role}`);
    const exactRole = exactRoleForModuleId(id);
    if (strictInputs && exactRole !== role) fail(`module role misclassified for ${id}`);
    const chunks = array(item.chunks, `moduleEvidence.modules[${index}].chunks`).map((chunk) => string(chunk, "module evidence chunk"));
    if (!chunks.length) fail(`module evidence has no chunks for ${id}`);
    if (new Set(chunks).size !== chunks.length) fail(`duplicate module/chunk claim for ${id}`);
    const files = chunks.map((chunk) => model.manifest[chunk]?.file ?? (model.keys.includes(chunk) ? model.manifest[chunk].file : chunk));
    for (const file of files) if (!model.keys.some((key) => model.manifest[key].file === file)) fail(`module evidence chunk is not in manifest: ${file}`);
    return { id, role, files: [...new Set(files)].sort() };
  });
  const ids = modules.map((item) => item.id);
  if (new Set(ids).size !== ids.length) fail("duplicate module evidence IDs");
  if (strictInputs) {
    if (stableJson(modules) !== stableJson(expectedModules)) fail("module evidence role inventory omits captured modules");
    const roleInventory = object(evidence.roleInventory, "moduleEvidence.roleInventory");
    for (const role of ROLES) {
      const listed = array(roleInventory[role], `moduleEvidence.roleInventory.${role}`).map((id) => string(id, "module evidence role ID")).sort();
      const expected = modules.filter((item) => item.role === role).map((item) => item.id).sort();
      if (stableJson(listed) !== stableJson(expected)) fail(`module evidence ${role} inventory is incomplete or misclassified`);
    }
    if (evidence.moduleInventorySha256 !== sha256(Buffer.from(stableJson(modules.map((item) => ({ id: item.id, role: item.role, files: item.files })))))) {
      fail("module evidence inventory digest differs");
    }
  }
  const present = (role, closure) => {
    const files = new Set(closure.files);
    return modules.filter((item) => item.role === role && item.files.some((file) => files.has(file))).map((item) => item.id).sort();
  };
  const classify = (role, closure) => ({ present: present(role, closure).length > 0, moduleIds: present(role, closure) });
  return {
    tooltip: { initial: classify("tooltip", closures.initial), auth: classify("tooltip", closures.auth), dashboard: classify("tooltip", closures.dashboard) },
    chart: { initial: classify("chart", closures.initial), auth: classify("chart", closures.auth), dashboard: classify("chart", closures.dashboard) },
    sentry: { initial: classify("sentry", closures.initial), auth: classify("sentry", closures.auth), dashboard: classify("sentry", closures.dashboard) },
    inventory: modules.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function assetModel(root, baseline, acceptance, supplied, strictInputs) {
  const pair = acceptance.assets.pairComparison;
  if (strictInputs) {
    object(pair, "acceptance.assets.pairComparison");
    if (pair.baselineBytes !== 234001 || pair.optimizedBytes !== 16272) fail("B1 pairComparison bytes drifted");
    if (pair.comparison !== "xot-logo.png + favicon.png versus xot-logo-full.webp + xot-logo-compact.webp") fail("B1 pairComparison asset mapping drifted");
  }
  const sourceOriginals = strictInputs
    ? acceptance.assets.originals.filter((item) => item.sourceFor === "public/xot-logo-full.webp" || item.sourceFor === "public/xot-logo-compact.webp")
    : [];
  if (strictInputs && sourceOriginals.length !== 2) fail("B1 sourceFor originals are incomplete");
  const originals = supplied?.originals ?? (strictInputs ? sourceOriginals.map((item) => ({ ...item, path: item.path.replace(/^public\//, "") })) : acceptance.assets.originals);
  const derivatives = supplied?.derivatives ?? (strictInputs ? acceptance.assets.derivatives.map((item) => ({ ...item, path: item.path.replace(/^public\//, "") })) : []);
  const normalizeAssets = (items, name) => array(items, name).map((item, index) => {
    const descriptor = typeof item === "string" ? { path: item } : object(item, `${name}[${index}]`);
    const path = safeRelativePath(descriptor.path, `${name}[${index}].path`);
    const actual = fileRecord(root, path);
    if (descriptor.bytes !== undefined && actual.bytes !== descriptor.bytes) fail(`${path} byte count differs from accepted asset`);
    if (descriptor.sha256 !== undefined && actual.sha256 !== descriptor.sha256) fail(`${path} hash differs from accepted asset`);
    return { ...actual, expectedSha256: descriptor.sha256 ?? null };
  });
  const currentOriginals = normalizeAssets(originals, "assets.originals");
  const currentDerivatives = normalizeAssets(derivatives, "assets.derivatives");
  const acceptedOriginalBytes = strictInputs ? pair.baselineBytes : acceptance.assets.originals.reduce((sum, item) => sum + Number(item.bytes ?? 0), 0);
  const currentBytes = currentDerivatives.reduce((sum, item) => sum + item.bytes, 0);
  if (strictInputs && currentBytes !== pair.optimizedBytes) fail(`optimized asset bytes are ${currentBytes}, expected ${pair.optimizedBytes}`);
  return {
    baselineBytes: supplied?.baselineBytes ?? acceptedOriginalBytes,
    currentBytes,
    originals: currentOriginals,
    derivatives: currentDerivatives,
    reductionPercent: acceptedOriginalBytes === 0 ? null : ((acceptedOriginalBytes - currentBytes) / acceptedOriginalBytes) * 100,
    pairComparison: strictInputs ? { baselineBytes: pair.baselineBytes, optimizedBytes: pair.optimizedBytes, savedBytes: pair.savedBytes, reductionPercentExact: pair.reductionPercentExact } : null,
    b0AssetReceiptCount: Array.isArray(baseline.assets.files) ? baseline.assets.files.length : null,
  };
}

export function compareBundles({ baseline, acceptance, manifest, manifestBytes = null, manifestSha256 = null, outputRoot, moduleEvidence, assetExpectations, maxDeltaPercent = 2, strictInputs = false }) {
  validateReceiptShape(baseline, acceptance, strictInputs);
  if (!Number.isFinite(maxDeltaPercent) || maxDeltaPercent < 0) fail("maxDeltaPercent must be non-negative");
  if (typeof outputRoot !== "string" || !outputRoot) fail("outputRoot is required");
  const rootStat = lstatSync(outputRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("outputRoot must be a real directory");
  const model = manifestModel(manifest);
  const initialKeys = model.initial;
  const authKey = model.routeKey("src/pages/AuthPage.tsx");
  const dashboardKey = model.routeKey("src/pages/Dashboard.tsx");
  const closures = {
    initial: metricsForClosure(outputRoot, model, initialKeys),
    auth: metricsForClosure(outputRoot, model, authKey ? model.closure(authKey) : initialKeys),
    dashboard: metricsForClosure(outputRoot, model, dashboardKey ? model.closure(dashboardKey, new Set([model.initialKey])) : initialKeys),
  };
  for (const scope of Object.values(closures)) {
    scope.css = cssMetrics(outputRoot, model, scope.keys);
    scope.cssTotals = totals(scope.css);
    scope.transferTotals = {
      bytes: scope.jsTotals.bytes + scope.cssTotals.bytes,
      gzipBytes: scope.jsTotals.gzipBytes + scope.cssTotals.gzipBytes,
    };
    scope.totals = scope.transferTotals;
  }
  const allManifestFiles = metricsForClosure(outputRoot, model, model.keys);
  const sentryKey = model.keys.filter((key) => model.manifest[key].isDynamicEntry === true && String(model.manifest[key].src ?? "").includes("@sentry/react"));
  if (sentryKey.length !== 1) fail("exactly one dynamic @sentry/react manifest entry is required");
  const sentryClosureKeys = model.closure(sentryKey[0]);
  const sentryFiles = metricsForClosure(outputRoot, model, sentryClosureKeys);
  const dynamicReferences = model.dynamicRefs(initialKeys);
  if (!dynamicReferences.includes(sentryKey[0])) fail("initial entry does not dynamically reference the Sentry entry");
  if (closures.initial.files.includes(model.manifest[sentryKey[0]].file) || closures.auth.files.includes(model.manifest[sentryKey[0]].file)) {
    fail("Sentry output is in the initial/auth closure");
  }
  const modules = moduleModel(moduleEvidence, model, closures, { strictInputs, manifestSha256, outputFiles: allManifestFiles.metrics });
  if (modules.chart.initial.present || modules.chart.auth.present) fail("chart module is present in initial/auth closure");
  if (modules.sentry.initial.present) fail("Sentry module evidence is present in initial closure");
  const scopes = {
    initial: delta(baseline.build.entryClosure.totals, closures.initial.transferTotals),
    auth: delta(baseline.build.authLoginClosure.totals, closures.auth.jsTotals),
    dashboard: delta(baseline.build.dashboardClosure.totals, closures.dashboard.jsTotals),
  };
  const baselineScopes = ["entryClosure", "authLoginClosure", "dashboardClosure"];
  for (const [index, name] of ["initial", "auth", "dashboard"].entries()) {
    const baselineCss = totals((baseline.build[baselineScopes[index]].css ?? []).map((item) => ({
      bytes: integer(item.bytes, `baseline.build.${baselineScopes[index]}.css.bytes`),
      gzipBytes: integer(item.gzipBytes, `baseline.build.${baselineScopes[index]}.css.gzipBytes`),
    })));
    scopes[name].css = delta(baselineCss, closures[name].cssTotals);
  }
  const guardFailures = [];
  for (const [name, item] of Object.entries(scopes)) {
    for (const [field, percent] of [["bytes", item.bytesPercent], ["gzipBytes", item.gzipBytesPercent]]) {
      if (percent !== null && percent > maxDeltaPercent) guardFailures.push(`${name}.${field} increased ${percent.toFixed(3)}%`);
    }
    for (const [field, percent] of [["bytes", item.css.bytesPercent], ["gzipBytes", item.css.gzipBytesPercent]]) {
      if (percent !== null && percent > maxDeltaPercent) guardFailures.push(`${name}.css.${field} increased ${percent.toFixed(3)}%`);
    }
  }
  if (guardFailures.length) fail(`+${maxDeltaPercent}% guard failed: ${guardFailures.join(", ")}`);
  return {
    schema: COMPARISON_SCHEMA,
    boundary: "T0/T1 local source/build comparison only; no runtime/UI or hosted claim",
    guard: { maxDeltaPercent, passed: true, failures: [] },
    manifest: { bytes: manifestBytes, sha256: manifestSha256, keys: model.keys, entryKey: model.initialKey, files: allManifestFiles.metrics },
    closures,
    sentry: { manifestKey: sentryKey[0], dynamicReferences, closure: sentryFiles, initialPresent: false },
    modules,
    deltas: scopes,
    assets: assetModel(outputRoot, baseline, acceptance, assetExpectations, strictInputs),
  };
}

export function validateNormalizedComparison(result) {
  object(result, "comparison");
  if (result.schema !== COMPARISON_SCHEMA) fail("comparison schema is invalid");
  if (result.guard?.passed !== true) fail("comparison guard did not pass");
  for (const name of ["initial", "auth", "dashboard"]) {
    object(result.closures?.[name], `comparison.closures.${name}`);
    object(result.deltas?.[name], `comparison.deltas.${name}`);
  }
  return true;
}

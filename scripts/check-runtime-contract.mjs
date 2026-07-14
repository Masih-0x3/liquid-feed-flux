#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_PATH = "docs/operations/runtime-contract.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseVersion(value) {
  const match = String(value).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function isVite8SupportedNode(value) {
  const version = parseVersion(value);
  if (!version) return false;
  const [major, minor] = version;
  return major === 20 ? minor >= 19 : major > 22 || (major === 22 && minor >= 12);
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function edgeSupabaseImports(root) {
  const imports = {};
  const nonLiteralModuleLoads = [];
  const parseErrorSources = [];
  const prohibitedNodeModuleSources = [];
  const prohibitedCommonJsAliasSources = [];
  const functionsRoot = join(root, "supabase/functions");
  const moduleExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
  for (const path of walkFiles(functionsRoot).filter((file) => moduleExtensions.has(file.slice(file.lastIndexOf("."))))) {
    const source = readFileSync(path, "utf8");
    const scriptKind = path.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : path.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : /\.(?:js|mjs|cjs)$/.test(path)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
    if (sourceFile.parseDiagnostics.length > 0) parseErrorSources.push(relative(root, path));
    const specifiers = [];
    const isPropertyName = (node) => (
      (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      || ("name" in node.parent && node.parent.name === node && (
        ts.isMethodDeclaration(node.parent)
        || ts.isPropertyDeclaration(node.parent)
        || ts.isPropertySignature(node.parent)
        || ts.isMethodSignature(node.parent)
      ))
    );
    const isDeclarationName = (node) => (
      "name" in node.parent
      && node.parent.name === node
      && (
        ts.isParameter(node.parent)
        || ts.isVariableDeclaration(node.parent)
        || ts.isBindingElement(node.parent)
        || ts.isFunctionDeclaration(node.parent)
        || ts.isFunctionExpression(node.parent)
        || ts.isClassDeclaration(node.parent)
        || ts.isClassExpression(node.parent)
      )
    );
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier
        && ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      }
      if (
        ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression
      ) {
        if (ts.isStringLiteralLike(node.moduleReference.expression)) {
          specifiers.push(node.moduleReference.expression.text);
        } else {
          nonLiteralModuleLoads.push(relative(root, path));
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          nonLiteralModuleLoads.push(relative(root, path));
        } else {
          specifiers.push(node.arguments[0].text);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          nonLiteralModuleLoads.push(relative(root, path));
        } else {
          specifiers.push(node.arguments[0].text);
        }
      }
      if (ts.isIdentifier(node) && (node.text === "module" || node.text === "exports") && !isPropertyName(node) && !isDeclarationName(node)) {
        prohibitedCommonJsAliasSources.push(relative(root, path));
      }
      if (
        ts.isIdentifier(node)
        && node.text === "require"
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
        && !isPropertyName(node)
        && !isDeclarationName(node)
      ) {
        prohibitedCommonJsAliasSources.push(relative(root, path));
      }
      if (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "globalThis"
        && ["module", "exports", "require"].includes(node.name.text)
      ) {
        prohibitedCommonJsAliasSources.push(relative(root, path));
      }
      if (
        ts.isElementAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "globalThis"
        && ts.isStringLiteralLike(node.argumentExpression)
        && ["module", "exports", "require"].includes(node.argumentExpression.text)
      ) {
        prohibitedCommonJsAliasSources.push(relative(root, path));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (specifiers.some((specifier) => specifier === "node:module" || specifier === "module")) {
      prohibitedNodeModuleSources.push(relative(root, path));
    }
    const supabaseSpecifiers = specifiers.filter((specifier) => specifier.includes("@supabase/supabase-js"));
    if (supabaseSpecifiers.length === 1) imports[relative(root, path)] = supabaseSpecifiers[0];
    else if (supabaseSpecifiers.length > 1) imports[relative(root, path)] = supabaseSpecifiers.sort();
  }
  return {
    imports: Object.fromEntries(Object.entries(imports).sort(([left], [right]) => left.localeCompare(right))),
    nonLiteralModuleLoads: [...new Set(nonLiteralModuleLoads)].sort(),
    parseErrorSources: [...new Set(parseErrorSources)].sort(),
    prohibitedNodeModuleSources: [...new Set(prohibitedNodeModuleSources)].sort(),
    prohibitedCommonJsAliasSources: [...new Set(prohibitedCommonJsAliasSources)].sort(),
  };
}

function workflowRuntimeFacts(value, jobName, setupNodeAction) {
  const lines = value.split(/\r?\n/);
  const jobHeader = `  ${jobName}:`;
  const workflowHasOverrides = lines.some((line) => /^(?:defaults|env):/.test(line));
  const workflowHasQuotedKeys = lines.some((line) => /^\s*["'][^"']+["']\s*:/.test(line));
  const workflowHasYamlIndirection = lines.some((line) => /<<:|(?:^|\s)[&*][A-Za-z0-9_-]+/.test(line));
  const jobStart = lines.findIndex((line) => line === jobHeader);
  if (jobStart < 0 || lines.filter((line) => line === jobHeader).length !== 1) {
    return { found: false, runSteps: [], setupNodeActionFound: false, nodeSelector: null, runsOn: null, blocking: false, workflowHasOverrides, workflowHasQuotedKeys, workflowHasYamlIndirection };
  }
  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) || /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[index])) {
      jobEnd = index;
      break;
    }
  }
  const jobLines = lines.slice(jobStart + 1, jobEnd);
  const runsOn = jobLines.find((line) => /^    runs-on:\s*/.test(line))?.match(/^    runs-on:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/)?.[1] ?? null;
  const jobHasBypass = jobLines.some((line) => /^    (?:if|continue-on-error|defaults|env|container|needs):/.test(line));
  const stepStarts = [];
  for (let index = 0; index < jobLines.length; index += 1) {
    if (/^      -\s+/.test(jobLines[index])) stepStarts.push(index);
  }
  const steps = stepStarts.map((start, position) => {
    const end = stepStarts[position + 1] ?? jobLines.length;
    const block = jobLines.slice(start, end);
    const first = block[0].replace(/^      -\s+/, "        ");
    const normalized = [first, ...block.slice(1)];
    const runValue = normalized.find((line) => /^        run:\s*/.test(line))?.match(/^        run:\s*([^#]+?)\s*$/)?.[1] ?? null;
    const uses = normalized.find((line) => /^        uses:\s*/.test(line))?.match(/^        uses:\s*(\S+)\s*(?:#.*)?$/)?.[1] ?? null;
    const nodeSelector = normalized.find((line) => /^          node-version:\s*/.test(line))?.match(/^          node-version:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/)?.[1] ?? null;
    const cache = normalized.find((line) => /^          cache:\s*/.test(line))?.match(/^          cache:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/)?.[1] ?? null;
    const meaningful = normalized.filter((line) => line.trim() && !line.trim().startsWith("#"));
    return {
      run: runValue?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? null,
      uses,
      nodeSelector,
      cache,
      meaningful,
      hasBypass: normalized.some((line) => /^ {8,}(?:if|continue-on-error):/.test(line)),
      isBareRun: Boolean(runValue) && meaningful.length === 1,
      isBareUses: Boolean(uses) && meaningful.length === 1,
    };
  });
  const runSteps = steps.map((step) => step.run).filter(Boolean);
  const setupIndexes = steps.flatMap((step, index) => step.uses === setupNodeAction ? [index] : []);
  const setupIndex = setupIndexes.length === 1 ? setupIndexes[0] : -1;
  let nodeSelector = null;
  if (setupIndex >= 0) nodeSelector = steps[setupIndex].nodeSelector;
  const firstRequiredRunIndex = steps.findIndex((step) => step.run);
  return {
    found: true,
    runSteps,
    setupNodeActionFound: setupIndex >= 0,
    nodeSelector,
    runsOn,
    blocking: !jobHasBypass && steps.every((step) => !step.hasBypass),
    setupBeforeRuns: setupIndex >= 0 && setupIndex < firstRequiredRunIndex,
    requiredPrefixMatches:
      steps[0]?.uses === "actions/checkout@v4"
      && steps[0]?.isBareUses
      && steps[1]?.uses === setupNodeAction
      && steps[1]?.meaningful.length === 4
      && steps[1]?.meaningful[1]?.trim() === "with:"
      && steps[1]?.cache === "npm"
      && steps.slice(2, 5).map((step) => step.run).every((run, index) => run === ["npm ci", "npm run check:runtime-contract", "npm run test:runtime-contract"][index]),
    unsafeRequiredRun: steps.some((step) => ["npm ci", "npm run check:runtime-contract", "npm run test:runtime-contract"].includes(step.run) && !step.isBareRun),
    workflowHasOverrides,
    workflowHasQuotedKeys,
    workflowHasYamlIndirection,
  };
}

function exactJson(value) {
  if (Array.isArray(value)) return `[${value.map(exactJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${exactJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireEqual(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

export function validateRuntimeContract({
  root = REPO_ROOT,
  actualNodeVersion = process.versions.node,
  actualNpmVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/)?.[1] ?? null,
  requireDeploymentMajor = Boolean(process.env.CI || process.env.VERCEL),
} = {}) {
  const contract = JSON.parse(readFileSync(resolve(root, CONTRACT_PATH), "utf8"));
  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const rootLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const rendererPackage = JSON.parse(readFileSync(join(root, "services/video-renderer/package.json"), "utf8"));
  const rendererLock = JSON.parse(readFileSync(join(root, "services/video-renderer/package-lock.json"), "utf8"));
  const denoLock = JSON.parse(readFileSync(join(root, "deno.lock"), "utf8"));
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const dockerfile = readFileSync(join(root, "services/video-renderer/Dockerfile"), "utf8");
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const errors = [];

  requireEqual(errors, "contract schema", contract.schema_version, "xot-runtime-contract-v1");
  requireEqual(errors, "contract status", contract.status, "current_divergence_frozen_upgrade_deferred");
  requireEqual(errors, "root Node engine", rootPackage.engines?.node, contract.node.root_engine);
  requireEqual(errors, "root npm engine", rootPackage.engines?.npm, contract.node.root_npm_engine);
  requireEqual(errors, "root package manager", rootPackage.packageManager, contract.node.root_package_manager);
  requireEqual(errors, "lock root Node engine", rootLock.packages?.[""]?.engines?.node, contract.node.root_engine);
  requireEqual(errors, "lock root npm engine", rootLock.packages?.[""]?.engines?.npm, contract.node.root_npm_engine);
  requireEqual(errors, "renderer Node engine", rendererPackage.engines?.node, contract.node.renderer_engine);
  requireEqual(errors, "renderer lock Node engine", rendererLock.packages?.[""]?.engines?.node, contract.node.renderer_engine);
  requireEqual(errors, "Vite package range", rootPackage.devDependencies?.vite, contract.vite.package_range);
  requireEqual(errors, "Vite lock version", rootLock.packages?.["node_modules/vite"]?.version, contract.vite.lock_version);
  requireEqual(errors, "Vite lock Node engine", rootLock.packages?.["node_modules/vite"]?.engines?.node, contract.vite.lock_node_engine);
  requireEqual(errors, "Vite supported range", contract.node.vite_supported_range, contract.vite.lock_node_engine);
  requireEqual(errors, "root Supabase package range", rootPackage.dependencies?.["@supabase/supabase-js"], contract.supabase_js.root_package_range);
  requireEqual(errors, "renderer Supabase package range", rendererPackage.dependencies?.["@supabase/supabase-js"], contract.supabase_js.renderer_package_range);
  requireEqual(errors, "root Supabase lock", rootLock.packages?.["node_modules/@supabase/supabase-js"]?.version, contract.supabase_js.root_lock);
  requireEqual(errors, "renderer Supabase lock", rendererLock.packages?.["node_modules/@supabase/supabase-js"]?.version, contract.supabase_js.renderer_lock);
  requireEqual(errors, "root Supabase lock resolved URL", rootLock.packages?.["node_modules/@supabase/supabase-js"]?.resolved, contract.supabase_js.root_lock_resolved);
  requireEqual(errors, "root Supabase lock integrity", rootLock.packages?.["node_modules/@supabase/supabase-js"]?.integrity, contract.supabase_js.root_lock_integrity);
  requireEqual(errors, "renderer Supabase lock resolved URL", rendererLock.packages?.["node_modules/@supabase/supabase-js"]?.resolved, contract.supabase_js.renderer_lock_resolved);
  requireEqual(errors, "renderer Supabase lock integrity", rendererLock.packages?.["node_modules/@supabase/supabase-js"]?.integrity, contract.supabase_js.renderer_lock_integrity);
  requireEqual(errors, "Deno Supabase lock", denoLock.specifiers?.[contract.supabase_js.deno_package_specifier], contract.supabase_js.deno_lock);
  requireEqual(errors, "Deno Supabase npm integrity", denoLock.npm?.[`@supabase/supabase-js@${contract.supabase_js.deno_lock}`]?.integrity, contract.supabase_js.deno_lock_integrity);
  const edgeInventory = edgeSupabaseImports(root);
  requireEqual(errors, "Edge Supabase import inventory", exactJson(edgeInventory.imports), exactJson(contract.supabase_js.edge_imports));
  if (edgeInventory.nonLiteralModuleLoads.length > 0) {
    errors.push(`non-literal Edge module loads are prohibited: ${edgeInventory.nonLiteralModuleLoads.join(", ")}`);
  }
  if (edgeInventory.parseErrorSources.length > 0) {
    errors.push(`Edge module inventory cannot parse: ${edgeInventory.parseErrorSources.join(", ")}`);
  }
  if (edgeInventory.prohibitedNodeModuleSources.length > 0) {
    errors.push(`node:module/module imports are prohibited in Edge functions because createRequire aliases bypass static inventory: ${edgeInventory.prohibitedNodeModuleSources.join(", ")}`);
  }
  if (edgeInventory.prohibitedCommonJsAliasSources.length > 0) {
    errors.push(`CommonJS module/exports and aliased require surfaces are prohibited in Edge functions: ${edgeInventory.prohibitedCommonJsAliasSources.join(", ")}`);
  }
  const expectedEdgeUrls = [...new Set(Object.values(contract.supabase_js.edge_imports).flat())].sort();
  const integrityUrls = Object.keys(contract.supabase_js.edge_import_integrity ?? {}).sort();
  requireEqual(errors, "Edge Supabase integrity URL set", exactJson(integrityUrls), exactJson(expectedEdgeUrls));
  for (const [specifier, integrity] of Object.entries(contract.supabase_js.edge_import_integrity ?? {})) {
    requireEqual(errors, `Deno lock integrity for ${specifier}`, denoLock.remote?.[specifier], integrity);
  }

  const dockerSelector = dockerfile.match(/^FROM\s+(\S+)/m)?.[1] ?? null;
  requireEqual(errors, "renderer Docker selector", dockerSelector, contract.node.renderer_docker_selector);
  requireEqual(errors, "canonical CI workflow hash", sha256(ci), contract.build_guard.ci_workflow_sha256);
  requireEqual(errors, "canonical CI workflow path", contract.build_guard.ci_workflow_path, ".github/workflows/ci.yml");
  const workflowFacts = workflowRuntimeFacts(ci, contract.node.ci_job, contract.node.ci_setup_node_action);
  if (!workflowFacts.found) errors.push("CI blocking runtime job is missing or duplicated");
  if (workflowFacts.workflowHasOverrides) errors.push("workflow-level defaults or env overrides are prohibited for the runtime gate");
  if (workflowFacts.workflowHasQuotedKeys) errors.push("quoted YAML mapping keys are prohibited in the runtime workflow");
  if (workflowFacts.workflowHasYamlIndirection) errors.push("YAML anchors, aliases, and merge keys are prohibited in the runtime workflow");
  requireEqual(errors, "CI runtime job runner", workflowFacts.runsOn, contract.node.ci_runs_on);
  if (!workflowFacts.blocking) errors.push("CI runtime job or one of its steps can be skipped or ignored");
  if (!workflowFacts.requiredPrefixMatches) errors.push("CI must begin with checkout, setup-node, npm ci, runtime check, and runtime tests in that exact order");
  if (workflowFacts.unsafeRequiredRun) errors.push("CI required runtime run steps must be bare commands without shell, directory, env, or other overrides");
  if (!workflowFacts.setupNodeActionFound) errors.push("CI setup-node action is missing or changed");
  if (!workflowFacts.setupBeforeRuns) errors.push("CI setup-node must execute before runtime run steps");
  requireEqual(errors, "CI Node selector", workflowFacts.nodeSelector, contract.node.ci_selector);
  const requiredStepIndexes = contract.node.ci_required_runs.map((command) => workflowFacts.runSteps.indexOf(command));
  if (requiredStepIndexes.some((index) => index < 0)) {
    errors.push("CI does not contain every exact runtime contract run step");
  } else if (requiredStepIndexes.some((index, position) => position > 0 && index <= requiredStepIndexes[position - 1])) {
    errors.push("CI runtime contract run steps are out of order");
  }
  requireEqual(errors, "Vercel build command", vercel.buildCommand, contract.vercel_config.buildCommand);
  requireEqual(errors, "Vercel install command", vercel.installCommand, contract.vercel_config.installCommand);
  requireEqual(errors, "Vercel output directory", vercel.outputDirectory, contract.vercel_config.outputDirectory);
  requireEqual(
    errors,
    "build contract wrapper hash",
    sha256(readFileSync(resolve(root, contract.build_guard.wrapper_path))),
    contract.build_guard.wrapper_sha256,
  );
  requireEqual(
    errors,
    "frontend environment checker hash",
    sha256(readFileSync(resolve(root, contract.build_guard.frontend_env_path))),
    contract.build_guard.frontend_env_sha256,
  );
  requireEqual(errors, "root build script", rootPackage.scripts?.build, "vite build");
  if (rootPackage.scripts?.prebuild !== "node scripts/check-build-contract.mjs") {
    errors.push("prebuild does not execute the combined runtime and frontend environment contract");
  }
  requireEqual(errors, "runtime check script", rootPackage.scripts?.["check:runtime-contract"], "node scripts/check-runtime-contract.mjs");
  requireEqual(errors, "runtime test script", rootPackage.scripts?.["test:runtime-contract"], "node --test scripts/check-runtime-contract.test.mjs");

  const expectedSelector = `${contract.node.deployment_major}.x`;
  requireEqual(errors, "deployment selector/major invariant", contract.node.deployment_selector, expectedSelector);
  requireEqual(errors, "root/deployment Node invariant", contract.node.root_engine, contract.node.deployment_selector);
  requireEqual(errors, "renderer/deployment Node invariant", contract.node.renderer_engine, contract.node.deployment_selector);
  requireEqual(errors, "CI/deployment Node invariant", contract.node.ci_selector, String(contract.node.deployment_major));
  if (!contract.node.renderer_docker_selector.startsWith(`node:${contract.node.deployment_major}-`)) {
    errors.push("renderer Docker selector does not match deployment Node major");
  }
  const packageManagerNpm = parseVersion(contract.node.root_package_manager.replace(/^npm@/, ""));
  if (packageManagerNpm?.[0] !== contract.node.npm_major || contract.node.root_npm_engine !== `${contract.node.npm_major}.x`) {
    errors.push("npm package-manager/engine/major invariant is inconsistent");
  }
  const minimum = parseVersion(contract.node.deployment_minimum);
  if (minimum?.[0] !== contract.node.deployment_major || !isVite8SupportedNode(contract.node.deployment_minimum)) {
    errors.push("deployment minimum is inconsistent with the selected major or Vite requirement");
  }

  if (!isVite8SupportedNode(actualNodeVersion)) {
    errors.push(`Node ${actualNodeVersion} is outside the Vite 8 supported range ${contract.node.vite_supported_range}`);
  }
  const actual = parseVersion(actualNodeVersion);
  if (requireDeploymentMajor && actual?.[0] !== contract.node.deployment_major) {
    errors.push(`deployment/CI Node major is ${actual?.[0] ?? "invalid"}, expected ${contract.node.deployment_major}`);
  }
  if (actualNpmVersion) {
    const npmMajor = parseVersion(actualNpmVersion)?.[0];
    if (npmMajor !== contract.node.npm_major) {
      errors.push(`npm major is ${npmMajor ?? "invalid"}, expected ${contract.node.npm_major}`);
    }
  }

  return { contract, errors, actualNodeVersion, actualNpmVersion };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = validateRuntimeContract({ requireDeploymentMajor: process.argv.includes("--require-deployment-major") || Boolean(process.env.CI || process.env.VERCEL) });
  if (result.errors.length) {
    console.error(`Runtime contract FAIL:\n- ${result.errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Runtime contract PASS: node ${result.actualNodeVersion}; npm ${result.actualNpmVersion ?? "not reported"}; deployment selector ${result.contract.node.deployment_selector}; root/renderer/Deno/Edge Supabase versions frozen with upgrade deferred.`);
}

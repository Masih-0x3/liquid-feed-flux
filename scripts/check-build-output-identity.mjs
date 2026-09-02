#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_PROJECT_REF } from "./preview-identity.mjs";

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const PROJECT_REF_URL_RE = /(?<![a-z0-9])([a-z0-9]{20})\.supabase\.co\b/g;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BUILD_TARGET_ENV_NAMES = Object.freeze([
  "XOT_BUILD_TARGET",
  "XOT_ENVIRONMENT",
  "APP_ENVIRONMENT",
  "ENVIRONMENT",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_DEPLOYMENT_TARGET",
]);

export const BUILD_TARGETS = Object.freeze({
  PREVIEW: "preview",
  PRODUCTION: "production",
});

function maskIdentifier(value) {
  if (!value) return "[missing]";
  return value.length < 8 ? "[masked]" : `${value.slice(0, 3)}…${value.slice(-3)}`;
}

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedTarget(value) {
  const target = valueOf(value).toLowerCase();
  if (target === "prod") return BUILD_TARGETS.PRODUCTION;
  return target;
}

/** Resolve one explicit build target from the supported deployment aliases. */
export function selectBuildTarget(env = process.env) {
  const values = BUILD_TARGET_ENV_NAMES
    .map((name) => normalizedTarget(env?.[name]))
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length === 0) {
    const expectedRefs = ["XOT_EXPECTED_PREVIEW_PROJECT_REF", "VITE_SUPABASE_PROJECT_ID"]
      .map((name) => valueOf(env?.[name]))
      .filter(Boolean);
    if (new Set(expectedRefs).size === 1
      && PROJECT_REF_RE.test(expectedRefs[0])
      && expectedRefs[0] !== PRODUCTION_SUPABASE_PROJECT_REF) {
      return BUILD_TARGETS.PREVIEW;
    }
    throw new Error("buildOutput: an explicit Preview or Production target is required");
  }
  if (unique.length > 1) {
    throw new Error("buildOutput: conflicting Preview and Production targets were supplied");
  }
  if (!Object.values(BUILD_TARGETS).includes(unique[0])) {
    throw new Error("buildOutput: the selected build target is invalid");
  }
  return unique[0];
}

/** Select one project-ref alias and bind it to the selected build target. */
export function selectExpectedProjectRef(env = process.env, target) {
  const selectedTarget = targetFromArgument(target);
  if (!Object.values(BUILD_TARGETS).includes(selectedTarget)) {
    throw new Error("buildOutput: an explicit Preview or Production target is required");
  }
  const values = ["XOT_EXPECTED_PREVIEW_PROJECT_REF", "VITE_SUPABASE_PROJECT_ID"]
    .map((name) => valueOf(env?.[name]))
    .filter(Boolean);
  if (new Set(values).size > 1) {
    throw new Error("buildOutput: conflicting expected Supabase project refs were supplied");
  }
  const selectedRef = values[0] || "";
  if (selectedTarget === BUILD_TARGETS.PREVIEW
    && (!PROJECT_REF_RE.test(selectedRef) || selectedRef === PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error("buildOutput: expected Preview project ref is missing or invalid");
  }
  if (selectedTarget === BUILD_TARGETS.PRODUCTION) {
    if (selectedRef && selectedRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new Error("buildOutput: expected Production project ref is invalid");
    }
    return PRODUCTION_SUPABASE_PROJECT_REF;
  }
  return selectedRef;
}

function projectRefsIn(bytes, knownRefs = []) {
  const text = bytes.toString("utf8");
  const refs = new Set();
  for (const match of text.matchAll(PROJECT_REF_URL_RE)) refs.add(match[1]);
  for (const ref of knownRefs) {
    if (!PROJECT_REF_RE.test(ref)) continue;
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text)) refs.add(ref);
  }
  return refs;
}

function targetFromArgument(value) {
  if (typeof value === "string") return normalizedTarget(value);
  if (value && typeof value === "object") {
    return normalizedTarget(value.target ?? value.mode ?? value.environment);
  }
  return "";
}

function filesUnder(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

/**
 * Check only a caller-selected output directory. There is intentionally no
 * implicit `dist` fallback: a stale local output must never be treated as a
 * fresh build artifact.
 */
export function validateBuildOutputIdentity(outputDir, expectedProjectRef, target) {
  const errors = [];
  const requestedDir = valueOf(outputDir);
  const expectedRef = valueOf(expectedProjectRef);
  const selectedTarget = targetFromArgument(target);

  if (!requestedDir) {
    errors.push("buildOutput: an explicit output directory is required");
    return { ok: false, errors, filesScanned: 0 };
  }
  const directory = resolve(requestedDir);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    errors.push("buildOutput: the specified output directory does not exist");
    return { ok: false, errors, filesScanned: 0 };
  }
  if (!Object.values(BUILD_TARGETS).includes(selectedTarget)) {
    errors.push("buildOutput: an explicit Preview or Production target is required");
  }
  if (selectedTarget === BUILD_TARGETS.PREVIEW
    && (!PROJECT_REF_RE.test(expectedRef) || expectedRef === PRODUCTION_SUPABASE_PROJECT_REF)) {
    errors.push("buildOutput: expected Preview project ref is missing or invalid");
  }
  if (selectedTarget === BUILD_TARGETS.PRODUCTION
    && expectedRef && expectedRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push("buildOutput: expected Production project ref is invalid");
  }

  let files;
  try {
    files = filesUnder(directory);
  } catch {
    errors.push("buildOutput: output directory could not be inspected");
    return { ok: false, errors, filesScanned: 0 };
  }
  if (files.length === 0) errors.push("buildOutput: output directory is empty");

  const observedRefs = new Set();
  for (const file of files) {
    let bytes;
    try {
      const stat = lstatSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        errors.push("buildOutput: an output file exceeds the inspection limit");
        continue;
      }
      bytes = readFileSync(file);
    } catch {
      errors.push("buildOutput: an output file could not be inspected");
      continue;
    }
    for (const ref of projectRefsIn(bytes, [expectedRef, PRODUCTION_SUPABASE_PROJECT_REF])) observedRefs.add(ref);
  }

  if (selectedTarget === BUILD_TARGETS.PREVIEW) {
    const expectedFound = observedRefs.has(expectedRef);
    if (observedRefs.has(PRODUCTION_SUPABASE_PROJECT_REF)) {
      errors.push("buildOutput: production project identity found in Preview output");
    }
    if ([...observedRefs].some((ref) => ref !== expectedRef)) {
      errors.push("buildOutput: an unexpected Supabase project identity was found in Preview output");
    }
    if (PROJECT_REF_RE.test(expectedRef) && expectedRef !== PRODUCTION_SUPABASE_PROJECT_REF && !expectedFound) {
      errors.push("buildOutput: expected Preview project identity was not found in output");
    }
  } else if (selectedTarget === BUILD_TARGETS.PRODUCTION) {
    if (!observedRefs.has(PRODUCTION_SUPABASE_PROJECT_REF)) {
      errors.push("buildOutput: production project identity was not found in output");
    }
    if ([...observedRefs].some((ref) => ref !== PRODUCTION_SUPABASE_PROJECT_REF)) {
      errors.push("buildOutput: a non-production Supabase project identity was found in Production output");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    filesScanned: files.length,
    directory: isAbsolute(requestedDir) ? requestedDir : relative(process.cwd(), directory) || ".",
    target: selectedTarget || "[missing]",
    expectedProject: maskIdentifier(selectedTarget === BUILD_TARGETS.PRODUCTION
      ? PRODUCTION_SUPABASE_PROJECT_REF
      : expectedRef),
  };
}

function parseOutputDir(argv) {
  const index = argv.indexOf("--output-dir");
  if (index === -1) return valueOf(process.env.XOT_BUILD_OUTPUT_DIR);
  return valueOf(argv[index + 1]);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const outputDir = parseOutputDir(process.argv.slice(2));
  if (!outputDir) {
    console.log("BUILD_OUTPUT_IDENTITY_SKIPPED reason=no_explicit_output_dir");
    process.exit(0);
  }
  let target;
  try {
    target = selectBuildTarget(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "buildOutput: invalid build target");
    process.exit(1);
  }
  let expectedProjectRef;
  try {
    expectedProjectRef = selectExpectedProjectRef(process.env, target);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "buildOutput: invalid expected project ref");
    process.exit(1);
  }
  const result = validateBuildOutputIdentity(outputDir, expectedProjectRef, target);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(`BUILD_OUTPUT_IDENTITY_PASS files=${result.filesScanned} expectedProject=${result.expectedProject}`);
}

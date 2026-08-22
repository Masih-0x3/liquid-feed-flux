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
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const PRODUCTION_REF_BYTES = Buffer.from(PRODUCTION_SUPABASE_PROJECT_REF, "utf8");

function maskIdentifier(value) {
  if (!value) return "[missing]";
  return value.length < 8 ? "[masked]" : `${value.slice(0, 3)}…${value.slice(-3)}`;
}

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
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
export function validateBuildOutputIdentity(outputDir, expectedProjectRef) {
  const errors = [];
  const requestedDir = valueOf(outputDir);
  const expectedRef = valueOf(expectedProjectRef);

  if (!requestedDir) {
    errors.push("buildOutput: an explicit output directory is required");
    return { ok: false, errors, filesScanned: 0 };
  }
  const directory = resolve(requestedDir);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    errors.push("buildOutput: the specified output directory does not exist");
    return { ok: false, errors, filesScanned: 0 };
  }
  if (!PROJECT_REF_RE.test(expectedRef) || expectedRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push("buildOutput: expected Preview project ref is missing or invalid");
  }

  let files;
  try {
    files = filesUnder(directory);
  } catch {
    errors.push("buildOutput: output directory could not be inspected");
    return { ok: false, errors, filesScanned: 0 };
  }
  if (files.length === 0) errors.push("buildOutput: output directory is empty");

  let expectedFound = false;
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
    if (bytes.includes(PRODUCTION_REF_BYTES)) {
      errors.push("buildOutput: production project identity found in output");
    }
    if (PROJECT_REF_RE.test(expectedRef) && bytes.includes(Buffer.from(expectedRef, "utf8"))) {
      expectedFound = true;
    }
  }
  if (PROJECT_REF_RE.test(expectedRef) && expectedRef !== PRODUCTION_SUPABASE_PROJECT_REF && !expectedFound) {
    errors.push("buildOutput: expected Preview project identity was not found in output");
  }

  return {
    ok: errors.length === 0,
    errors,
    filesScanned: files.length,
    directory: isAbsolute(requestedDir) ? requestedDir : relative(process.cwd(), directory) || ".",
    expectedProject: maskIdentifier(expectedRef),
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
  const expectedProjectRef = valueOf(process.env.XOT_EXPECTED_PREVIEW_PROJECT_REF)
    || valueOf(process.env.VITE_SUPABASE_PROJECT_ID);
  const result = validateBuildOutputIdentity(outputDir, expectedProjectRef);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(`BUILD_OUTPUT_IDENTITY_PASS files=${result.filesScanned} expectedProject=${result.expectedProject}`);
}

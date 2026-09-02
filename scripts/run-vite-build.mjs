#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  selectBuildTarget,
  selectExpectedProjectRef,
  validateBuildOutputIdentity,
} from "./check-build-output-identity.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUTPUT_DIR = "dist";

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function displayPath(path, cwd) {
  return relative(cwd, path) || ".";
}

export function parseOutputDirArgs(argv) {
  if (argv.length > 0) {
    throw new Error("the canonical build wrapper does not accept CLI arguments; set XOT_BUILD_OUTPUT_DIR instead");
  }
  return { passthrough: [] };
}

export function selectBuildOutput(argv, env = process.env, cwd = process.cwd()) {
  parseOutputDirArgs(argv);
  const configuredOutput = valueOf(env.XOT_BUILD_OUTPUT_DIR);
  const selectedValue = configuredOutput || DEFAULT_OUTPUT_DIR;
  const selectedPath = resolve(cwd, selectedValue);

  return {
    outputDir: selectedPath,
    outputDirValue: selectedValue,
    viteArgs: ["build", "--outDir", selectedValue, "--emptyOutDir"],
  };
}

export function runBuild({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = REPO_ROOT,
  execute = execFileSync,
  validate = validateBuildOutputIdentity,
} = {}) {
  let selection;
  let buildTarget;
  let expectedProjectRef;
  try {
    selection = selectBuildOutput(argv, env, cwd);
    buildTarget = selectBuildTarget(env);
    expectedProjectRef = selectExpectedProjectRef(env, buildTarget);
    selection = { ...selection, buildTarget };
  } catch (error) {
    throw new Error(`BUILD_OUTPUT_IDENTITY_CONFIG_FAIL ${error instanceof Error ? error.message : "invalid build configuration"}`);
  }

  const viteName = process.platform === "win32" ? "vite.cmd" : "vite";
  const vitePath = join(cwd, "node_modules", ".bin", viteName);
  if (!existsSync(vitePath)) {
    throw new Error("BUILD_OUTPUT_IDENTITY_CONFIG_FAIL local Vite executable is missing");
  }

  execute(vitePath, selection.viteArgs, {
    cwd,
    env: { ...env, XOT_BUILD_OUTPUT_DIR: selection.outputDirValue },
    stdio: "inherit",
  });

  const result = validate(selection.outputDir, expectedProjectRef, buildTarget);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
  return { selection, result };
}

function run() {
  try {
    const { selection, result } = runBuild();
    console.log(`BUILD_OUTPUT_IDENTITY_PASS files=${result.filesScanned} output=${displayPath(selection.outputDir, REPO_ROOT)} expectedProject=${result.expectedProject}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "build failed");
    process.exitCode = error?.status || 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) run();

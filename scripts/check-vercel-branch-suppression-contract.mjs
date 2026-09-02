#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SUPPRESSED_BRANCHES = Object.freeze([
  "codex/xot-full-closure-candidate",
  "codex/video-render-workspace-redesign",
]);
export const SUCCESSOR_BRANCH = SUPPRESSED_BRANCHES[0];

export function validateVercelBranchSuppression({ root = REPO_ROOT } = {}) {
  const errors = [];
  const path = join(root, "vercel.json");
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`Vercel config must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { errors };
  }

  const deploymentEnabled = config?.git?.deploymentEnabled;
  if (!deploymentEnabled || typeof deploymentEnabled !== "object" || Array.isArray(deploymentEnabled)) {
    errors.push("Vercel git.deploymentEnabled branch map is required");
    return { errors };
  }
  for (const branch of SUPPRESSED_BRANCHES) {
    if (deploymentEnabled[branch] !== false) {
      errors.push(`Vercel suppressed branch ${branch} must be explicitly disabled`);
    }
  }
  for (const [branch, enabled] of Object.entries(deploymentEnabled)) {
    if (!SUPPRESSED_BRANCHES.includes(branch) && enabled === true && branch.includes("*")) {
      errors.push("Vercel suppression map must not enable a wildcard that can override a suppressed branch");
    }
  }
  return { errors };
}

const result = validateVercelBranchSuppression();
if (result.errors.length > 0) {
  for (const error of result.errors) console.error(`Vercel branch suppression contract: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Vercel branch suppression contract PASS: ${SUPPRESSED_BRANCHES.map((branch) => `${branch}=false`).join(", ")}`);
}

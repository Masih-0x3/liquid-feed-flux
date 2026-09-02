import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REPO_ROOT, SUCCESSOR_BRANCH, validateVercelBranchSuppression } from "./check-vercel-branch-suppression-contract.mjs";

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-vercel-branch-suppression-"));
  try {
    cpSync(join(REPO_ROOT, "vercel.json"), join(root, "vercel.json"));
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the named successor branch is explicitly deployment-disabled", () => {
  const result = validateVercelBranchSuppression();
  assert.deepEqual(result.errors, []);
});

test("enabling the successor branch fails closed", () => withFixture((root) => {
  const path = join(root, "vercel.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.git.deploymentEnabled[SUCCESSOR_BRANCH] = true;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  assert.ok(validateVercelBranchSuppression({ root }).errors.some((error) => error.includes("must be explicitly disabled")));
}));

test("renaming the required branch fails closed", () => withFixture((root) => {
  const path = join(root, "vercel.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  delete config.git.deploymentEnabled[SUCCESSOR_BRANCH];
  config.git.deploymentEnabled["codex/other-candidate"] = false;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  assert.ok(validateVercelBranchSuppression({ root }).errors.some((error) => error.includes("must be explicitly disabled")));
}));

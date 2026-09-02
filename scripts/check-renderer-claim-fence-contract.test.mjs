import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkerPath = join(repoRoot, "scripts/check-renderer-claim-fence-contract.mjs");

function runChecker(extraEnv = {}) {
  return spawnSync(process.execPath, [checkerPath], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 120_000,
  });
}

test("B4 renderer claim-fence source contract passes", () => {
  const run = runChecker();
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /RENDERER_CLAIM_FENCE_CONTRACT_PASS/);
});

test("B4 renderer claim-fence mutations fail closed", () => {
  const run = runChecker({ MUTATION_TEST: "1" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /selfTest=pass/);
});

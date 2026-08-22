import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkerPath = join(repoRoot, "scripts/check-digest-checkpoint-contract.mjs");

function runChecker(extraEnv = {}) {
  return spawnSync(process.execPath, [checkerPath], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 120000,
  });
}

test("B3b2 digest checkpoint source contract passes", () => {
  const run = runChecker();
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /DIGEST_CHECKPOINT_CONTRACT_PASS/);
});

test("B3b2 digest checkpoint mutations fail closed", () => {
  const run = runChecker({ MUTATION_TEST: "1" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /selfTest=pass/);
});

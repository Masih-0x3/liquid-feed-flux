import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const checker = join(root, "scripts/check-e7-disposable-boundary-contract.mjs");

function runChecker(extraEnv = {}) {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("E7 source contract passes on the committed tree", () => {
  const result = runChecker();
  assert.equal(result.status, 0, `normal checker failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /E7_DISPOSABLE_SOURCE_CONTRACT_PASS/);
});

test("E7 source contract rejects the mutation battery", () => {
  const result = runChecker({ MUTATION_TEST: "1" });
  assert.equal(result.status, 0, `mutation checker failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /E7_DISPOSABLE_SOURCE_CONTRACT_PASS selfTest=pass/);
});

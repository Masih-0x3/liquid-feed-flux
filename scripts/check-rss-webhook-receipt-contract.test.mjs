// B3b1 (AIR-003): test runner for the durable RSS webhook receipt contract.
//
// The contract checker (check-rss-webhook-receipt-contract.mjs) validates the
// deterministic-material receipt key semantics, the durable claim lease, and the
// INV-3 HTTP-200 gating directly against the committed source. This runner executes
// it twice as a subprocess:
//   1. normal mode   - asserts the whole contract passes on the committed tree.
//   2. MUTATION_TEST - asserts every adversarial mutation fails-closed (each mutated
//      source is rejected), proving the assertions are load-bearing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkerPath = join(repoRoot, "scripts/check-rss-webhook-receipt-contract.mjs");

function runChecker(extraEnv = {}) {
  const result = spawnSync(process.execPath, [checkerPath], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 120000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("the B3b1 source receipt contract passes on the committed tree", () => {
  const run = runChecker();
  assert.equal(run.status, 0, `checker must exit 0 in normal mode\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.match(run.stdout, /RSS_WEBHOOK_RECEIPT_SOURCE_CONTRACT_PASS/, "checker must emit its PASS marker");
});

test("the B3b1 contract fails-closed under every mutation", () => {
  const run = runChecker({ MUTATION_TEST: "1" });
  assert.equal(run.status, 0, `checker must exit 0 in mutation mode\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.match(run.stdout, /selfTest=pass/, "checker must run the mutation battery to completion");
});

function test(name, fn) {
  // Minimal harness-compatible runner: run immediately; failures throw upward so the
  // npm --test process surfaces them with the checker's own messages.
  try {
    fn();
    process.stdout.write(`ok ${name}\n`);
  } catch (error) {
    process.stdout.write(`not ok ${name}\n`);
    process.stdout.write(`  ${String(error && error.stack ? error.stack : error)}\n`);
    process.exitCode = 1;
  }
}
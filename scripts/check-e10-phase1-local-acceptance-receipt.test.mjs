import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EVIDENCE_PATHS,
  RECEIPT_PATH,
  SUCCESSOR_RECEIPT_PATH,
  REPO_ROOT,
  validatePhase1SuccessorReceipt,
  validatePhase1Receipt,
} from "./check-e10-phase1-local-acceptance-receipt.mjs";

function readReceipt() {
  return JSON.parse(readFileSync(join(REPO_ROOT, SUCCESSOR_RECEIPT_PATH), "utf8"));
}

test("E10 Phase 1 successor receipt validates exact local acceptance", () => {
  assert.equal(validatePhase1SuccessorReceipt(readReceipt()), true);
});

test("receipt rejects status downgrade or promotion beyond local", () => {
  for (const status of ["PARTIAL_BLOCKED", "ACCEPTED_PRODUCTION", "RELEASED", "PASS"]) {
    const receipt = readReceipt();
    receipt.status = status;
    assert.throws(() => validatePhase1SuccessorReceipt(receipt), /ACCEPTED_LOCAL_PHASE1/);
  }
});

test("receipt rejects a Phase 1 task that is not locally accepted", () => {
  const receipt = readReceipt();
  receipt.phase1Tasks[0].status = "PASS";
  assert.throws(() => validatePhase1SuccessorReceipt(receipt), /must be local-only accepted/);
});

test("receipt rejects wrong Deno version, counts, skipped tests, and lock hash", () => {
  const mutations = [
    (receipt) => { receipt.validation.denoFunctionChecks.version = "2.1.14"; },
    (receipt) => { receipt.validation.denoFunctionChecks.lint.files = 152; },
    (receipt) => { receipt.validation.denoFunctionChecks.check.entrypoints = 9; },
    (receipt) => { receipt.validation.denoFunctionChecks.typedTests.skipped = 1; },
    (receipt) => { receipt.evidence["deno.lock"] = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const receipt = readReceipt();
    mutate(receipt);
    assert.throws(() => validatePhase1SuccessorReceipt(receipt));
  }
});

test("receipt rejects skipped or unrun function tests", () => {
  const receipt = readReceipt();
  receipt.validation.denoFunctionChecks.testsRun = false;
  assert.throws(() => validatePhase1SuccessorReceipt(receipt), /true/);
  const second = readReceipt();
  second.validation.denoFunctionChecks.denoTestsClaimed = false;
  assert.throws(() => validatePhase1SuccessorReceipt(second), /true/);
});

test("receipt rejects nonempty blockers", () => {
  const receipt = readReceipt();
  receipt.blockers = ["new blocker"];
  assert.throws(() => validatePhase1SuccessorReceipt(receipt), /deep-equal/);
});

test("receipt rejects browser claim inflation", () => {
  const receipt = readReceipt();
  receipt.validation.authenticatedBrowserUi = { status: "PASS", authenticated: true };
  assert.throws(() => validatePhase1SuccessorReceipt(receipt), /browser acceptance/);
  const second = readReceipt();
  second.validation.phase6AuthenticatedBrowserAcceptance.status = "PASS";
  assert.throws(() => validatePhase1SuccessorReceipt(second), /deep-equal/);
});

test("receipt rejects Phase 2 authorization and release opening", () => {
  const receipt = readReceipt();
  receipt.phase2Authorization = "AUTHORIZED";
  assert.throws(() => validatePhase1SuccessorReceipt(receipt), /UNAUTHORIZED_BY_E9_V4/);
  const second = readReceipt();
  second.release = "OPEN";
  assert.throws(() => validatePhase1SuccessorReceipt(second), /CLOSED/);
});

test("receipt rejects evidence omission, additions, and hash drift", () => {
  const dropped = readReceipt();
  delete dropped.evidence["package.json"];
  assert.throws(() => validatePhase1SuccessorReceipt(dropped), /deep-equal/);
  const added = readReceipt();
  added.evidence["README.md"] = "0".repeat(64);
  assert.throws(() => validatePhase1SuccessorReceipt(added), /deep-equal/);
  const changed = readReceipt();
  changed.evidence[EVIDENCE_PATHS[0]] = "0".repeat(64);
  assert.throws(() => validatePhase1SuccessorReceipt(changed), /expected hash drifted/);
});

test("E10 Phase 1 predecessor remains byte-stable and successor is readable", () => {
  const first = readFileSync(join(REPO_ROOT, RECEIPT_PATH));
  const second = readFileSync(join(REPO_ROOT, RECEIPT_PATH));
  assert.deepEqual(second, first);
  assert.ok(readFileSync(join(REPO_ROOT, SUCCESSOR_RECEIPT_PATH)).length > 0);
});

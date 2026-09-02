import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RECEIPT_PATH } from "./build-e10-phase2-preview-safety-acceptance-receipt.mjs";
import { REPO_ROOT, validatePhase2Receipt } from "./check-e10-phase2-preview-safety-acceptance-receipt.mjs";

const readReceipt = () => JSON.parse(readFileSync(join(REPO_ROOT, RECEIPT_PATH), "utf8"));
const expectReject = (mutate, pattern = /Expected|must|Phase 2|drifted|REJECTED|CLOSED|false|authority/i) => {
  const receipt = readReceipt();
  mutate(receipt);
  assert.throws(() => validatePhase2Receipt(receipt, { verifyGit: false }), pattern);
};

test("E10 Phase 2 receipt validates exact Preview preparation acceptance", () => {
  assert.equal(validatePhase2Receipt(readReceipt()), true);
});

test("receipt rejects false deployed/staging/browser/pushed/live claims", () => {
  for (const field of ["deployed", "staging", "browserAcceptance", "pushed", "live"]) expectReject((receipt) => { receipt.claims[field] = true; });
});

test("receipt requires the incident disclosure and rejected evidence", () => {
  expectReject((receipt) => { delete receipt.validation.incident; });
  expectReject((receipt) => { receipt.validation.incident.evidenceStatus = "ACCEPTED"; });
  expectReject((receipt) => { receipt.validation.incident.phaseWideZeroExternalContactClaim = true; });
});

test("receipt rejects release reopening, wrong identity, and hash drift", () => {
  expectReject((receipt) => { receipt.release = "OPEN"; });
  expectReject((receipt) => { receipt.head = "deadbeef"; });
  expectReject((receipt) => { receipt.evidence["package.json"].sha256 = "0".repeat(64); });
});

test("receipt rejects build, role, posting, and pause-control inflation", () => {
  expectReject((receipt) => { receipt.validation.npmBuild.productionRefPresentCount = 1; });
  expectReject((receipt) => { receipt.validation.npmBuild.existingDistUnchanged = false; });
  expectReject((receipt) => { receipt.controls.roles = ["admin", "viewer"]; });
  expectReject((receipt) => { receipt.controls.posting.state = "enabled"; });
  expectReject((receipt) => { receipt.controls.translation.initialState = "enabled"; });
  expectReject((receipt) => { receipt.controls.dedupe.readOnlyToggle = true; });
});

test("receipt rejects fake Phase 3 authorization", () => {
  expectReject((receipt) => { receipt.nextPhase.authorization = "AUTHORIZED"; });
});

test("builder is deterministic and leaves a trailing newline", () => {
  const before = readFileSync(join(REPO_ROOT, RECEIPT_PATH));
  execFileSync(process.execPath, [join(REPO_ROOT, "scripts/build-e10-phase2-preview-safety-acceptance-receipt.mjs")], { cwd: REPO_ROOT, stdio: "ignore" });
  const first = readFileSync(join(REPO_ROOT, RECEIPT_PATH));
  execFileSync(process.execPath, [join(REPO_ROOT, "scripts/build-e10-phase2-preview-safety-acceptance-receipt.mjs")], { cwd: REPO_ROOT, stdio: "ignore" });
  const second = readFileSync(join(REPO_ROOT, RECEIPT_PATH));
  assert.deepEqual(first, second);
  assert.equal(second.at(-1), 0x0a);
  assert.deepEqual(before, first);
});

test("receipt JSON is parseable from an isolated copy", () => {
  const temp = mkdtempSync(join(tmpdir(), "xot-e10-p2-receipt-"));
  try {
    const path = join(temp, "receipt.json");
    writeFileSync(path, readFileSync(join(REPO_ROOT, RECEIPT_PATH)));
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, "utf8")));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

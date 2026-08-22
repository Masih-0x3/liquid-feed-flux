#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRANCH, EVIDENCE_PATHS, HEAD, RECEIPT_PATH } from "./build-e10-phase2-preview-safety-acceptance-receipt.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileEvidence = (path) => {
  const value = readFileSync(join(REPO_ROOT, path));
  return { sha256: sha256(value), bytes: value.byteLength };
};
const currentIdentity = () => ({
  branch: execFileSync("git", ["-C", REPO_ROOT, "branch", "--show-current"], { encoding: "utf8" }).trim(),
  head: execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
});

// This record is predecessor-bound. Validate its fixed identity and evidence,
// but do not require the live worktree to remain at the historical HEAD.
export function validatePhase2Receipt(receipt, { root = REPO_ROOT, verifyGit = false } = {}) {
  assert.equal(receipt?.schema, "xot-e10-phase2-preview-safety-acceptance-receipt-v1");
  assert.equal(receipt?.event, "e10_phase2_preview_safety_acceptance_accepted");
  assert.equal(receipt?.phase, "e10-phase2-preview-preparation");
  assert.equal(receipt?.status, "ACCEPTED_PREVIEW_PREPARATION_T1");
  assert.equal(receipt?.release, "CLOSED");
  assert.equal(receipt?.releaseGate, "CLOSED");
  assert.equal(receipt?.repository, ".");
  assert.equal(receipt?.branch, BRANCH);
  assert.equal(receipt?.head, HEAD);
  if (verifyGit) assert.deepEqual(currentIdentity(), { branch: BRANCH, head: HEAD });

  for (const field of ["localDisposableLaneOnly", "noPersistentLocalFullStack", "sourceConfigRunbookChangesOnly", "noPush", "noCommit", "noDeploy", "noCloudMutation", "noStagingMutation", "noProviderWrite", "noProductionContact", "noBrowserContact", "stagedIndexEmpty"]) {
    assert.equal(receipt.scope?.[field], true, `scope.${field} must remain true`);
  }
  assert.equal(receipt.scope?.noExternalContactClaim, false, "Phase 2 must disclose that it cannot claim zero external contact");

  assert.deepEqual(receipt.topology, {
    local: "disposable repository editing and deterministic validation only",
    preview: "one complete protected hosted Preview/staging plane in later phases",
    production: "untouched; separately gated",
  });
  assert.deepEqual(receipt.phase2Tasks.map((task) => task.id), ["P2-01", "P2-02", "P2-03", "P2-04"]);
  for (const task of receipt.phase2Tasks) {
    assert.equal(task.status, "ACCEPTED_LOCAL");
    assert.ok(Array.isArray(task.evidence) && task.evidence.length > 0);
    for (const path of task.evidence) assert.ok(EVIDENCE_PATHS.includes(path), `${task.id} has unbound evidence ${path}`);
  }

  assert.deepEqual(receipt.controls.roles, ["admin", "read_only"]);
  assert.equal(receipt.controls.exactlyOneRolePerUser, true);
  assert.deepEqual(receipt.controls.posting, { state: "hard_blocked", dashboardToggle: false, databaseOverride: false, environmentBreaker: false });
  assert.deepEqual(receipt.controls.translation, { initialState: "paused", adminToggleable: true, readOnlyToggle: false });
  assert.deepEqual(receipt.controls.dedupe, { initialState: "paused", adminToggleable: true, readOnlyToggle: false });

  assert.equal(receipt.validation?.focusedGuardTests?.status, "PASS");
  assert.equal(receipt.validation?.denoFunctionChecks?.passed, 444);
  assert.equal(receipt.validation?.frontendTests?.files, 32);
  assert.equal(receipt.validation?.frontendTests?.tests, 202);
  assert.equal(receipt.validation?.rendererTests?.tests, 202);
  assert.deepEqual(receipt.validation?.lint, { status: "PASS", errors: 0, warnings: 10 });
  assert.deepEqual(receipt.validation?.strictTypecheck, { status: "PASS" });
  assert.deepEqual(receipt.validation?.npmBuild, { status: "PASS", mode: "official-isolated", distFiles: 82, totalBytes: 1969568, previewRefPresentCount: 4, productionRefPresentCount: 0, existingDistUnchanged: true });
  assert.deepEqual(receipt.validation?.adversarialFinal, { status: "PASS", decision: "ACCEPT", p0: 0, p1: 0, p2: 0 });

  const incident = receipt.validation?.incident;
  assert.equal(incident?.evidenceStatus, "REJECTED");
  assert.equal(incident?.command, "scripts/check-release-state.sh --target preview --mode execute");
  assert.deepEqual(incident?.attemptedReadOnlyCommands, ["gh", "curl", "npx supabase functions list"]);
  assert.equal(incident?.mutationOccurred, false);
  assert.equal(incident?.resolution, "RESOLVED_NO_MUTATION");
  assert.equal(incident?.phaseWideZeroExternalContactClaim, false);
  assert.equal(incident?.laterCleanValidation, "used no external commands");

  for (const field of ["committed", "pushed", "deployed", "staging", "browserAcceptance", "live", "production"]) assert.equal(receipt.claims?.[field], false, `claims.${field} must remain false`);
  assert.deepEqual(receipt.nextPhase, { id: "E10-P3", name: "isolated Supabase staging", status: "NOT_STARTED", authorization: "REQUIRES_EXPLICIT_EXTERNAL_PROVISIONING_AUTHORITY" });
  assert.ok(receipt.blockers.includes("Phase 3 requires explicit external provisioning authority for isolated Supabase staging"));
  assert.ok(Array.isArray(receipt.excludedClaims) && receipt.excludedClaims.includes("staging"));

  assert.deepEqual(Object.keys(receipt.evidence ?? {}).sort(), [...EVIDENCE_PATHS].sort());
  for (const path of EVIDENCE_PATHS) {
    assert.ok(statSync(join(root, path), { throwIfNoEntry: false }), `missing evidence file ${path}`);
    assert.deepEqual(receipt.evidence[path], fileEvidenceFrom(root, path), `${path} hash/size drifted`);
  }
  return true;
}

function fileEvidenceFrom(root, path) {
  const value = readFileSync(join(root, path));
  return { sha256: sha256(value), bytes: value.byteLength };
}

const isMain = resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    validatePhase2Receipt(JSON.parse(readFileSync(join(REPO_ROOT, RECEIPT_PATH), "utf8")), { verifyGit: false });
    console.log("E10_PHASE2_PREVIEW_SAFETY_RECEIPT_CHECK_PASS status=ACCEPTED_PREVIEW_PREPARATION_T1");
  } catch (error) {
    console.error(`E10_PHASE2_PREVIEW_SAFETY_RECEIPT_CHECK_FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

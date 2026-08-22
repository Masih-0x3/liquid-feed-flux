import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RECEIPT_PATH = "docs/plans/2026-08-12-xot-e10-phase1-local-acceptance.json";
export const SUCCESSOR_RECEIPT_PATH = "docs/plans/2026-08-22-xot-e10-phase1-local-acceptance-successor.json";
export const BRANCH = "codex/xot-remediation-convergence";
export const HEAD = "0bd578856016c06a10890339f93aa13b82ecae48";
export const SQL_RECEIPT_PATH = "docs/plans/2026-08-12-xot-e10-disposable-sql-runtime-acceptance.json";
export const EVIDENCE_PATHS = Object.freeze([
  "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql",
  "supabase/functions/_shared/appRole.ts",
  "supabase/functions/_shared/runtimeControls.ts",
  "supabase/functions/_shared/e10PreviewParityFoundation.test.ts",
  "supabase/functions/admin-actions/adminAccessPolicy.test.ts",
  "supabase/functions/admin-actions/runtimeControlsRoute.test.ts",
  "src/api/runtimeControls.ts",
  "src/test/runtime-controls-api.test.ts",
  "src/test/runtime-controls.test.tsx",
  "src/components/settings/RuntimeControlsPanel.tsx",
  "scripts/check-admin-role-auth-contract.mjs",
  "scripts/e10SqlBoundary.mjs",
  "scripts/e10SqlBoundary.test.mjs",
  "scripts/run-e10-sql-boundary.mjs",
  SQL_RECEIPT_PATH,
  "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json",
  "package.json",
  "package-lock.json",
  "deno.lock",
]);
export const EXPECTED_EVIDENCE_HASHES = Object.freeze({
  "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql": "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7",
  "supabase/functions/_shared/appRole.ts": "1d966b8d5cbe9c5fdbb20bc231046fcf049d200534366b49306c9296542628d8",
  "supabase/functions/_shared/runtimeControls.ts": "55a984a590daee7c7a66b337c7b418db2214ab1bda3009d7336c284fa4aea072",
  "supabase/functions/_shared/e10PreviewParityFoundation.test.ts": "eb51d9eb0e1eab93badbb04b80009870d8e9bb1eaf0cf2f4702af339f0503747",
  "supabase/functions/admin-actions/adminAccessPolicy.test.ts": "36bb5ea46eaf87f5734e0841fc3420688f2f790388fc31b2676f12a65b2957ea",
  "supabase/functions/admin-actions/runtimeControlsRoute.test.ts": "a14f5e45f605c3889dddf594e9909f6dc80bc5a3de5c428bc0d48af6a59a577c",
  "src/api/runtimeControls.ts": "6d652a6823dd6ab3922800f6fda678d218655b928e58b181992b4d5616530b8f",
  "src/test/runtime-controls-api.test.ts": "25fe5268ad86b86ac1dabb917098ce374fc7fb3d2705dd10a8812e5e69d258da",
  "src/test/runtime-controls.test.tsx": "88ff4f59d4bbb2fb231be43b2fcbf1692aa3e46027d5e97e19d6062cfd6cad3d",
  "src/components/settings/RuntimeControlsPanel.tsx": "d693402582b2d19cf139f8bb70c897b325360aba174c8c0e74db8d0855256470",
  "scripts/check-admin-role-auth-contract.mjs": "bc404e06eb36a832a51d6b1d2f8a785998ff54162e366a91692c7be0570c4769",
  "scripts/e10SqlBoundary.mjs": "669e6b02e5e8a2f09f10cfe886b0a135bbe17fc84cd7f216612cb401fd9be550",
  "scripts/e10SqlBoundary.test.mjs": "392a0cd6871175cdf8331cae86bc7f3b94c1a79ec2b674468cff9c113175c322",
  "scripts/run-e10-sql-boundary.mjs": "da27f50d0ec8e98ea2a841b86e9d1e469bfea88fa6e0562ac6d287e992bcc71d",
  [SQL_RECEIPT_PATH]: "6504e08a814d93b02dfbfdf3b40a1227800261d4b4490590e92394d5373dd34d",
  "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json": "f78dea0fc6b827bc051f64a351e8d6646964af33d00ab30801771db86f6b69bf",
  "package.json": "73a0784dfa9016d8e441316f0e40c1e53e4d0ca2223515a11e152ce26e984f71",
  "package-lock.json": "e789f19d394fc7f26958b4e04ceb72e617f2b0fbd260ba874ec1a8eff8837ccf",
  "deno.lock": "3758b544b86276d58f2bdef9f2b77b4744e2e480bfe2a3fc729d907c801851c0",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(root, relativePath) {
  return sha256(readFileSync(join(root, relativePath)));
}

function currentIdentity(root) {
  return {
    branch: execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim(),
    head: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  };
}

export function validatePhase1Receipt(receipt, { root = REPO_ROOT, verifyGit = true, expectedEvidenceHashes = EXPECTED_EVIDENCE_HASHES } = {}) {
  assert.equal(receipt?.schema, "xot-e10-phase1-local-acceptance-receipt-v1");
  assert.equal(receipt?.event, "e10_phase1_local_acceptance_accepted");
  assert.equal(receipt?.phase, "e10-phase1-local-only");
  assert.equal(receipt?.status, "ACCEPTED_LOCAL_PHASE1");
  assert.equal(receipt?.release, "CLOSED");
  assert.equal(receipt?.releaseGate, "CLOSED");
  assert.equal(receipt?.phase2Authorization, "UNAUTHORIZED_BY_E9_V4");
  assert.equal(receipt?.repository, ".");
  assert.equal(receipt?.branch, BRANCH);
  assert.equal(receipt?.head, HEAD);
  if (verifyGit) assert.deepEqual(currentIdentity(root), { branch: BRANCH, head: HEAD });

  for (const field of [
    "localOnly", "noPush", "noDeploy", "noCloudMutation", "noProviderContact",
    "noProductionContact", "noStagingContact", "noBrowserContact", "noExternalContact",
  ]) assert.equal(receipt.scope?.[field], true, `scope.${field} must remain true`);

  assert.equal(receipt.phase1Tasks?.length, 9);
  assert.deepEqual(receipt.phase1Tasks.map((task) => task.id), ["P1-01", "P1-02", "P1-03", "P1-04", "P1-05", "P1-06", "P1-07", "P1-08", "P1-09"]);
  for (const task of receipt.phase1Tasks) {
    assert.equal(task.status, "ACCEPTED_LOCAL", `${task.id} must be local-only accepted`);
    assert.ok(Array.isArray(task.evidence) && task.evidence.length > 0, `${task.id} needs evidence`);
    for (const path of task.evidence) assert.ok(EVIDENCE_PATHS.includes(path), `${task.id} has unbound evidence`);
  }

  assert.deepEqual(receipt.validation?.npmTest, { status: "PASS", files: 31, tests: 198, command: "npm test" });
  assert.deepEqual(receipt.validation?.strictTypecheck, { status: "PASS", command: "npm run check:strict" });
  assert.deepEqual(receipt.validation?.lint, { status: "PASS", warnings: 10, errors: 0, command: "npm run lint" });
  assert.deepEqual(receipt.validation?.rendererTests, { status: "PASS", tests: 202, command: "npm --prefix services/video-renderer test" });
  assert.deepEqual(receipt.validation?.syntheticEnvironmentBuild, { status: "PASS", modules: 2504, distFiles: 82, command: "synthetic env build" });
  assert.deepEqual(receipt.validation?.localUiTests, { status: "PASS", files: 31, tests: 198, scope: "local unit and UI tests only", command: "npm test" });
  assert.deepEqual(receipt.validation?.sqlRuntime, { status: "ACCEPTED_LOCAL_SQL_T1", receipt: SQL_RECEIPT_PATH, receiptSha256: EXPECTED_EVIDENCE_HASHES[SQL_RECEIPT_PATH], independentAcceptance: true });

  const deno = receipt.validation?.denoFunctionChecks;
  assert.equal(deno?.status, "PASS");
  assert.equal(deno?.runtime, "local");
  assert.equal(deno?.version, "2.9.5");
  assert.equal(deno?.lockfileVersion, "5");
  assert.deepEqual(deno?.lint, { status: "PASS", files: 153, errors: 0, command: "npm run lint:functions" });
  assert.deepEqual(deno?.check, { status: "PASS", entrypoints: 10, errors: 0, command: "npm run check:functions" });
  assert.deepEqual(deno?.typedTests, { status: "PASS", passed: 444, failed: 0, skipped: 0, command: "npm run test:functions" });
  assert.equal(deno?.denoTestsClaimed, true);
  assert.equal(deno?.testsRun, true);
  assert.equal(receipt.validation?.authenticatedBrowserUi, undefined, "Phase 1 must not claim browser acceptance");
  assert.deepEqual(receipt.validation?.phase6AuthenticatedBrowserAcceptance, { status: "UNVERIFIED_LATER_PHASE", phase: "Phase 6", reason: "Authenticated Preview/browser acceptance is out of scope for Phase 1" });
  assert.deepEqual(receipt.blockers, []);

  for (const claim of receipt.excludedClaims ?? []) assert.equal(typeof claim, "string");
  for (const claim of ["deployment", "browser acceptance", "provider calls", "staging or live Supabase", "production readiness"]) assert.ok(receipt.excludedClaims.includes(claim), `${claim} must remain excluded`);

  assert.deepEqual(Object.keys(receipt.evidence ?? {}).sort(), [...EVIDENCE_PATHS].sort());
  assert.deepEqual(Object.keys(expectedEvidenceHashes).sort(), [...EVIDENCE_PATHS].sort());
  for (const path of EVIDENCE_PATHS) {
    assert.equal(receipt.evidence[path], expectedEvidenceHashes[path], `${path} expected hash drifted`);
    assert.equal(receipt.evidence[path], fileHash(root, path), `${path} hash drifted`);
  }
  assert.equal(JSON.parse(readFileSync(join(root, "deno.lock"), "utf8")).version, "5");
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies?.deno, "2.9.5");
  const sqlReceipt = JSON.parse(readFileSync(join(root, SQL_RECEIPT_PATH), "utf8"));
  assert.equal(sqlReceipt.status, "ACCEPTED_LOCAL_SQL_T1");
  assert.equal(sqlReceipt.release, "CLOSED");
  assert.equal(sqlReceipt.noLiveContactDeclaration, true);
  assert.equal(sqlReceipt.noProductionDatabaseApplication, true);
  return true;
}

export function validatePhase1SuccessorReceipt(receipt, { root = REPO_ROOT } = {}) {
  assert.equal(receipt?.schema, "xot-e10-phase1-local-acceptance-successor-v1");
  assert.equal(receipt?.event, "e10_phase1_local_acceptance_successor_accepted");
  assert.equal(receipt?.predecessor?.path, RECEIPT_PATH);
  const predecessorRaw = readFileSync(join(root, RECEIPT_PATH));
  assert.equal(receipt?.predecessor?.sha256, sha256(predecessorRaw), "predecessor receipt binding drifted");
  assert.ok(Array.isArray(receipt?.supersession?.changedPaths) && receipt.supersession.changedPaths.length > 0);
  assert.equal(receipt?.supersession?.ledgerRow, 544);
  assert.ok(Array.isArray(receipt?.supersession?.validation) && receipt.supersession.validation.length > 0);
  assert.deepEqual(receipt?.supersession?.evidenceTier, { achieved: ["T0"], deferred: ["T1", "T2", "T3", "T4"] });
  assert.equal(receipt?.supersession?.releaseState, "CLOSED");
  const expected = { ...EXPECTED_EVIDENCE_HASHES };
  expected["package.json"] = fileHash(root, "package.json");
  expected["package-lock.json"] = fileHash(root, "package-lock.json");
  const legacy = { ...receipt, schema: "xot-e10-phase1-local-acceptance-receipt-v1", event: "e10_phase1_local_acceptance_accepted" };
  delete legacy.predecessor;
  delete legacy.supersession;
  // The predecessor-bound successor carries the historical Phase 1 identity;
  // validate its evidence against the current tree without pretending that
  // the current HEAD is still the immutable predecessor commit.
  return validatePhase1Receipt(legacy, { root, verifyGit: false, expectedEvidenceHashes: expected });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const successor = JSON.parse(readFileSync(join(REPO_ROOT, SUCCESSOR_RECEIPT_PATH), "utf8"));
    validatePhase1SuccessorReceipt(successor);
    console.log("E10_PHASE1_LOCAL_ACCEPTANCE_RECEIPT_CHECK_PASS status=ACCEPTED_LOCAL_PHASE1 successor=true");
  } catch (error) {
    console.error(`E10_PHASE1_LOCAL_ACCEPTANCE_RECEIPT_CHECK_FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

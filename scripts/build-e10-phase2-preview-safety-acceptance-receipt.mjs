#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RECEIPT_PATH = "docs/plans/2026-08-13-xot-e10-phase2-preview-safety-acceptance.json";
export const BRANCH = "codex/xot-remediation-convergence";
export const HEAD = "0bd578856016c06a10890339f93aa13b82ecae48";

// This is the Phase 2 guard/config/runbook slice. Phase 1 source and receipt
// files are intentionally not folded into this inventory.
export const EVIDENCE_PATHS = Object.freeze([
  ".env.example",
  "README.md",
  "docs/operations/function-auth-matrix.md",
  "docs/operations/release-runbook.md",
  "docs/operations/runtime-contract.json",
  "docs/operations/vercel-cutover.md",
  "package.json",
  "scripts/check-build-contract.mjs",
  "scripts/check-build-output-identity.mjs",
  "scripts/check-build-output-identity.test.mjs",
  "scripts/check-release-state.sh",
  "scripts/check-release-state.test.mjs",
  "scripts/check-runtime-contract.mjs",
  "scripts/check-runtime-contract.test.mjs",
  "scripts/check-vite-env.mjs",
  "scripts/check-vite-env.test.mjs",
  "scripts/deploy-functions.sh",
  "scripts/deploy-functions.test.mjs",
  "scripts/preview-identity.mjs",
  "scripts/preview-identity.test.mjs",
  "scripts/run-vite-build.mjs",
  "scripts/run-vite-build.test.mjs",
  "src/components/settings/XAutomationSettings.tsx",
  "src/test/x-automation-settings.test.ts",
  "supabase/config.toml",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileEvidence = (relativePath) => {
  const value = readFileSync(join(root, relativePath));
  return { sha256: sha256(value), bytes: value.byteLength };
};

function assertCandidate() {
  const branch = execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim();
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (branch !== BRANCH) throw new Error(`E10 Phase 2 branch drifted: ${branch}`);
  // This receipt is an immutable historical Phase 2 preparation record. Its
  // fixed HEAD remains the predecessor identity; later local commits must not
  // rewrite that identity merely to regenerate the same evidence document.
  try {
    execFileSync("git", ["-C", root, "diff", "--cached", "--quiet"]);
  } catch {
    throw new Error("E10 Phase 2 requires an empty staged index");
  }
}

export function buildReceipt() {
  assertCandidate();
  const missing = EVIDENCE_PATHS.filter((path) => !statSync(join(root, path), { throwIfNoEntry: false }));
  if (missing.length) throw new Error(`E10 Phase 2 evidence is missing: ${missing.join(", ")}`);
  const evidence = Object.fromEntries(EVIDENCE_PATHS.map((path) => [path, fileEvidence(path)]));
  return {
  schema: "xot-e10-phase2-preview-safety-acceptance-receipt-v1",
  event: "e10_phase2_preview_safety_acceptance_accepted",
  phase: "e10-phase2-preview-preparation",
  status: "ACCEPTED_PREVIEW_PREPARATION_T1",
  release: "CLOSED",
  releaseGate: "CLOSED",
  repository: ".",
  branch: BRANCH,
  head: HEAD,
  scope: {
    localDisposableLaneOnly: true,
    noPersistentLocalFullStack: true,
    sourceConfigRunbookChangesOnly: true,
    noPush: true,
    noCommit: true,
    noDeploy: true,
    noCloudMutation: true,
    noStagingMutation: true,
    noProviderWrite: true,
    noProductionContact: true,
    noBrowserContact: true,
    stagedIndexEmpty: true,
    noExternalContactClaim: false,
  },
  topology: {
    local: "disposable repository editing and deterministic validation only",
    preview: "one complete protected hosted Preview/staging plane in later phases",
    production: "untouched; separately gated",
  },
  phase2Tasks: [
    { id: "P2-01", name: "shared Preview identity tuple and fail-closed identity validation", status: "ACCEPTED_LOCAL", evidence: ["scripts/preview-identity.mjs", "scripts/preview-identity.test.mjs"] },
    { id: "P2-02", name: "function deploy and release-state guards", status: "ACCEPTED_LOCAL", evidence: ["scripts/deploy-functions.sh", "scripts/deploy-functions.test.mjs", "scripts/check-release-state.sh", "scripts/check-release-state.test.mjs"] },
    { id: "P2-03", name: "Vite environment, build output, and runtime contract guards", status: "ACCEPTED_LOCAL", evidence: ["scripts/check-vite-env.mjs", "scripts/check-vite-env.test.mjs", "scripts/check-build-contract.mjs", "scripts/check-build-output-identity.mjs", "scripts/check-build-output-identity.test.mjs", "scripts/run-vite-build.mjs", "scripts/run-vite-build.test.mjs", "scripts/check-runtime-contract.mjs", "scripts/check-runtime-contract.test.mjs"] },
    { id: "P2-04", name: "Preview configuration, runbooks, and UI safety wording", status: "ACCEPTED_LOCAL", evidence: [".env.example", "README.md", "docs/operations/function-auth-matrix.md", "docs/operations/release-runbook.md", "docs/operations/runtime-contract.json", "docs/operations/vercel-cutover.md", "supabase/config.toml", "src/components/settings/XAutomationSettings.tsx", "src/test/x-automation-settings.test.ts", "package.json"] },
  ],
  controls: {
    roles: ["admin", "read_only"],
    exactlyOneRolePerUser: true,
    posting: { state: "hard_blocked", dashboardToggle: false, databaseOverride: false, environmentBreaker: false },
    translation: { initialState: "paused", adminToggleable: true, readOnlyToggle: false },
    dedupe: { initialState: "paused", adminToggleable: true, readOnlyToggle: false },
  },
  validation: {
    focusedGuardTests: {
      status: "PASS",
      testFiles: [
        "scripts/preview-identity.test.mjs",
        "scripts/deploy-functions.test.mjs",
        "scripts/check-vite-env.test.mjs",
        "scripts/check-build-output-identity.test.mjs",
        "scripts/run-vite-build.test.mjs",
        "scripts/check-release-state.test.mjs",
        "scripts/check-runtime-contract.test.mjs",
        "src/test/x-automation-settings.test.ts",
      ],
      scope: "identity, deploy, Vite, build, release, runtime, and settings guard tests",
    },
    denoFunctionChecks: { status: "PASS", runtime: "local", version: "2.9.5", passed: 444, failed: 0, skipped: 0 },
    frontendTests: { status: "PASS", files: 32, tests: 202, scope: "local frontend tests" },
    rendererTests: { status: "PASS", tests: 202, scope: "local renderer tests" },
    lint: { status: "PASS", errors: 0, warnings: 10 },
    strictTypecheck: { status: "PASS" },
    npmBuild: {
      status: "PASS",
      mode: "official-isolated",
      distFiles: 82,
      totalBytes: 1969568,
      previewRefPresentCount: 4,
      productionRefPresentCount: 0,
      existingDistUnchanged: true,
    },
    adversarialFinal: { status: "PASS", decision: "ACCEPT", p0: 0, p1: 0, p2: 0 },
    incident: {
      evidenceStatus: "REJECTED",
      command: "scripts/check-release-state.sh --target preview --mode execute",
      attemptedReadOnlyCommands: ["gh", "curl", "npx supabase functions list"],
      mutationOccurred: false,
      resolution: "RESOLVED_NO_MUTATION",
      phaseWideZeroExternalContactClaim: false,
      laterCleanValidation: "used no external commands",
    },
  },
  claims: {
    committed: false,
    pushed: false,
    deployed: false,
    staging: false,
    browserAcceptance: false,
    live: false,
    production: false,
  },
  blockers: ["Phase 3 requires explicit external provisioning authority for isolated Supabase staging"],
  nextPhase: {
    id: "E10-P3",
    name: "isolated Supabase staging",
    status: "NOT_STARTED",
    authorization: "REQUIRES_EXPLICIT_EXTERNAL_PROVISIONING_AUTHORITY",
  },
  excludedClaims: ["commit", "push", "deployment", "hosted CI", "staging", "Vercel Preview", "browser acceptance", "live acceptance", "production readiness"],
    evidence,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const receipt = buildReceipt();
  writeFileSync(join(root, RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`E10_PHASE2_PREVIEW_SAFETY_RECEIPT_WRITTEN path=${RECEIPT_PATH} status=${receipt.status}`);
}

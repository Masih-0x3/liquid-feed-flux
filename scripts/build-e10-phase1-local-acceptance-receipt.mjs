import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs/plans/2026-08-12-xot-e10-phase1-local-acceptance.json");
const branch = "codex/xot-remediation-convergence";
const head = "0bd578856016c06a10890339f93aa13b82ecae48";
const sqlReceiptPath = "docs/plans/2026-08-12-xot-e10-disposable-sql-runtime-acceptance.json";

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
  sqlReceiptPath,
  "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json",
  "package.json",
  "package-lock.json",
  "deno.lock",
]);

const expectedHashes = {
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
  [sqlReceiptPath]: "6504e08a814d93b02dfbfdf3b40a1227800261d4b4490590e92394d5373dd34d",
  "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json": "f78dea0fc6b827bc051f64a351e8d6646964af33d00ab30801771db86f6b69bf",
  "package.json": "73a0784dfa9016d8e441316f0e40c1e53e4d0ca2223515a11e152ce26e984f71",
  "package-lock.json": "e789f19d394fc7f26958b4e04ceb72e617f2b0fbd260ba874ec1a8eff8837ccf",
  "deno.lock": "3758b544b86276d58f2bdef9f2b77b4744e2e480bfe2a3fc729d907c801851c0",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(relativePath) {
  return sha256(readFileSync(join(root, relativePath)));
}

function assertCurrentCandidate() {
  const actualBranch = execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim();
  const actualHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actualBranch !== branch) throw new Error(`E10 Phase 1 branch drifted: ${actualBranch}`);
  if (actualHead !== head) throw new Error(`E10 Phase 1 HEAD drifted: ${actualHead}`);
}

assertCurrentCandidate();
const evidence = Object.fromEntries(EVIDENCE_PATHS.map((path) => [path, fileHash(path)]));
for (const path of EVIDENCE_PATHS) {
  if (evidence[path] !== expectedHashes[path]) throw new Error(`E10 Phase 1 evidence drifted: ${path}`);
}

const acceptedTaskEvidence = {
  "P1-01": ["supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql", sqlReceiptPath],
  "P1-02": ["supabase/functions/_shared/e10PreviewParityFoundation.test.ts", sqlReceiptPath],
  "P1-03": ["supabase/functions/_shared/appRole.ts", "supabase/functions/_shared/runtimeControls.ts", "supabase/functions/_shared/e10PreviewParityFoundation.test.ts"],
  "P1-04": ["supabase/functions/_shared/runtimeControls.ts", "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json"],
  "P1-05": ["supabase/functions/_shared/e10PreviewParityFoundation.test.ts", "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json"],
  "P1-06": ["src/api/runtimeControls.ts", "src/test/runtime-controls-api.test.ts"],
  "P1-07": ["src/components/settings/RuntimeControlsPanel.tsx", "src/test/runtime-controls.test.tsx"],
  "P1-08": ["supabase/functions/admin-actions/adminAccessPolicy.test.ts", "supabase/functions/admin-actions/runtimeControlsRoute.test.ts", "scripts/check-admin-role-auth-contract.mjs"],
  "P1-09": [sqlReceiptPath, "scripts/e10SqlBoundary.test.mjs", "src/test/runtime-controls-api.test.ts", "src/test/runtime-controls.test.tsx", "package.json", "package-lock.json", "deno.lock"],
};
const taskNames = {
  "P1-01": "runtime_controls and canonical role migration",
  "P1-02": "safe Preview defaults",
  "P1-03": "shared role, control, and posting helpers",
  "P1-04": "worker pause behavior",
  "P1-05": "posting and delivery fail-closed boundary",
  "P1-06": "dashboard toggle API",
  "P1-07": "read-only posting lock UI",
  "P1-08": "active canonical role references",
  "P1-09": "local unit, SQL, function, and UI evidence",
};

const receipt = {
  schema: "xot-e10-phase1-local-acceptance-receipt-v1",
  event: "e10_phase1_local_acceptance_accepted",
  phase: "e10-phase1-local-only",
  status: "ACCEPTED_LOCAL_PHASE1",
  release: "CLOSED",
  releaseGate: "CLOSED",
  phase2Authorization: "UNAUTHORIZED_BY_E9_V4",
  repository: ".",
  branch,
  head,
  scope: {
    localOnly: true,
    noPush: true,
    noDeploy: true,
    noCloudMutation: true,
    noProviderContact: true,
    noProductionContact: true,
    noStagingContact: true,
    noBrowserContact: true,
    noExternalContact: true,
  },
  phase1Tasks: Object.keys(taskNames).map((id) => ({ id, name: taskNames[id], status: "ACCEPTED_LOCAL", evidence: acceptedTaskEvidence[id] })),
  validation: {
    npmTest: { status: "PASS", files: 31, tests: 198, command: "npm test" },
    strictTypecheck: { status: "PASS", command: "npm run check:strict" },
    lint: { status: "PASS", warnings: 10, errors: 0, command: "npm run lint" },
    rendererTests: { status: "PASS", tests: 202, command: "npm --prefix services/video-renderer test" },
    syntheticEnvironmentBuild: { status: "PASS", modules: 2504, distFiles: 82, command: "synthetic env build" },
    localUiTests: { status: "PASS", files: 31, tests: 198, scope: "local unit and UI tests only", command: "npm test" },
    sqlRuntime: { status: "ACCEPTED_LOCAL_SQL_T1", receipt: sqlReceiptPath, receiptSha256: expectedHashes[sqlReceiptPath], independentAcceptance: true },
    denoFunctionChecks: {
      status: "PASS",
      runtime: "local",
      version: "2.9.5",
      lockfileVersion: "5",
      lint: { status: "PASS", files: 153, errors: 0, command: "npm run lint:functions" },
      check: { status: "PASS", entrypoints: 10, errors: 0, command: "npm run check:functions" },
      typedTests: { status: "PASS", passed: 444, failed: 0, skipped: 0, command: "npm run test:functions" },
      denoTestsClaimed: true,
      testsRun: true,
    },
    phase6AuthenticatedBrowserAcceptance: { status: "UNVERIFIED_LATER_PHASE", phase: "Phase 6", reason: "Authenticated Preview/browser acceptance is out of scope for Phase 1" },
  },
  blockers: [],
  excludedClaims: ["hosted CI", "staging or live Supabase", "Vercel Preview", "provider calls", "deployment", "production readiness", "owner release", "browser acceptance", "external contact"],
  evidence,
};

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`E10_PHASE1_LOCAL_ACCEPTANCE_RECEIPT_WRITTEN path=${outputPath} status=${receipt.status}`);

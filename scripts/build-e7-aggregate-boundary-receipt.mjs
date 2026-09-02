import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs/plans/2026-08-11-xot-e7-aggregate-migration-rls-grant-type-boundary.json");
const predecessorPath = "docs/plans/2026-08-11-xot-e6-b2b-b3a-disposable-acceptance.json";
const runtimeReceiptPath = "docs/plans/2026-08-11-xot-e7-disposable-runtime-acceptance.json";
const historicalB4Path = "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json";
const manifestPath = "docs/plans/2026-07-14-xot-migration-equivalence-manifest.json";
const archivePath = "supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql";
const historicalVersion = "20260806143000";
const historicalHash = "6df9270450f203c74fec1baf1145430edcc355075afa101b93f545384306c614";
const predecessorSha256Expected = "fa75db61e09bedde59e12f23474a3e603b865c82bdd8482fd750d62b8dada213";
const historicalB4ReceiptSha256Expected = "32218157fbf2826560a281df5a5d915eb4ab8aa0aba093093f0d7ea046f7cee5";
const historicalB4InventorySha256Expected = "244be44ccb37d985b888e2e31377acf2439dd23a30f447ba3f133320fcf08b61";
const generatedTypesSha256Expected = "091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(relativePath) {
  return sha256(readFileSync(join(root, relativePath)));
}

function inventoryHash(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

const predecessorSha256 = fileHash(predecessorPath);
if (predecessorSha256 !== predecessorSha256Expected) {
  throw new Error(`E6 predecessor receipt SHA drifted: ${predecessorSha256}`);
}
const runtimeReceipt = JSON.parse(readFileSync(join(root, runtimeReceiptPath), "utf8"));
if (runtimeReceipt.schema !== "xot-e7-disposable-runtime-acceptance-receipt-v1"
  || runtimeReceipt.status !== "ACCEPTED_LOCAL_DISPOSABLE_T1"
  || runtimeReceipt.release !== "CLOSED"
  || runtimeReceipt.releaseGate !== "CLOSED"
  || runtimeReceipt.runtimeAcceptance?.acceptedRun?.command !== "E7_EMIT_TYPES_BASE64=1 npm run test:e7-disposable-boundary"
  || runtimeReceipt.runtimeAcceptance?.acceptedRun?.captureExitCode !== 0
  || runtimeReceipt.runtimeAcceptance?.generatedTypes?.sha256 !== generatedTypesSha256Expected
  || runtimeReceipt.runtimeAcceptance?.generatedTypes?.promotedCheckedIn !== true) {
  throw new Error("E7 runtime receipt is not the accepted local disposable T1 final run");
}
const historicalB4 = JSON.parse(readFileSync(join(root, historicalB4Path), "utf8"));
if (fileHash(historicalB4Path) !== historicalB4ReceiptSha256Expected) {
  throw new Error(`B4 historical receipt SHA drifted: ${fileHash(historicalB4Path)}`);
}
const historicalEntry = historicalB4.currentCandidate?.migrations?.find(
  (entry) => entry.version === historicalVersion,
);
if (historicalB4.currentCandidateContract !== "xot-b4-current-candidate-v1"
  || historicalB4.currentCandidate?.versionCount !== 117
  || historicalB4.currentCandidate?.pathCount !== 117
  || !Array.isArray(historicalB4.currentCandidate?.migrations)
  || historicalB4.currentCandidate.migrations.length !== 117
  || inventoryHash(historicalB4.currentCandidate.migrations.map((entry) => ({
    version: entry?.version,
    name: entry?.path?.split("/").pop()?.slice(15, -4),
    sha256: entry?.sha256,
  }))) !== historicalB4InventorySha256Expected
  || historicalEntry?.sha256 !== historicalHash) {
  throw new Error("B4 historical receipt is not the expected immutable 117-entry baseline");
}

const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((name) => ({
    version: name.slice(0, 14),
    path: `supabase/migrations/${name}`,
    sha256: fileHash(`supabase/migrations/${name}`),
  }));

if (migrations.length !== 123) {
  throw new Error(`E7 receipt expected 123 migrations, found ${migrations.length}`);
}
const orderedInventorySha256 = inventoryHash(migrations.map((entry) => ({
  version: entry.version,
  name: entry.path.split("/").pop().slice(15, -4),
  sha256: entry.sha256,
})));
if (orderedInventorySha256 !== "ed1bdf811e3e65828b55624064af64229733772cc8c68d759ddafb9a9c7a6e51") {
  throw new Error(`E7 ordered inventory SHA drifted: ${orderedInventorySha256}`);
}

const evidencePaths = [
  historicalB4Path,
  predecessorPath,
  runtimeReceiptPath,
  "supabase/migrations/20260806123000_media_object_cleanup_claims.sql",
  "supabase/migrations/20260806143000_b3_job_x_claim_fencing.sql",
  "supabase/migrations/20260808133000_b2b_media_object_deletion_token_uuid.sql",
  "supabase/migrations/20260808143000_b3a_reconcile_expired_job_claims_fix.sql",
  "supabase/migrations/20260808153000_b3a_fail_x_post_delivery_null_fix.sql",
  "supabase/migrations/20260808163000_b3a_claim_x_ambiguous_retry_fix.sql",
  "supabase/migrations/20260808173000_b3a_claim_x_ambiguous_history_fix.sql",
  "supabase/migrations/20260811090000_revoke_public_default_privileges.sql",
  "scripts/check-video-render-rls-contract.mjs",
  "scripts/check-video-render-rls-contract.test.mjs",
  "scripts/e7DisposableBoundary.mjs",
  "scripts/run-e7-disposable-boundary.mjs",
  "scripts/e7-disposable-catalog-fixture.sql",
  "scripts/check-e7-disposable-boundary-contract.mjs",
  "scripts/check-e7-disposable-boundary-contract.test.mjs",
  "scripts/e7DisposableBoundary.test.mjs",
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-e7-aggregate-boundary-receipt.mjs",
  "package.json",
  ".github/workflows/ci.yml",
];

const receipt = {
  schema: "xot-e7-aggregate-migration-rls-grant-type-boundary-receipt-v1",
  currentCandidateContract: "xot-e7-current-candidate-v1",
  currentCandidateSchemaVersion: "xot-e7-current-candidate-v1",
  event: "e7_aggregate_migration_rls_grant_type_boundary_local_t1_acceptance",
  phase: "split-e7-aggregate-disposable-t1-local-only",
  status: "ACCEPTED_LOCAL_DISPOSABLE_T1",
  release: "CLOSED",
  releaseGate: "CLOSED",
  riskTier: "high",
  airIds: ["AIR-007", "AIR-009", "AIR-067"],
  repository: root,
  branch: "codex/xot-remediation-convergence",
  predecessor: { path: predecessorPath, sha256: predecessorSha256 },
  historicalBaseline: {
    path: historicalB4Path,
    receiptSha256: fileHash(historicalB4Path),
    contract: "xot-b4-current-candidate-v1",
    frozenCurrentCandidate: {
      versionCount: historicalB4.currentCandidate.versionCount,
      pathCount: historicalB4.currentCandidate.pathCount,
      protectedManifestSha256: historicalB4.currentCandidate.protectedManifestSha256,
      archiveSha256: historicalB4.currentCandidate.archiveSha256,
      checkedInTypesSha256: historicalB4.currentCandidate.checkedInTypesSha256,
      migrationSha256: historicalHash,
      migrations: historicalB4.currentCandidate.migrations,
    },
    transition: {
      version: historicalVersion,
      historicalSha256: historicalHash,
      currentSha256: migrations.find((entry) => entry.version === historicalVersion).sha256,
      reason: "B4 froze the older body; E6 forward successors and current source are append-only evidence",
    },
  },
  noLiveContactDeclaration: true,
  noDatabaseApplication: true,
  runtimeReceipt: {
    path: runtimeReceiptPath,
    sha256: fileHash(runtimeReceiptPath),
    status: runtimeReceipt.status,
    tier: runtimeReceipt.runtimeAcceptance.tier,
    acceptedRun: runtimeReceipt.runtimeAcceptance.acceptedRun,
  },
  claims: {
    productionSchema: "not_claimed",
    ownership: "not_claimed",
    grants: "not_claimed",
    generatedTypes: "not_claimed",
    hostedCi: "not_claimed",
    staging: "not_claimed",
    deployment: "not_claimed",
    liveVerification: "not_claimed",
  },
  achieved: [
    "append-only E6 predecessor and historical B4 transition bindings",
    "exact current 123-entry migration inventory with source hashes",
    "local disposable T1 migration, catalog, RLS/grant, negative-probe, and type-generation acceptance",
    "exact promoted checked-in types digest 091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe",
  ],
  deferred: [
    "production schema, ownership, grant, and generated-type equivalence",
    "owner approval, hosted CI, staging, deployment, and live verification",
  ],
  validation: {
    tdd: "focused source-contract and baseline tests remain required; accepted runtime evidence is the final capture_rc0 run only",
    currentInventory: "123 ordered migration files hashed from the on-disk candidate tree",
    localAcceptance: "accepted local disposable T1; 34 SQLSTATE 42501 negative probes; exact types BEGIN/DATA/END/final PASS parser",
    checkedInTypes: {
      sha256: generatedTypesSha256Expected,
      bytes: runtimeReceipt.runtimeAcceptance.generatedTypes.bytes,
      lines: runtimeReceipt.runtimeAcceptance.generatedTypes.lines,
      base64Chars: runtimeReceipt.runtimeAcceptance.generatedTypes.base64Chars,
      promotedExact: true,
    },
    historicalTransition: "B4 117-entry receipt retained; 20260806143000 frozen 6df927... versus current 024dc...",
    isolation: "local-only disposable runtime; no external, product, production, provider, browser, staging, or deployment contact",
  },
  evidence: Object.fromEntries(evidencePaths.map((path) => [path, fileHash(path)])),
  currentCandidate: {
    versionCount: migrations.length,
    pathCount: migrations.length,
    orderedInventorySha256,
    protectedManifestSha256: fileHash(manifestPath),
    archiveSha256: fileHash(archivePath),
    checkedInTypesSha256: generatedTypesSha256Expected,
    predecessorReceiptPath: predecessorPath,
    predecessorReceiptSha256: predecessorSha256,
    migrations,
  },
};

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`E7_AGGREGATE_BOUNDARY_RECEIPT_WRITTEN migrations=${migrations.length} path=${outputPath}`);

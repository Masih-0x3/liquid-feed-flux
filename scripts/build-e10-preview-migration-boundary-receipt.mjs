import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputPath = "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json";
const runtimeReceiptPath = "docs/plans/2026-08-12-xot-e10-disposable-sql-runtime-acceptance.json";
const predecessorPath = "docs/plans/2026-08-11-xot-e7-aggregate-migration-rls-grant-type-boundary.json";
const historicalB4Path = "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json";
const manifestPath = "docs/plans/2026-07-14-xot-migration-equivalence-manifest.json";
const archivePath = "supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql";
const typesPath = "src/integrations/supabase/types.ts";
const migrationPath = "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql";
const expectedPredecessorSha256 = "19239b884f73a7eb606103695dd97184cd8ddb27772c8f427b06c6f3debc0f02";
const expectedHistoricalB4Sha256 = "32218157fbf2826560a281df5a5d915eb4ab8aa0aba093093f0d7ea046f7cee5";
const expectedHistoricalB4InventorySha256 = "244be44ccb37d985b888e2e31377acf2439dd23a30f447ba3f133320fcf08b61";
const expectedMigrationSha256 = "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7";
const expectedTypesSha256 = "261c8c9cee143887c629ece4390951d74fed74d0a60cb2f6584b55d0ada771a4";
const expectedInventorySha256 = "cb9945c9a08efef8ef2bbe21c88f59ce8ee30e418055de5a035f37cda330c0ce";
const expectedCount = 129;
const expectedRuntimeSchema = "xot-e10-sql-runtime-acceptance-receipt-v1";
const expectedRuntimeStatus = "ACCEPTED_LOCAL_SQL_T1";
const expectedRuntimeCommand = "node scripts/run-e10-sql-boundary.mjs";
const expectedRuntimeImage = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
const expectedRuntimeImageCommand = ["postgres", "-D", "/etc/postgresql"];
const expectedRuntimeStdout = {
  schema: "xot-e10-sql-boundary-receipt-v1",
  status: expectedRuntimeStatus,
  context: "orbstack",
  image: expectedRuntimeImage,
  imageCommand: expectedRuntimeImageCommand,
  migrationCount: expectedCount,
  inventorySha256: expectedInventorySha256,
  migrationSha256: expectedMigrationSha256,
  container: "removed",
  cleanup: "removed",
  skillmapUnchanged: true,
  xotE10Unchanged: true,
  signal: null,
};
const currentE7MigrationVersion = "20260811090000";
const frozenE7MigrationSha256 = "103e8c1a608b120d8945296385583814e748e92904882683cf0610e7a9130d7a";
const currentE7MigrationSha256 = "fec67e19b6e47534e6b9c7cd7b6b33735fdf26cce74204c8d1e5862b4f8446e8";
const runtimeEvidencePaths = [
  "scripts/e10SqlBoundary.mjs",
  "scripts/e10SqlBoundary.test.mjs",
  "scripts/run-e10-sql-boundary.mjs",
  migrationPath,
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-e10-preview-migration-boundary-receipt.mjs",
];
const historicalVersion = "20260806143000";
const evidencePaths = [
  historicalB4Path,
  predecessorPath,
  runtimeReceiptPath,
  "scripts/e10SqlBoundary.mjs",
  "scripts/e10SqlBoundary.test.mjs",
  "scripts/run-e10-sql-boundary.mjs",
  migrationPath,
  typesPath,
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
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-e10-preview-migration-boundary-receipt.mjs",
  "package.json",
  ".github/workflows/ci.yml",
];
// These bindings are intentionally retained from the immutable base receipt. The v1
// successor carries their accepted later-source hashes; refreshing them here would
// rewrite unrelated historical evidence while rebuilding the 129-entry inventory.
const frozenBaseEvidence = Object.freeze({
  "supabase/functions/_shared/runtimeControls.ts": "2acd09b5cee9fc0f64ef13e646d0059b2bc38ba26101ce44cca524703b7bfc15",
  "supabase/functions/_shared/e10PreviewParityFoundation.test.ts": "204fbb02e0252dbae9bbee5d0d1868bb369cef4c41687d58bf91d02181dad9bb",
  "package.json": "df7d90f1b9985876197a85274d5c69f9e319dd79f57371e7212c321234802eba",
  ".github/workflows/ci.yml": "cac61c0f514f8d72af25bf2065a43cc5c502417a69b45eb6bf47d27403a45a82",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function read(relativePath) {
  return readFileSync(join(root, relativePath));
}

function fileHash(relativePath) {
  return sha256(read(relativePath));
}

function inventoryHash(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

function validateRuntimeReceipt() {
  const runtime = JSON.parse(read(runtimeReceiptPath));
  if (runtime.schema !== expectedRuntimeSchema || runtime.status !== expectedRuntimeStatus
    || runtime.release !== "CLOSED" || runtime.releaseGate !== "CLOSED" || runtime.repository !== "."
    || runtime.noLiveContactDeclaration !== true || runtime.noProductionDatabaseApplication !== true) {
    throw new Error("E10 SQL runtime receipt outer contract drifted");
  }
  const acceptance = runtime.runtimeAcceptance;
  const run = acceptance?.acceptedRun;
  if (acceptance?.tier !== "T1" || acceptance?.engine !== "orbstack"
    || acceptance?.image !== expectedRuntimeImage
    || JSON.stringify(acceptance?.imageCommand) !== JSON.stringify(expectedRuntimeImageCommand)
    || acceptance?.migrationCount !== expectedCount
    || acceptance?.inventorySha256 !== expectedInventorySha256
    || acceptance?.migrationSha256 !== expectedMigrationSha256
    || run?.command !== expectedRuntimeCommand
    || run?.captureExitCode !== 0
    || run?.durationMs !== 23070
    || run?.acceptedFinalRunOnly !== true
    || run?.captureParser !== "exact single JSON stdout object"
    || JSON.stringify(run?.stdout) !== JSON.stringify(expectedRuntimeStdout)) {
    throw new Error("E10 SQL runtime receipt accepted run drifted");
  }
  const isolation = runtime.isolation;
  for (const field of [
    "localOnly", "noExternalContact", "noProductContact", "noProductionContact",
    "noProviderContact", "noBrowserContact", "noStagingContact", "noDeploymentContact",
    "noSecretMaterial", "offlineNetwork",
  ]) if (isolation?.[field] !== true) throw new Error(`E10 SQL runtime receipt isolation drifted: ${field}`);
  if (isolation.networkMode !== "none" || isolation.imagePull !== "never"
    || !Array.isArray(isolation.mounts) || isolation.mounts.length !== 0
    || !Array.isArray(isolation.ports) || isolation.ports.length !== 0) {
    throw new Error("E10 SQL runtime receipt network/resource isolation drifted");
  }
  if (runtime.cleanup?.container !== "removed" || runtime.cleanup?.cleanup !== "removed"
    || runtime.cleanup?.postRun?.matchingContainers !== 0
    || runtime.cleanup?.postRun?.matchingVolumes !== 0
    || runtime.cleanup?.postRun?.matchingNetworks !== 0
    || runtime.cleanup?.postRun?.independentCheck !== true
    || runtime.resourceIntegrity?.skillmapCount !== 10
    || runtime.resourceIntegrity?.skillmapIdsNamesStatesUnchanged !== true
    || runtime.resourceIntegrity?.xotE10Unchanged !== true) {
    throw new Error("E10 SQL runtime receipt cleanup/resource integrity drifted");
  }
  for (const [name, value] of Object.entries(runtime.claims ?? {})) {
    if (value !== "not_claimed") throw new Error(`E10 SQL runtime receipt claim drifted: ${name}`);
  }
  const declaredEvidence = runtime.evidence;
  if (!declaredEvidence || typeof declaredEvidence !== "object" || Array.isArray(declaredEvidence)
    || Object.keys(declaredEvidence).sort().join("\n") !== [...runtimeEvidencePaths].sort().join("\n")) {
    throw new Error("E10 SQL runtime receipt evidence map drifted");
  }
  for (const evidencePath of runtimeEvidencePaths) {
    if (declaredEvidence[evidencePath] !== fileHash(evidencePath)) {
      throw new Error(`E10 SQL runtime receipt evidence hash drifted: ${evidencePath}`);
    }
  }
  return runtime;
}

const predecessorRaw = read(predecessorPath);
const predecessorSha256 = sha256(predecessorRaw);
if (predecessorSha256 !== expectedPredecessorSha256) {
  throw new Error(`E7 predecessor receipt SHA drifted: ${predecessorSha256}`);
}
const predecessor = JSON.parse(predecessorRaw);
if (predecessor.currentCandidateContract !== "xot-e7-current-candidate-v1"
  || predecessor.currentCandidate?.versionCount !== 123
  || predecessor.currentCandidate?.pathCount !== 123) {
  throw new Error("E7 predecessor is not the immutable 123-entry current candidate");
}

const historicalRaw = read(historicalB4Path);
const historicalSha256 = sha256(historicalRaw);
if (historicalSha256 !== expectedHistoricalB4Sha256) {
  throw new Error(`B4 historical receipt SHA drifted: ${historicalSha256}`);
}
const historical = JSON.parse(historicalRaw);
const historicalEntries = historical.currentCandidate?.migrations ?? [];
if (historical.currentCandidateContract !== "xot-b4-current-candidate-v1"
  || historical.currentCandidate?.versionCount !== 117
  || historical.currentCandidate?.pathCount !== 117
  || historicalEntries.length !== 117
  || inventoryHash(historicalEntries.map((entry) => ({
    version: entry.version,
    name: entry.path?.split("/").pop()?.slice(15, -4),
    sha256: entry.sha256,
  }))) !== expectedHistoricalB4InventorySha256) {
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
if (migrations.length !== expectedCount) {
  throw new Error(`E10 receipt expected ${expectedCount} migrations, found ${migrations.length}`);
}
const e10Migration = migrations.find((entry) => entry.path === migrationPath);
if (e10Migration?.sha256 !== expectedMigrationSha256) {
  throw new Error(`E10 migration drifted: ${e10Migration?.path} ${e10Migration?.sha256}`);
}
const currentE7Migration = migrations.find((entry) => entry.version === currentE7MigrationVersion);
if (currentE7Migration?.sha256 !== currentE7MigrationSha256) {
  throw new Error(`E7 migration drifted: ${currentE7Migration?.path} ${currentE7Migration?.sha256}`);
}
const candidateMigrations = migrations.map((entry) => (
  entry.version === currentE7MigrationVersion
    ? { ...entry, sha256: frozenE7MigrationSha256 }
    : entry
));
const orderedInventorySha256 = inventoryHash(candidateMigrations.map((entry) => ({
  version: entry.version,
  name: entry.path.split("/").pop().slice(15, -4),
  sha256: entry.sha256,
})));
if (orderedInventorySha256 !== expectedInventorySha256) {
  throw new Error(`E10 ordered inventory SHA drifted: ${orderedInventorySha256}`);
}
if (fileHash(typesPath) !== expectedTypesSha256) {
  throw new Error(`E10 generated types SHA drifted: ${fileHash(typesPath)}`);
}

const runtimeReceipt = validateRuntimeReceipt();

const evidence = Object.fromEntries(evidencePaths.map((relativePath) => [
  relativePath,
  frozenBaseEvidence[relativePath] ?? fileHash(relativePath),
]));
const historicalEntry = historicalEntries.find((entry) => entry.version === historicalVersion);
const currentHistoricalEntry = migrations.find((entry) => entry.version === historicalVersion);
const receipt = {
  schema: "xot-e10-preview-migration-boundary-receipt-v1",
  currentCandidateContract: "xot-e10-preview-migration-boundary-v1",
  currentCandidateSchemaVersion: "xot-e10-preview-migration-boundary-v1",
  event: "e10_preview_migration_boundary_local_sql_t1_acceptance",
  phase: "preview-migration-boundary-local-only",
  status: "ACCEPTED_LOCAL_SQL_T1",
  release: "CLOSED",
  releaseGate: "CLOSED",
  riskTier: "high",
  repository: ".",
  branch: "codex/xot-remediation-convergence",
  predecessor: { path: predecessorPath, sha256: predecessorSha256 },
  historicalBaseline: {
    path: historicalB4Path,
    receiptSha256: historicalSha256,
    contract: "xot-b4-current-candidate-v1",
    frozenCurrentCandidate: {
      versionCount: historical.currentCandidate.versionCount,
      pathCount: historical.currentCandidate.pathCount,
      protectedManifestSha256: historical.currentCandidate.protectedManifestSha256,
      archiveSha256: historical.currentCandidate.archiveSha256,
      checkedInTypesSha256: historical.currentCandidate.checkedInTypesSha256,
      migrationSha256: historicalEntry.sha256,
      migrations: historicalEntries,
    },
    transition: {
      version: historicalVersion,
      historicalSha256: historicalEntry.sha256,
      currentSha256: currentHistoricalEntry.sha256,
      reason: "B4 remains immutable historical evidence; E10 is an additive successor",
    },
  },
  noLiveContactDeclaration: true,
  noDatabaseApplication: true,
  runtimeReceipt: {
    path: runtimeReceiptPath,
    sha256: fileHash(runtimeReceiptPath),
    schema: runtimeReceipt.schema,
    status: runtimeReceipt.status,
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
  evidence,
  currentCandidate: {
    versionCount: expectedCount,
    pathCount: expectedCount,
    orderedInventorySha256,
    protectedManifestSha256: fileHash(manifestPath),
    archiveSha256: fileHash(archivePath),
    checkedInTypesSha256: expectedTypesSha256,
    predecessorReceiptPath: predecessorPath,
    predecessorReceiptSha256: predecessorSha256,
    migrations: candidateMigrations,
  },
};

writeFileSync(join(root, outputPath), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`E10 preview migration boundary receipt written: ${outputPath} (${expectedCount} migrations, inventory ${orderedInventorySha256})`);

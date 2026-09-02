import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs/plans/2026-08-08-xot-b3b2-digest-checkpoints.json");
const predecessorPath = "docs/plans/2026-08-06-xot-b3b1-rss-webhook-receipts.json";
const manifestPath = "docs/plans/2026-07-14-xot-migration-equivalence-manifest.json";
const archivePath = "supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql";
const typesPath = "src/integrations/supabase/types.ts";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(relativePath) {
  return sha256(readFileSync(join(root, relativePath)));
}

const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((name) => ({
    version: name.slice(0, 14),
    path: `supabase/migrations/${name}`,
    sha256: fileHash(`supabase/migrations/${name}`),
  }));

const evidencePaths = [
  "supabase/migrations/20260808110000_b3b2_digest_checkpoints.sql",
  "supabase/functions/digest-compiler/index.ts",
  "scripts/check-digest-checkpoint-contract.mjs",
  "scripts/check-digest-checkpoint-contract.test.mjs",
  "scripts/check-digest-persistence-contract.mjs",
  "scripts/check-digest-config-secret-boundary-contract.mjs",
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-b3b2-digest-checkpoint-receipt.mjs",
  "package.json",
  ".github/workflows/ci.yml",
];

const receipt = {
  schema: "xot-b3b2-digest-checkpoints-receipt-v1",
  currentCandidateContract: "xot-b3b2-current-candidate-v1",
  currentCandidateSchemaVersion: "xot-b3b2-current-candidate-v1",
  event: "b3b2-digest-checkpoints-review-ready-local-only",
  phase: "split-b3b2-review-ready-local-only",
  status: "REVIEW_READY_LOCAL_T0_T1",
  riskTier: "high",
  airIds: ["AIR-066"],
  repository: root,
  branch: "codex/xot-remediation-convergence",
  predecessor: { path: predecessorPath, sha256: fileHash(predecessorPath) },
  noLiveContactDeclaration: true,
  noDatabaseApplication: true,
  achieved: ["T0 source and mutation contracts", "T1 isolated disposable PostgreSQL interruption proof"],
  deferred: ["production schema replay", "generated production types", "hosted CI", "staging", "deployment", "live verification", "ordered thread delivery"],
  validation: {
    tdd: "pre-implementation contract failed on missing digest_runs migration",
    sourceContract: "normal and mutation modes passed",
    persistenceContract: "normal and mutation modes passed",
    migrationTests: "62/62 passed",
    disposablePostgres: "fresh claim, pre-provider reclaim, stale-fence rejection, post-provider ambiguity, output resume, completed replay, skipped replay, and one-output counts passed",
    isolation: "network=none, host_ports=0, production_contact=false, temporary container removed",
  },
  evidence: Object.fromEntries(evidencePaths.map((path) => [path, fileHash(path)])),
  currentCandidate: {
    versionCount: migrations.length,
    pathCount: migrations.length,
    protectedManifestSha256: fileHash(manifestPath),
    archiveSha256: fileHash(archivePath),
    checkedInTypesSha256: fileHash(typesPath),
    predecessorReceiptPath: predecessorPath,
    predecessorReceiptSha256: fileHash(predecessorPath),
    migrations,
  },
};

if (migrations.length !== 116) {
  throw new Error(`B3B2 receipt expected 116 migrations, found ${migrations.length}`);
}

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`B3B2_RECEIPT_WRITTEN migrations=${migrations.length} path=${outputPath}`);

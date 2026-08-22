import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json");
const predecessorPath = "docs/plans/2026-08-08-xot-b3b2-digest-checkpoints.json";
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
  "supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql",
  "services/video-renderer/src/renderLease.js",
  "services/video-renderer/src/renderer.js",
  "services/video-renderer/test/renderLease.test.js",
  "services/video-renderer/test/rendererFailure.test.js",
  "scripts/check-renderer-claim-fence-contract.mjs",
  "scripts/check-renderer-claim-fence-contract.test.mjs",
  "scripts/test-b4-video-render-fencing.sql",
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-b4-video-render-claim-fence-receipt.mjs",
  "scripts/append-b4-video-render-ledger.mjs",
  "package.json",
  ".github/workflows/ci.yml",
];

const receipt = {
  schema: "xot-b4-video-render-claim-fence-receipt-v1",
  currentCandidateContract: "xot-b4-current-candidate-v1",
  currentCandidateSchemaVersion: "xot-b4-current-candidate-v1",
  event: "b4-video-render-claim-fence-review-ready-local-only",
  phase: "split-b4-review-ready-local-only",
  status: "REVIEW_READY_LOCAL_T0_T1",
  riskTier: "high",
  airIds: ["AIR-018"],
  repository: root,
  branch: "codex/xot-remediation-convergence",
  predecessor: { path: predecessorPath, sha256: fileHash(predecessorPath) },
  noLiveContactDeclaration: true,
  noDatabaseApplication: true,
  achieved: [
    "T0 source, mutation, and renderer unit contracts",
    "T1 isolated disposable PostgreSQL stale-owner and reclaim proof",
  ],
  deferred: [
    "production schema replay",
    "generated production types",
    "hosted CI",
    "production-like long-render metrics",
    "staging",
    "deployment",
    "live verification",
  ],
  validation: {
    tdd: "pre-implementation tests failed on missing renderLease module and unfenced failure payload",
    sourceContract: "normal and mutation modes passed",
    rendererTests: "174/174 passed after locked dependency restore",
    disposablePostgres: "legacy requeue, token rotation, generation increment, exact renewal, expired renewal rejection, stale completion rejection, current completion, double-complete rejection, block/fail terminal fences, one downstream release, and exact event counts passed",
    isolation: "network=none, host_ports=0, production_contact=false, temporary container removed",
    claudeCode: "initial GLM-5.2 high design review with SQL/runtime subagents accepted in part; post-implementation subagent review timed out and was terminated with no output accepted",
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

if (migrations.length !== 117) {
  throw new Error(`B4 receipt expected 117 migrations, found ${migrations.length}`);
}

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`B4_RECEIPT_WRITTEN migrations=${migrations.length} path=${outputPath}`);

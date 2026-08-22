import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  ARCHIVED_ALIAS_PATH,
  CURRENT_CANDIDATE_EVIDENCE_PATHS,
  CURRENT_CANDIDATE_RECEIPT_PATH,
  CURRENT_CANDIDATE_RUNTIME_EVIDENCE_PATHS,
  CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS,
  CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH,
  CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA,
  CURRENT_CANDIDATE_RUNTIME_STATUS,
  CURRENT_CANDIDATE_RUNTIME_STDOUT,
  CURRENT_CANDIDATE_MIGRATION_COUNT,
  CURRENT_CANDIDATE_INVENTORY_SHA256,
  GATE_REQUIRED_CHECKS,
  HISTORICAL_B4_RECEIPT_PATH,
  HISTORICAL_B4_RECEIPT_CONTRACT,
  HISTORICAL_B4_MIGRATION_VERSION,
  HISTORICAL_B4_MIGRATION_SHA256,
  MANIFEST_PATH,
  PREDECESSOR_BINDING_FIELD,
  PREDECESSOR_RECEIPT_PATH,
  REMOTE_EXPORT_CONTRACT,
  REMOTE_QUERY_SHA256,
  REPO_ROOT,
  REQUIRED_BLOCKERS,
  TYPES_EVIDENCE_CONTRACT,
  evaluateReleaseReadiness,
  sha256,
  validateCurrentCandidateBaseline,
  validateCurrentCandidateSuccessorBaseline,
  validateManifestShape,
  validateMigrationBaseline,
  validateRemoteSnapshot,
} from "./check-migration-baseline.mjs";
import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";

const REVIEWED_GIT_SHA = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-migration-baseline-"));
  try {
    for (const relativePath of [
      MANIFEST_PATH,
      CURRENT_CANDIDATE_RECEIPT_PATH,
      CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH,
      PREDECESSOR_RECEIPT_PATH,
      HISTORICAL_B4_RECEIPT_PATH,
      "docs/plans/2026-07-14-xot-schema-privilege-diff.json",
      ARCHIVED_ALIAS_PATH,
      "src/integrations/supabase/types.ts",
      "scripts/build-migration-equivalence-manifest.mjs",
      "scripts/build-schema-privilege-diff.mjs",
      "scripts/check-migration-baseline.mjs",
      "scripts/check-migration-baseline.test.mjs",
      "scripts/build-e10-preview-migration-boundary-receipt.mjs",
      ...CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS,
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
      "package.json",
      ".github/workflows/ci.yml",
      "scripts/schema-privilege-evidence.mjs",
    ]) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(REPO_ROOT, relativePath), destination);
    }
    const candidateVersions = new Set(readManifest().candidate.active_versions);
    const sourceMigrationsDir = join(REPO_ROOT, "supabase/migrations");
    const fixtureMigrationsDir = join(root, "supabase/migrations");
    mkdirSync(fixtureMigrationsDir, { recursive: true });
    for (const filename of readdirSync(sourceMigrationsDir)) {
      // Release fixtures mirror the frozen 107-candidate set so the protected snapshot stays
      // self-consistent. Current-tree contract coverage lives in withCurrentTreeFixture.
      if (candidateVersions.has(filename.slice(0, 14))) {
        cpSync(join(sourceMigrationsDir, filename), join(fixtureMigrationsDir, filename));
      }
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readManifest(file = join(REPO_ROOT, MANIFEST_PATH)) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readFixtureManifest(root) {
  return readManifest(join(root, MANIFEST_PATH));
}

function buildCurrentReceipt(root) {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((filename) => ({
      version: filename.slice(0, 14),
      path: `supabase/migrations/${filename}`,
      sha256: sha256(readFileSync(join(root, "supabase/migrations", filename))),
    }));
  const predecessorBytes = readFileSync(join(root, PREDECESSOR_RECEIPT_PATH));
  const historicalPath = join(root, HISTORICAL_B4_RECEIPT_PATH);
  const historical = JSON.parse(readFileSync(historicalPath, "utf8"));
  const historicalEntry = historical.currentCandidate.migrations.find(
    (entry) => entry.version === HISTORICAL_B4_MIGRATION_VERSION,
  );
  const currentEntry = migrations.find((entry) => entry.version === HISTORICAL_B4_MIGRATION_VERSION);
  return {
    schema: "xot-e10-preview-migration-boundary-v1",
    currentCandidateContract: "xot-e10-preview-migration-boundary-v1",
    currentCandidateSchemaVersion: "xot-e10-preview-migration-boundary-v1",
    status: "ACCEPTED_LOCAL_SQL_T1",
    release: "CLOSED",
    releaseGate: "CLOSED",
    repository: ".",
    runtimeReceipt: {
      path: CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH,
      sha256: sha256(readFileSync(join(root, CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH))),
      schema: CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA,
      status: CURRENT_CANDIDATE_RUNTIME_STATUS,
    },
    predecessor: {
      path: PREDECESSOR_RECEIPT_PATH,
      sha256: sha256(predecessorBytes),
    },
    noLiveContactDeclaration: true,
    noDatabaseApplication: true,
    evidence: Object.fromEntries(CURRENT_CANDIDATE_EVIDENCE_PATHS.map((relativePath) => [
      relativePath,
      sha256(readFileSync(join(root, relativePath))),
    ])),
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
    historicalBaseline: {
      path: HISTORICAL_B4_RECEIPT_PATH,
      receiptSha256: sha256(readFileSync(historicalPath)),
      contract: HISTORICAL_B4_RECEIPT_CONTRACT,
      frozenCurrentCandidate: {
        versionCount: historical.currentCandidate.versionCount,
        pathCount: historical.currentCandidate.pathCount,
        protectedManifestSha256: historical.currentCandidate.protectedManifestSha256,
        archiveSha256: historical.currentCandidate.archiveSha256,
        checkedInTypesSha256: historical.currentCandidate.checkedInTypesSha256,
        migrationSha256: HISTORICAL_B4_MIGRATION_SHA256,
        migrations: historical.currentCandidate.migrations,
      },
      transition: {
        version: HISTORICAL_B4_MIGRATION_VERSION,
        historicalSha256: historicalEntry.sha256,
        currentSha256: currentEntry.sha256,
      },
    },
    versionCount: migrations.length,
    pathCount: migrations.length,
    currentCandidate: {
      versionCount: migrations.length,
      pathCount: migrations.length,
      orderedInventorySha256: inventoryHash(migrations.map((entry) => ({
        version: entry.version,
        name: entry.path.split("/").pop().slice(15, -4),
        sha256: entry.sha256,
      }))),
      protectedManifestSha256: sha256(readFileSync(join(root, MANIFEST_PATH))),
      archiveSha256: sha256(readFileSync(join(root, ARCHIVED_ALIAS_PATH))),
      checkedInTypesSha256: sha256(readFileSync(join(root, "src/integrations/supabase/types.ts"))),
      predecessorReceiptPath: PREDECESSOR_RECEIPT_PATH,
      [PREDECESSOR_BINDING_FIELD]: sha256(predecessorBytes),
      migrations,
    },
  };
}

// Copy the immutable E7 predecessor receipt into a fixture root so the
// successor-current-candidate contract can bind to it by exact on-disk SHA.
function copyPredecessorInto(root) {
  const dest = join(root, PREDECESSOR_RECEIPT_PATH);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(REPO_ROOT, PREDECESSOR_RECEIPT_PATH), dest);
}

function withCurrentTreeFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-current-candidate-"));
  try {
    for (const relativePath of [
      MANIFEST_PATH,
      CURRENT_CANDIDATE_RECEIPT_PATH,
      CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH,
      PREDECESSOR_RECEIPT_PATH,
      HISTORICAL_B4_RECEIPT_PATH,
      "docs/plans/2026-07-14-xot-schema-privilege-diff.json",
      "src/integrations/supabase/types.ts",
      ARCHIVED_ALIAS_PATH,
      "scripts/build-migration-equivalence-manifest.mjs",
      "scripts/build-schema-privilege-diff.mjs",
      "scripts/check-migration-baseline.mjs",
      "scripts/check-migration-baseline.test.mjs",
      "scripts/build-e10-preview-migration-boundary-receipt.mjs",
      ...CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS,
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
      "package.json",
      ".github/workflows/ci.yml",
      "scripts/schema-privilege-evidence.mjs",
    ]) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(REPO_ROOT, relativePath), destination);
    }
    copyPredecessorInto(root);
    const fixtureMigrationsDir = join(root, "supabase/migrations");
    mkdirSync(fixtureMigrationsDir, { recursive: true });
    for (const filename of readdirSync(join(REPO_ROOT, "supabase/migrations"))) {
      cpSync(join(REPO_ROOT, "supabase/migrations", filename), join(fixtureMigrationsDir, filename));
    }
    const receiptPath = join(root, CURRENT_CANDIDATE_RECEIPT_PATH);
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(buildCurrentReceipt(root), null, 2)}\n`);
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readFixtureCurrentCandidate(root) {
  return JSON.parse(readFileSync(join(root, CURRENT_CANDIDATE_RECEIPT_PATH), "utf8"));
}

function writeFixtureCurrentCandidate(root, receipt) {
  writeFileSync(join(root, CURRENT_CANDIDATE_RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`);
}

function writeFixtureManifest(root, manifest) {
  writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
}

function inventoryHash(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

function makeRemoteFixture() {
  const rows = [
    { version: "20260101000000", name: "one", statements: ["select 1;"] },
    { version: "20260102000000", name: "two", statements: ["select 2;"] },
  ];
  return {
    manifest: {
      project_ref: "test-project",
      observed_entries: rows.map((row) => ({
        id: `remote:${row.version}`,
        side: "remote",
        version: row.version,
        name: row.name,
        sha256: sha256(row.statements.join("\n")),
        statement_count: row.statements.length,
        body_available: true,
      })),
    },
    payload: {
      export_contract: REMOTE_EXPORT_CONTRACT,
      project_ref: "test-project",
      captured_at: "2026-07-14T12:00:00Z",
      source: {
        service: "postgres",
        relation: "supabase_migrations.schema_migrations",
        statement_serialization: "statements.join(LF)",
        capture_tool: "supabase-mcp:execute_sql",
        query_sha256: REMOTE_QUERY_SHA256,
      },
      rows,
    },
  };
}

function serializeEvidencePackage(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function ownerEvidencePackage(manifest) {
  const entries = manifest.observed_entries
    .filter((entry) => entry.review_status === "owner_approved")
    .map((entry) => ({
      id: entry.id,
      sha256: entry.sha256,
      disposition: entry.disposition,
      decision: "approved",
    }));
  return {
    contract: "xot-owner-review-evidence-v1",
    reviewed_git_sha: manifest.candidate.reviewed_git_sha,
    reviewer: entries.length > 0
      ? manifest.observed_entries.find((entry) => entry.review_status === "owner_approved").review.reviewer
      : null,
    entries,
  };
}

function gateEvidencePackage(manifest) {
  return {
    contract: "xot-gate-closure-evidence-v1",
    reviewed_git_sha: manifest.candidate.reviewed_git_sha,
    gates: manifest.blockers
      .filter((blocker) => blocker.status === "resolved")
      .map((blocker) => ({
        gate_id: blocker.id,
        receipt_contract: blocker.receipt.contract,
        decision: blocker.receipt.decision,
        reviewer: blocker.receipt.reviewer,
        reviewed_at: blocker.resolved_at,
        checks: GATE_REQUIRED_CHECKS[blocker.id].map((name) => {
          const artifactPath = `protected-evidence/gate-checks/${blocker.id}-${name}.json`;
          return {
            name,
            status: "passed",
            artifact_path: artifactPath,
            artifact_sha256: sha256(serializeEvidencePackage(gateCheckArtifact(manifest, blocker.id, name))),
          };
        }),
      })),
  };
}

function gateCheckArtifact(manifest, gateId, checkName) {
  return {
    contract: "xot-gate-check-artifact-v1",
    gate_id: gateId,
    check_name: checkName,
    reviewed_git_sha: manifest.candidate.reviewed_git_sha,
    result: "passed",
  };
}

function resolveManifest(manifest, reviewedGitSha = REVIEWED_GIT_SHA) {
  const resolvedAt = "2026-07-14T12:00:00Z";
  manifest.candidate.reviewed_git_sha = reviewedGitSha;
  for (const entry of manifest.observed_entries) {
    if (entry.review_status === "candidate_pending_owner_review") {
      entry.review_status = "owner_approved";
      const reviewer = "database-owner:test-fixture";
      entry.review = {
        reviewer,
        reviewed_at: resolvedAt,
        evidence_receipt: {
          contract: "xot-migration-owner-review-v1",
          entry_id: entry.id,
          decision: "approved",
          disposition: entry.disposition,
          reviewed_sha256: entry.sha256,
          reviewed_git_sha: reviewedGitSha,
          reviewer,
          reviewed_at: resolvedAt,
          evidence: [],
        },
      };
    }
  }
  const ownerPackageHash = sha256(serializeEvidencePackage(ownerEvidencePackage(manifest)));
  for (const entry of manifest.observed_entries) {
    if (entry.review_status === "owner_approved") {
      entry.review.evidence_receipt.evidence = [{
        path: "protected-evidence/owner-review-package.json",
        sha256: ownerPackageHash,
      }];
    }
  }
  manifest.candidate.status = "accepted";
  manifest.candidate.replay.acceptance_result = "accepted";
  manifest.candidate.replay.outbound_isolation = "proven_no_egress";
  manifest.candidate.recovery.status = "accepted";
  manifest.candidate.privilege_review.status = "approved";
  manifest.candidate.remote_body_resolution.status = "approved";
  manifest.candidate.hosted_ci.status = "passed";
  manifest.candidate.generated_types.checked_in_status = "current";
  manifest.candidate.generated_types.checked_in_sha256 =
    manifest.candidate.generated_types.production_sha256;
  const receiptContracts = {
    "replay-egress": "xot-replay-egress-receipt-v1",
    "restore-readiness": "xot-restore-drill-receipt-v1",
    "owner-review": "xot-owner-review-closure-v1",
    "remote-body-missing": "xot-remote-body-resolution-v1",
    "privilege-drift": "xot-privilege-review-receipt-v1",
    "types-stale": "xot-types-trust-receipt-v1",
    "hosted-ci": "xot-hosted-ci-receipt-v1",
  };
  for (const blocker of manifest.blockers) {
    blocker.status = "resolved";
    blocker.resolved_at = resolvedAt;
    blocker.receipt = {
      contract: receiptContracts[blocker.id],
      gate_id: blocker.id,
      decision: "accepted",
      reviewer: "release-owner:test-fixture",
      reviewed_at: resolvedAt,
      reviewed_git_sha: reviewedGitSha,
      evidence: [],
    };
  }
  const gatePackageHash = sha256(serializeEvidencePackage(gateEvidencePackage(manifest)));
  for (const blocker of manifest.blockers) {
    blocker.receipt.evidence = [{
      path: "protected-evidence/gate-closure-package.json",
      sha256: gatePackageHash,
    }];
  }
  return manifest;
}

function activeMigrationPath(root, version) {
  const migrationsDir = join(root, "supabase/migrations");
  const filename = readdirSync(migrationsDir).find((name) => name.startsWith(`${version}_`) && name.endsWith(".sql"));
  assert.ok(filename, `fixture migration ${version} exists`);
  return join(migrationsDir, filename);
}

function buildEndToEndReleaseFixture(root) {
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "config", "user.name", "XOT Test"]);
  execFileSync("git", ["-C", root, "config", "user.email", "xot-test@example.invalid"]);
  let manifest = readFixtureManifest(root);
  const archivedAlias = manifest.observed_entries.find((entry) => entry.id === "local:20250903140000");
  const archivedAliasBody = readFileSync(join(root, ARCHIVED_ALIAS_PATH), "utf8");
  archivedAlias.sha256 = sha256(archivedAliasBody);
  archivedAlias.sha256_without_terminal_lf = sha256(
    archivedAliasBody.endsWith("\n") ? archivedAliasBody.slice(0, -1) : archivedAliasBody,
  );
  manifest.methodology.protected_input_hashes.observed_local_inventory_sha256 = inventoryHash(
    manifest.observed_entries.filter((entry) => entry.side === "local"),
  );
  const remoteRows = manifest.observed_entries
    .filter((entry) => entry.side === "remote")
    .map((entry) => {
      let statements = [];
      if (entry.review_status === "hash_proven") {
        const localVersion = entry.counterpart_id.split(":")[1];
        statements = [readFileSync(activeMigrationPath(root, localVersion), "utf8")];
      } else if (entry.restored_local_path) {
        const restoredBody = readFileSync(join(root, entry.restored_local_path), "utf8");
        statements = [restoredBody.endsWith("\n") ? restoredBody.slice(0, -1) : restoredBody];
      }
      const body = statements.join("\n");
      entry.sha256 = sha256(body);
      entry.statement_count = statements.length;
      entry.body_available = statements.length > 0;
      entry.body_bytes = Buffer.byteLength(body);
      return { version: entry.version, name: entry.name ?? "", statements };
    });
  writeFixtureManifest(root, manifest);
  execFileSync("git", ["-C", root, "add", "--all"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "reviewed code candidate"]);
  const reviewedGitSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const capturedAt = new Date().toISOString();
  const remotePayload = {
    export_contract: REMOTE_EXPORT_CONTRACT,
    project_ref: manifest.project_ref,
    captured_at: capturedAt,
    source: {
      service: "postgres",
      relation: "supabase_migrations.schema_migrations",
      statement_serialization: "statements.join(LF)",
      capture_tool: "supabase-mcp:execute_sql",
      query_sha256: REMOTE_QUERY_SHA256,
    },
    rows: remoteRows,
  };
  const evidenceDir = join(root, "protected-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const remoteJsonPath = join(evidenceDir, "remote.json");
  const remoteRaw = `${JSON.stringify(remotePayload)}\n`;
  writeFileSync(remoteJsonPath, remoteRaw);
  manifest.methodology.protected_input_hashes.remote_export_sha256 = sha256(remoteRaw);

  manifest = resolveManifest(manifest, reviewedGitSha);
  writeFileSync(
    join(evidenceDir, "owner-review-package.json"),
    serializeEvidencePackage(ownerEvidencePackage(manifest)),
  );
  for (const blocker of manifest.blockers) {
    for (const checkName of GATE_REQUIRED_CHECKS[blocker.id]) {
      const artifactPath = join(evidenceDir, "gate-checks", `${blocker.id}-${checkName}.json`);
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, serializeEvidencePackage(gateCheckArtifact(manifest, blocker.id, checkName)));
    }
  }
  writeFileSync(
    join(evidenceDir, "gate-closure-package.json"),
    serializeEvidencePackage(gateEvidencePackage(manifest)),
  );
  const replaySchemaPath = join(evidenceDir, "replay-schema.sql");
  const productionSchemaPath = join(evidenceDir, "production-schema.sql");
  const replaySchema = "CREATE TABLE public.fixture (id bigint);\n";
  const productionSchema = "CREATE TABLE public.fixture (id bigint);\n";
  writeFileSync(replaySchemaPath, replaySchema);
  writeFileSync(productionSchemaPath, productionSchema);
  const schemaFacts = buildSchemaPrivilegeFacts(replaySchema, productionSchema);
  manifest.candidate.schema_diff.replay_sha256 = schemaFacts.source.replay.sha256;
  manifest.candidate.schema_diff.production_sha256 = schemaFacts.source.production.sha256;
  manifest.candidate.schema_diff.non_privilege_sha256 = schemaFacts.non_privilege_schema.replay_sha256;
  manifest.candidate.privilege_review = {
    status: "approved",
    differing_records: schemaFacts.privileges.differing_records,
    production_broader_records: schemaFacts.privileges.production_broader_records,
    replay_broader_records: schemaFacts.privileges.replay_broader_records,
    different_records: schemaFacts.privileges.different_records,
    default_privilege_replay_only: schemaFacts.defaultPrivilegeCounts.replay_only,
    default_privilege_production_only: schemaFacts.defaultPrivilegeCounts.production_only,
  };

  const privilegePath = join(root, "docs/plans/2026-07-14-xot-schema-privilege-diff.json");
  const privilegeReceipt = JSON.parse(readFileSync(privilegePath, "utf8"));
  privilegeReceipt.source = schemaFacts.source;
  privilegeReceipt.non_privilege_schema = schemaFacts.non_privilege_schema;
  privilegeReceipt.privileges = schemaFacts.privileges;
  privilegeReceipt.assessment.status = "approved";
  privilegeReceipt.default_privilege_assessment.status = "approved";
  Object.assign(privilegeReceipt.default_privilege_assessment, schemaFacts.defaultPrivilegeCounts);
  privilegeReceipt.disposition.status = "approved";
  writeFileSync(privilegePath, `${JSON.stringify(privilegeReceipt, null, 2)}\n`);

  const productionTypesPath = join(evidenceDir, "production-types.ts");
  const productionTypes = readFileSync(join(root, "src/integrations/supabase/types.ts"));
  writeFileSync(productionTypesPath, productionTypes);
  const typesHash = sha256(productionTypes);
  manifest.candidate.generated_types.production_sha256 = typesHash;
  manifest.candidate.generated_types.checked_in_sha256 = typesHash;
  manifest.candidate.generated_types.checked_in_status = "current";
  const typesReceiptPath = join(evidenceDir, "production-types-receipt.json");
  writeFileSync(typesReceiptPath, `${JSON.stringify({
    contract: TYPES_EVIDENCE_CONTRACT,
    project_ref: manifest.project_ref,
    schema: "public",
    captured_at: capturedAt,
    reviewed_git_sha: manifest.candidate.reviewed_git_sha,
    output_sha256: typesHash,
    source: {
      command: "supabase gen types typescript --linked --schema public",
      tool_version: "fixture",
      schema_dump_sha256: manifest.candidate.schema_diff.production_sha256,
    },
  }, null, 2)}\n`);
  writeFixtureManifest(root, manifest);
  execFileSync("git", ["-C", root, "add", MANIFEST_PATH, "docs/plans/2026-07-14-xot-schema-privilege-diff.json"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "attach release evidence"]);
  return {
    remoteJsonPath,
    replaySchemaPath,
    productionSchemaPath,
    productionTypesPath,
    typesReceiptPath,
  };
}

test("normal mode verifies the full current tree against the standalone candidate receipt", () =>
  withCurrentTreeFixture((root) => {
    const result = validateMigrationBaseline({ root });
    assert.equal(result.releaseReady, false);
    assert.equal(result.currentCandidateChecked, true);
    assert.equal(result.currentCandidateActiveCount, CURRENT_CANDIDATE_MIGRATION_COUNT);
  }));

test("current candidate validation rejects a missing receipt", () =>
  withCurrentTreeFixture((root) => {
    rmSync(join(root, CURRENT_CANDIDATE_RECEIPT_PATH));
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate successor receipt missing|current candidate receipt missing/,
    );
  }));

test("normal mode refuses a protected-manifest binding that was dropped from the receipt", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    delete receipt.currentCandidate.protectedManifestSha256;
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt protectedManifestSha256 is missing or invalid/,
    );
  }));

test("intact current candidate receipt validates cleanly", () =>
  withCurrentTreeFixture((root) => {
    const result = validateCurrentCandidateBaseline({ root, receiptPath: CURRENT_CANDIDATE_RECEIPT_PATH });
    assert.equal(result.checked, true);
    assert.equal(result.activeCount, CURRENT_CANDIDATE_MIGRATION_COUNT);
    assert.equal(
      readFixtureCurrentCandidate(root).currentCandidate.orderedInventorySha256,
      CURRENT_CANDIDATE_INVENTORY_SHA256,
    );
    assert.deepEqual(result.errors, []);
  }));

test("current candidate receipt binds the exact E10 evidence set and 124-entry latest inventory", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    assert.deepEqual(Object.keys(receipt.evidence).sort(), [...CURRENT_CANDIDATE_EVIDENCE_PATHS].sort());
    assert.equal(receipt.repository, ".");
    assert.equal(
      receipt.evidence["scripts/check-migration-baseline.test.mjs"],
      sha256(readFileSync(join(root, "scripts/check-migration-baseline.test.mjs"))),
    );
    assert.equal(
      receipt.evidence["scripts/build-e10-preview-migration-boundary-receipt.mjs"],
      sha256(readFileSync(join(root, "scripts/build-e10-preview-migration-boundary-receipt.mjs"))),
    );
    assert.equal(receipt.currentCandidate.versionCount, 124);
    assert.equal(receipt.currentCandidate.pathCount, 124);
    assert.equal(receipt.currentCandidate.orderedInventorySha256, CURRENT_CANDIDATE_INVENTORY_SHA256);
    assert.deepEqual(receipt.currentCandidate.migrations.at(-1), {
      version: "20260812100000",
      path: "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql",
      sha256: sha256(readFileSync(join(root, "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql"))),
    });
  }));

function readFixtureRuntimeReceipt(root) {
  return JSON.parse(readFileSync(join(root, CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH), "utf8"));
}

function writeFixtureRuntimeReceipt(root, receipt) {
  writeFileSync(join(root, CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`);
}

test("E10 SQL runtime receipt keeps the exact local-only acceptance boundary", () =>
  withCurrentTreeFixture((root) => {
    const runtime = readFixtureRuntimeReceipt(root);
    assert.equal(runtime.status, CURRENT_CANDIDATE_RUNTIME_STATUS);
    assert.deepEqual(runtime.runtimeAcceptance.acceptedRun.stdout, CURRENT_CANDIDATE_RUNTIME_STDOUT);
    assert.deepEqual(Object.keys(runtime.evidence).sort(), [...CURRENT_CANDIDATE_RUNTIME_EVIDENCE_PATHS].sort());
    assert.equal(validateCurrentCandidateBaseline({ root }).checked, true);
  }));

test("E10 SQL runtime receipt rejects exit, duration, stdout, cleanup, resource, contact, release, and hash mutations", () =>
  withCurrentTreeFixture((root) => {
    const runtime = readFixtureRuntimeReceipt(root);
    const mutations = [
      ["capture exit", (runtime) => { runtime.runtimeAcceptance.acceptedRun.captureExitCode = 1; }],
      ["duration", (runtime) => { runtime.runtimeAcceptance.acceptedRun.durationMs = 23071; }],
      ["nested status", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.status = "FAILED"; }],
      ["image", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.image = "wrong"; }],
      ["migration count", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.migrationCount = 123; }],
      ["inventory", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.inventorySha256 = "0".repeat(64); }],
      ["migration hash", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.migrationSha256 = "0".repeat(64); }],
      ["cleanup", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.cleanup = "failed"; }],
      ["signal", (runtime) => { runtime.runtimeAcceptance.acceptedRun.stdout.signal = "SIGTERM"; }],
      ["resource flags", (runtime) => { runtime.resourceIntegrity.skillmapIdsNamesStatesUnchanged = false; }],
      ["harness hash", (runtime) => { runtime.evidence[CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS[0]] = "0".repeat(64); }],
      ["no contact", (runtime) => { runtime.isolation.noExternalContact = false; }],
      ["release", (runtime) => { runtime.releaseGate = "OPEN"; }],
    ];
    for (const [label, mutate] of mutations) {
      const mutated = structuredClone(runtime);
      mutate(mutated);
      writeFixtureRuntimeReceipt(root, mutated);
      const result = validateCurrentCandidateBaseline({ root });
      assert.equal(result.checked, false, `${label} mutation must fail closed`);
      assert.ok(result.errors.length > 0, `${label} mutation must produce an error`);
    }
  }));

test("accepted E10 aggregate rejects a missing or mutated runtime receipt", () =>
  withCurrentTreeFixture((root) => {
    rmSync(join(root, CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH));
    const missing = validateCurrentCandidateBaseline({ root });
    assert.equal(missing.checked, false);
    assert.ok(missing.errors.some((error) => error.includes("runtime receipt missing")));
  }));

test("accepted E10 aggregate rejects a runtime receipt hash binding mutation", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.runtimeReceipt.sha256 = "0".repeat(64);
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((error) => error.includes("runtimeReceipt SHA-256")));
  }));

test("coordinated latest-migration tampering remains rejected by the fixed 124 inventory hash", () =>
  withCurrentTreeFixture((root) => {
    const migrationPath = join(root, "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql");
    const tamperedBody = `${readFileSync(migrationPath, "utf8")}\n-- coordinated tamper\n`;
    writeFileSync(migrationPath, tamperedBody);
    const tamperedSha = sha256(tamperedBody);
    const receipt = readFixtureCurrentCandidate(root);
    const latest = receipt.currentCandidate.migrations.at(-1);
    latest.sha256 = tamperedSha;
    receipt.evidence["supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql"] = tamperedSha;
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateSuccessorBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((error) => error.includes("ordered inventory SHA-256")));
  }));

test("current candidate validation rejects a stale declared evidence hash", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    const evidencePath = "supabase/functions/_shared/appRole.ts";
    receipt.evidence[evidencePath] = "0".repeat(64);
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.includes(`current candidate receipt evidence hash mismatch: ${evidencePath}`));
  }));

test("E10 candidate rejects an inflated accepted-local disposable status", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.status = "CANDIDATE_PENDING_LOCAL_SQL_T1";
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((error) => error.includes("status must be ACCEPTED_LOCAL_SQL_T1")));
  }));

test("current candidate validation rejects missing and unexpected evidence paths", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    const missingPath = CURRENT_CANDIDATE_EVIDENCE_PATHS[0];
    delete receipt.evidence[missingPath];
    receipt.evidence["README.md"] = sha256("unexpected");
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.includes(`current candidate receipt evidence path missing: ${missingPath}`));
    assert.ok(result.errors.includes("current candidate receipt evidence path is unexpected: README.md"));
  }));

test("current candidate validation rejects an evidence symlink that escapes the fixture root", () =>
  withCurrentTreeFixture((root) => {
    const outside = mkdtempSync(join(tmpdir(), "xot-e10-evidence-outside-"));
    try {
      const evidencePath = "supabase/functions/_shared/appRole.ts";
      const outsidePath = join(outside, "outside.mjs");
      writeFileSync(outsidePath, "export const outside = true;\n");
      rmSync(join(root, evidencePath));
      symlinkSync(outsidePath, join(root, evidencePath));
      const receipt = readFixtureCurrentCandidate(root);
      receipt.evidence[evidencePath] = sha256(readFileSync(outsidePath));
      writeFixtureCurrentCandidate(root, receipt);
      const result = validateCurrentCandidateBaseline({ root });
      assert.equal(result.checked, false);
      assert.ok(result.errors.includes(`current candidate receipt evidence path escapes repository root: ${evidencePath}`));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }));

test("successor baseline verifies the exact E7 predecessor hash binding", () =>
  withCurrentTreeFixture((root) => {
    const result = validateCurrentCandidateSuccessorBaseline({ root });
    assert.equal(result.checked, true);
    assert.equal(result.predecessorBinding.predecessorSha256, sha256(readFileSync(join(root, PREDECESSOR_RECEIPT_PATH))));
    assert.equal(result.activeCount, CURRENT_CANDIDATE_MIGRATION_COUNT);
  }));

test("successor baseline fails when the declared predecessor hash does not match E7", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.currentCandidate[PREDECESSOR_BINDING_FIELD] = "0".repeat(64);
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateSuccessorBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((e) => e.includes("predecessor receipt binding mismatch")));
  }));

test("successor baseline rejects a coordinated E7 mutation with regenerated E10 predecessor hashes", () =>
  withCurrentTreeFixture((root) => {
    const predecessorPath = join(root, PREDECESSOR_RECEIPT_PATH);
    const mutatedPredecessor = `${readFileSync(predecessorPath, "utf8")}\n// coordinated mutation\n`;
    writeFileSync(predecessorPath, mutatedPredecessor);
    const mutatedSha = sha256(mutatedPredecessor);
    const receipt = readFixtureCurrentCandidate(root);
    receipt.predecessor.sha256 = mutatedSha;
    receipt.currentCandidate[PREDECESSOR_BINDING_FIELD] = mutatedSha;
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateSuccessorBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((error) => error.includes("authorized immutable value")));
  }));

test("normal mode fails when the successor receipt drops its E7 predecessor binding", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    delete receipt.currentCandidate[PREDECESSOR_BINDING_FIELD];
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /must declare a predecessorReceiptSha256/,
    );
  }));

test("successor baseline fails when the predecessor binding field is absent", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    delete receipt.currentCandidate[PREDECESSOR_BINDING_FIELD];
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateSuccessorBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((e) => e.includes("predecessorReceiptSha256")));
  }));

test("historical B4 receipt remains a frozen 117-entry record with its older 20260806143000 hash", () => {
  const historical = readManifest(join(REPO_ROOT, HISTORICAL_B4_RECEIPT_PATH));
  assert.equal(historical.currentCandidateContract, HISTORICAL_B4_RECEIPT_CONTRACT);
  assert.equal(historical.currentCandidate.versionCount, 117);
  assert.equal(
    historical.currentCandidate.migrations.find((entry) => entry.version === HISTORICAL_B4_MIGRATION_VERSION).sha256,
    HISTORICAL_B4_MIGRATION_SHA256,
  );
});

test("historical B4 inventory rejects a coordinated non-transition entry mutation", () =>
  withCurrentTreeFixture((root) => {
    const historicalPath = join(root, HISTORICAL_B4_RECEIPT_PATH);
    const historical = JSON.parse(readFileSync(historicalPath, "utf8"));
    const mutatedEntry = historical.currentCandidate.migrations.find(
      (entry) => entry.version !== HISTORICAL_B4_MIGRATION_VERSION,
    );
    mutatedEntry.sha256 = "0".repeat(64);
    const historicalRaw = `${JSON.stringify(historical, null, 2)}\n`;
    writeFileSync(historicalPath, historicalRaw);
    const receipt = readFixtureCurrentCandidate(root);
    receipt.historicalBaseline.receiptSha256 = sha256(historicalRaw);
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.some((error) => (
      error.includes("historical B4") || error.includes("frozen inventory")
    )));
  }));

test("historical B4 receipt replacement is rejected even when E10 updates its declared hash", () =>
  withCurrentTreeFixture((root) => {
    const historicalPath = join(root, HISTORICAL_B4_RECEIPT_PATH);
    const historical = JSON.parse(readFileSync(historicalPath, "utf8"));
    historical.event = "replacement-not-authorized";
    const historicalRaw = `${JSON.stringify(historical, null, 2)}\n`;
    writeFileSync(historicalPath, historicalRaw);
    const receipt = readFixtureCurrentCandidate(root);
    receipt.historicalBaseline.receiptSha256 = sha256(historicalRaw);
    writeFixtureCurrentCandidate(root, receipt);
    const result = validateCurrentCandidateBaseline({ root });
    assert.equal(result.checked, false);
    assert.ok(result.errors.includes("historical B4 receipt hash mismatch"));
  }));

test("normal mode rejects an E10 candidate that claims acceptance or production boundary evidence", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.status = "ACCEPTED";
    receipt.claims.productionSchema = "equivalent";
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt status must be ACCEPTED_LOCAL_SQL_T1|must mark productionSchema as not_claimed/,
    );
  }));

test("successor baseline fails when an extra migration is present (124 -> 125)", () =>
  withCurrentTreeFixture((root) => {
    writeFileSync(join(root, "supabase/migrations/29990101000000_extra_hidden.sql"), "select 1;\n");
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current migration file is not listed in the receipt/,
    );
  }));

test("successor baseline is chained: the applied migration count is 124", () =>
  withCurrentTreeFixture((root) => {
    const result = validateMigrationBaseline({ root });
    assert.equal(result.currentCandidateActiveCount, CURRENT_CANDIDATE_MIGRATION_COUNT);
    assert.equal(result.currentCandidateChecked, true);
  }));

test("normal mode fails when the top-level currentCandidateContract is missing", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    delete receipt.currentCandidateContract;
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt contract mismatch/,
    );
  }));

test("normal mode refuses a nested-only current-candidate schema", () =>
  withCurrentTreeFixture((root) => {
    // The single authoritative field is the top-level currentCandidateContract. A nested candidate
    // schema alone must NOT be accepted.
    const receipt = readFixtureCurrentCandidate(root);
    delete receipt.currentCandidateContract;
    receipt.currentCandidate.schema = "xot-b4-current-candidate-v1";
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt contract mismatch/,
    );
  }));

test("normal mode fails on an exact-but-wrong currentCandidateContract value", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.currentCandidateContract = "xot-b4-current-candidate-v2";
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt contract mismatch/,
    );
  }));

test("F1: an extra unlisted migration file fails closed in normal mode", () =>
  withCurrentTreeFixture((root) => {
    writeFileSync(
      join(root, "supabase/migrations/29990101000000_extra_hidden.sql"),
      "select 1;\n",
    );
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current migration file is not listed in the receipt/,
    );
  }));

test("F1: an extra same-content migration under a variant new version fails closed", () =>
  withCurrentTreeFixture((root) => {
    // Content clone of an existing migration under an unlisted new version must still be rejected.
    const source = readFileSync(activeMigrationPath(root, "20250902164607"), "utf8");
    writeFileSync(join(root, "supabase/migrations/29990102000000_variant_clone.sql"), source);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current migration file is not listed in the receipt/,
    );
  }));

test("F2: a traversal receipt path is rejected in normal mode", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    receipt.currentCandidate.migrations[0].path = "supabase/migrations/../../escape-probe.txt";
    receipt.currentCandidate.migrations[0].sha256 = sha256("escape payload\n");
    writeFileSync(join(root, "escape-probe.txt"), "escape payload\n");
    writeFixtureCurrentCandidate(root, receipt);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /unsafe or non-canonical path|escapes the migrations root/,
    );
  }));

test("F2: a symlink escape is rejected in normal mode", () =>
  withCurrentTreeFixture((root) => {
    const originalPath = activeMigrationPath(root, "20250902164607");
    const outside = join(root, "outside-target.sql");
    const originalBody = readFileSync(originalPath);
    writeFileSync(outside, originalBody);
    rmSync(originalPath);
    symlinkSync(outside, originalPath);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /escapes the migrations root|resolves to a foreign file/,
    );
  }));

test("shape validation rejects duplicate and invented dispositions", () => {
  const manifest = readManifest();
  manifest.observed_entries[1].id = manifest.observed_entries[0].id;
  manifest.observed_entries[2].disposition = "unknown";
  const errors = validateManifestShape(manifest);
  assert.ok(errors.some((error) => error.startsWith("duplicate entry id")));
  assert.ok(errors.some((error) => error.startsWith("invalid disposition")));
});

test("shape validation rejects acceptance while blockers remain", () => {
  const manifest = readManifest();
  manifest.candidate.status = "accepted";
  assert.ok(validateManifestShape(manifest).includes("candidate status must not claim acceptance while blockers remain"));
});

test("a fully resolved manifest has a satisfiable release state", () => {
  const manifest = resolveManifest(readManifest());
  assert.deepEqual(validateManifestShape(manifest), []);
  assert.deepEqual(evaluateReleaseReadiness(manifest, { checked: true }, {
    schemaEvidenceChecked: true,
    typesEvidenceChecked: true,
  }), []);
});

test("a fully evidenced release passes the end-to-end release gate", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const result = validateMigrationBaseline({ root, releaseGate: true, ...evidence });
    assert.equal(result.releaseReady, true);
    assert.equal(result.remoteSnapshotChecked, true);
    assert.ok(result.typesEvidenceCapturedAt);
  }));

test("release gate ignores the author's current-candidate receipt and enforces the protected 107 candidate", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    // A fully-evidenced release over the frozen 107 candidate passes. The author-created 124-entry
    // current-candidate receipt must NOT be consulted in release mode; release equivalence stays
    // bound to the protected candidate, which has not adopted the forward files.
    const result = validateMigrationBaseline({ root, releaseGate: true, ...evidence });
    assert.equal(result.releaseReady, true);
  }));

test("release mode fails closed when a forward migration is present but not adopted into the candidate", () =>
  withCurrentTreeFixture((root) => {
    // The 124-entry current candidate satisfies normal mode, but the frozen 107 protected candidate
    // has not adopted the forwards, so the release gate fails closed on the version-set shift.
    const evidence = buildEndToEndReleaseFixture(root);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /active migration versions differ from the reviewed candidate inventory/,
    );
  }));

test("release schema dumps must reproduce every committed privilege fact", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const productionSchema = `${readFileSync(evidence.productionSchemaPath, "utf8")}GRANT SELECT ON TABLE public.fixture TO anon;\n`;
    writeFileSync(evidence.productionSchemaPath, productionSchema);
    const replaySchema = readFileSync(evidence.replaySchemaPath, "utf8");
    const changedFacts = buildSchemaPrivilegeFacts(replaySchema, productionSchema);
    const manifest = readFixtureManifest(root);
    manifest.candidate.schema_diff.production_sha256 = changedFacts.source.production.sha256;
    writeFixtureManifest(root, manifest);
    const privilegePath = join(root, "docs/plans/2026-07-14-xot-schema-privilege-diff.json");
    const privilegeReceipt = JSON.parse(readFileSync(privilegePath, "utf8"));
    privilegeReceipt.source = changedFacts.source;
    writeFileSync(privilegePath, `${JSON.stringify(privilegeReceipt, null, 2)}\n`);
    const typesReceipt = JSON.parse(readFileSync(evidence.typesReceiptPath, "utf8"));
    typesReceipt.source.schema_dump_sha256 = changedFacts.source.production.sha256;
    writeFileSync(evidence.typesReceiptPath, `${JSON.stringify(typesReceipt, null, 2)}\n`);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /schema evidence grants\/default privileges do not reproduce the privilege receipt/,
    );
  }));

test("schema grants and revokes remain inside the privilege comparison", () => {
  const replay = [
    "CREATE TABLE public.fixture (id bigint);",
    "REVOKE ALL ON SCHEMA public FROM PUBLIC;",
    "",
  ].join("\n");
  const production = [
    "CREATE TABLE public.fixture (id bigint);",
    "GRANT USAGE ON SCHEMA public TO anon;",
    "",
  ].join("\n");
  const facts = buildSchemaPrivilegeFacts(replay, production);
  assert.equal(facts.non_privilege_schema.expected_empty, true);
  assert.equal(facts.privileges.differing_records, 2);
  assert.deepEqual(new Set(facts.privileges.differences.map((item) => item.statement)), new Set(["grant", "revoke"]));
  assert.ok(facts.privileges.differences.every((item) => item.object_type === "schema"));
});

test("owner evidence packages are secret-scanned after integrity verification", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const ownerPath = join(root, "protected-evidence/owner-review-package.json");
    const ownerPackage = JSON.parse(readFileSync(ownerPath, "utf8"));
    ownerPackage.fixture_note = ["sbp", "1234567890abcdef1234567890abcdef"].join("_");
    const ownerRaw = serializeEvidencePackage(ownerPackage);
    writeFileSync(ownerPath, ownerRaw);
    const manifest = readFixtureManifest(root);
    for (const entry of manifest.observed_entries) {
      if (entry.review_status === "owner_approved") {
        entry.review.evidence_receipt.evidence[0].sha256 = sha256(ownerRaw);
      }
    }
    writeFixtureManifest(root, manifest);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /owner review evidence .* contains Supabase personal access token/,
    );
  }));

test("evidence symlinks escaping the repository are rejected", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const ownerPath = join(root, "protected-evidence/owner-review-package.json");
    const outsidePath = join(tmpdir(), `xot-evidence-outside-${process.pid}.json`);
    const ownerRaw = readFileSync(ownerPath);
    try {
      writeFileSync(outsidePath, ownerRaw);
      rmSync(ownerPath);
      symlinkSync(outsidePath, ownerPath);
      assert.throws(
        () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
        /evidence path escapes repository root/,
      );
    } finally {
      rmSync(outsidePath, { force: true });
    }
  }));

test("direct release evidence inputs cannot escape the reviewed repository", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const outsideRoot = mkdtempSync(join(tmpdir(), "xot-migration-outside-"));
    try {
      const outside = {};
      for (const [name, sourcePath] of Object.entries({
        remoteJsonPath: evidence.remoteJsonPath,
        replaySchemaPath: evidence.replaySchemaPath,
        productionSchemaPath: evidence.productionSchemaPath,
        productionTypesPath: evidence.productionTypesPath,
        typesReceiptPath: evidence.typesReceiptPath,
      })) {
        const destination = join(outsideRoot, name);
        cpSync(sourcePath, destination);
        outside[name] = destination;
      }
      assert.throws(
        () => validateMigrationBaseline({ root, releaseGate: true, ...outside }),
        /evidence path escapes repository root/,
      );
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  }));

test("gate evidence packages require passed gate-specific checks", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const gatePath = join(root, "protected-evidence/gate-closure-package.json");
    const gatePackage = JSON.parse(readFileSync(gatePath, "utf8"));
    gatePackage.gates[0].checks[0].status = "failed";
    const gateRaw = serializeEvidencePackage(gatePackage);
    writeFileSync(gatePath, gateRaw);
    const manifest = readFixtureManifest(root);
    for (const blocker of manifest.blockers) blocker.receipt.evidence[0].sha256 = sha256(gateRaw);
    writeFixtureManifest(root, manifest);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /gate evidence package does not prove replay-egress/,
    );
  }));

test("release mode requires a clean reviewed-code plus evidence-commit chain", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const manifestPath = join(root, MANIFEST_PATH);
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n`);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /release checkout has uncommitted tracked changes/,
    );
  }));

test("release mode rejects unrelated untracked source beside protected evidence", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    writeFileSync(join(root, "src/untracked-release-source.ts"), "export const untracked = true;\n");
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /release checkout has untracked files outside protected evidence: .*src\/untracked-release-source\.ts/,
    );
  }));

test("evidence commits cannot rewrite immutable migration manifest facts", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const manifest = readFixtureManifest(root);
    const historicalEntry = manifest.observed_entries.find(
      (entry) => entry.side === "remote" && entry.review_status === "owner_approved",
    );
    historicalEntry.evidence = "tampered after reviewed parent";
    writeFixtureManifest(root, manifest);
    execFileSync("git", ["-C", root, "add", MANIFEST_PATH]);
    execFileSync("git", ["-C", root, "commit", "--quiet", "--amend", "--no-edit"]);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /evidence commit changes immutable migration manifest facts from the reviewed parent/,
    );
  }));

test("owner approval rejects pending identities and self-asserted receipts", () => {
  const manifest = readManifest();
  const entry = manifest.observed_entries.find((item) => item.review_status === "candidate_pending_owner_review");
  entry.review_status = "owner_approved";
  entry.review.reviewed_at = "2026-07-14T12:00:00Z";
  entry.review.evidence_receipt = "self-asserted";
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("typed reviewer evidence")));
});

test("owner approval requires a valid reviewed Git SHA even while other gates remain blocked", () => {
  const manifest = resolveManifest(readManifest());
  manifest.candidate.reviewed_git_sha = undefined;
  for (const entry of manifest.observed_entries) {
    if (entry.review_status === "owner_approved") {
      entry.review.evidence_receipt.reviewed_git_sha = undefined;
    }
  }
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("typed reviewer evidence")));
});

test("owner approval rejects a mismatched reviewed Git SHA in the entry receipt", () => {
  const manifest = resolveManifest(readManifest());
  const entry = manifest.observed_entries.find((item) => item.review_status === "owner_approved");
  entry.review.evidence_receipt.reviewed_git_sha = "0".repeat(40);
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("typed reviewer evidence")));
});

test("resolved blocker closure rejects a mismatched reviewed Git SHA", () => {
  const manifest = resolveManifest(readManifest());
  manifest.blockers[0].receipt.reviewed_git_sha = "0".repeat(40);
  assert.ok(validateManifestShape(manifest).some((error) => error.startsWith("resolved blocker lacks closure receipt")));
});

test("external owner evidence rejects a mismatched reviewed Git SHA", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const ownerPath = join(root, "protected-evidence/owner-review-package.json");
    const ownerPackage = JSON.parse(readFileSync(ownerPath, "utf8"));
    ownerPackage.reviewed_git_sha = "0".repeat(40);
    const ownerRaw = serializeEvidencePackage(ownerPackage);
    writeFileSync(ownerPath, ownerRaw);
    const manifest = readFixtureManifest(root);
    for (const entry of manifest.observed_entries) {
      if (entry.review_status === "owner_approved") {
        entry.review.evidence_receipt.evidence[0].sha256 = sha256(ownerRaw);
      }
    }
    writeFixtureManifest(root, manifest);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /owner review evidence package does not prove /,
    );
  }));

test("protected input keys are mandatory", () => {
  const manifest = readManifest();
  manifest.methodology.protected_input_hashes = {};
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("missing protected input hashes")));
});

test("accepted replay without proven no-egress isolation is rejected", () => {
  const manifest = resolveManifest(readManifest());
  manifest.candidate.replay.outbound_isolation = "unproven";
  assert.ok(validateManifestShape(manifest).includes("accepted replay must have proven_no_egress isolation"));
});

test("resolved blockers require constrained status and closure receipts", () => {
  const manifest = readManifest();
  manifest.blockers[0].status = "waived_without_receipt";
  assert.ok(validateManifestShape(manifest).some((error) => error.startsWith("invalid blocker status")));
  manifest.blockers[0].status = "resolved";
  assert.ok(validateManifestShape(manifest).some((error) => error.startsWith("resolved blocker lacks closure receipt")));
});

test("shape validation rejects asymmetric, missing, and invented counterparts", () => {
  const manifest = readManifest();
  const paired = manifest.observed_entries.find((entry) => entry.id === "local:20250902164607");
  const counterpart = manifest.observed_entries.find((entry) => entry.id === paired.counterpart_id);
  paired.counterpart_id = null;
  counterpart.counterpart_id = null;
  const restored = manifest.observed_entries.find((entry) => entry.id === "remote:20250904033120");
  restored.counterpart_id = "candidate-local:99999999999999";
  const errors = validateManifestShape(manifest);
  assert.ok(errors.some((error) => error.includes("missing counterpart for local:20250902164607")));
  assert.ok(errors.some((error) => error.includes("invalid candidate counterpart receipt")));
});

test("normalized matches cannot be relabeled as hash proof", () => {
  const manifest = readManifest();
  const entry = manifest.observed_entries.find((item) => item.disposition.includes("normalized_match"));
  entry.review_status = "hash_proven";
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("cannot be hash-proven")));
});

test("hash-proven labels require reciprocal raw hash equality", () => {
  const manifest = readManifest();
  const remote = manifest.observed_entries.find(
    (entry) => entry.side === "remote" && entry.disposition === "renamed_exact_equivalent",
  );
  remote.sha256 = "0".repeat(64);
  assert.ok(validateManifestShape(manifest).some((error) => error.includes("hash-proven counterpart SHA mismatch")));
});

test("release mode fails closed while migration gates remain", () => {
  assert.throws(
    () => validateMigrationBaseline({ releaseGate: true }),
    /Migration baseline validation failed:[\s\S]*requires protected replay and production schema evidence[\s\S]*requires fresh production types evidence/,
  );
});

test("active source tampering is rejected in normal mode", () =>
  withCurrentTreeFixture((root) => {
    const migration = activeMigrationPath(root, "20250902164607");
    writeFileSync(migration, `${readFileSync(migration, "utf8")}\n-- tampered\n`);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate source hash mismatch for 20250902164607/,
    );
  }));

test("coordinated active hash changes still fail against the current candidate receipt", () =>
  withCurrentTreeFixture((root) => {
    const migration = activeMigrationPath(root, "20250902164607");
    const body = `${readFileSync(migration, "utf8")}\n-- coordinated tamper\n`;
    writeFileSync(migration, body);
    // Coordinating the protected manifest hash does not help: the immutable current-candidate
    // receipt still pins the real identity of the current source body.
    const manifest = readFixtureManifest(root);
    manifest.candidate.active_source_hashes["20250902164607"] = sha256(body);
    writeFixtureManifest(root, manifest);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate source hash mismatch for 20250902164607/,
    );
  }));

test("reintroducing the retired alias into the executable chain is rejected", () =>
  withFixture((root) => {
    cpSync(
      join(root, ARCHIVED_ALIAS_PATH),
      join(root, "supabase/migrations/20250903140000_rpc_pipeline_status_and_retry.sql"),
    );
    assert.throws(() => validateMigrationBaseline({ root }), /demoted 20250903140000 alias is still executable/);
  }));

test("retired alias archive tampering is rejected in normal mode", () =>
  withCurrentTreeFixture((root) => {
    const archive = join(root, ARCHIVED_ALIAS_PATH);
    writeFileSync(archive, `${readFileSync(archive, "utf8")}\n-- tampered\n`);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt archive hash mismatch/,
    );
  }));

test("duplicate active migration versions are rejected in normal mode", () =>
  withCurrentTreeFixture((root) => {
    cpSync(
      activeMigrationPath(root, "20250902164607"),
      join(root, "supabase/migrations/20250902164607_duplicate.sql"),
    );
    assert.throws(() => validateMigrationBaseline({ root }), /duplicate active migration versions: 20250902164607/);
  }));

test("a renamed retained migration is rejected when its path drifts from the receipt", () =>
  withCurrentTreeFixture((root) => {
    const receipt = readFixtureCurrentCandidate(root);
    const entry = receipt.currentCandidate.migrations.find((item) => item.version === "20250902164607");
    const source = activeMigrationPath(root, "20250902164607");
    renameSync(source, join(root, "supabase/migrations/20250902164607_renamed.sql"));
    assert.throws(
      () => validateMigrationBaseline({ root }),
      new RegExp(`current candidate source file is missing: ${entry.path.replace(".", "\\.")}`),
    );
  }));

test("remote snapshots require an exact unique version set", () => {
  const { manifest, payload } = makeRemoteFixture();
  payload.rows[1] = { ...payload.rows[0] };
  const file = join(tmpdir(), `xot-remote-duplicate-${process.pid}.json`);
  try {
    writeFileSync(file, JSON.stringify(payload));
    const result = validateRemoteSnapshot(manifest, file, Date.parse("2026-07-14T12:01:00Z"));
    assert.ok(result.errors.some((error) => error.includes("duplicate versions")));
    assert.ok(result.errors.some((error) => error.includes("missing versions: 20260102000000")));
  } finally {
    rmSync(file, { force: true });
  }
});

test("remote snapshots require project, contract, and fresh capture metadata", () => {
  const { manifest, payload } = makeRemoteFixture();
  payload.project_ref = "wrong-project";
  payload.export_contract = "unknown";
  payload.captured_at = "2026-07-14T04:00:00Z";
  const file = join(tmpdir(), `xot-remote-metadata-${process.pid}.json`);
  try {
    writeFileSync(file, JSON.stringify(payload));
    const result = validateRemoteSnapshot(manifest, file, Date.parse("2026-07-14T12:01:00Z"));
    assert.ok(result.errors.some((error) => error.includes("remote export contract")));
    assert.ok(result.errors.some((error) => error.includes("project_ref")));
    assert.ok(result.errors.some((error) => error.includes("older than the six-hour")));
  } finally {
    rmSync(file, { force: true });
  }
});

test("remote snapshots require the committed source/query contract", () => {
  const { manifest, payload } = makeRemoteFixture();
  delete payload.source.capture_tool;
  payload.source.query_sha256 = "0".repeat(64);
  const file = join(tmpdir(), `xot-remote-source-${process.pid}.json`);
  try {
    writeFileSync(file, JSON.stringify(payload));
    const result = validateRemoteSnapshot(manifest, file, Date.parse("2026-07-14T12:01:00Z"));
    assert.ok(result.errors.includes("remote export source/query metadata is missing or invalid"));
  } finally {
    rmSync(file, { force: true });
  }
});

test("remote snapshots reject secret-bearing migration bodies", () => {
  const { manifest, payload } = makeRemoteFixture();
  const secret = ["sbp", "1234567890abcdef1234567890abcdef"].join("_");
  payload.rows[0].statements = [`select '${secret}';`];
  const remoteEntry = manifest.observed_entries.find((entry) => entry.version === payload.rows[0].version);
  remoteEntry.sha256 = sha256(payload.rows[0].statements.join("\n"));
  remoteEntry.statement_count = payload.rows[0].statements.length;
  remoteEntry.body_available = true;
  const file = join(tmpdir(), `xot-remote-secret-${process.pid}.json`);
  try {
    const raw = JSON.stringify(payload);
    writeFileSync(file, raw);
    manifest.methodology = { protected_input_hashes: { remote_export_sha256: sha256(raw) } };
    const result = validateRemoteSnapshot(manifest, file, Date.parse("2026-07-14T12:01:00Z"));
    assert.ok(result.errors.some((error) => error.includes("remote export contains Supabase personal access token")));
  } finally {
    rmSync(file, { force: true });
  }
});

test("incomplete remote snapshots are rejected", () => {
  const { manifest, payload } = makeRemoteFixture();
  payload.rows = [];
  const file = join(tmpdir(), `xot-remote-incomplete-${process.pid}.json`);
  try {
    writeFileSync(file, JSON.stringify(payload));
    const result = validateRemoteSnapshot(manifest, file, Date.parse("2026-07-14T12:01:00Z"));
    assert.ok(result.errors.includes("remote export has 0 rows, expected 2"));
  } finally {
    rmSync(file, { force: true });
  }
});

test("secret-like decoded and modern provider keys in the manifest are rejected", () =>
  withFixture((root) => {
    const manifest = readFixtureManifest(root);
    manifest[["test", "secret"].join("_")] = ["sb", "secret", "12345678", "90abcdef"].join("_");
    writeFixtureManifest(root, manifest);
    assert.throws(() => validateMigrationBaseline({ root }), /manifest contains Supabase secret key/);
  }));

test("Supabase personal access tokens are rejected", () =>
  withFixture((root) => {
    const manifest = readFixtureManifest(root);
    manifest["fixture_pat"] = ["sbp", "1234567890abcdef1234567890abcdef"].join("_");
    writeFixtureManifest(root, manifest);
    assert.throws(() => validateMigrationBaseline({ root }), /Supabase personal access token/);
  }));

test("unicode-escaped credentials are scanned after JSON decoding", () =>
  withFixture((root) => {
    const file = join(root, MANIFEST_PATH);
    const raw = readFileSync(file, "utf8").replace(
      '"schema_version":',
      '"test_secret":"\\u0065yJfake.payload.signature","schema_version":',
    );
    writeFileSync(file, raw);
    assert.throws(() => validateMigrationBaseline({ root }), /manifest contains JWT/);
  }));

test("secret-like material in restored and archived source is rejected", () =>
  withFixture((root) => {
    const restored = join(root, "supabase/migrations/20250904033120_add_core_pipeline_columns.sql");
    const fixtureValue = ["sb", "secret", "12345678", "90abcdef"].join("_");
    writeFileSync(restored, `${readFileSync(restored, "utf8")}\n-- ${fixtureValue}\n`);
    assert.throws(() => validateMigrationBaseline({ root }), /reviewed source .* contains Supabase secret key/);
  }));

test("checked-in type hash is recomputed in normal mode", () =>
  withCurrentTreeFixture((root) => {
    const types = join(root, "src/integrations/supabase/types.ts");
    writeFileSync(types, `${readFileSync(types, "utf8")}\n// tampered\n`);
    assert.throws(
      () => validateMigrationBaseline({ root }),
      /current candidate receipt checked-in types hash mismatch/,
    );
  }));

test("coordinated checked-in type rewrites fail without independent production evidence", () =>
  withFixture((root) => {
    const types = join(root, "src/integrations/supabase/types.ts");
    const body = `${readFileSync(types, "utf8")}\n// coordinated rewrite\n`;
    writeFileSync(types, body);
    const manifest = readFixtureManifest(root);
    manifest.candidate.generated_types.checked_in_sha256 = sha256(body);
    manifest.candidate.generated_types.production_sha256 = sha256(body);
    manifest.candidate.generated_types.checked_in_status = "current";
    writeFixtureManifest(root, manifest);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true }),
      /release gate requires fresh production types evidence/,
    );
  }));

test("privilege approval rejects erased differences and blocked sub-assessments", () =>
  withFixture((root) => {
    const evidence = buildEndToEndReleaseFixture(root);
    const privilegePath = join(root, "docs/plans/2026-07-14-xot-schema-privilege-diff.json");
    const receipt = JSON.parse(readFileSync(privilegePath, "utf8"));
    receipt.privileges.differences = [];
    receipt.default_privilege_assessment.status = "blocked_pending_sr_rls_01_explicit_disposition";
    receipt.disposition.status = "blocked_pending_sr_rls_01";
    writeFileSync(privilegePath, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.throws(
      () => validateMigrationBaseline({ root, releaseGate: true, ...evidence }),
      /privilege differences list length does not match differing_records|receipt assessments remain blocked/,
    );
  }));

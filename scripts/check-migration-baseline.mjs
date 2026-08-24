import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = "docs/plans/2026-07-14-xot-migration-equivalence-manifest.json";
export const PRIVILEGE_DIFF_PATH = "docs/plans/2026-07-14-xot-schema-privilege-diff.json";
export const ARCHIVED_ALIAS_PATH = "supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql";
export const CURRENT_CANDIDATE_RECEIPT_PATH =
  "docs/plans/2026-08-12-xot-e10-preview-migration-boundary.json";
export const SUCCESSOR_CANDIDATE_RECEIPT_PATH =
  "docs/plans/2026-08-24-xot-e10-preview-migration-boundary-successor-v2.json";
export const SUCCESSOR_V1_CANDIDATE_RECEIPT_PATH =
  "docs/plans/2026-08-22-xot-e10-preview-migration-boundary-successor.json";
export const SUCCESSOR_V1_CANDIDATE_RECEIPT_SCHEMA =
  "xot-e10-preview-migration-boundary-successor-v1";
export const SUCCESSOR_V2_CANDIDATE_RECEIPT_SCHEMA =
  "xot-e10-preview-migration-boundary-successor-v2";
export const CURRENT_CANDIDATE_RECEIPT_CONTRACT = "xot-e10-preview-migration-boundary-v1";
export const CURRENT_CANDIDATE_MIGRATION_COUNT = 124;
export const CURRENT_CANDIDATE_INVENTORY_SHA256 =
  "d6c31480f6d7c9e926be12bf0e555af9d34d74b07f2b4efa42f5e01f120a5b57";
export const CURRENT_CANDIDATE_TYPES_SHA256 =
  "261c8c9cee143887c629ece4390951d74fed74d0a60cb2f6584b55d0ada771a4";
// The immediately-preceding authorized successor receipt. The E10 current
// candidate must carry this exact predecessor SHA-256 so the append-only chain
// remains immutable: E7 -> E10 (this candidate).
export const PREDECESSOR_RECEIPT_PATH =
  "docs/plans/2026-08-11-xot-e7-aggregate-migration-rls-grant-type-boundary.json";
export const PREDECESSOR_BINDING_FIELD = "predecessorReceiptSha256";
export const PREDECESSOR_RECEIPT_SHA256 =
  "19239b884f73a7eb606103695dd97184cd8ddb27772c8f427b06c6f3debc0f02";
export const HISTORICAL_B4_RECEIPT_PATH =
  "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json";
export const HISTORICAL_B4_RECEIPT_CONTRACT = "xot-b4-current-candidate-v1";
export const HISTORICAL_B4_RECEIPT_SHA256 =
  "32218157fbf2826560a281df5a5d915eb4ab8aa0aba093093f0d7ea046f7cee5";
export const HISTORICAL_B4_INVENTORY_SHA256 =
  "244be44ccb37d985b888e2e31377acf2439dd23a30f447ba3f133320fcf08b61";
export const HISTORICAL_B4_MIGRATION_VERSION = "20260806143000";
export const HISTORICAL_B4_MIGRATION_SHA256 =
  "6df9270450f203c74fec1baf1145430edcc355075afa101b93f545384306c614";
export const E10_CANDIDATE_STATUS = "ACCEPTED_LOCAL_SQL_T1";
export const CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH =
  "docs/plans/2026-08-12-xot-e10-disposable-sql-runtime-acceptance.json";
export const CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA = "xot-e10-sql-runtime-acceptance-receipt-v1";
export const CURRENT_CANDIDATE_RUNTIME_STATUS = "ACCEPTED_LOCAL_SQL_T1";
export const CURRENT_CANDIDATE_RUNTIME_COMMAND = "node scripts/run-e10-sql-boundary.mjs";
export const CURRENT_CANDIDATE_RUNTIME_IMAGE =
  "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
export const CURRENT_CANDIDATE_RUNTIME_IMAGE_COMMAND = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
export const CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS = Object.freeze([
  "scripts/e10SqlBoundary.mjs",
  "scripts/e10SqlBoundary.test.mjs",
  "scripts/run-e10-sql-boundary.mjs",
]);
export const CURRENT_CANDIDATE_RUNTIME_STDOUT = Object.freeze({
  schema: "xot-e10-sql-boundary-receipt-v1",
  status: "ACCEPTED_LOCAL_SQL_T1",
  context: "orbstack",
  image: CURRENT_CANDIDATE_RUNTIME_IMAGE,
  imageCommand: CURRENT_CANDIDATE_RUNTIME_IMAGE_COMMAND,
  migrationCount: 124,
  inventorySha256: "d6c31480f6d7c9e926be12bf0e555af9d34d74b07f2b4efa42f5e01f120a5b57",
  migrationSha256: "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7",
  container: "removed",
  cleanup: "removed",
  skillmapUnchanged: true,
  xotE10Unchanged: true,
  signal: null,
});
export const CURRENT_CANDIDATE_RUNTIME_EVIDENCE_PATHS = Object.freeze([
  ...CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS,
  "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql",
  "scripts/check-migration-baseline.mjs",
  "scripts/check-migration-baseline.test.mjs",
  "scripts/build-e10-preview-migration-boundary-receipt.mjs",
]);
export const CURRENT_CANDIDATE_EVIDENCE_PATHS = Object.freeze([
  HISTORICAL_B4_RECEIPT_PATH,
  PREDECESSOR_RECEIPT_PATH,
  CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH,
  ...CURRENT_CANDIDATE_RUNTIME_HARNESS_PATHS,
  "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql",
  "src/integrations/supabase/types.ts",
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
]);
export const RESTORED_SOURCE_PATHS = [
  "supabase/migrations/20250904033120_add_core_pipeline_columns.sql",
  "supabase/migrations/20250904033146_rpc_pipeline_status_and_retry.sql",
  "supabase/migrations/20250905010114_telegram_analytics.sql",
];
export const REQUIRED_BLOCKERS = [
  "replay-egress",
  "restore-readiness",
  "owner-review",
  "remote-body-missing",
  "privilege-drift",
  "types-stale",
  "hosted-ci",
];
export const REMOTE_EXPORT_CONTRACT = "xot-remote-migration-snapshot-v1";
export const TYPES_EVIDENCE_CONTRACT = "xot-production-types-evidence-v1";
export const REMOTE_QUERY_SHA256 = "3f63679ba759a74eccdc18add2ff796df31b178793a51f3e7fe3772cf95bf1fb";

const EXACT_DISPOSITIONS = new Set(["exact_equivalent", "renamed_exact_equivalent"]);
const ALLOWED_DISPOSITIONS = new Set([
  ...EXACT_DISPOSITIONS,
  "live_schema_equivalent_unledgered_local",
  "remote_body_missing_effect_observed_pending_approval",
  "remote_body_subset_live_effect_reconciled",
  "renamed_comment_only_equivalent_pending_archive_approval",
  "renamed_normalized_match_pending_semantic_review",
  "same_version_normalized_match_pending_semantic_review",
  "schema_equivalent_runtime_seed_superseded",
  "security_privilege_divergence",
  "source_restored_candidate",
  "superseded_operational_definition",
]);
const ALLOWED_REVIEW_STATUSES = new Set([
  "hash_proven",
  "candidate_pending_owner_review",
  "owner_approved",
]);
const ALLOWED_BLOCKER_STATUSES = new Set(["blocked", "resolved"]);
const BLOCKER_RECEIPT_CONTRACTS = new Map([
  ["replay-egress", "xot-replay-egress-receipt-v1"],
  ["restore-readiness", "xot-restore-drill-receipt-v1"],
  ["owner-review", "xot-owner-review-closure-v1"],
  ["remote-body-missing", "xot-remote-body-resolution-v1"],
  ["privilege-drift", "xot-privilege-review-receipt-v1"],
  ["types-stale", "xot-types-trust-receipt-v1"],
  ["hosted-ci", "xot-hosted-ci-receipt-v1"],
]);
export const GATE_REQUIRED_CHECKS = Object.freeze({
  "replay-egress": ["clean-replay", "outbound-isolation", "production-log-zero-traffic"],
  "restore-readiness": ["backup-readiness", "restore-drill", "restore-validation"],
  "owner-review": ["all-entries-reviewed", "review-package-integrity"],
  "remote-body-missing": ["source-recovery-or-forward-fix", "live-effect-review"],
  "privilege-drift": ["role-matrix", "schema-privilege-reproduction", "default-privilege-disposition"],
  "types-stale": ["linked-type-generation", "replay-type-generation", "type-parity"],
  "hosted-ci": ["github-actions-success", "reviewed-sha-match"],
});
const PROTECTED_INPUT_KEYS = new Set([
  "manifest_generator_sha256",
  "observed_local_inventory_sha256",
  "candidate_local_inventory_sha256",
  "remote_export_sha256",
]);
const ALLOWED_UNMATCHED_LOCAL_IDS = new Set([
  "local:20260609201533",
  "local:20260609213357",
]);
const ALLOWED_CANDIDATE_COUNTERPART_IDS = new Set([
  "remote:20250904033120",
  "remote:20250905010114",
]);
const REMOTE_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const REMOTE_SNAPSHOT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const SENSITIVE_PATTERNS = [
  { label: "JWT", pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { label: "Bearer credential", pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: "database URL", pattern: /postgres(?:ql)?:\/\//i },
  { label: "private key", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}\b/ },
  { label: "Supabase personal access token", pattern: /\bsbp_[A-Za-z0-9_-]{16,}\b/ },
  { label: "OpenAI key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function readMigrationFile(filePath) {
  const body = readFileSync(filePath, "utf8");
  return {
    sha256: sha256(body),
    sha256WithoutTerminalLf: sha256(body.endsWith("\n") ? body.slice(0, -1) : body),
  };
}

export function listActiveMigrations(root) {
  const migrationsDir = join(root, "supabase/migrations");
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((filename) => ({
      version: filename.slice(0, 14),
      filename,
      ...readMigrationFile(join(migrationsDir, filename)),
    }));
}

function isValidIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isValidSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isValidReviewedGitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isNamedHumanReviewer(value) {
  return typeof value === "string"
    && /^(?:database-owner|release-owner|security-owner):[A-Za-z0-9][A-Za-z0-9._-]+$/.test(value);
}

function hasTypedEvidenceItems(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => (
      typeof item?.path === "string"
      && item.path.length > 0
      && !item.path.startsWith("/")
      && !item.path.split("/").includes("..")
      && isValidSha256(item.sha256)
    ));
}

function inventoryHash(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

function collectDecodedStrings(value, path = "$", output = []) {
  if (typeof value === "string") {
    output.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectDecodedStrings(item, `${path}[${index}]`, output));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectDecodedStrings(item, `${path}.${key}`, output);
    }
  }
  return output;
}

function validateNoSensitiveMaterial(value, location, raw = null) {
  const errors = new Set();
  const candidates = collectDecodedStrings(value);
  if (typeof raw === "string") candidates.push({ path: "$raw", value: raw });
  for (const candidate of candidates) {
    for (const { label, pattern } of SENSITIVE_PATTERNS) {
      if (pattern.test(candidate.value)) {
        errors.add(`${location} contains ${label} at ${candidate.path}`);
      }
    }
  }
  return [...errors];
}

function validateReviewedSourcesContainNoSecrets(root) {
  const errors = [];
  for (const relativePath of [...RESTORED_SOURCE_PATHS, ARCHIVED_ALIAS_PATH]) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath)) {
      errors.push(`reviewed source missing: ${relativePath}`);
      continue;
    }
    errors.push(
      ...validateNoSensitiveMaterial(readFileSync(absolutePath, "utf8"), `reviewed source ${relativePath}`),
    );
  }
  return errors;
}

function validateReferencedEvidenceFiles(manifest, root, allowedUntrackedPaths = null) {
  const errors = [];
  const cache = new Map();
  const repositoryRoot = resolve(root);
  let realRepositoryRoot;
  try {
    realRepositoryRoot = realpathSync(repositoryRoot);
  } catch {
    return [`repository root cannot be resolved: ${repositoryRoot}`];
  }
  const loadEvidence = (reference, label) => {
    if (!hasTypedEvidenceItems([reference])) return null;
    if (cache.has(reference.path)) {
      const cached = cache.get(reference.path);
      if (cached.sha256 !== reference.sha256) {
        errors.push(`referenced evidence hash differs: ${reference.path}`);
        return null;
      }
      return cached;
    }
    const evidencePath = resolve(repositoryRoot, reference.path);
    if (!evidencePath.startsWith(`${repositoryRoot}/`)) {
      errors.push(`evidence path escapes repository root: ${reference.path}`);
      return null;
    }
    if (!existsSync(evidencePath)) {
      errors.push(`referenced evidence file is missing: ${reference.path}`);
      return null;
    }
    let realEvidencePath;
    try {
      realEvidencePath = realpathSync(evidencePath);
    } catch {
      errors.push(`referenced evidence path cannot be resolved: ${reference.path}`);
      return null;
    }
    if (
      realEvidencePath !== realRepositoryRoot
      && !realEvidencePath.startsWith(`${realRepositoryRoot}/`)
    ) {
      errors.push(`evidence path escapes repository root: ${reference.path}`);
      return null;
    }
    const raw = readFileSync(realEvidencePath, "utf8");
    const evidenceSha256 = sha256(raw);
    if (evidenceSha256 !== reference.sha256) {
      errors.push(`referenced evidence hash differs: ${reference.path}`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push(`${label} evidence is not valid JSON: ${reference.path}`);
      return null;
    }
    errors.push(...validateNoSensitiveMaterial(parsed, `${label} evidence ${reference.path}`, raw));
    if (allowedUntrackedPaths) {
      const relativePath = relative(realRepositoryRoot, realEvidencePath).split("\\").join("/");
      if (relativePath && !relativePath.startsWith("..")) allowedUntrackedPaths.add(relativePath);
    }
    const loaded = { raw, parsed, sha256: evidenceSha256 };
    cache.set(reference.path, loaded);
    return loaded;
  };

  for (const entry of manifest.observed_entries ?? []) {
    if (entry.review_status === "owner_approved") {
      const references = entry.review?.evidence_receipt?.evidence ?? [];
      let matched = false;
      for (const reference of references) {
        const loaded = loadEvidence(reference, "owner review");
        const evidenceEntry = loaded?.parsed?.entries?.find((item) => item.id === entry.id);
        if (
          loaded?.parsed?.contract === "xot-owner-review-evidence-v1"
          && loaded.parsed.reviewed_git_sha === manifest.candidate?.reviewed_git_sha
          && loaded.parsed.reviewer === entry.review?.reviewer
          && evidenceEntry?.decision === "approved"
          && evidenceEntry?.sha256 === entry.sha256
          && evidenceEntry?.disposition === entry.disposition
        ) {
          matched = true;
        }
      }
      if (!matched) errors.push(`owner review evidence package does not prove ${entry.id}`);
    }
  }

  for (const blocker of manifest.blockers ?? []) {
    if (blocker.status !== "resolved") continue;
    const references = blocker.receipt?.evidence ?? [];
    let matched = false;
    for (const reference of references) {
      const loaded = loadEvidence(reference, `gate ${blocker.id}`);
      const gate = loaded?.parsed?.gates?.find((item) => item.gate_id === blocker.id);
      const requiredCheckNames = GATE_REQUIRED_CHECKS[blocker.id] ?? [];
      const checks = Array.isArray(gate?.checks) ? gate.checks : [];
      const checksByName = new Map(checks.map((check) => [check?.name, check]));
      let checksValid = checks.length === requiredCheckNames.length
        && requiredCheckNames.every((name) => checksByName.has(name));
      for (const requiredName of requiredCheckNames) {
        const check = checksByName.get(requiredName);
        const artifact = loadEvidence({
          path: check?.artifact_path,
          sha256: check?.artifact_sha256,
        }, `gate ${blocker.id} check ${requiredName}`);
        if (
          check?.status !== "passed"
          || artifact?.parsed?.contract !== "xot-gate-check-artifact-v1"
          || artifact.parsed.gate_id !== blocker.id
          || artifact.parsed.check_name !== requiredName
          || artifact.parsed.reviewed_git_sha !== manifest.candidate?.reviewed_git_sha
          || artifact.parsed.result !== "passed"
        ) {
          checksValid = false;
        }
      }
      if (
        loaded?.parsed?.contract === "xot-gate-closure-evidence-v1"
        && loaded.parsed.reviewed_git_sha === manifest.candidate?.reviewed_git_sha
        && gate?.receipt_contract === BLOCKER_RECEIPT_CONTRACTS.get(blocker.id)
        && gate?.decision === "accepted"
        && gate?.reviewer === blocker.receipt?.reviewer
        && gate?.reviewed_at === blocker.resolved_at
        && checksValid
      ) {
        matched = true;
      }
    }
    if (!matched) errors.push(`gate evidence package does not prove ${blocker.id}`);
  }
  return errors;
}

function resolveEvidenceInputPath(root, candidatePath, label, errors) {
  if (!candidatePath) return null;
  const logicalRoot = resolve(root);
  const repositoryRoot = existsSync(logicalRoot) ? realpathSync(logicalRoot) : logicalRoot;
  const candidate = resolve(logicalRoot, candidatePath);
  if (!existsSync(candidate)) {
    const relativeCandidate = relative(logicalRoot, candidate);
    if (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate)) {
      errors.push(`${label} path escapes repository root: ${candidatePath}`);
      return null;
    }
    return candidate;
  }
  let realCandidate;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    errors.push(`${label} path cannot be resolved: ${candidatePath}`);
    return null;
  }
  const realRelative = relative(repositoryRoot, realCandidate);
  if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
    errors.push(`${label} path escapes repository root: ${candidatePath}`);
    return null;
  }
  return candidate;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function immutableManifestProjection(manifest) {
  const protectedInputHashes = { ...(manifest.methodology?.protected_input_hashes ?? {}) };
  delete protectedInputHashes.remote_export_sha256;
  const candidate = manifest.candidate ?? {};
  return {
    schema_version: manifest.schema_version,
    observed_at: manifest.observed_at,
    project_ref: manifest.project_ref,
    observation_anchor: manifest.observation_anchor,
    candidate_base_anchor: manifest.candidate_base_anchor,
    methodology: {
      ...(manifest.methodology ?? {}),
      protected_input_hashes: protectedInputHashes,
    },
    safety: manifest.safety,
    normalization_contract: manifest.normalization_contract,
    counts: manifest.counts,
    candidate_inventory: {
      removed_active_versions: candidate.removed_active_versions,
      restored_remote_versions: candidate.restored_remote_versions,
      active_versions: candidate.active_versions,
      active_source_hashes: candidate.active_source_hashes,
      replay_through_version: candidate.replay?.through_version,
      missing_remote_body_version: candidate.remote_body_resolution?.version,
    },
    blockers: (manifest.blockers ?? []).map(({ status, resolved_at, receipt, ...immutable }) => immutable),
    observed_entries: (manifest.observed_entries ?? []).map(({ review_status, review, ...immutable }) => immutable),
  };
}

function validateReviewedGitEvidence(manifest, gitRoot, allowedUntrackedPaths = new Set()) {
  const reviewedGitSha = manifest.candidate?.reviewed_git_sha;
  if (!isValidReviewedGitSha(reviewedGitSha)) return ["release candidate reviewed_git_sha is missing or invalid"];
  try {
    const head = execFileSync("git", ["-C", resolve(gitRoot), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    execFileSync("git", ["-C", resolve(gitRoot), "cat-file", "-e", `${reviewedGitSha}^{commit}`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const parent = execFileSync("git", ["-C", resolve(gitRoot), "rev-parse", `${head}^`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (parent !== reviewedGitSha) {
      return [`reviewed_git_sha ${reviewedGitSha} is not the direct parent of evidence commit ${head}`];
    }
    const changedPaths = execFileSync(
      "git",
      ["-C", resolve(gitRoot), "diff", "--name-only", reviewedGitSha, head],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim().split("\n").filter(Boolean);
    const allowedEvidenceCommitPaths = new Set([MANIFEST_PATH, PRIVILEGE_DIFF_PATH]);
    const unexpectedPaths = changedPaths.filter((path) => !allowedEvidenceCommitPaths.has(path));
    if (unexpectedPaths.length > 0 || !changedPaths.includes(MANIFEST_PATH)) {
      return [`evidence commit changes unauthorized paths: ${unexpectedPaths.join(", ") || "manifest missing"}`];
    }
    const parentManifestRaw = execFileSync(
      "git",
      ["-C", resolve(gitRoot), "show", `${reviewedGitSha}:${MANIFEST_PATH}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parentManifest = JSON.parse(parentManifestRaw);
    if (
      stableJson(immutableManifestProjection(parentManifest))
      !== stableJson(immutableManifestProjection(manifest))
    ) {
      return ["evidence commit changes immutable migration manifest facts from the reviewed parent"];
    }
    const workingTreeStatus = execFileSync(
      "git",
      ["-C", resolve(gitRoot), "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const statusLines = workingTreeStatus ? workingTreeStatus.split("\n") : [];
    const trackedChanges = statusLines.filter((line) => !line.startsWith("?? "));
    if (trackedChanges.length) return ["release checkout has uncommitted tracked changes"];
    const unexpectedUntracked = statusLines
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3))
      .filter((path) => !allowedUntrackedPaths.has(path));
    if (unexpectedUntracked.length) {
      return [`release checkout has untracked files outside protected evidence: ${unexpectedUntracked.join(", ")}`];
    }
  } catch {
    return ["reviewed_git_sha could not be verified against the clean review/evidence commit chain"];
  }
  return [];
}

function requireBlockerStatus(errors, blockersById, id, expected) {
  const blocker = blockersById.get(id);
  if (!blocker) return;
  if (blocker.status !== expected) {
    errors.push(`blocker ${id} must be ${expected}, got ${String(blocker.status)}`);
  }
}

export function validateManifestShape(manifest) {
  const errors = [];
  if (manifest.schema_version !== "xot-migration-equivalence-manifest-v1") {
    errors.push(`unexpected schema_version ${String(manifest.schema_version)}`);
  }
  if (!Array.isArray(manifest.observed_entries)) {
    return [...errors, "observed_entries must be an array"];
  }
  if (manifest.observed_entries.length !== 210) {
    errors.push(`expected 210 observed side entries, got ${manifest.observed_entries.length}`);
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.observation_anchor?.git_head ?? "")) {
    errors.push("observation anchor must include a full git SHA");
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.candidate_base_anchor?.git_head ?? "")) {
    errors.push("candidate base anchor must include a full git SHA");
  }
  if (manifest.methodology?.generator !== "scripts/build-migration-equivalence-manifest.mjs") {
    errors.push("manifest methodology must identify the committed generator");
  }
  if (manifest.methodology?.generator_version !== 2) {
    errors.push(`manifest generator_version is ${String(manifest.methodology?.generator_version)}, expected 2`);
  }
  const protectedInputs = manifest.methodology?.protected_input_hashes ?? {};
  const protectedKeys = Object.keys(protectedInputs);
  const missingProtectedKeys = [...PROTECTED_INPUT_KEYS].filter((name) => !(name in protectedInputs));
  const unexpectedProtectedKeys = protectedKeys.filter((name) => !PROTECTED_INPUT_KEYS.has(name));
  if (missingProtectedKeys.length) errors.push(`missing protected input hashes: ${missingProtectedKeys.join(", ")}`);
  if (unexpectedProtectedKeys.length) errors.push(`unexpected protected input hashes: ${unexpectedProtectedKeys.join(", ")}`);
  for (const [name, hash] of Object.entries(protectedInputs)) {
    if (!isValidSha256(hash)) errors.push(`invalid protected input hash ${name}`);
  }
  if (manifest.normalization_contract?.classification !== "diagnostic_only") {
    errors.push("normalization contract must remain diagnostic_only");
  }
  for (const field of ["remote_mutations_performed", "db_push_performed", "migration_repair_performed"]) {
    if (manifest.safety?.[field] !== false) errors.push(`safety.${field} must be false`);
  }
  if (manifest.safety?.raw_remote_export_committed !== false) {
    errors.push("raw remote export must not be committed");
  }
  if (manifest.safety?.restored_remote_source_bodies_committed !== 3) {
    errors.push("expected exactly three reviewed restored source bodies");
  }
  if (manifest.safety?.secret_bearing_restored_source_bodies_committed !== 0) {
    errors.push("restored source body inventory must contain zero secret-bearing files");
  }

  const ids = new Set();
  const byId = new Map();
  const sideCounts = { local: 0, remote: 0 };
  for (const entry of manifest.observed_entries) {
    if (ids.has(entry.id)) errors.push(`duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    byId.set(entry.id, entry);
    if (!(entry.side in sideCounts)) errors.push(`invalid side for ${entry.id}`);
    else sideCounts[entry.side] += 1;
    if (entry.id !== `${entry.side}:${entry.version}`) errors.push(`id/side/version mismatch for ${entry.id}`);
    if (!/^\d{14}$/.test(entry.version)) errors.push(`invalid version for ${entry.id}`);
    if (!ALLOWED_DISPOSITIONS.has(entry.disposition)) errors.push(`invalid disposition for ${entry.id}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) errors.push(`invalid SHA-256 for ${entry.id}`);
    if (!ALLOWED_REVIEW_STATUSES.has(entry.review_status)) {
      errors.push(`invalid review status for ${entry.id}`);
    }
    if (String(entry.disposition).includes("normalized_match") && entry.review_status === "hash_proven") {
      errors.push(`normalized diagnostic match cannot be hash-proven for ${entry.id}`);
    }
    if (entry.review_status === "hash_proven") {
      if (
        entry.review?.reviewer !== "automation:scripts/check-migration-baseline.mjs"
        || entry.review?.evidence_receipt !== "reciprocal raw SHA-256 equality"
        || !isValidIsoTimestamp(entry.review?.reviewed_at)
      ) {
        errors.push(`hash-proven entry lacks deterministic automation receipt for ${entry.id}`);
      }
    } else if (entry.review_status === "candidate_pending_owner_review") {
      if (
        entry.review?.reviewer !== "pending:database-owner"
        || entry.review?.reviewed_at !== null
        || entry.review?.evidence_receipt !== null
      ) {
        errors.push(`pending entry has invalid reviewer state for ${entry.id}`);
      }
    } else if (entry.review_status === "owner_approved") {
      const receipt = entry.review?.evidence_receipt;
      if (
        !isNamedHumanReviewer(entry.review?.reviewer)
        || !isValidReviewedGitSha(manifest.candidate?.reviewed_git_sha)
        || !isValidIsoTimestamp(entry.review?.reviewed_at)
        || receipt?.contract !== "xot-migration-owner-review-v1"
        || receipt?.entry_id !== entry.id
        || receipt?.decision !== "approved"
        || receipt?.disposition !== entry.disposition
        || receipt?.reviewed_sha256 !== entry.sha256
        || receipt?.reviewed_git_sha !== manifest.candidate?.reviewed_git_sha
        || receipt?.reviewer !== entry.review.reviewer
        || receipt?.reviewed_at !== entry.review.reviewed_at
        || !hasTypedEvidenceItems(receipt?.evidence)
      ) {
        errors.push(`owner-approved entry lacks typed reviewer evidence for ${entry.id}`);
      }
    }
  }

  if (sideCounts.local !== 105 || sideCounts.remote !== 105) {
    errors.push(`expected 105 local and 105 remote entries, got ${sideCounts.local}/${sideCounts.remote}`);
  }
  const uniqueVersions = new Set(manifest.observed_entries.map((entry) => entry.version)).size;
  const derivedCounts = {
    observed_local: sideCounts.local,
    observed_remote: sideCounts.remote,
    observed_side_entries: manifest.observed_entries.length,
    unique_observed_versions: uniqueVersions,
  };
  for (const [field, expected] of Object.entries(derivedCounts)) {
    if (manifest.counts?.[field] !== expected) {
      errors.push(`counts.${field} is ${String(manifest.counts?.[field])}, expected ${expected}`);
    }
  }
  if (manifest.counts?.candidate_active_local !== 107) {
    errors.push(`expected candidate_active_local count 107, got ${String(manifest.counts?.candidate_active_local)}`);
  }

  for (const entry of manifest.observed_entries) {
    if (!entry.counterpart_id) {
      if (!ALLOWED_UNMATCHED_LOCAL_IDS.has(entry.id)) {
        errors.push(`missing counterpart for ${entry.id}`);
      } else if (!entry.unmatched_reason || !entry.live_effect_receipt) {
        errors.push(`unmatched entry lacks structured evidence for ${entry.id}`);
      }
      continue;
    }
    if (entry.counterpart_id.startsWith("candidate-local:")) {
      if (!ALLOWED_CANDIDATE_COUNTERPART_IDS.has(entry.id)) {
        errors.push(`unauthorized candidate counterpart for ${entry.id}`);
      }
      if (
        entry.counterpart_id !== `candidate-local:${entry.version}`
        || !entry.restored_local_path
        || entry.current_source_state !== "restored_to_candidate_executable_chain"
      ) {
        errors.push(`invalid candidate counterpart receipt for ${entry.id}`);
      }
      continue;
    }
    const counterpart = byId.get(entry.counterpart_id);
    if (!counterpart) {
      errors.push(`missing counterpart ${entry.counterpart_id} for ${entry.id}`);
      continue;
    }
    if (counterpart.side === entry.side) errors.push(`counterpart has same side for ${entry.id}`);
    if (counterpart.counterpart_id !== entry.id) {
      errors.push(`asymmetric counterpart ${entry.id} -> ${entry.counterpart_id}`);
    }
    if (entry.review_status === "hash_proven") {
      if (!EXACT_DISPOSITIONS.has(entry.disposition)) {
        errors.push(`hash-proven entry has non-exact disposition for ${entry.id}`);
      }
      if (entry.sha256 !== counterpart.sha256) {
        errors.push(`hash-proven counterpart SHA mismatch for ${entry.id}`);
      }
    }
    if (counterpart.disposition !== entry.disposition) {
      errors.push(`counterpart disposition mismatch for ${entry.id}`);
    }
    if (counterpart.review_status !== entry.review_status) {
      errors.push(`counterpart review status mismatch for ${entry.id}`);
    }
    if (EXACT_DISPOSITIONS.has(entry.disposition) && entry.review_status !== "hash_proven") {
      errors.push(`exact disposition must be hash-proven for ${entry.id}`);
    }
  }

  const blockerIds = new Set();
  const blockersById = new Map();
  for (const blocker of manifest.blockers ?? []) {
    if (blockerIds.has(blocker.id)) errors.push(`duplicate blocker ${blocker.id}`);
    blockerIds.add(blocker.id);
    blockersById.set(blocker.id, blocker);
    if (!ALLOWED_BLOCKER_STATUSES.has(blocker.status)) {
      errors.push(`invalid blocker status for ${blocker.id}`);
    }
    if (blocker.status === "resolved") {
      const receipt = blocker.receipt;
      if (
        !isValidIsoTimestamp(blocker.resolved_at)
        || receipt?.contract !== BLOCKER_RECEIPT_CONTRACTS.get(blocker.id)
        || receipt?.gate_id !== blocker.id
        || receipt?.decision !== "accepted"
        || !isNamedHumanReviewer(receipt?.reviewer)
        || receipt?.reviewed_at !== blocker.resolved_at
        || receipt?.reviewed_git_sha !== manifest.candidate?.reviewed_git_sha
        || !hasTypedEvidenceItems(receipt?.evidence)
      ) {
        errors.push(`resolved blocker lacks closure receipt for ${blocker.id}`);
      }
    }
  }
  for (const required of REQUIRED_BLOCKERS) {
    if (!blockerIds.has(required)) errors.push(`missing required blocker ${required}`);
  }

  const replayAccepted = manifest.candidate?.replay?.acceptance_result === "accepted";
  if (replayAccepted) {
    if (manifest.candidate?.replay?.outbound_isolation !== "proven_no_egress") {
      errors.push("accepted replay must have proven_no_egress isolation");
    }
    requireBlockerStatus(errors, blockersById, "replay-egress", "resolved");
  } else {
    if (manifest.candidate?.replay?.acceptance_result !== "rejected_pending_safe_rerun") {
      errors.push("unaccepted replay must be rejected_pending_safe_rerun");
    }
    if (manifest.candidate?.replay?.outbound_isolation !== "unproven") {
      errors.push("rejected replay must record outbound isolation as unproven");
    }
    requireBlockerStatus(errors, blockersById, "replay-egress", "blocked");
  }

  const pendingOwnerReview = manifest.observed_entries.some(
    (entry) => entry.review_status === "candidate_pending_owner_review",
  );
  requireBlockerStatus(errors, blockersById, "owner-review", pendingOwnerReview ? "blocked" : "resolved");
  requireBlockerStatus(
    errors,
    blockersById,
    "restore-readiness",
    manifest.candidate?.recovery?.status === "accepted" ? "resolved" : "blocked",
  );
  requireBlockerStatus(
    errors,
    blockersById,
    "remote-body-missing",
    manifest.candidate?.remote_body_resolution?.status === "approved" ? "resolved" : "blocked",
  );
  requireBlockerStatus(
    errors,
    blockersById,
    "privilege-drift",
    manifest.candidate?.privilege_review?.status === "approved" ? "resolved" : "blocked",
  );
  const typesCurrent =
    manifest.candidate?.generated_types?.checked_in_status === "current"
    && manifest.candidate?.generated_types?.checked_in_sha256 === manifest.candidate?.generated_types?.production_sha256;
  requireBlockerStatus(errors, blockersById, "types-stale", typesCurrent ? "resolved" : "blocked");
  requireBlockerStatus(
    errors,
    blockersById,
    "hosted-ci",
    manifest.candidate?.hosted_ci?.status === "passed" ? "resolved" : "blocked",
  );

  const activeBlockers = [...blockersById.values()].filter((item) => item.status === "blocked");
  if (activeBlockers.length === 0 && !isValidReviewedGitSha(manifest.candidate?.reviewed_git_sha)) {
    errors.push("fully resolved candidate must include a reviewed_git_sha");
  }
  if (manifest.candidate?.status === "accepted" && activeBlockers.length > 0) {
    errors.push("candidate status must not claim acceptance while blockers remain");
  }
  return errors;
}

export function validateRemoteSnapshot(manifest, remoteJsonPath, nowMs = Date.now()) {
  if (!remoteJsonPath) return { checked: false, errors: [], capturedAt: null };
  const raw = readFileSync(resolve(remoteJsonPath), "utf8");
  const payload = JSON.parse(raw);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const errors = [];
  errors.push(...validateNoSensitiveMaterial(payload, "remote export", raw));
  if (sha256(raw) !== manifest.methodology?.protected_input_hashes?.remote_export_sha256) {
    errors.push("remote export hash differs from the protected manifest input");
  }
  if (payload.export_contract !== REMOTE_EXPORT_CONTRACT) {
    errors.push(`remote export contract is ${String(payload.export_contract)}, expected ${REMOTE_EXPORT_CONTRACT}`);
  }
  if (payload.project_ref !== manifest.project_ref) {
    errors.push(`remote export project_ref is ${String(payload.project_ref)}, expected ${manifest.project_ref}`);
  }
  if (
    payload.source?.service !== "postgres"
    || payload.source?.relation !== "supabase_migrations.schema_migrations"
    || payload.source?.statement_serialization !== "statements.join(LF)"
    || payload.source?.capture_tool !== "supabase-mcp:execute_sql"
    || payload.source?.query_sha256 !== REMOTE_QUERY_SHA256
  ) {
    errors.push("remote export source/query metadata is missing or invalid");
  }
  const capturedMs = Date.parse(payload.captured_at);
  if (!Number.isFinite(capturedMs)) {
    errors.push("remote export captured_at is missing or invalid");
  } else {
    if (capturedMs > nowMs + REMOTE_SNAPSHOT_FUTURE_TOLERANCE_MS) {
      errors.push("remote export captured_at is implausibly in the future");
    }
    if (nowMs - capturedMs > REMOTE_SNAPSHOT_MAX_AGE_MS) {
      errors.push("remote export is older than the six-hour release window");
    }
  }

  const expectedEntries = manifest.observed_entries.filter((entry) => entry.side === "remote");
  const remoteEntries = new Map(expectedEntries.map((entry) => [entry.version, entry]));
  if (rows.length !== remoteEntries.size) {
    errors.push(`remote export has ${rows.length} rows, expected ${remoteEntries.size}`);
  }
  const actualVersions = rows.map((row) => String(row.version));
  const duplicates = actualVersions.filter((version, index) => actualVersions.indexOf(version) !== index);
  if (duplicates.length) errors.push(`remote export has duplicate versions: ${[...new Set(duplicates)].join(", ")}`);
  const actualSet = new Set(actualVersions);
  const missing = [...remoteEntries.keys()].filter((version) => !actualSet.has(version));
  const unexpected = [...actualSet].filter((version) => !remoteEntries.has(version));
  if (missing.length) errors.push(`remote export is missing versions: ${missing.join(", ")}`);
  if (unexpected.length) errors.push(`remote export has unexpected versions: ${unexpected.join(", ")}`);

  for (const row of rows) {
    const version = String(row.version);
    const entry = remoteEntries.get(version);
    if (!entry) continue;
    const statements = Array.isArray(row.statements) ? row.statements : [];
    const body = statements.join("\n");
    if (entry.sha256 !== sha256(body)) errors.push(`remote body hash changed for ${version}`);
    if (entry.statement_count !== statements.length) errors.push(`remote statement count changed for ${version}`);
    if (entry.body_available !== (statements.length > 0)) errors.push(`remote body availability changed for ${version}`);
    if ((entry.name ?? null) !== (row.name || null)) errors.push(`remote name changed for ${version}`);
  }
  return {
    checked: true,
    errors,
    capturedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : null,
  };
}

function validatePrivilegeReceipt(manifest, root, { replaySchemaPath = null, productionSchemaPath = null } = {}) {
  const errors = [];
  const receiptPath = resolve(root, PRIVILEGE_DIFF_PATH);
  if (!existsSync(receiptPath)) return [`privilege receipt missing: ${PRIVILEGE_DIFF_PATH}`];
  const raw = readFileSync(receiptPath, "utf8");
  const receipt = JSON.parse(raw);
  errors.push(...validateNoSensitiveMaterial(receipt, "privilege receipt", raw));
  if (receipt.schema_version !== "xot-schema-privilege-diff-v1") {
    errors.push(`unexpected privilege receipt schema ${String(receipt.schema_version)}`);
  }
  if (receipt.methodology?.generator !== "scripts/build-schema-privilege-diff.mjs") {
    errors.push("privilege receipt does not identify the committed generator");
  }
  if (receipt.source?.replay?.sha256 !== manifest.candidate?.schema_diff?.replay_sha256) {
    errors.push("privilege receipt replay source hash differs from manifest");
  }
  if (receipt.source?.production?.sha256 !== manifest.candidate?.schema_diff?.production_sha256) {
    errors.push("privilege receipt production source hash differs from manifest");
  }
  if (
    receipt.non_privilege_schema?.expected_empty !== true
    || receipt.non_privilege_schema?.replay_sha256 !== receipt.non_privilege_schema?.production_sha256
  ) {
    errors.push("non-privilege schema receipt is not expected-empty");
  }
  if (receipt.non_privilege_schema?.replay_sha256 !== manifest.candidate?.schema_diff?.non_privilege_sha256) {
    errors.push("non-privilege schema receipt hash differs from manifest");
  }
  if (receipt.privileges?.differing_records !== manifest.candidate?.privilege_review?.differing_records) {
    errors.push("privilege difference count differs from manifest");
  }
  const differences = Array.isArray(receipt.privileges?.differences) ? receipt.privileges.differences : [];
  const classificationCounts = { production_broader: 0, replay_broader: 0, different: 0 };
  for (const difference of differences) {
    if (!(difference.classification in classificationCounts)) {
      errors.push(`invalid privilege difference classification ${String(difference.classification)}`);
    } else {
      classificationCounts[difference.classification] += 1;
    }
  }
  if (differences.length !== receipt.privileges?.differing_records) {
    errors.push("privilege differences list length does not match differing_records");
  }
  for (const [field, expected] of Object.entries({
    production_broader_records: classificationCounts.production_broader,
    replay_broader_records: classificationCounts.replay_broader,
    different_records: classificationCounts.different,
  })) {
    if (receipt.privileges?.[field] !== expected) {
      errors.push(`privilege ${field} does not match classified differences`);
    }
    if (manifest.candidate?.privilege_review?.[field] !== expected) {
      errors.push(`manifest privilege_review.${field} does not match classified differences`);
    }
  }
  if (manifest.candidate?.privilege_review?.differing_records !== differences.length) {
    errors.push("manifest privilege_review.differing_records does not match receipt");
  }
  const replayDefaults = new Set(receipt.privileges?.default_privileges?.replay ?? []);
  const productionDefaults = new Set(receipt.privileges?.default_privileges?.production ?? []);
  const replayOnly = [...replayDefaults].filter((item) => !productionDefaults.has(item));
  const productionOnly = [...productionDefaults].filter((item) => !replayDefaults.has(item));
  if (
    replayOnly.length !== receipt.default_privilege_assessment?.replay_only
    || productionOnly.length !== receipt.default_privilege_assessment?.production_only
  ) {
    errors.push("default-privilege assessment counts do not match receipt clauses");
  }
  const commonDefaults = [...replayDefaults].filter((item) => productionDefaults.has(item));
  if (
    replayDefaults.size !== receipt.default_privilege_assessment?.replay_clauses
    || productionDefaults.size !== receipt.default_privilege_assessment?.production_clauses
    || commonDefaults.length !== receipt.default_privilege_assessment?.common_clauses
    || replayOnly.length !== manifest.candidate?.privilege_review?.default_privilege_replay_only
    || productionOnly.length !== manifest.candidate?.privilege_review?.default_privilege_production_only
  ) {
    errors.push("default-privilege totals differ from the receipt or manifest");
  }
  const privilegeApproved = manifest.candidate?.privilege_review?.status === "approved";
  if (privilegeApproved && (
    receipt.assessment?.status !== "approved"
    || receipt.default_privilege_assessment?.status !== "approved"
    || receipt.disposition?.status !== "approved"
  )) {
    errors.push("manifest claims privilege approval while receipt assessments remain blocked");
  }
  if (Boolean(replaySchemaPath) !== Boolean(productionSchemaPath)) {
    errors.push("replay and production schema evidence must be supplied together");
  } else if (replaySchemaPath && productionSchemaPath) {
    const replaySchema = readFileSync(resolve(replaySchemaPath), "utf8");
    const productionSchema = readFileSync(resolve(productionSchemaPath), "utf8");
    const regenerated = buildSchemaPrivilegeFacts(replaySchema, productionSchema);
    if (JSON.stringify(regenerated.source) !== JSON.stringify(receipt.source)) {
      errors.push("schema evidence source facts do not reproduce the privilege receipt");
    }
    if (JSON.stringify(regenerated.non_privilege_schema) !== JSON.stringify(receipt.non_privilege_schema)) {
      errors.push("schema evidence canonical structure does not reproduce the privilege receipt");
    }
    if (JSON.stringify(regenerated.privileges) !== JSON.stringify(receipt.privileges)) {
      errors.push("schema evidence grants/default privileges do not reproduce the privilege receipt");
    }
    for (const [field, expected] of Object.entries(regenerated.defaultPrivilegeCounts)) {
      if (receipt.default_privilege_assessment?.[field] !== expected) {
        errors.push(`schema evidence default privilege ${field} does not reproduce the receipt`);
      }
    }
  }
  return errors;
}

export function validateTypesEvidence(manifest, typesPath, receiptPath, nowMs = Date.now()) {
  if (!typesPath && !receiptPath) return { checked: false, errors: [], capturedAt: null };
  const errors = [];
  if (!typesPath || !receiptPath) {
    return { checked: false, errors: ["production types and its evidence receipt must be supplied together"], capturedAt: null };
  }
  const outputHash = sha256(readFileSync(resolve(typesPath)));
  const receipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8"));
  errors.push(...validateNoSensitiveMaterial(receipt, "types receipt"));
  if (receipt.contract !== TYPES_EVIDENCE_CONTRACT) errors.push("unexpected production types evidence contract");
  if (receipt.project_ref !== manifest.project_ref || receipt.schema !== "public") {
    errors.push("production types evidence project/schema mismatch");
  }
  if (receipt.source?.command !== "supabase gen types typescript --linked --schema public") {
    errors.push("production types evidence command is not the linked public-schema contract");
  }
  if (typeof receipt.source?.tool_version !== "string" || receipt.source.tool_version.length === 0) {
    errors.push("production types evidence tool version is missing");
  }
  if (receipt.source?.schema_dump_sha256 !== manifest.candidate?.schema_diff?.production_sha256) {
    errors.push("production types evidence is not tied to the reviewed production schema dump");
  }
  if (receipt.output_sha256 !== outputHash || outputHash !== manifest.candidate?.generated_types?.production_sha256) {
    errors.push("production types output hash differs from receipt or manifest");
  }
  if (receipt.reviewed_git_sha !== manifest.candidate?.reviewed_git_sha) {
    errors.push("production types evidence is not tied to the reviewed Git SHA");
  }
  const capturedMs = Date.parse(receipt.captured_at);
  if (!Number.isFinite(capturedMs)) errors.push("production types evidence captured_at is missing or invalid");
  else if (nowMs - capturedMs > REMOTE_SNAPSHOT_MAX_AGE_MS || capturedMs > nowMs + REMOTE_SNAPSHOT_FUTURE_TOLERANCE_MS) {
    errors.push("production types evidence is outside the six-hour release window");
  }
  return {
    checked: errors.length === 0,
    errors,
    capturedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : null,
  };
}

export function validateCurrentCandidateRuntimeReceipt(root, { evidenceOverrides = {} } = {}) {
  const resolvedRoot = resolve(root);
  const runtimePath = resolve(resolvedRoot, CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH);
  const errors = [];
  if (!existsSync(runtimePath)) {
    return {
      checked: false,
      errors: [`E10 SQL runtime receipt missing: ${CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH}`],
      receipt: null,
      sha256: null,
    };
  }
  const raw = readFileSync(runtimePath, "utf8");
  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    return {
      checked: false,
      errors: [`E10 SQL runtime receipt is not valid JSON: ${CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH}`],
      receipt: null,
      sha256: sha256(raw),
    };
  }
  errors.push(...validateNoSensitiveMaterial(receipt, "E10 SQL runtime receipt", raw));
  if (receipt.schema !== CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA) {
    errors.push(`E10 SQL runtime receipt schema must be ${CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA}`);
  }
  if (receipt.status !== CURRENT_CANDIDATE_RUNTIME_STATUS) {
    errors.push(`E10 SQL runtime receipt status must be ${CURRENT_CANDIDATE_RUNTIME_STATUS}`);
  }
  if (receipt.release !== "CLOSED" || receipt.releaseGate !== "CLOSED") {
    errors.push("E10 SQL runtime receipt release and releaseGate must be CLOSED");
  }
  if (receipt.repository !== ".") errors.push("E10 SQL runtime receipt repository must be .");
  if (receipt.noLiveContactDeclaration !== true) {
    errors.push("E10 SQL runtime receipt must declare no live contact");
  }
  if (receipt.noProductionDatabaseApplication !== true) {
    errors.push("E10 SQL runtime receipt must declare no production database application");
  }
  const acceptance = receipt.runtimeAcceptance;
  if (!acceptance || typeof acceptance !== "object") {
    errors.push("E10 SQL runtime receipt runtimeAcceptance block is missing");
  } else {
    if (acceptance.tier !== "T1") errors.push("E10 SQL runtime receipt tier must be T1");
    if (acceptance.engine !== "orbstack") errors.push("E10 SQL runtime receipt engine must be orbstack");
    if (acceptance.image !== CURRENT_CANDIDATE_RUNTIME_IMAGE) {
      errors.push("E10 SQL runtime receipt image digest is not the expected immutable image");
    }
    if (JSON.stringify(acceptance.imageCommand) !== JSON.stringify(CURRENT_CANDIDATE_RUNTIME_IMAGE_COMMAND)) {
      errors.push("E10 SQL runtime receipt image command is not the expected postgres command");
    }
    if (acceptance.migrationCount !== CURRENT_CANDIDATE_MIGRATION_COUNT) {
      errors.push("E10 SQL runtime receipt migration count is not 124");
    }
    if (acceptance.inventorySha256 !== CURRENT_CANDIDATE_INVENTORY_SHA256) {
      errors.push("E10 SQL runtime receipt inventory SHA-256 is not the current E10 inventory");
    }
    if (acceptance.migrationSha256 !== CURRENT_CANDIDATE_RUNTIME_STDOUT.migrationSha256) {
      errors.push("E10 SQL runtime receipt migration SHA-256 is not the current E10 migration");
    }
    const run = acceptance.acceptedRun;
    if (!run || typeof run !== "object") {
      errors.push("E10 SQL runtime receipt acceptedRun block is missing");
    } else {
      if (run.command !== CURRENT_CANDIDATE_RUNTIME_COMMAND) {
        errors.push("E10 SQL runtime receipt accepted command is not the exact E10 runner command");
      }
      if (run.captureExitCode !== 0) errors.push("E10 SQL runtime receipt captureExitCode must be 0");
      if (run.durationMs !== 23070) errors.push("E10 SQL runtime receipt durationMs must be 23070");
      if (run.acceptedFinalRunOnly !== true) errors.push("E10 SQL runtime receipt must identify the retained final run only");
      if (run.captureParser !== "exact single JSON stdout object") {
        errors.push("E10 SQL runtime receipt stdout parser contract is missing");
      }
      if (JSON.stringify(run.stdout) !== JSON.stringify(CURRENT_CANDIDATE_RUNTIME_STDOUT)) {
        errors.push("E10 SQL runtime receipt nested stdout object differs from the retained exact output");
      }
    }
  }
  const isolation = receipt.isolation;
  const requiredIsolation = [
    "localOnly",
    "noExternalContact",
    "noProductContact",
    "noProductionContact",
    "noProviderContact",
    "noBrowserContact",
    "noStagingContact",
    "noDeploymentContact",
    "noSecretMaterial",
    "offlineNetwork",
  ];
  for (const field of requiredIsolation) {
    if (isolation?.[field] !== true) errors.push(`E10 SQL runtime receipt isolation.${field} must be true`);
  }
  if (isolation?.networkMode !== "none") errors.push("E10 SQL runtime receipt networkMode must be none");
  if (isolation?.imagePull !== "never") errors.push("E10 SQL runtime receipt imagePull must be never");
  if (!Array.isArray(isolation?.mounts) || isolation.mounts.length !== 0) {
    errors.push("E10 SQL runtime receipt mounts must be empty");
  }
  if (!Array.isArray(isolation?.ports) || isolation.ports.length !== 0) {
    errors.push("E10 SQL runtime receipt ports must be empty");
  }
  const cleanup = receipt.cleanup;
  if (cleanup?.container !== "removed" || cleanup?.cleanup !== "removed") {
    errors.push("E10 SQL runtime receipt cleanup must record removed container and cleanup");
  }
  for (const field of ["matchingContainers", "matchingVolumes", "matchingNetworks"]) {
    if (cleanup?.postRun?.[field] !== 0) errors.push(`E10 SQL runtime receipt cleanup.postRun.${field} must be 0`);
  }
  if (cleanup?.postRun?.independentCheck !== true) {
    errors.push("E10 SQL runtime receipt must include an independent post-run resource check");
  }
  const resourceIntegrity = receipt.resourceIntegrity;
  if (resourceIntegrity?.skillmapCount !== 10
    || resourceIntegrity?.skillmapIdsNamesStatesUnchanged !== true
    || resourceIntegrity?.xotE10Unchanged !== true) {
    errors.push("E10 SQL runtime receipt resource integrity flags are not the exact accepted values");
  }
  for (const [name, value] of Object.entries(receipt.claims ?? {})) {
    if (value !== "not_claimed") errors.push(`E10 SQL runtime receipt claim ${name} must be not_claimed`);
  }
  const declaredEvidence = receipt.evidence;
  if (!declaredEvidence || typeof declaredEvidence !== "object" || Array.isArray(declaredEvidence)) {
    errors.push("E10 SQL runtime receipt evidence map is missing or invalid");
  } else {
    const expectedEvidence = new Set(CURRENT_CANDIDATE_RUNTIME_EVIDENCE_PATHS);
    for (const evidencePath of CURRENT_CANDIDATE_RUNTIME_EVIDENCE_PATHS) {
      if (!Object.hasOwn(declaredEvidence, evidencePath)) {
        errors.push(`E10 SQL runtime receipt evidence path missing: ${evidencePath}`);
        continue;
      }
      const evidenceFile = resolve(resolvedRoot, evidencePath);
      if (!existsSync(evidenceFile)) {
        errors.push(`E10 SQL runtime receipt evidence file is missing: ${evidencePath}`);
        continue;
      }
      const expectedHash = evidenceOverrides[evidencePath] ?? declaredEvidence[evidencePath];
      if (sha256(readFileSync(evidenceFile)) !== expectedHash) {
        errors.push(`E10 SQL runtime receipt evidence hash mismatch: ${evidencePath}`);
      }
    }
    for (const evidencePath of Object.keys(declaredEvidence)) {
      if (!expectedEvidence.has(evidencePath)) {
        errors.push(`E10 SQL runtime receipt evidence path is unexpected: ${evidencePath}`);
      }
    }
  }
  return { checked: errors.length === 0, errors, receipt, sha256: sha256(raw) };
}

export function validateCurrentCandidateBaseline({
  root = REPO_ROOT,
  receiptPath = CURRENT_CANDIDATE_RECEIPT_PATH,
  receiptOverride = null,
  candidateInventorySha256 = CURRENT_CANDIDATE_INVENTORY_SHA256,
  migrationsDir = "supabase/migrations",
  archivePath = ARCHIVED_ALIAS_PATH,
  typesPath = "src/integrations/supabase/types.ts",
  protectedManifestPath = MANIFEST_PATH,
} = {}) {
  const resolvedRoot = resolve(root);
  const resolvedReceipt = resolve(resolvedRoot, receiptPath);
  const errors = [];
  if (!receiptOverride && !existsSync(resolvedReceipt)) {
    errors.push(`current candidate receipt missing: ${receiptPath}`);
    return { checked: false, errors, activeCount: null };
  }
  const rawReceipt = receiptOverride ? JSON.stringify(receiptOverride) : readFileSync(resolvedReceipt, "utf8");
  const receipt = receiptOverride ?? JSON.parse(rawReceipt);
  errors.push(...validateNoSensitiveMaterial(receipt, "current candidate receipt", rawReceipt));
  const runtimeValidation = validateCurrentCandidateRuntimeReceipt(resolvedRoot, {
    evidenceOverrides: receipt.evidence ?? {},
  });
  errors.push(...runtimeValidation.errors);

  const candidate = receipt.currentCandidate;
  if (!candidate || typeof candidate !== "object") {
    errors.push("current candidate receipt lacks a currentCandidate block");
    return { checked: false, errors, activeCount: null };
  }
  // The single authoritative contract field is the top-level currentCandidateContract. A nested
  // candidate-level schema is not accepted, so the reconciliation receipt's own top-level schema
  // stays separate from the current-candidate contract.
  if (receipt.currentCandidateContract !== CURRENT_CANDIDATE_RECEIPT_CONTRACT) {
    errors.push(`current candidate receipt contract mismatch (expected ${CURRENT_CANDIDATE_RECEIPT_CONTRACT})`);
  }
  if (typeof candidate.protectedManifestSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(candidate.protectedManifestSha256)) {
    errors.push("current candidate receipt protectedManifestSha256 is missing or invalid");
  }
  if (typeof candidate.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.archiveSha256)) {
    errors.push("current candidate receipt archiveSha256 is missing or invalid");
  }
  if (typeof candidate.checkedInTypesSha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.checkedInTypesSha256)) {
    errors.push("current candidate receipt checkedInTypesSha256 is missing or invalid");
  } else if (candidate.checkedInTypesSha256 !== CURRENT_CANDIDATE_TYPES_SHA256) {
    errors.push("current candidate receipt checkedInTypesSha256 is not the current E10 generated type hash");
  }
  if (receipt.predecessor?.path !== PREDECESSOR_RECEIPT_PATH) {
    errors.push(`current candidate receipt top-level predecessor path must be ${PREDECESSOR_RECEIPT_PATH}`);
  }
  if (receipt.predecessor?.sha256 !== PREDECESSOR_RECEIPT_SHA256) {
    errors.push("current candidate receipt top-level predecessor SHA-256 is not the authorized immutable E7 value");
  }
  if (candidate.predecessorReceiptPath !== PREDECESSOR_RECEIPT_PATH) {
    errors.push(`current candidate receipt predecessorReceiptPath must be ${PREDECESSOR_RECEIPT_PATH}`);
  }
  if (candidate.predecessorReceiptSha256 !== PREDECESSOR_RECEIPT_SHA256) {
    errors.push("current candidate receipt nested predecessor SHA-256 is not the authorized immutable E7 value");
  }
  if (receipt.status !== E10_CANDIDATE_STATUS) {
    errors.push(`current candidate receipt status must be ${E10_CANDIDATE_STATUS}`);
  }
  if (receipt.release !== "CLOSED" || receipt.releaseGate !== "CLOSED") {
    errors.push("current E10 candidate must keep release and releaseGate CLOSED");
  }
  if (receipt.runtimeReceipt?.path !== CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH) {
    errors.push(`current candidate runtimeReceipt path must be ${CURRENT_CANDIDATE_RUNTIME_RECEIPT_PATH}`);
  }
  if (receipt.runtimeReceipt?.sha256 !== runtimeValidation.sha256) {
    errors.push("current candidate runtimeReceipt SHA-256 does not match the on-disk runtime receipt");
  }
  if (receipt.runtimeReceipt?.schema !== CURRENT_CANDIDATE_RUNTIME_RECEIPT_SCHEMA
    || receipt.runtimeReceipt?.status !== CURRENT_CANDIDATE_RUNTIME_STATUS) {
    errors.push("current candidate runtimeReceipt schema/status binding is invalid");
  }
  const unclaimedBoundaryNames = [
    "productionSchema",
    "ownership",
    "grants",
    "generatedTypes",
    "hostedCi",
    "staging",
    "deployment",
    "liveVerification",
  ];
  for (const name of unclaimedBoundaryNames) {
    if (receipt.claims?.[name] !== "not_claimed") {
      errors.push(`current candidate receipt must mark ${name} as not_claimed`);
    }
  }
  if (receipt.noLiveContactDeclaration !== true) {
    errors.push("current candidate receipt must declare no live contact");
  }
  if (receipt.noDatabaseApplication !== true) {
    errors.push("current candidate receipt must declare no database application");
  }
  const declaredEvidence = receipt.evidence;
  const escapesRepositoryRoot = (relativePath) => (
    isAbsolute(relativePath)
    || relativePath === ".."
    || relativePath.startsWith("../")
    || relativePath.startsWith("..\\")
  );
  if (!declaredEvidence || typeof declaredEvidence !== "object" || Array.isArray(declaredEvidence)) {
    errors.push("current candidate receipt evidence map is missing or invalid");
  } else {
    const expectedEvidence = new Set(CURRENT_CANDIDATE_EVIDENCE_PATHS);
    for (const evidencePath of CURRENT_CANDIDATE_EVIDENCE_PATHS) {
      if (!Object.hasOwn(declaredEvidence, evidencePath)) {
        errors.push(`current candidate receipt evidence path missing: ${evidencePath}`);
      }
    }
    for (const evidencePath of Object.keys(declaredEvidence)) {
      if (!expectedEvidence.has(evidencePath)) {
        errors.push(`current candidate receipt evidence path is unexpected: ${evidencePath}`);
        continue;
      }
      const declaredSha256 = declaredEvidence[evidencePath];
      if (typeof declaredSha256 !== "string" || !/^[a-f0-9]{64}$/.test(declaredSha256)) {
        errors.push(`current candidate receipt evidence hash is invalid: ${evidencePath}`);
        continue;
      }
      const absoluteEvidencePath = resolve(resolvedRoot, evidencePath);
      const lexicalRelativePath = relative(resolvedRoot, absoluteEvidencePath);
      if (escapesRepositoryRoot(lexicalRelativePath)) {
        errors.push(`current candidate receipt evidence path escapes repository root: ${evidencePath}`);
        continue;
      }
      if (!existsSync(absoluteEvidencePath)) {
        errors.push(`current candidate receipt evidence file is missing: ${evidencePath}`);
        continue;
      }
      let realEvidencePath;
      try {
        realEvidencePath = realpathSync(absoluteEvidencePath);
      } catch {
        errors.push(`current candidate receipt evidence path cannot be resolved: ${evidencePath}`);
        continue;
      }
      const realRoot = realpathSync(resolvedRoot);
      const realRelativePath = relative(realRoot, realEvidencePath);
      if (escapesRepositoryRoot(realRelativePath)) {
        errors.push(`current candidate receipt evidence path escapes repository root: ${evidencePath}`);
        continue;
      }
      if (sha256(readFileSync(realEvidencePath)) !== declaredSha256) {
        errors.push(`current candidate receipt evidence hash mismatch: ${evidencePath}`);
      }
    }
  }
  if (!Array.isArray(candidate.migrations) || candidate.migrations.length !== CURRENT_CANDIDATE_MIGRATION_COUNT) {
    errors.push(`current candidate receipt must list exactly ${CURRENT_CANDIDATE_MIGRATION_COUNT} migrations, found ${candidate.migrations?.length ?? "none"}`);
    return { checked: false, errors, activeCount: null };
  }
  if (candidate.versionCount !== CURRENT_CANDIDATE_MIGRATION_COUNT) {
    errors.push(`current candidate receipt versionCount must be ${CURRENT_CANDIDATE_MIGRATION_COUNT}`);
  }
  if (candidate.pathCount !== undefined && candidate.pathCount !== CURRENT_CANDIDATE_MIGRATION_COUNT) {
    errors.push(`current candidate receipt pathCount does not match ${CURRENT_CANDIDATE_MIGRATION_COUNT}`);
  }
  const declaredInventorySha256 = candidate.orderedInventorySha256;
  const calculatedInventorySha256 = inventoryHash(candidate.migrations.map((entry) => ({
    version: entry?.version,
    name: typeof entry?.path === "string" ? entry.path.split("/").pop()?.slice(15, -4) : entry?.path,
    sha256: entry?.sha256,
  })));
  if (declaredInventorySha256 !== candidateInventorySha256
    || calculatedInventorySha256 !== candidateInventorySha256) {
    errors.push(`current candidate receipt ordered inventory SHA-256 does not match ${CURRENT_CANDIDATE_MIGRATION_COUNT}-entry inventory`);
  }

  // F2: Establish the canonical migrations root once. Every receipt entry must resolve to a real
  // file inside this resolved root with no symlink escape, dot segment, or slash/directory variation.
  const logicalMigrationsRoot = resolve(resolvedRoot, migrationsDir);
  if (!existsSync(logicalMigrationsRoot)) {
    errors.push(`current candidate migrations root missing: ${migrationsDir}`);
    return { checked: false, errors, activeCount: null };
  }
  const realMigrationsRoot = realpathSync(logicalMigrationsRoot);

  const seenVersions = new Set();
  const seenCanonicalPaths = new Set();
  for (const entry of candidate.migrations) {
    if (!entry || typeof entry !== "object") {
      errors.push("current candidate receipt contains a malformed migration entry");
      continue;
    }
    if (typeof entry.version !== "string" || !/^\d{14}$/.test(entry.version)) {
      errors.push("current candidate receipt contains an entry with an invalid version");
      continue;
    }
    if (typeof entry.path !== "string") {
      errors.push(`current candidate receipt entry ${entry.version} has an invalid path (not a string)`);
      continue;
    }
    // F2: canonical shape (no dot segments, absolute path, alternate directory, or slashes).
    const pathSegments = entry.path.split("/");
    if (
      isAbsolute(entry.path)
      || pathSegments[0] !== "supabase"
      || pathSegments[1] !== "migrations"
      || pathSegments.length !== 3
      || pathSegments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))
    ) {
      errors.push(`current candidate receipt entry ${entry.version} has an unsafe or non-canonical path`);
      continue;
    }
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      errors.push(`current candidate receipt entry ${entry.version} has an invalid sha256`);
      continue;
    }
    const filename = pathSegments[2];
    if (!/^\d{14}_[^/\\]+\.sql$/.test(filename)) {
      errors.push(`current candidate receipt entry ${entry.version} has a malformed filename`);
      continue;
    }
    if (!filename.startsWith(`${entry.version}_`)) {
      errors.push(`current candidate receipt entry ${entry.version} filename does not match its version`);
      continue;
    }
    if (seenVersions.has(entry.version)) errors.push(`current candidate receipt duplicates version ${entry.version}`);
    seenVersions.add(entry.version);
    if (seenCanonicalPaths.has(entry.path)) errors.push(`current candidate receipt duplicates path ${entry.path}`);
    seenCanonicalPaths.add(entry.path);

    const candidatePath = resolve(resolvedRoot, entry.path);
    let realCandidate;
    try {
      realCandidate = realpathSync(candidatePath);
    } catch {
      errors.push(`current candidate source file is missing: ${entry.path}`);
      continue;
    }
    // F2: enforced realpath containment inside the resolved migrations root.
    const realRelative = relative(realMigrationsRoot, realCandidate);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      errors.push(`current candidate source path escapes the migrations root: ${entry.path}`);
      continue;
    }
    // F1: an existing on-disk file must exactly match the canonical filename (rejects symlink to an
    // external file whose realpath lands outside, and rejects a variant path to the same content).
    if (basename(realCandidate) !== filename) {
      errors.push(`current candidate source path resolves to a foreign file: ${entry.path}`);
      continue;
    }
    const actualSha = sha256(readFileSync(candidatePath));
    if (actualSha !== entry.sha256) {
      errors.push(`current candidate source hash mismatch for ${entry.version} (${entry.path})`);
    }
  }

  // F1: independently enumerate the actual current SQL inventory and require exact one-to-one
  // equality with the receipt's canonical file set. Any extra/unlisted file (including a content
  // clone under a new version), missing listed file, duplicate, or renamed variant fails closed.
  const onDiskFiles = [];
  for (const filename of readdirSync(realMigrationsRoot)) {
    if (!/^\d{14}_[^/\\]+\.sql$/.test(filename)) continue; // only candidate-shaped .sql are enumerated
    onDiskFiles.push(filename);
  }
  const onDiskSet = new Set(onDiskFiles);
  const receiptCanonicalSet = new Set(
    candidate.migrations
      .filter((entry) => entry && typeof entry.path === "string")
      .map((entry) => entry.path.split("/").pop() || ""),
  );
  if (onDiskFiles.length !== receiptCanonicalSet.size) {
    errors.push(
      `current migrations inventory count mismatch: on-disk=${onDiskFiles.length}, receipt=${receiptCanonicalSet.size}`,
    );
  }
  for (const filename of onDiskFiles) {
    if (!receiptCanonicalSet.has(filename)) {
      errors.push(`current migration file is not listed in the receipt: ${migrationsDir}/${filename}`);
    }
  }
  for (const filename of receiptCanonicalSet) {
    if (!onDiskSet.has(filename)) {
      errors.push(`current migration file is listed but missing from disk: ${migrationsDir}/${filename}`);
    }
  }

  const realProtectedManifest = resolve(resolvedRoot, protectedManifestPath);
  if (!existsSync(realProtectedManifest)) errors.push("current candidate receipt protected manifest is missing");
  else if (sha256(readFileSync(realProtectedManifest)) !== candidate.protectedManifestSha256) {
    errors.push("current candidate receipt protected manifest hash mismatch");
  }

  const realArchive = resolve(resolvedRoot, archivePath);
  if (!existsSync(realArchive)) errors.push("current candidate receipt archived alias is missing");
  else if (sha256(readFileSync(realArchive)) !== candidate.archiveSha256) {
    errors.push("current candidate receipt archive hash mismatch");
  }

  const realTypes = resolve(resolvedRoot, typesPath);
  if (!existsSync(realTypes)) errors.push("current candidate receipt checked-in types file is missing");
  else if (sha256(readFileSync(realTypes)) !== candidate.checkedInTypesSha256) {
    errors.push("current candidate receipt checked-in types hash mismatch");
  }

  // E10 is an additive current-candidate transition. B4 remains immutable historical
  // evidence, including its 117-entry inventory and the older body hash that B4 froze
  // for 20260806143000. Do not silently reinterpret that historical receipt as current.
  const historical = receipt.historicalBaseline;
  if (!historical || typeof historical !== "object") {
    errors.push("current candidate receipt lacks the historical B4 baseline binding");
  } else {
    if (historical.path !== HISTORICAL_B4_RECEIPT_PATH) {
      errors.push(`historical B4 baseline path must be ${HISTORICAL_B4_RECEIPT_PATH}`);
    }
    const historicalPath = resolve(resolvedRoot, HISTORICAL_B4_RECEIPT_PATH);
    if (!existsSync(historicalPath)) {
      errors.push(`historical B4 receipt missing: ${HISTORICAL_B4_RECEIPT_PATH}`);
    } else {
      const historicalRaw = readFileSync(historicalPath, "utf8");
      if (historical.receiptSha256 !== HISTORICAL_B4_RECEIPT_SHA256
        || sha256(historicalRaw) !== HISTORICAL_B4_RECEIPT_SHA256) {
        errors.push("historical B4 receipt hash mismatch");
      }
      let historicalReceipt;
      try {
        historicalReceipt = JSON.parse(historicalRaw);
      } catch {
        errors.push("historical B4 receipt is not valid JSON");
      }
      const historicalCandidate = historicalReceipt?.currentCandidate;
      if (historicalReceipt?.currentCandidateContract !== HISTORICAL_B4_RECEIPT_CONTRACT) {
        errors.push("historical B4 receipt contract mismatch");
      }
      if (historicalCandidate?.versionCount !== 117 || historicalCandidate?.pathCount !== 117) {
        errors.push("historical B4 receipt must retain its 117-entry candidate counts");
      }
      const historicalMigrations = historicalCandidate?.migrations;
      if (!Array.isArray(historicalMigrations) || historicalMigrations.length !== 117) {
        errors.push("historical B4 receipt must retain its complete 117-entry migration inventory");
      } else {
        const historicalInventory = inventoryHash(historicalMigrations.map((entry) => ({
          version: entry?.version,
          name: typeof entry?.path === "string" ? entry.path.split("/").pop()?.slice(15, -4) : entry?.path,
          sha256: entry?.sha256,
        })));
        if (historicalInventory !== HISTORICAL_B4_INVENTORY_SHA256) {
          errors.push("historical B4 migration inventory hash does not match the frozen inventory");
        }
      }
      const frozenMigrations = historical.frozenCurrentCandidate?.migrations;
      if (!Array.isArray(frozenMigrations) || frozenMigrations.length !== 117) {
        errors.push("current E10 receipt must carry the complete frozen B4 migration inventory");
      } else if (JSON.stringify(frozenMigrations) !== JSON.stringify(historicalMigrations)) {
        errors.push("historical B4 migration inventory mismatch between receipt and frozen E7 binding");
      }
      for (const field of ["protectedManifestSha256", "archiveSha256", "checkedInTypesSha256"]) {
        if (historical[field] !== undefined) {
          errors.push(`historical B4 baseline field ${field} must be nested under frozenCurrentCandidate`);
        }
        if (historical.frozenCurrentCandidate?.[field] !== historicalCandidate?.[field]) {
          errors.push(`historical B4 ${field} binding changed`);
        }
        if (field !== "checkedInTypesSha256" && historical.frozenCurrentCandidate?.[field] !== candidate[field]) {
          errors.push(`historical B4 ${field} binding does not match the E7 candidate`);
        }
      }
      const historicalEntry = historicalCandidate?.migrations?.find(
        (entry) => entry?.version === HISTORICAL_B4_MIGRATION_VERSION,
      );
      const transition = historical.transition;
      const currentEntry = candidate.migrations.find(
        (entry) => entry?.version === HISTORICAL_B4_MIGRATION_VERSION,
      );
      if (historicalEntry?.sha256 !== HISTORICAL_B4_MIGRATION_SHA256) {
        errors.push("historical B4 migration hash does not match the frozen receipt hash");
      }
      if (historical.frozenCurrentCandidate?.migrationSha256 !== historicalEntry?.sha256) {
        errors.push("historical B4 frozen migration binding changed");
      }
      for (const historicalMigration of historicalMigrations ?? []) {
        const currentMigration = candidate.migrations.find(
          (entry) => entry?.version === historicalMigration?.version,
        );
        if (!currentMigration) {
          errors.push(`historical B4 migration missing from E7 candidate: ${historicalMigration?.version}`);
          continue;
        }
        if (currentMigration.path !== historicalMigration.path) {
          errors.push(`historical B4 migration path changed for ${historicalMigration?.version}`);
        }
        if (historicalMigration.version !== HISTORICAL_B4_MIGRATION_VERSION
          && currentMigration.sha256 !== historicalMigration.sha256) {
          errors.push(`historical B4 migration hash changed for ${historicalMigration?.version}`);
        }
      }
      if (transition?.version !== HISTORICAL_B4_MIGRATION_VERSION
        || transition?.historicalSha256 !== historicalEntry?.sha256
        || transition?.currentSha256 !== currentEntry?.sha256) {
        errors.push("historical B4 to E7 migration transition binding is invalid");
      }
    }
  }

  return { checked: errors.length === 0, errors, activeCount: candidate.migrations.length };
}

/**
 * Immutable-successor contract for the current-candidate receipt chain.
 *
 * The E10 receipt must both (a) pass the normal current-candidate validation
 * (exact 124 inventory, protected manifest/archive/types bindings, canonical
 * paths, no symlink/traversal) and (b) bind immutably to its immutable E7
 * predecessor by exact SHA-256. An E10 receipt that is internally consistent but
 * does not prove its immediate predecessor (missing/wrong hash, or the
 * predecessor receipt not on disk at that exact hash) fails closed. The
 * historical B4 117-entry transition is validated separately and is never
 * re-materialized as the current candidate.
 */
export function validateCurrentCandidateSuccessorBaseline({ root = REPO_ROOT } = {}) {
  const resolvedRoot = resolve(root);
  const errors = [];
  const successorV2Path = resolve(resolvedRoot, SUCCESSOR_CANDIDATE_RECEIPT_PATH);
  const successorV1Path = resolve(resolvedRoot, SUCCESSOR_V1_CANDIDATE_RECEIPT_PATH);
  const currentPath = existsSync(successorV2Path)
    ? successorV2Path
    : existsSync(successorV1Path)
      ? successorV1Path
      : resolve(resolvedRoot, CURRENT_CANDIDATE_RECEIPT_PATH);
  if (!existsSync(currentPath)) {
    return {
      checked: false,
      errors: [`current candidate successor receipt missing: ${CURRENT_CANDIDATE_RECEIPT_PATH}`],
      predecessorBinding: null,
      activeCount: null,
    };
  }
  if (!existsSync(resolve(resolvedRoot, PREDECESSOR_RECEIPT_PATH))) {
    errors.push(`predecessor receipt missing: ${PREDECESSOR_RECEIPT_PATH}`);
    return { checked: false, errors, predecessorBinding: null, activeCount: null };
  }

  // 1. Bind the immutable E7 predecessor by exact SHA-256 of its on-disk bytes.
  const predecessorRaw = readFileSync(resolve(resolvedRoot, PREDECESSOR_RECEIPT_PATH), "utf8");
  const predecessorSha256 = sha256(predecessorRaw);
  if (predecessorSha256 !== PREDECESSOR_RECEIPT_SHA256) {
    errors.push("E7 predecessor receipt SHA-256 is not the authorized immutable value");
  }
  let current = null;
  try {
    current = JSON.parse(readFileSync(currentPath, "utf8"));
  } catch {
    errors.push(`current candidate successor receipt is not valid JSON: ${CURRENT_CANDIDATE_RECEIPT_PATH}`);
    return { checked: false, errors, predecessorBinding: null, activeCount: null };
  }
  const applyOverrides = (base, envelope, label) => {
    const candidateOverrides = envelope.currentCandidateOverrides ?? {};
    const evidenceOverrides = envelope.evidenceOverrides ?? {};
    if (!candidateOverrides || typeof candidateOverrides !== "object" || Array.isArray(candidateOverrides)) {
      errors.push(`${label} currentCandidateOverrides must be an object`);
      return base;
    }
    if (!evidenceOverrides || typeof evidenceOverrides !== "object" || Array.isArray(evidenceOverrides)) {
      errors.push(`${label} evidenceOverrides must be an object`);
      return base;
    }
    const migrationOverrides = candidateOverrides.migrationSha256Overrides ?? {};
    if (!migrationOverrides || typeof migrationOverrides !== "object" || Array.isArray(migrationOverrides)) {
      errors.push(`${label} migrationSha256Overrides must be an object`);
    }
    const migrations = Array.isArray(base.currentCandidate?.migrations)
      ? base.currentCandidate.migrations.map((entry) => {
        const override = migrationOverrides?.[entry.path];
        if (override === undefined) return entry;
        if (!isValidSha256(override)) errors.push(`${label} migration override hash is invalid: ${entry.path}`);
        return { ...entry, sha256: override };
      })
      : base.currentCandidate?.migrations;
    for (const path of Object.keys(migrationOverrides ?? {})) {
      if (!migrations?.some((entry) => entry.path === path)) {
        errors.push(`${label} migration override path is not in the predecessor inventory: ${path}`);
      }
    }
    const allowedCandidateKeys = new Set(["migrationSha256Overrides", "orderedInventorySha256"]);
    for (const key of Object.keys(candidateOverrides)) {
      if (!allowedCandidateKeys.has(key)) errors.push(`${label} currentCandidateOverrides key is unexpected: ${key}`);
    }
    return {
      ...base,
      currentCandidate: {
        ...base.currentCandidate,
        ...candidateOverrides,
        migrations,
      },
      evidence: { ...base.evidence, ...evidenceOverrides },
    };
  };

  const validateEnvelope = (envelope, expectedSchema, predecessorPath, expectedLedgerRow, label) => {
    if (envelope?.schema !== expectedSchema) {
      errors.push(`${label} schema must be ${expectedSchema}`);
    }
    if (envelope?.supersession?.ledgerRow !== expectedLedgerRow
      || !Array.isArray(envelope.supersession?.changedPaths)
      || envelope.supersession.changedPaths.length === 0
      || !Array.isArray(envelope.supersession?.validation)
      || envelope.supersession.validation.length === 0
      || envelope.supersession?.releaseState !== "CLOSED") {
      errors.push(`${label} supersession metadata is invalid`);
    }
    if (envelope?.predecessor?.path !== predecessorPath) {
      errors.push(`${label} predecessor path must be ${predecessorPath}`);
    }
    const absolutePredecessor = resolve(resolvedRoot, predecessorPath);
    if (!existsSync(absolutePredecessor)) {
      errors.push(`${label} predecessor missing: ${predecessorPath}`);
      return null;
    }
    const predecessorRaw = readFileSync(absolutePredecessor, "utf8");
    const predecessorSha = sha256(predecessorRaw);
    if (envelope?.predecessor?.sha256 !== predecessorSha) {
      errors.push(`${label} predecessor SHA-256 does not match its immutable predecessor`);
    }
    return JSON.parse(predecessorRaw);
  };

  let effectiveCurrent = current;
  if (current?.schema === SUCCESSOR_V2_CANDIDATE_RECEIPT_SCHEMA) {
    if (JSON.stringify(current.supersession?.evidenceTier) !== JSON.stringify({ achieved: ["T0", "T1", "T2"], deferred: ["T3", "T4"] })) {
      errors.push("successor-v2 evidence tier is invalid");
    }
    const v1 = validateEnvelope(
      current,
      SUCCESSOR_V2_CANDIDATE_RECEIPT_SCHEMA,
      SUCCESSOR_V1_CANDIDATE_RECEIPT_PATH,
      545,
      "successor-v2 receipt",
    );
    if (v1?.schema !== SUCCESSOR_V1_CANDIDATE_RECEIPT_SCHEMA) {
      errors.push("successor-v2 predecessor must be successor-v1");
    }
    if (v1) {
      const base = validateEnvelope(
        v1,
        SUCCESSOR_V1_CANDIDATE_RECEIPT_SCHEMA,
        CURRENT_CANDIDATE_RECEIPT_PATH,
        544,
        "successor-v1 receipt",
      );
      if (base) effectiveCurrent = applyOverrides(applyOverrides(base, v1, "successor-v1"), current, "successor-v2");
    }
    const additionalEvidence = current.additionalEvidence ?? {};
    if (!additionalEvidence || typeof additionalEvidence !== "object" || Array.isArray(additionalEvidence)) {
      errors.push("successor-v2 additionalEvidence must be an object");
    } else {
      for (const [evidencePath, expectedSha] of Object.entries(additionalEvidence)) {
        if (!["scripts/check-video-render-rls-contract.mjs", "scripts/check-migration-baseline.test.mjs"].includes(evidencePath)) {
          errors.push(`successor-v2 additional evidence path is unexpected: ${evidencePath}`);
          continue;
        }
        const absolutePath = resolve(resolvedRoot, evidencePath);
        if (!isValidSha256(expectedSha) || !existsSync(absolutePath) || sha256(readFileSync(absolutePath)) !== expectedSha) {
          errors.push(`successor-v2 additional evidence hash mismatch: ${evidencePath}`);
        }
      }
    }
  } else if (current?.schema === SUCCESSOR_V1_CANDIDATE_RECEIPT_SCHEMA) {
    if (current.supersession?.evidenceTier && JSON.stringify(current.supersession.evidenceTier) !== JSON.stringify({ achieved: ["T0", "T1"], deferred: ["T2", "T3", "T4"] })) {
      errors.push("successor-v1 evidence tier is invalid");
    }
    const predecessor = validateEnvelope(
      current,
      SUCCESSOR_V1_CANDIDATE_RECEIPT_SCHEMA,
      CURRENT_CANDIDATE_RECEIPT_PATH,
      544,
      "successor-v1 receipt",
    );
    if (predecessor) effectiveCurrent = applyOverrides(predecessor, current, "successor-v1");
  }
  const candidate = effectiveCurrent?.currentCandidate;
  const declaredPredecessor = candidate?.[PREDECESSOR_BINDING_FIELD];
  if (typeof declaredPredecessor !== "string" || !/^[a-f0-9]{64}$/.test(declaredPredecessor)) {
    errors.push("current candidate successor receipt must declare a predecessorReceiptSha256");
  } else if (declaredPredecessor !== predecessorSha256) {
    errors.push(
      `predecessor receipt binding mismatch: declared ${declaredPredecessor}, expected SHA-256 of `
        + `${PREDECESSOR_RECEIPT_PATH} = ${predecessorSha256}`,
    );
  }

  // 2. Run the full current-candidate validation against the successor receipt.
  const inner = validateCurrentCandidateBaseline({
    root,
    receiptOverride: effectiveCurrent,
    candidateInventorySha256: effectiveCurrent.currentCandidate?.orderedInventorySha256,
  });
  errors.push(...inner.errors);

  return {
    checked: errors.length === 0,
    errors,
    predecessorBinding: { predecessorSha256, declaredPredecessor },
    activeCount: inner.activeCount,
  };
}

export function evaluateReleaseReadiness(manifest, remoteValidation, evidenceValidation = {}) {
  const errors = [];
  const pendingOwnerReview = manifest.observed_entries.filter(
    (entry) => entry.review_status === "candidate_pending_owner_review",
  ).length;
  const activeBlockers = (manifest.blockers ?? []).filter((item) => item.status === "blocked");
  if (!remoteValidation.checked) errors.push("fresh remote migration snapshot was not checked");
  if (!evidenceValidation.schemaEvidenceChecked) errors.push("protected replay/production schema evidence was not checked");
  if (!evidenceValidation.typesEvidenceChecked) errors.push("fresh production types evidence was not checked");
  if (pendingOwnerReview > 0) errors.push(`${pendingOwnerReview} observed entries still require owner review`);
  if (activeBlockers.length > 0) errors.push(`active blockers: ${activeBlockers.map((item) => item.id).join(", ")}`);
  if (manifest.candidate?.status !== "accepted") {
    errors.push(`candidate status is ${String(manifest.candidate?.status)}`);
  }
  if (
    manifest.candidate?.replay?.acceptance_result !== "accepted"
    || manifest.candidate?.replay?.outbound_isolation !== "proven_no_egress"
  ) {
    errors.push("replay does not have an accepted no-egress receipt");
  }
  if (manifest.candidate?.recovery?.status !== "accepted") errors.push("restore readiness is not accepted");
  if (manifest.candidate?.privilege_review?.status !== "approved") errors.push("privilege review is not approved");
  if (manifest.candidate?.remote_body_resolution?.status !== "approved") {
    errors.push("missing remote body is not resolved");
  }
  if (manifest.candidate?.hosted_ci?.status !== "passed") errors.push("hosted CI has not passed");
  if (
    manifest.candidate?.generated_types?.checked_in_status !== "current"
    || manifest.candidate?.generated_types?.checked_in_sha256 !== manifest.candidate?.generated_types?.production_sha256
  ) {
    errors.push("checked-in generated types are not tied to the approved production schema");
  }
  return errors;
}

export function validateMigrationBaseline({
  root = REPO_ROOT,
  manifestPath = MANIFEST_PATH,
  remoteJsonPath = null,
  replaySchemaPath = null,
  productionSchemaPath = null,
  productionTypesPath = null,
  typesReceiptPath = null,
  releaseGate = false,
} = {}) {
  const resolvedRoot = resolve(root);
  const resolvedManifest = resolve(resolvedRoot, manifestPath);
  if (!existsSync(resolvedManifest)) throw new Error(`Migration manifest not found: ${resolvedManifest}`);
  const rawManifest = readFileSync(resolvedManifest, "utf8");
  const manifest = JSON.parse(rawManifest);
  const inputPathErrors = [];
  const resolvedRemoteJsonPath = resolveEvidenceInputPath(
    resolvedRoot,
    remoteJsonPath,
    "remote export evidence",
    inputPathErrors,
  );
  const resolvedReplaySchemaPath = resolveEvidenceInputPath(
    resolvedRoot,
    replaySchemaPath,
    "replay schema evidence",
    inputPathErrors,
  );
  const resolvedProductionSchemaPath = resolveEvidenceInputPath(
    resolvedRoot,
    productionSchemaPath,
    "production schema evidence",
    inputPathErrors,
  );
  const resolvedProductionTypesPath = resolveEvidenceInputPath(
    resolvedRoot,
    productionTypesPath,
    "production types evidence",
    inputPathErrors,
  );
  const resolvedTypesReceiptPath = resolveEvidenceInputPath(
    resolvedRoot,
    typesReceiptPath,
    "types receipt evidence",
    inputPathErrors,
  );
  const allowedUntrackedPaths = new Set();
  const realResolvedRoot = realpathSync(resolvedRoot);
  for (const evidencePath of [
    resolvedRemoteJsonPath,
    resolvedReplaySchemaPath,
    resolvedProductionSchemaPath,
    resolvedProductionTypesPath,
    resolvedTypesReceiptPath,
  ]) {
    if (!evidencePath) continue;
    let realEvidencePath;
    try {
      realEvidencePath = realpathSync(resolve(evidencePath));
    } catch {
      continue;
    }
    const relativePath = relative(realResolvedRoot, realEvidencePath).split("\\").join("/");
    if (relativePath && !relativePath.startsWith("..")) allowedUntrackedPaths.add(relativePath);
  }
  const errors = [
    ...inputPathErrors,
    ...validateManifestShape(manifest),
    ...validateNoSensitiveMaterial(manifest, "manifest", rawManifest),
    ...validateReviewedSourcesContainNoSecrets(resolvedRoot),
    ...validateReferencedEvidenceFiles(manifest, resolvedRoot, allowedUntrackedPaths),
    ...validatePrivilegeReceipt(manifest, resolvedRoot, {
      replaySchemaPath: resolvedReplaySchemaPath,
      productionSchemaPath: resolvedProductionSchemaPath,
    }),
  ];

  const active = listActiveMigrations(resolvedRoot);
  const actualVersions = active.map((entry) => entry.version);
  const duplicateVersions = actualVersions.filter((version, index) => actualVersions.indexOf(version) !== index);
  if (duplicateVersions.length) {
    errors.push(`duplicate active migration versions: ${[...new Set(duplicateVersions)].join(", ")}`);
  }
  if (active.some((entry) => entry.version === "20250903140000")) {
    errors.push("demoted 20250903140000 alias is still executable");
  }

  // Manifest-integrity facts that hold regardless of the current tree or release gate.
  const observedLocalInventoryHash = inventoryHash(manifest.observed_entries.filter((entry) => entry.side === "local"));
  if (observedLocalInventoryHash !== manifest.methodology?.protected_input_hashes?.observed_local_inventory_sha256) {
    errors.push("observed local inventory differs from protected input hash");
  }
  const generatorPath = resolve(resolvedRoot, "scripts/build-migration-equivalence-manifest.mjs");
  if (
    !existsSync(generatorPath)
    || sha256(readFileSync(generatorPath)) !== manifest.methodology?.protected_input_hashes?.manifest_generator_sha256
  ) {
    errors.push("manifest generator differs from protected input hash");
  }

  if (releaseGate) {
    // The protected snapshot is a frozen 107-active-candidate record (observed 2026-07-14). The
    // current tree legitimately carries forward migrations newer than that snapshot, so equivalence
    // against the protected candidate is enforced only when the release gate demands it. Normal mode
    // verifies the current candidate against its own immutable receipt below.
    const expectedVersions = manifest.candidate?.active_versions ?? [];
    const expectedHashes = manifest.candidate?.active_source_hashes ?? {};
    if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
      errors.push("active migration versions differ from the reviewed candidate inventory");
    }
    const actualCandidateInventoryHash = inventoryHash(active.map((entry) => ({
      version: entry.version,
      name: entry.filename.slice(15, -4),
      sha256: entry.sha256,
    })));
    if (actualCandidateInventoryHash !== manifest.methodology?.protected_input_hashes?.candidate_local_inventory_sha256) {
      errors.push("active migration filenames/body inventory differs from protected candidate input");
    }
    const restoredVersions = new Set(["20250904033120", "20250904033146", "20250905010114"]);
    const observedLocalByVersion = new Map(
      manifest.observed_entries
        .filter((entry) => entry.side === "local")
        .map((entry) => [entry.version, entry]),
    );
    const observedRemoteByVersion = new Map(
      manifest.observed_entries
        .filter((entry) => entry.side === "remote")
        .map((entry) => [entry.version, entry]),
    );
    for (const migration of active) {
      if (migration.sha256 !== expectedHashes[migration.version]) {
        errors.push(`active migration hash changed for ${migration.version}`);
      }
      if (restoredVersions.has(migration.version)) {
        const remote = observedRemoteByVersion.get(migration.version);
        if (!remote || (migration.sha256 !== remote.sha256 && migration.sha256WithoutTerminalLf !== remote.sha256)) {
          errors.push(`restored source differs from immutable remote body for ${migration.version}`);
        }
      } else {
        const observed = observedLocalByVersion.get(migration.version);
        if (!observed || migration.sha256 !== observed.sha256) {
          errors.push(`active source differs from immutable observed local body for ${migration.version}`);
        }
      }
    }
    const archivedAlias = resolve(resolvedRoot, ARCHIVED_ALIAS_PATH);
    const observedAlias = manifest.observed_entries.find((entry) => entry.id === "local:20250903140000");
    if (!existsSync(archivedAlias)) errors.push(`archived alias missing: ${ARCHIVED_ALIAS_PATH}`);
    else if (!observedAlias || readMigrationFile(archivedAlias).sha256 !== observedAlias.sha256) {
      errors.push("archived alias does not match the immutable observed source hash");
    }
    const checkedInTypesPath = resolve(resolvedRoot, "src/integrations/supabase/types.ts");
    if (!existsSync(checkedInTypesPath)) {
      errors.push("checked-in Supabase types file is missing");
    } else if (sha256(readFileSync(checkedInTypesPath)) !== manifest.candidate?.generated_types?.checked_in_sha256) {
      errors.push("checked-in Supabase type hash differs from the manifest");
    }
  }

  // Normal mode fixes the current tree to the standalone current-candidate receipt so every current
  // file (including the forward migrations absent from the protected 107-candidate snapshot) is
  // independently verified. A genuine mismatch of any current source, the archive, the checked-in
  // types, or the protected-manifest binding FAILS normal mode. Release mode defers the equivalence
  // to the protected snapshot and the reviewed-SHA/owner/grant/type evidence; if a forward candidate
  // has not been adopted into the candidate, release fails closed above.
  let currentCandidateValidation = { checked: false, errors: [], activeCount: null };
  if (!releaseGate) {
    currentCandidateValidation = validateCurrentCandidateSuccessorBaseline({ root: resolvedRoot });
    errors.push(...currentCandidateValidation.errors);
  }

  const remoteValidation = validateRemoteSnapshot(manifest, resolvedRemoteJsonPath);
  errors.push(...remoteValidation.errors);
  const typesValidation = validateTypesEvidence(
    manifest,
    resolvedProductionTypesPath,
    resolvedTypesReceiptPath,
  );
  errors.push(...typesValidation.errors);
  const schemaEvidenceChecked = Boolean(replaySchemaPath && productionSchemaPath);
  if (releaseGate && !schemaEvidenceChecked) {
    errors.push("release gate requires protected replay and production schema evidence");
  }
  if (releaseGate && !typesValidation.checked) {
    errors.push("release gate requires fresh production types evidence");
  }
  if (releaseGate) {
    errors.push(...validateReviewedGitEvidence(manifest, resolvedRoot, allowedUntrackedPaths));
  }
  if (errors.length) throw new Error(`Migration baseline validation failed:\n- ${errors.join("\n- ")}`);

  const releaseErrors = evaluateReleaseReadiness(manifest, remoteValidation, {
    schemaEvidenceChecked,
    typesEvidenceChecked: typesValidation.checked,
  });
  if (releaseGate && releaseErrors.length) {
    throw new Error(`Migration release gate blocked:\n- ${releaseErrors.join("\n- ")}`);
  }

  return {
    manifest: basename(resolvedManifest),
    observedSideEntries: manifest.observed_entries.length,
    activeMigrations: active.length,
    hashProvenEntries: manifest.observed_entries.filter((entry) => entry.review_status === "hash_proven").length,
    pendingOwnerReviewEntries: manifest.observed_entries.filter(
      (entry) => entry.review_status === "candidate_pending_owner_review",
    ).length,
    remoteSnapshotChecked: remoteValidation.checked,
    remoteSnapshotCapturedAt: remoteValidation.capturedAt,
    typesEvidenceCapturedAt: typesValidation.capturedAt,
    blockers: manifest.blockers.map((item) => item.id),
    releaseReady: releaseErrors.length === 0,
    releaseErrors,
    currentCandidateChecked: currentCandidateValidation.checked,
    currentCandidateActiveCount: currentCandidateValidation.activeCount,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const remoteFlagIndex = process.argv.indexOf("--remote-json");
  const remoteJsonPath = remoteFlagIndex >= 0 ? process.argv[remoteFlagIndex + 1] : null;
  const replaySchemaFlagIndex = process.argv.indexOf("--replay-schema");
  const replaySchemaPath = replaySchemaFlagIndex >= 0 ? process.argv[replaySchemaFlagIndex + 1] : null;
  const productionSchemaFlagIndex = process.argv.indexOf("--production-schema");
  const productionSchemaPath = productionSchemaFlagIndex >= 0 ? process.argv[productionSchemaFlagIndex + 1] : null;
  const productionTypesFlagIndex = process.argv.indexOf("--production-types");
  const productionTypesPath = productionTypesFlagIndex >= 0 ? process.argv[productionTypesFlagIndex + 1] : null;
  const typesReceiptFlagIndex = process.argv.indexOf("--types-receipt");
  const typesReceiptPath = typesReceiptFlagIndex >= 0 ? process.argv[typesReceiptFlagIndex + 1] : null;
  const releaseGate = process.argv.includes("--release-gate");
  if (remoteFlagIndex >= 0 && !remoteJsonPath) throw new Error("--remote-json requires a path");
  for (const [index, name] of [
    [replaySchemaFlagIndex, "--replay-schema"],
    [productionSchemaFlagIndex, "--production-schema"],
    [productionTypesFlagIndex, "--production-types"],
    [typesReceiptFlagIndex, "--types-receipt"],
  ]) {
    if (index >= 0 && !process.argv[index + 1]) throw new Error(`${name} requires a path`);
  }
  const result = validateMigrationBaseline({
    remoteJsonPath,
    replaySchemaPath,
    productionSchemaPath,
    productionTypesPath,
    typesReceiptPath,
    releaseGate,
  });
  console.log(
    `Migration inventory integrity PASS: ${result.observedSideEntries} immutable observed sides, `
      + `${result.activeMigrations} current active files, ${result.hashProvenEntries} hash-proven, `
      + `${result.pendingOwnerReviewEntries} pending owner review, remote snapshot `
      + `${result.remoteSnapshotChecked ? `checked at ${result.remoteSnapshotCapturedAt}` : "not checked"}.`,
  );
  console.log(`Migration release gate ${result.releaseReady ? "READY" : "BLOCKED"}: ${result.releaseErrors.join("; ")}`);
  console.log(
    `Current candidate contents verified: ${result.currentCandidateChecked ? "PASS" : "FAIL"} `
      + `(${result.currentCandidateActiveCount} migrations fixed against receipt).`,
  );
}

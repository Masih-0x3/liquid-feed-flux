import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = "docs/plans/2026-07-14-xot-migration-equivalence-manifest.json";
export const PRIVILEGE_DIFF_PATH = "docs/plans/2026-07-14-xot-schema-privilege-diff.json";
export const ARCHIVED_ALIAS_PATH = "supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql";
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

function validateReferencedEvidenceFiles(manifest, root) {
  const errors = [];
  const cache = new Map();
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
    const evidencePath = resolve(root, reference.path);
    if (!evidencePath.startsWith(`${resolve(root)}/`)) {
      errors.push(`evidence path escapes repository root: ${reference.path}`);
      return null;
    }
    if (!existsSync(evidencePath)) {
      errors.push(`referenced evidence file is missing: ${reference.path}`);
      return null;
    }
    const raw = readFileSync(evidencePath, "utf8");
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

function validateReviewedGitEvidence(manifest, gitRoot) {
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
    const trackedStatus = execFileSync(
      "git",
      ["-C", resolve(gitRoot), "status", "--porcelain", "--untracked-files=no"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (trackedStatus) return ["release checkout has uncommitted tracked changes"];
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
  const payload = JSON.parse(readFileSync(resolve(remoteJsonPath), "utf8"));
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const errors = [];
  if (sha256(readFileSync(resolve(remoteJsonPath))) !== manifest.methodology?.protected_input_hashes?.remote_export_sha256) {
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
  const errors = [
    ...validateManifestShape(manifest),
    ...validateNoSensitiveMaterial(manifest, "manifest", rawManifest),
    ...validateReviewedSourcesContainNoSecrets(resolvedRoot),
    ...validateReferencedEvidenceFiles(manifest, resolvedRoot),
    ...validatePrivilegeReceipt(manifest, resolvedRoot, { replaySchemaPath, productionSchemaPath }),
  ];

  const active = listActiveMigrations(resolvedRoot);
  const expectedVersions = manifest.candidate?.active_versions ?? [];
  const expectedHashes = manifest.candidate?.active_source_hashes ?? {};
  const actualVersions = active.map((entry) => entry.version);
  const duplicateVersions = actualVersions.filter((version, index) => actualVersions.indexOf(version) !== index);
  if (duplicateVersions.length) {
    errors.push(`duplicate active migration versions: ${[...new Set(duplicateVersions)].join(", ")}`);
  }
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
  if (active.some((entry) => entry.version === "20250903140000")) {
    errors.push("demoted 20250903140000 alias is still executable");
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

  const remoteValidation = validateRemoteSnapshot(manifest, remoteJsonPath);
  errors.push(...remoteValidation.errors);
  const typesValidation = validateTypesEvidence(manifest, productionTypesPath, typesReceiptPath);
  errors.push(...typesValidation.errors);
  const schemaEvidenceChecked = Boolean(replaySchemaPath && productionSchemaPath);
  if (releaseGate && !schemaEvidenceChecked) {
    errors.push("release gate requires protected replay and production schema evidence");
  }
  if (releaseGate && !typesValidation.checked) {
    errors.push("release gate requires fresh production types evidence");
  }
  if (releaseGate) {
    errors.push(...validateReviewedGitEvidence(manifest, resolvedRoot));
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
}

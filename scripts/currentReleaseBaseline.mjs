import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, dirname } from "node:path";
import { assertCurrentReleaseMigrationInventory, CURRENT_RELEASE_INVENTORY_SHA256, CURRENT_RELEASE_MIGRATION_VERSION, CURRENT_RELEASE_HARNESS_PATHS } from "./currentReleaseSqlBoundary.mjs";
import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";
import { E10_EXPECTED_IMAGE, E10_CONTEXT } from "./e10SqlBoundary.mjs";
import { E7_EXPECTED_PG_META_IMAGE, E7_PG_META_COMMAND } from "./e7DisposableBoundary.mjs";

export const CURRENT_RELEASE_BASELINE_PATH = "docs/plans/2026-09-07-xot-current-release-baseline.json";
export const CURRENT_RELEASE_PRIVILEGE_PATH = "docs/plans/2026-09-07-xot-current-release-schema-privilege-diff.json";
export const CURRENT_RELEASE_BASELINE_SCHEMA = "xot-current-release-baseline-v1";
export const CURRENT_PROJECT = "jzirqfzzvlbxwfzndaer";
export const CURRENT_CAPTURE_SOURCE = Object.freeze({
  service: "postgres",
  relation: "supabase_migrations.schema_migrations",
  statement_serialization: "statements.join(LF)",
  capture_tool: "supabase-cli-go:db-query-linked-2.111.0",
  query_sha256: "ebd2e913e33eed927c78b46aa164a8ad6c4447f94ea2d10484ade2a1cb56a891",
});
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const sha = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const human = (value) => typeof value === "string" && value.trim().length >= 2 && !/pending|automation|agent|codex|unknown/i.test(value);
export function parseEvidenceJson(raw) {
  try { return JSON.parse(raw); } catch { throw new Error("evidence JSON is invalid; contents withheld"); }
}

export function localInventory(root) {
  return readdirSync(resolve(root, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort().map((file) => {
      const body = readFileSync(resolve(root, "supabase/migrations", file));
      return { version: file.slice(0, 14), name: file.slice(15, -4), sha256: hash(body),
        sha256_without_terminal_lf: hash(body.at(-1) === 10 ? body.subarray(0, -1) : body) };
    });
}

// The current-release epoch ends at CURRENT_RELEASE_MIGRATION_VERSION. Later
// append-only successors (e.g. the September 8 remaining-PR batch) belong to a
// newer epoch and must not weaken drift detection inside this one.
export function epochInventory(root) {
  return localInventory(root).filter((entry) => entry.version <= CURRENT_RELEASE_MIGRATION_VERSION);
}

export function remoteInventory(payload) {
  if (!Array.isArray(payload?.rows)) throw new Error("remote capture rows are absent");
  const seen = new Set();
  return payload.rows.map((row) => {
    if (!/^\d{14}$/.test(row.version) || seen.has(row.version)
      || !Array.isArray(row.statements) || row.statements.some((statement) => typeof statement !== "string")) {
      throw new Error("remote capture version/statement shape is invalid or duplicated");
    }
    seen.add(row.version);
    return { version: row.version, name: row.name || null, sha256: hash(row.statements.join("\n")),
      statement_count: row.statements.length, body_available: row.statements.length > 0 };
  }).sort((a, b) => a.version.localeCompare(b.version));
}

export function insidePath(root, path) {
  if (typeof path !== "string" || !path) throw new Error("evidence path is absent");
  const base = realpathSync(root);
  const target = realpathSync(resolve(root, path));
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("evidence path escapes repository root");
  if (!statSync(target).isFile()) throw new Error("evidence path is not a file");
  return target;
}

export function protectedInput(root, path) {
  const target = insidePath(root, path);
  const privateRoot = realpathSync(resolve(root, "supabase/.temp"));
  if (!target.startsWith(`${privateRoot}/`)) throw new Error("raw evidence must be under the existing private .temp boundary");
  if ((statSync(target).mode & 0o777) !== 0o600 || (statSync(dirname(target)).mode & 0o777) !== 0o700) {
    throw new Error("raw evidence requires file 0600 and immediate directory 0700");
  }
  const rel = relative(realpathSync(root), target);
  execFileSync("git", ["-C", root, "check-ignore", "--quiet", "--", rel], { stdio: "pipe" });
  const tracked = execFileSync("git", ["-C", root, "ls-files", "--", rel], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (tracked.trim()) throw new Error("raw evidence must not be tracked");
  return readFileSync(target);
}

export function buildCurrentReleaseBaseline({ root, remotePath, historicalPath, predecessorPath, gateChecks }) {
  const raw = protectedInput(root, remotePath);
  const payload = parseEvidenceJson(raw);
  const local = epochInventory(root);
  assertCurrentReleaseMigrationInventory(local);
  const remote = remoteInventory(payload);
  if (payload.project_ref !== CURRENT_PROJECT || payload.export_contract !== "xot-remote-migration-snapshot-v1"
    || JSON.stringify(payload.source) !== JSON.stringify(CURRENT_CAPTURE_SOURCE) || !iso(payload.captured_at)) {
    throw new Error("capture identity/provenance is not the approved current contract");
  }
  const historical = parseEvidenceJson(readFileSync(insidePath(root, historicalPath)));
  const historicalEntries = new Map(historical.observed_entries.map((entry) => [entry.id, entry]));
  const entries = [...local.map((entry) => ({ ...entry, side: "local" })), ...remote.map((entry) => ({ ...entry, side: "remote" }))]
    .map((entry) => {
      const opposite = entry.side === "local" ? remote : local;
      const matches = opposite.filter((other) => entry.sha256 === other.sha256
        || (entry.side === "local" ? entry.sha256_without_terminal_lf === other.sha256 : entry.sha256 === other.sha256_without_terminal_lf));
      const id = `${entry.side}:${entry.version}`;
      const previous = historicalEntries.get(id);
      // Byte equality proves source equality, not privilege, deployment or owner approval.
      return { id, side: entry.side, version: entry.version, sha256: entry.sha256,
        counterparts: matches.map((other) => `${entry.side === "local" ? "remote" : "local"}:${other.version}`),
        disposition: matches.length ? "raw_body_equal" : "requires_semantic_review",
        review_status: matches.length ? "hash_proven" : "candidate_pending_owner_review",
        historical_disposition: previous?.disposition ?? null,
        review: null };
    });
  return { schema: CURRENT_RELEASE_BASELINE_SCHEMA, created_at: new Date().toISOString(), project_ref: CURRENT_PROJECT,
    historical: { path: historicalPath, sha256: hash(readFileSync(insidePath(root, historicalPath))) },
    predecessor: { path: predecessorPath, sha256: hash(readFileSync(insidePath(root, predecessorPath))) },
    candidate: { status: "pending_review", reviewed_git_sha: null, inventory_sha256: CURRENT_RELEASE_INVENTORY_SHA256,
      checked_in_types_sha256: hash(readFileSync(resolve(root, "src/integrations/supabase/types.ts"))),
      local_inventory: local },
    remote: { captured_at: payload.captured_at, raw_sha256: hash(raw), source: payload.source, inventory: remote,
      sensitive_history_disposition: "protected_local_input_pending_owner_review" },
    observed_entries: entries,
    blockers: Object.entries(gateChecks).map(([id, checks]) => ({ id, status: "blocked", required_checks: [...checks], resolved_at: null, receipt: null })),
    evidence: { replay_receipt: null, privilege_diff: null, production_schema_sha256: null, replay_schema_sha256: null,
      production_types_sha256: null, replay_types_sha256: null },
    release: "CLOSED" };
}

export function currentReleaseImmutableProjection(manifest) {
  const projected = structuredClone(manifest);
  delete projected.release;
  delete projected.candidate.status;
  delete projected.candidate.reviewed_git_sha;
  delete projected.remote.sensitive_history_disposition;
  for (const entry of projected.observed_entries) { delete entry.review_status; delete entry.review; }
  for (const gate of projected.blockers) { delete gate.status; delete gate.resolved_at; delete gate.receipt; }
  return projected;
}

export function validateCurrentReleaseShape(manifest, gateChecks) {
  const errors = [];
  if (manifest?.schema !== CURRENT_RELEASE_BASELINE_SCHEMA || manifest.project_ref !== CURRENT_PROJECT || !iso(manifest.created_at)) {
    return ["current release baseline schema/project/time is invalid"];
  }
  if (!Array.isArray(manifest.candidate?.local_inventory) || !Array.isArray(manifest.remote?.inventory)
    || !manifest.evidence || typeof manifest.evidence !== "object" || Array.isArray(manifest.evidence)) {
    return ["current release baseline candidate/remote/evidence structure is invalid"];
  }
  try { assertCurrentReleaseMigrationInventory(manifest.candidate?.local_inventory ?? []); }
  catch { errors.push("current release baseline inventory is not the pinned candidate"); }
  if (manifest.candidate?.inventory_sha256 !== CURRENT_RELEASE_INVENTORY_SHA256) errors.push("current release candidate inventory pin differs");
  if (!["pending_review", "accepted"].includes(manifest.candidate?.status)
    || !["CLOSED", "READY"].includes(manifest.release)) errors.push("current candidate status is invalid");
  if (!sha(manifest.candidate?.checked_in_types_sha256)) errors.push("current release type hash is invalid");
  if (!Array.isArray(manifest.remote?.inventory) || manifest.remote.inventory.length !== 117
    || !sha(manifest.remote?.raw_sha256) || !iso(manifest.remote?.captured_at)
    || JSON.stringify(manifest.remote?.source) !== JSON.stringify(CURRENT_CAPTURE_SOURCE)) errors.push("current remote baseline contract is invalid");
  const remoteRows = Array.isArray(manifest.remote?.inventory) ? manifest.remote.inventory : [];
  if (new Set(remoteRows.map((row) => row.version)).size !== remoteRows.length
    || remoteRows.some((row) => !/^\d{14}$/.test(row.version) || !sha(row.sha256)
      || !Number.isInteger(row.statement_count) || row.statement_count < 0 || row.body_available !== (row.statement_count > 0))) {
    errors.push("current remote baseline row shape is invalid");
  }
  const expectedEntries = [...(manifest.candidate?.local_inventory ?? []).map((entry) => ({ ...entry, side: "local" })),
    ...(manifest.remote?.inventory ?? []).map((entry) => ({ ...entry, side: "remote" }))];
  const observed = Array.isArray(manifest.observed_entries) ? manifest.observed_entries : [];
  const ids = new Set();
  if (observed.length !== expectedEntries.length) errors.push("current review inventory count differs");
  for (const entry of expectedEntries) {
    const id = `${entry.side}:${entry.version}`;
    const reviewed = observed.find((item) => item.id === id);
    if (ids.has(id) || !reviewed || reviewed.sha256 !== entry.sha256 || reviewed.side !== entry.side || reviewed.version !== entry.version) {
      errors.push(`current review inventory binding differs: ${id}`); continue;
    }
    ids.add(id);
    const opposite = entry.side === "local" ? manifest.remote.inventory : manifest.candidate.local_inventory;
    const matches = opposite.filter((other) => entry.sha256 === other.sha256
      || (entry.side === "local" ? entry.sha256_without_terminal_lf === other.sha256 : entry.sha256 === other.sha256_without_terminal_lf))
      .map((other) => `${entry.side === "local" ? "remote" : "local"}:${other.version}`);
    if (JSON.stringify(matches) !== JSON.stringify(reviewed.counterparts)
      || reviewed.disposition !== (matches.length ? "raw_body_equal" : "requires_semantic_review")) errors.push(`current counterpart proof differs: ${id}`);
    if (reviewed.review_status === "hash_proven") {
      if (!matches.length || reviewed.review !== null) errors.push(`current hash proof is invalid: ${id}`);
    } else if (reviewed.review_status === "candidate_pending_owner_review") {
      if (reviewed.review !== null) errors.push(`pending review must not claim a receipt: ${id}`);
    } else if (reviewed.review_status === "owner_approved") {
      const review = reviewed.review;
      const receipt = review?.evidence_receipt;
      if (!human(review?.reviewer) || !iso(review?.reviewed_at) || receipt?.contract !== "xot-migration-owner-review-v1"
        || receipt.entry_id !== id || receipt.decision !== "approved" || receipt.disposition !== reviewed.disposition
        || receipt.reviewed_sha256 !== entry.sha256 || receipt.reviewed_git_sha !== manifest.candidate.reviewed_git_sha
        || receipt.reviewer !== review.reviewer || receipt.reviewed_at !== review.reviewed_at) errors.push(`current owner approval is invalid: ${id}`);
    } else errors.push(`current review status is invalid: ${id}`);
  }
  const gates = Array.isArray(manifest.blockers) ? manifest.blockers : [];
  if (gates.length !== Object.keys(gateChecks).length || new Set(gates.map((gate) => gate.id)).size !== gates.length) errors.push("current gate inventory differs");
  for (const [id, checks] of Object.entries(gateChecks)) {
    const gate = gates.find((item) => item.id === id);
    if (!gate || JSON.stringify(gate.required_checks) !== JSON.stringify(checks)) errors.push(`current required checks differ: ${id}`);
    else if (gate.status === "blocked") {
      if (gate.receipt !== null || gate.resolved_at !== null) errors.push(`blocked gate must not claim closure: ${id}`);
    } else if (gate.status === "resolved") {
      if (!human(gate.receipt?.reviewer) || !iso(gate.resolved_at)) errors.push(`current gate owner receipt is invalid: ${id}`);
    } else errors.push(`current gate status is invalid: ${id}`);
  }
  return errors;
}

export function validateCurrentReleaseBaseline({ root, baselinePath = CURRENT_RELEASE_BASELINE_PATH, remoteJsonPath,
  replaySchemaPath, productionSchemaPath, productionTypesPath, replayTypesPath, typesReceiptPath, releaseGate = true, legacy, nowMs = Date.now() }) {
  const manifest = parseEvidenceJson(readFileSync(insidePath(root, baselinePath), "utf8"));
  const errors = validateCurrentReleaseShape(manifest, legacy.gateChecks);
  errors.push(...legacy.noSecrets(manifest, "current release baseline"));
  for (const [label, expected] of [["historical", legacy.historicalPath], ["predecessor", legacy.predecessorPath]]) {
    const reference = manifest[label];
    if (reference?.path !== expected || !sha(reference?.sha256)
      || hash(readFileSync(insidePath(root, expected))) !== reference.sha256) errors.push(`current ${label} binding differs`);
  }
  if (JSON.stringify(epochInventory(root)) !== JSON.stringify(manifest.candidate.local_inventory)) errors.push("current on-disk migration inventory differs");
  if (hash(readFileSync(resolve(root, "src/integrations/supabase/types.ts"))) !== manifest.candidate.checked_in_types_sha256) errors.push("current checked-in types differ");
  errors.push(...legacy.referencedEvidence(manifest, root));
  if (errors.length) throw new Error(`Current migration baseline validation failed:\n- ${errors.join("\n- ")}`);
  const releaseErrors = [];
  const pending = manifest.observed_entries.filter((entry) => entry.review_status === "candidate_pending_owner_review").length;
  if (pending) releaseErrors.push(`${pending} current source entries still require owner review`);
  const blocked = manifest.blockers.filter((gate) => gate.status !== "resolved").map((gate) => gate.id);
  if (blocked.length) releaseErrors.push(`active blockers: ${blocked.join(", ")}`);
  if (manifest.candidate.status !== "accepted") releaseErrors.push("current candidate is not owner-accepted");
  if (manifest.remote.sensitive_history_disposition !== "owner_reviewed_protected_local_only") releaseErrors.push("credential-bearing historical input handling still requires owner review");
  if (!manifest.evidence?.replay_receipt) releaseErrors.push("current pinned SQL replay receipt is required");
  else {
    const ref = manifest.evidence.replay_receipt;
    const raw = readFileSync(insidePath(root, ref.path));
    const receipt = parseEvidenceJson(raw);
    if (hash(raw) !== ref.sha256 || receipt.schema !== "xot-current-release-sql-boundary-receipt-v1"
      || receipt.status !== "ACCEPTED_LOCAL_SQL_T1" || receipt.context !== E10_CONTEXT || receipt.image !== E10_EXPECTED_IMAGE
      || receipt.migrationCount !== manifest.candidate.local_inventory.length
      || receipt.inventorySha256 !== manifest.candidate.inventory_sha256 || receipt.cleanup !== "removed"
      || receipt.container !== "removed" || receipt.skillmapUnchanged !== true || receipt.xotE10Unchanged !== true
      || receipt.signal !== null || receipt.replaySchemaSha256 !== manifest.evidence.replay_schema_sha256
      || JSON.stringify(receipt.imageCommand) !== JSON.stringify(["postgres", "-D", "/etc/postgresql"])
      || receipt.egressProbe?.network !== "none" || receipt.egressProbe.nonLoopbackRoutes !== 0
      || receipt.egressProbe.reservedAddressConnectExit !== 7 || receipt.egressProbe.publishedPorts !== 0 || receipt.egressProbe.mounts !== 0
      || receipt.feedbackRegression?.status !== "passed" || receipt.feedbackRegression.feedbackRowsAfterRollback !== 0
      || receipt.typeGenerator?.image !== E7_EXPECTED_PG_META_IMAGE || receipt.typeGenerator?.cleanup !== "removed"
      || receipt.typeGenerator?.network !== "owned database no-egress namespace"
      || JSON.stringify(receipt.typeGenerator?.command) !== JSON.stringify(E7_PG_META_COMMAND)
      || receipt.generatedTypesSha256 !== manifest.evidence.replay_types_sha256) releaseErrors.push("current pinned SQL replay receipt is invalid");
    for (const path of CURRENT_RELEASE_HARNESS_PATHS) {
      if (receipt.harnessHashes?.[path] !== hash(readFileSync(insidePath(root, path)))) releaseErrors.push(`current replay harness binding differs: ${path}`);
    }
  }
  if (!remoteJsonPath) releaseErrors.push("fresh protected remote migration capture is required");
  else {
    const raw = protectedInput(root, remoteJsonPath);
    const remote = parseEvidenceJson(raw);
    if (hash(raw) !== manifest.remote.raw_sha256 || JSON.stringify(remoteInventory(remote)) !== JSON.stringify(manifest.remote.inventory)
      || remote.project_ref !== CURRENT_PROJECT || remote.export_contract !== "xot-remote-migration-snapshot-v1"
      || JSON.stringify(remote.source) !== JSON.stringify(CURRENT_CAPTURE_SOURCE) || remote.captured_at !== manifest.remote.captured_at) releaseErrors.push("current protected remote capture does not reproduce the baseline");
    const age = nowMs - Date.parse(remote.captured_at);
    if (!Number.isFinite(age) || age > 6 * 3600_000 || age < -5 * 60_000) releaseErrors.push("remote capture is outside the six-hour release window");
  }
  if (!replaySchemaPath || !productionSchemaPath) releaseErrors.push("protected replay and Production schema inputs are required");
  else {
    const replay = protectedInput(root, replaySchemaPath).toString();
    const production = protectedInput(root, productionSchemaPath).toString();
    if (hash(replay) !== manifest.evidence.replay_schema_sha256 || hash(production) !== manifest.evidence.production_schema_sha256) releaseErrors.push("current schema evidence hashes differ");
    const facts = buildSchemaPrivilegeFacts(replay, production);
    if (!facts.non_privilege_schema.expected_empty) releaseErrors.push("replayed and Production non-privilege schema differ; reviewed reconciliation is required");
    if (!manifest.evidence.privilege_diff) releaseErrors.push("current schema/privilege comparison receipt is required");
    else {
      const ref = manifest.evidence.privilege_diff;
      const raw = readFileSync(insidePath(root, ref.path));
      const comparison = parseEvidenceJson(raw);
      if (hash(raw) !== ref.sha256 || comparison.schema !== "xot-current-release-schema-comparison-v1"
        || comparison.facts_sha256 !== hash(JSON.stringify(facts))
        || JSON.stringify(comparison.source) !== JSON.stringify(facts.source)
        || JSON.stringify(comparison.non_privilege_schema) !== JSON.stringify(facts.non_privilege_schema)
        || comparison.syntactic_privilege_summary?.differing_records !== facts.privileges.differing_records) releaseErrors.push("current schema/privilege receipt does not reproduce");
    }
  }
  if (!replayTypesPath) releaseErrors.push("protected current replay-generated types are required");
  else {
    const types = protectedInput(root, replayTypesPath);
    if (hash(types) !== manifest.evidence.replay_types_sha256
      || hash(types) !== manifest.evidence.production_types_sha256) releaseErrors.push("current replay and Production generated types do not have exact byte parity");
  }
  if (!productionTypesPath || !typesReceiptPath) releaseErrors.push("fresh protected Production types and capture receipt are required");
  else {
    const types = protectedInput(root, productionTypesPath);
    const receipt = parseEvidenceJson(protectedInput(root, typesReceiptPath));
    const age = nowMs - Date.parse(receipt.captured_at);
    if (receipt.contract !== "xot-production-types-evidence-v1" || receipt.project_ref !== CURRENT_PROJECT || receipt.schema !== "public"
      || receipt.source?.command !== `supabase gen types --project-id ${CURRENT_PROJECT} --schema public --lang typescript`
      || receipt.source?.tool_version !== "2.111.0" || receipt.source?.schema_dump_sha256 !== manifest.evidence.production_schema_sha256
      || receipt.reviewed_git_sha !== manifest.candidate.reviewed_git_sha || receipt.output_sha256 !== hash(types)
      || hash(types) !== manifest.evidence.production_types_sha256 || hash(types) !== manifest.candidate.checked_in_types_sha256
      || !Number.isFinite(age) || age > 6 * 3600_000 || age < -5 * 60_000) releaseErrors.push("current Production type provenance, exact parity, reviewed SHA or freshness is unproven");
  }
  if (releaseGate) releaseErrors.push(...legacy.reviewedGit(manifest, root, new Set(), {
    manifestPath: baselinePath, privilegeDiffPath: CURRENT_RELEASE_PRIVILEGE_PATH, projection: currentReleaseImmutableProjection,
  }));
  if (releaseGate && releaseErrors.length) throw new Error(`Current migration release gate blocked:\n- ${releaseErrors.join("\n- ")}`);
  return { manifest: baselinePath, activeMigrations: manifest.candidate.local_inventory.length,
    observedSideEntries: manifest.observed_entries.length, pendingOwnerReviewEntries: pending,
    hashProvenEntries: manifest.observed_entries.filter((entry) => entry.review_status === "hash_proven").length,
    currentCandidateChecked: true, currentCandidateActiveCount: manifest.candidate.local_inventory.length,
    remoteSnapshotChecked: Boolean(remoteJsonPath), remoteSnapshotCapturedAt: manifest.remote.captured_at,
    releaseReady: releaseErrors.length === 0, releaseErrors, blockers: blocked };
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GATE_REQUIRED_CHECKS, validateMigrationBaseline, MANIFEST_PATH, SUCCESSOR_V5_CANDIDATE_RECEIPT_PATH } from "./check-migration-baseline.mjs";
import { CURRENT_RELEASE_BASELINE_PATH, currentReleaseImmutableProjection, protectedInput,
  remoteInventory, validateCurrentReleaseShape, parseEvidenceJson, buildCurrentReleaseBaseline,
  validateCurrentReleaseBaseline, CURRENT_CAPTURE_SOURCE, CURRENT_PROJECT, hash } from "./currentReleaseBaseline.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const baseline = () => JSON.parse(readFileSync(join(root, CURRENT_RELEASE_BASELINE_PATH), "utf8"));
const errors = (value) => validateCurrentReleaseShape(value, GATE_REQUIRED_CHECKS);

test("current baseline binds the real 137/117 inventory and preserves all required gates", () => {
  const value = baseline();
  assert.deepEqual(errors(value), []);
  assert.equal(value.candidate.local_inventory.length, 137);
  assert.equal(value.remote.inventory.length, 117);
  assert.deepEqual(value.blockers.map((gate) => gate.id), Object.keys(GATE_REQUIRED_CHECKS));
  assert.ok(value.blockers.every((gate) => gate.status === "blocked"));
});

test("baseline rejects altered identity, count, source bytes and capture provenance", () => {
  for (const mutate of [
    (value) => { value.project_ref = "other"; },
    (value) => { value.schema = "other"; },
    (value) => { value.candidate.local_inventory.pop(); },
    (value) => { value.candidate.local_inventory[0].sha256 = "0".repeat(64); },
    (value) => { value.remote.inventory.pop(); },
    (value) => { value.remote.inventory[1].version = value.remote.inventory[0].version; },
    (value) => { value.remote.source.capture_tool = "unverified"; },
    (value) => { value.remote.inventory[0].body_available = !value.remote.inventory[0].body_available; },
    (value) => { delete value.evidence; },
  ]) { const value = baseline(); mutate(value); assert.ok(errors(value).length); }
});

test("baseline rejects skipped, duplicated and weakened gate checks", () => {
  for (const mutate of [
    (value) => value.blockers.pop(),
    (value) => value.blockers.push(value.blockers[0]),
    (value) => value.blockers[0].required_checks.pop(),
    (value) => { value.blockers[0].status = "skipped"; },
    (value) => { value.blockers[0].status = "resolved"; value.blockers[0].receipt = { reviewer: "automation:test" }; },
  ]) { const value = baseline(); mutate(value); assert.ok(errors(value).length); }
});

test("baseline cannot turn unmatched sources into hash proof or generic approval", () => {
  for (const mutate of [
    (entry) => { entry.review_status = "hash_proven"; },
    (entry) => { entry.counterparts = ["remote:20250902052820"]; },
    (entry) => { entry.review_status = "owner_approved"; entry.review = { reviewer: "approved" }; },
  ]) { const value = baseline(); const entry = value.observed_entries.find((item) => !item.counterparts.length); mutate(entry); assert.ok(errors(value).length); }
});

test("raw history inventory emits hashes only and rejects malformed/duplicate bodies", () => {
  const raw = { rows: [{ version: "20260101000000", name: "example", statements: ["private raw body"] }] };
  const result = remoteInventory(raw);
  assert.equal(result.length, 1);
  assert.ok(!JSON.stringify(result).includes("private raw body"));
  assert.throws(() => remoteInventory({ rows: [raw.rows[0], raw.rows[0]] }), /duplicated/);
  assert.throws(() => remoteInventory({ rows: [{ ...raw.rows[0], statements: [null] }] }), /invalid/);
});

test("malformed private JSON errors never echo its contents", () => {
  assert.throws(() => parseEvidenceJson("private-sensitive-example"), (error) => {
    assert.equal(error.message, "evidence JSON is invalid; contents withheld");
    assert.ok(!error.stack.includes("private-sensitive-example"));
    return true;
  });
});

test("evidence-only review changes cannot alter immutable current source or capture facts", () => {
  const original = baseline();
  const reviewed = structuredClone(original);
  reviewed.candidate.status = "accepted";
  reviewed.candidate.reviewed_git_sha = "a".repeat(40);
  reviewed.remote.sensitive_history_disposition = "owner_reviewed_protected_local_only";
  reviewed.observed_entries[0].review_status = "owner_approved";
  reviewed.observed_entries[0].review = { reviewer: "Named owner" };
  assert.deepEqual(currentReleaseImmutableProjection(reviewed), currentReleaseImmutableProjection(original));
  reviewed.remote.inventory[0].sha256 = "0".repeat(64);
  assert.notDeepEqual(currentReleaseImmutableProjection(reviewed), currentReleaseImmutableProjection(original));
});

test("protected raw inputs require ignored 0600 files inside a 0700 local evidence directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-current-baseline-test-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    writeFileSync(join(directory, ".gitignore"), "supabase/.temp/\n");
    const evidence = join(directory, "supabase/.temp/evidence");
    mkdirSync(evidence, { recursive: true, mode: 0o700 });
    chmodSync(evidence, 0o700);
    const file = join(evidence, "raw.json");
    writeFileSync(file, "{}", { mode: 0o600 });
    assert.equal(protectedInput(directory, file).toString(), "{}");
    chmodSync(file, 0o644);
    assert.throws(() => protectedInput(directory, file), /0600/);
    chmodSync(file, 0o600);
    chmodSync(evidence, 0o755);
    assert.throws(() => protectedInput(directory, file), /0700/);
    chmodSync(evidence, 0o700);
    execFileSync("git", ["-C", directory, "add", "-f", "supabase/.temp/evidence/raw.json"]);
    assert.throws(() => protectedInput(directory, file));
    writeFileSync(join(directory, "outside.json"), "{}", { mode: 0o600 });
    symlinkSync(join(directory, "outside.json"), join(evidence, "escape.json"));
    assert.throws(() => protectedInput(directory, join(evidence, "escape.json")), /private .temp boundary/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("normal repository validation retains historical integrity; current release stays closed", () => {
  assert.equal(validateMigrationBaseline({ root }).currentCandidateChecked, true);
  assert.throws(() => validateMigrationBaseline({ root, releaseGate: true }), /Current migration release gate blocked/);
});

function withSyntheticCapture(callback) {
  mkdirSync(join(root, "supabase/.temp"), { recursive: true });
  const directory = mkdtempSync(join(root, "supabase/.temp/current-baseline-test-"));
  chmodSync(directory, 0o700);
  const capturePath = join(directory, "synthetic-capture.json");
  const manifestPath = join(directory, "manifest.json");
  const nowMs = Date.parse("2026-09-07T12:00:00Z");
  const capture = { export_contract: "xot-remote-migration-snapshot-v1", project_ref: CURRENT_PROJECT,
    captured_at: new Date(nowMs).toISOString(), source: { ...CURRENT_CAPTURE_SOURCE },
    rows: baseline().remote.inventory.map((entry) => ({ version: entry.version, name: entry.name,
      statements: [`synthetic-test-only-${entry.version}`] })) };
  writeFileSync(capturePath, JSON.stringify(capture), { mode: 0o600 });
  const manifest = buildCurrentReleaseBaseline({ root, remotePath: capturePath, historicalPath: MANIFEST_PATH,
    predecessorPath: SUCCESSOR_V5_CANDIDATE_RECEIPT_PATH, gateChecks: GATE_REQUIRED_CHECKS });
  const legacy = { gateChecks: GATE_REQUIRED_CHECKS, historicalPath: MANIFEST_PATH, predecessorPath: SUCCESSOR_V5_CANDIDATE_RECEIPT_PATH,
    noSecrets: () => [], referencedEvidence: () => [], reviewedGit: () => ["synthetic fixture has no owner-reviewed SHA"] };
  const run = () => {
    writeFileSync(capturePath, JSON.stringify(capture), { mode: 0o600 });
    manifest.remote.raw_sha256 = hash(readFileSync(capturePath));
    manifest.remote.captured_at = capture.captured_at;
    writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    try {
      validateCurrentReleaseBaseline({ root, baselinePath: manifestPath, remoteJsonPath: capturePath, nowMs, legacy });
    } catch (error) { return error.message; }
    assert.fail("synthetic, unreviewed fixture must never open release");
  };
  try { callback({ directory, manifest, capture, run, nowMs }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("current captures retain the six-hour age and five-minute future limits", () => withSyntheticCapture(({ capture, run, nowMs }) => {
  assert.ok(!run().includes("outside the six-hour"));
  capture.captured_at = new Date(nowMs - 6 * 3600_000 - 1).toISOString();
  assert.match(run(), /outside the six-hour/);
  capture.captured_at = new Date(nowMs + 5 * 60_000 + 1).toISOString();
  assert.match(run(), /outside the six-hour/);
}));

test("current gate rejects a rebound replay receipt with altered isolation or source binding", () => withSyntheticCapture(({ directory, manifest, run }) => {
  const original = JSON.parse(readFileSync(join(root, "docs/plans/2026-09-07-xot-current-release-sql-replay.json"), "utf8"));
  const path = join(directory, "receipt.json");
  for (const mutate of [
    (receipt) => { receipt.image = "unapproved-image"; },
    (receipt) => { receipt.egressProbe.network = "bridge"; },
    (receipt) => { receipt.feedbackRegression.feedbackRowsAfterRollback = 1; },
    (receipt) => { receipt.harnessHashes["scripts/run-current-release-sql-boundary.mjs"] = "0".repeat(64); },
  ]) {
    const receipt = structuredClone(original);
    mutate(receipt);
    writeFileSync(path, JSON.stringify(receipt), { mode: 0o600 });
    manifest.evidence.replay_receipt = { path, sha256: hash(readFileSync(path)) };
    manifest.evidence.replay_schema_sha256 = original.replaySchemaSha256;
    assert.match(run(), /SQL replay receipt is invalid|harness binding differs/);
  }
}));

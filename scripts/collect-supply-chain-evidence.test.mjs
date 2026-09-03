import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateEvidenceContract,
  normalizeNpmAudit,
  normalizeSpdx,
  normalizeTrivy,
  normalizeDockerInspect,
  collectDenoResolutionEvidence,
  stableErrors,
  validateOwnerDisposition,
  validateEvidenceDirectory,
  validateEvidenceArtifacts,
  decodeBase64Json,
  validateOwnerPolicy,
  acceptedOwnerDisposition,
  ingestOwnerPolicy,
  validateOnlyEvidence,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DOCKER_BUILD_TIMEOUT_MS,
  recordTimeout,
} from "./collect-supply-chain-evidence.mjs";

test("the hosted Docker build has a cold-run timeout without weakening other command timeouts", () => {
  assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 5 * 60 * 1000);
  assert.equal(DOCKER_BUILD_TIMEOUT_MS, 15 * 60 * 1000);

  const defaultErrors = [];
  recordTimeout({ timedOut: true }, "npm audit", defaultErrors);
  assert.deepEqual(defaultErrors, ["npm audit timed out after 5 minutes"]);

  const buildErrors = [];
  recordTimeout({ timedOut: true }, "renderer Docker build", buildErrors, DOCKER_BUILD_TIMEOUT_MS);
  assert.deepEqual(buildErrors, ["renderer Docker build timed out after 15 minutes"]);
});

test("npm audit normalization keeps only reviewable metadata", () => {
  const normalized = normalizeNpmAudit({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0 } },
    vulnerabilities: {
      "demo-package": {
        severity: "high",
        range: "<1.2.0",
        via: [{ source: 123, title: "Demo advisory", url: "https://example.invalid/advisory" }],
        fixAvailable: false,
      },
    },
    rawToken: "must-not-be-copied",
  }, "root");

  assert.deepEqual(normalized.vulnerabilities, { info: 0, low: 1, moderate: 0, high: 2, critical: 0 });
  assert.equal(normalized.findings[0].package, "demo-package");
  assert.match(normalized.findings[0].id, /^npm:root:demo-package:[a-f0-9]{24}$/);
  assert.deepEqual(normalized.findingSummary, { total: 1, actionable: 0, nonfixable: 1, ids: [normalized.findings[0].id] });
  assert.deepEqual(normalized.findings[0].advisory, ["Demo advisory"]);
  assert.equal("rawToken" in normalized, false);
  assert.equal("url" in normalized.findings[0], false);
});

test("SPDX normalization rejects malformed or non-SPDX output", () => {
  assert.throws(() => normalizeSpdx({ name: "not-an-spdx" }, "root"), /SPDX-2\.3/);
  assert.throws(() => normalizeSpdx({ spdxVersion: "SPDX-2.3", packages: [] }, "root"), /non-empty/);
});

test("scanner normalization rejects missing or empty Trivy results", () => {
  assert.throws(() => normalizeTrivy({}, { status: 0 }), /Results/);
  assert.throws(() => normalizeTrivy({ Results: [] }, { status: 0 }), /non-empty/);
});

test("Trivy normalization retains H/C findings and classifies only fixed versions as actionable", () => {
  const normalized = normalizeTrivy({ Results: [{ Target: "debian", Vulnerabilities: [
    { PkgName: "openssl", InstalledVersion: "1.0", FixedVersion: "1.1", Severity: "HIGH", VulnerabilityID: "CVE-1" },
    { PkgName: "zlib", InstalledVersion: "1.0", FixedVersion: "", Severity: "CRITICAL", VulnerabilityID: "CVE-2" },
  ] }] });
  assert.equal(normalized.findings.length, 2);
  assert.equal(normalized.findingSummary.total, 2);
  assert.equal(normalized.findingSummary.actionable, 1);
  assert.equal(normalized.findingSummary.nonfixable, 1);
  assert.deepEqual(normalized.findingSummary.ids, normalized.findings.map((finding) => finding.id).sort());
  assert.ok(normalized.findings.every((finding) => /^trivy:[a-f0-9]{24}$/.test(finding.id)));
});

test("scanner normalization fails closed on command errors", () => {
  assert.throws(() => normalizeSpdx({ spdxVersion: "SPDX-2.3", packages: [{ name: "pkg", versionInfo: "1.0.0" }] }, "root", { status: 1 }), /command failed/);
  assert.throws(() => normalizeTrivy({ Results: [{ Target: "os", Vulnerabilities: [] }] }, { status: 1 }), /command failed/);
  assert.throws(() => normalizeNpmAudit({}, "root", { timedOut: true }), /timed out/);
});

test("Deno evidence performs frozen non-executing resolution over every function entrypoint", () => {
  const evidence = collectDenoResolutionEvidence(process.cwd(), "a".repeat(40));
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.scanMode, "non-executing-frozen-lock-resolution");
  assert.equal(evidence.resolutionMethod, "deno-check-frozen");
  assert.equal(evidence.runtimeExecution, "not_run_by_policy");
  assert.equal(evidence.commandStatus, 0);
  assert.equal(evidence.versionCommandStatus, 0);
  assert.ok(evidence.entrypointCount > 0);
  assert.equal("entrypoints" in evidence, false);
  assert.equal("deno" in evidence, false);
  assert.equal("stdout" in evidence, false);
  assert.equal("stderr" in evidence, false);
});

test("validation errors are deduplicated and ordered deterministically", () => {
  assert.deepEqual(stableErrors(["z", "a", "z", "b"]), ["a", "b", "z"]);
});

test("npm audit normalization rejects malformed vulnerability counts and shapes", () => {
  assert.throws(() => normalizeNpmAudit({ metadata: { vulnerabilities: { high: "not-a-count" } } }, "root"), /counts are malformed/);
  assert.throws(() => normalizeNpmAudit({ metadata: { vulnerabilities: {} }, vulnerabilities: [] }, "root"), /vulnerabilities must be a plain object/);
  assert.throws(() => normalizeNpmAudit({ metadata: { vulnerabilities: { high: 1 } }, vulnerabilities: {} }, "root", { status: 1 }), /findings are missing/);
});

test("Docker inspect normalization fails closed on empty or non-object output", () => {
  assert.throws(() => normalizeDockerInspect([], { status: 0 }), /non-empty object/);
  assert.throws(() => normalizeDockerInspect({}, { status: 0 }), /non-empty object/);
  assert.throws(() => normalizeDockerInspect(null, { status: 0 }), /non-empty object/);
});

test("evidence contract rejects stale checkout and unpinned actions", () => {
  const errors = evaluateEvidenceContract({
    reviewedSha: "a".repeat(40),
    checkoutSha: "b".repeat(40),
    actionRefs: ["actions/checkout@v4", "unreviewed/action@v4", "actions/upload-artifact@" + "c".repeat(40)],
    scannerStatus: "passed",
    highOrCritical: 0,
  });

  assert.ok(errors.some((error) => error.includes("exact reviewed SHA")));
  assert.ok(errors.some((error) => error.includes("SHA-pinned action")));
});

test("evidence contract rejects pinned actions outside the official actions namespace", () => {
  const errors = evaluateEvidenceContract({
    reviewedSha: "a".repeat(40),
    checkoutSha: "a".repeat(40),
    actionRefs: [{ action: "untrusted/upload-artifact", shaPinned: true }],
    scannerStatus: "passed",
    highOrCritical: 0,
  });

  assert.ok(errors.some((error) => error.includes("official actions/*")));
});

test("evidence contract rejects actionable findings without an owner disposition", () => {
  const errors = evaluateEvidenceContract({
    reviewedSha: "a".repeat(40),
    checkoutSha: "a".repeat(40),
    actionRefs: ["actions/upload-artifact@" + "c".repeat(40)],
    scannerStatus: "passed",
    highOrCritical: 1,
    ownerDisposition: "pending",
  });

  assert.ok(errors.some((error) => error.includes("owner disposition")));
});

test("evidence artifact validation rejects missing or empty output", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-evidence-"));
  try {
    const errors = validateEvidenceArtifacts(directory);
    assert.ok(errors.some((error) => error.includes("missing: root-npm-audit.json")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validate-only does not trust a replaced validation record", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-validation-"));
  try {
    writeFileSync(join(directory, "validation.json"), JSON.stringify({
      schema: "xot-hosted-supply-validation-v1",
      reviewedSha: "a".repeat(40),
      checkoutSha: "a".repeat(40),
      status: "passed_pending_owner_review",
      errors: [],
    }));
    const errors = validateEvidenceDirectory(directory, "a".repeat(40), "a".repeat(40));
    assert.ok(errors.some((error) => error.includes("missing: root-npm-audit.json")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validate-only rejects a missing or stale reviewed-SHA environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-env-"));
  try {
    writeFileSync(join(directory, "root-npm-audit.json"), JSON.stringify({ schema: "xot-hosted-npm-audit-v1", reviewedSha: "a".repeat(40) }));
    assert.ok(validateEvidenceDirectory(directory, null, "a".repeat(40)).some((error) => error.includes("not bound to the expected reviewed SHA")));
    assert.ok(validateEvidenceDirectory(directory, "b".repeat(40), "a".repeat(40)).some((error) => error.includes("not bound to the expected reviewed SHA")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validate-only rejects Git-SHA-sized artifact digests", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-manifest-"));
  try {
    writeFileSync(join(directory, "artifact-manifest.json"), JSON.stringify({
      schema: "xot-hosted-supply-artifact-manifest-v1",
      reviewedSha: "a".repeat(40),
      checkoutSha: "a".repeat(40),
      artifacts: [{ path: "root-npm-audit.json", sha256: "a".repeat(40) }],
    }));
    const errors = validateEvidenceDirectory(directory, "a".repeat(40), "a".repeat(40));
    assert.ok(errors.some((error) => error.includes("invalid digest")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owner acceptance requires dated no-waiver or per-finding dispositions", () => {
  const pending = { status: "awaiting_owner_review", decision: "not_accepted", highOrCritical: 0 };
  assert.deepEqual(validateOwnerDisposition(pending), []);
  assert.ok(validateOwnerDisposition({ status: "reviewed", decision: "accepted", highOrCritical: 0 }).some((error) => error.includes("no-waiver")));
  assert.ok(validateOwnerDisposition({
    status: "reviewed",
    decision: "accepted",
    highOrCritical: 1,
    actionableIds: ["test-id"],
    findings: [{ id: "test-id", owner: "security", expiresAt: null }],
    signedAt: "2026-09-02T00:00:00Z",
  }).some((error) => error.includes("expiry")));
  const acceptedClean = {
    status: "reviewed",
    decision: "accepted",
    owner: "release-security",
    reviewedSha: "a".repeat(40),
    signedAt: "2026-09-02T00:00:00Z",
    highOrCritical: 0,
    actionableIds: [],
    noWaiverReceipt: { decision: "no_waivers", owner: "release-security", reviewedSha: "a".repeat(40), baseImageClassification: "reviewed-non-actionable", signedAt: "2026-09-02T00:00:00Z" },
  };
  assert.deepEqual(validateOwnerDisposition(acceptedClean, Date.parse("2026-09-02T01:00:00Z")), []);
  assert.ok(validateOwnerDisposition({ ...acceptedClean, noWaiverReceipt: { ...acceptedClean.noWaiverReceipt, signedAt: "2026-09-03T00:00:00Z" } }, Date.parse("2026-09-02T01:00:00Z")).some((error) => error.includes("no-waiver")));
});

function ownerPolicy(overrides = {}) {
  return {
    schema: "xot-hosted-supply-owner-policy-v1",
    reviewedSha: "a".repeat(40),
    owner: "release-security",
    signedAt: "2026-09-02T00:00:00Z",
    expiresAt: "2026-10-02T00:00:00Z",
    decision: "accept_zero_actionable_no_waivers",
    actionableHighOrCritical: 0,
    observedHighOrCritical: 0,
    nonfixableHighOrCritical: 0,
    actionableIds: [],
    observedIds: [],
    nonfixableIds: [],
    baseImageClassification: "reviewed-non-actionable",
    waiverEntries: [],
    ...overrides,
  };
}

const ownerPolicyContext = {
  reviewedSha: "a".repeat(40),
  checkoutSha: "a".repeat(40),
  actionableHighOrCritical: 0,
  observedHighOrCritical: 0,
  nonfixableHighOrCritical: 0,
  actionableIds: [],
  observedIds: [],
  nonfixableIds: [],
  now: Date.parse("2026-09-02T01:00:00Z"),
};

test("exact-head owner policy accepts the current zero-actionable scan and maps to a disposition", () => {
  const policy = ownerPolicy();
  const encoded = Buffer.from(JSON.stringify(policy)).toString("base64");
  assert.deepEqual(decodeBase64Json(encoded), policy);
  assert.deepEqual(validateOwnerPolicy(policy, ownerPolicyContext), []);
  const disposition = acceptedOwnerDisposition(policy, { rendererImageId: "sha256:fixture" });
  assert.equal(disposition.status, "reviewed");
  assert.equal(disposition.decision, "accepted");
  assert.equal(disposition.reviewedSha, ownerPolicyContext.reviewedSha);
  assert.equal(disposition.noWaiverReceipt.decision, "no_waivers");
  assert.equal(disposition.noWaiverReceipt.baseImageClassification, policy.baseImageClassification);
  assert.deepEqual(disposition.waiverEntries, []);
});

test("exact-head owner policy fails closed for missing or tampered base64", () => {
  assert.throws(() => decodeBase64Json(""), /missing/);
  assert.throws(() => decodeBase64Json("not-base64"), /base64 is malformed/);
  const encoded = Buffer.from(JSON.stringify(ownerPolicy())).toString("base64");
  assert.throws(() => decodeBase64Json(`${encoded.slice(0, -1)}A`), /JSON is malformed|base64 is malformed/);
});

test("exact-head owner policy rejects wrong SHA, signature dates, counts, IDs, actionable findings, and waivers", () => {
  const cases = [
    ["SHA", { reviewedSha: "b".repeat(40) }, /exact reviewed SHA/],
    ["future signature", { signedAt: "2026-09-03T00:00:00Z" }, /dated signature/],
    ["expired policy", { expiresAt: "2026-09-02T00:30:00Z" }, /future expiry/],
    ["observed count", { observedHighOrCritical: 1 }, /observed high or critical/],
    ["nonfixable count", { nonfixableHighOrCritical: 1 }, /nonfixable count/],
    ["actionable IDs", { actionableIds: ["unexpected"] }, /actionable IDs/],
    ["observed IDs", { observedIds: ["unexpected"] }, /observed finding IDs/],
    ["nonfixable IDs", { nonfixableIds: ["unexpected"] }, /nonfixable finding IDs/],
    ["actionable finding", { actionableHighOrCritical: 1 }, /zero current actionable/],
    ["waiver decision", { decision: "accepted" }, /decision must/],
    ["base image classification", { baseImageClassification: "unknown" }, /base-image classification/],
    ["waiver entry", { waiverEntries: [{ id: "W-1" }] }, /no waiver entries/],
  ];
  for (const [, overrides, expected] of cases) {
    assert.ok(validateOwnerPolicy(ownerPolicy(overrides), ownerPolicyContext).some((error) => expected.test(error)));
  }
  assert.ok(validateOwnerPolicy(ownerPolicy(), { ...ownerPolicyContext, actionableHighOrCritical: 1 }).some((error) => error.includes("current actionable")));
});

test("exact-head owner policy rejects unknown fields and technical-only evidence remains independently represented", () => {
  const errors = validateOwnerPolicy(ownerPolicy({ unexpected: true }), ownerPolicyContext);
  assert.ok(errors.some((error) => error.includes("unexpected fields")));
  const pending = { status: "awaiting_owner_review", decision: "not_accepted", highOrCritical: 0 };
  assert.deepEqual(validateOwnerDisposition(pending), []);
});

const COMPLETE_EVIDENCE_ARTIFACTS = [
  "root-npm-audit.json", "renderer-npm-audit.json", "root-dev-npm-audit.json", "renderer-dev-npm-audit.json",
  "root-sbom.spdx.json", "renderer-sbom.spdx.json", "license-inventory.json", "deno-import-evidence.json",
  "renderer-image-provenance.json", "renderer-image-trivy.json", "renderer-image-sbom.spdx.json",
  "provenance.json", "owner-disposition.json",
];

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeCompleteEvidenceFixture(directory, reviewedSha) {
  const audit = (surface) => ({
    schema: "xot-hosted-npm-audit-v1", surface, reviewedSha, status: "passed", commandStatus: 0,
    timedOut: false, reportVersion: 2, vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    findings: [], findingSummary: { total: 0, actionable: 0, nonfixable: 0, ids: [] },
  });
  for (const surface of ["root", "renderer", "root-dev", "renderer-dev"]) writeJsonFixture(directory, `${surface}-npm-audit.json`, audit(surface));
  const sbom = (surface) => ({
    schema: "xot-hosted-spdx-sbom-v1", status: "passed", surface, reviewedSha, commandStatus: 0,
    timedOut: false, spdxVersion: "SPDX-2.3", name: surface, creationInfo: { created: null, creators: [] },
    packageCount: 1, packages: [{ name: "fixture", version: "1.0.0", licenseDeclared: "MIT", licenseConcluded: "MIT" }],
  });
  for (const surface of ["root", "renderer"]) writeJsonFixture(directory, `${surface}-sbom.spdx.json`, sbom(surface));
  writeJsonFixture(directory, "renderer-image-sbom.spdx.json", sbom("renderer-image"));
  writeJsonFixture(directory, "license-inventory.json", {
    schema: "xot-hosted-license-inventory-v1", reviewedSha,
    surfaces: { root: { packageCount: 1, licenses: ["MIT"] }, renderer: { packageCount: 1, licenses: ["MIT"] } },
  });
  const functionCount = readdirSync(join(process.cwd(), "supabase/functions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && statSync(join(process.cwd(), "supabase/functions", entry.name, "index.ts"), { throwIfNoEntry: false })?.isFile()).length;
  writeJsonFixture(directory, "deno-import-evidence.json", {
    schema: "xot-hosted-deno-import-v1", reviewedSha, status: "passed", reason: "fixture",
    scanMode: "non-executing-frozen-lock-resolution", resolutionMethod: "deno-check-frozen",
    runtimeExecution: "not_run_by_policy", denoVersion: "2.0.0", versionCommandStatus: 0,
    versionTimedOut: false, commandStatus: 0, timedOut: false, timeoutMs: 5 * 60 * 1000,
    lockSha256: fileSha256(join(process.cwd(), "deno.lock")), entrypointCount: functionCount,
  });
  writeJsonFixture(directory, "renderer-image-provenance.json", {
    schema: "xot-hosted-renderer-image-v1", reviewedSha, image: "fixture", dockerVersion: "fixture",
    buildStatus: 0, buildTimedOut: false, inspectStatus: 0, inspectTimedOut: false,
    imageId: "sha256:fixture", architecture: "amd64", os: "linux", rootfsLayers: 1, dockerfileSha256: "fixture",
  });
  writeJsonFixture(directory, "renderer-image-trivy.json", {
    schema: "xot-hosted-trivy-v1", status: "passed", reviewedSha, commandStatus: 0, timedOut: false,
    resultCount: 1, findings: [], findingSummary: { total: 0, actionable: 0, nonfixable: 0, ids: [] }, severityCounts: {},
  });
  writeJsonFixture(directory, "provenance.json", {
    schema: "xot-hosted-supply-provenance-v1", reviewedSha, checkoutSha: reviewedSha,
    actionRefs: [{ action: "actions/checkout", version: "1".repeat(40), shaPinned: true }],
  });
  writeJsonFixture(directory, "owner-disposition.json", {
    schema: "xot-hosted-supply-owner-disposition-v1", reviewedSha, status: "awaiting_owner_review",
    decision: "not_accepted", highOrCritical: 0, observedHighOrCritical: 0, nonfixableHighOrCritical: 0,
    actionableIds: [], observedIds: [], nonfixableIds: [], rendererImageId: "sha256:fixture",
    requiredOwner: "security/release owner", noWaiverReceipt: null, waiverEntries: [],
  });
  const manifest = {
    schema: "xot-hosted-supply-artifact-manifest-v1", reviewedSha, checkoutSha: reviewedSha,
    artifacts: COMPLETE_EVIDENCE_ARTIFACTS.map((path) => ({ path, sha256: fileSha256(join(directory, path)) })),
  };
  writeJsonFixture(directory, "artifact-manifest.json", manifest);
  writeJsonFixture(directory, "validation.json", {
    schema: "xot-hosted-supply-validation-v1", reviewedSha, checkoutSha: reviewedSha,
    status: "passed_pending_owner_review", errors: [],
  });
}

function writeJsonFixture(directory, name, value) {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

test("ingestOwnerPolicy accepts a complete fixture, rewrites disposition, and refreshes manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-ingest-"));
  try {
    const reviewedSha = "a".repeat(40);
    writeCompleteEvidenceFixture(directory, reviewedSha);
    const before = JSON.parse(readFileSync(join(directory, "artifact-manifest.json"), "utf8"));
    const policy = ownerPolicy({ reviewedSha });
    const encoded = Buffer.from(JSON.stringify(policy)).toString("base64");
    assert.deepEqual(validateOnlyEvidence(directory, { reviewedSha, checkoutSha: reviewedSha, technicalOnly: true, policyMode: "exact-head", encodedPolicy: "tampered" }).errors, []);
    assert.deepEqual(ingestOwnerPolicy(directory, encoded, { reviewedSha, checkoutSha: reviewedSha, now: ownerPolicyContext.now }), policy);
    const afterIngest = JSON.parse(readFileSync(join(directory, "artifact-manifest.json"), "utf8"));
    assert.notDeepEqual(afterIngest, before);
    const owner = JSON.parse(readFileSync(join(directory, "owner-disposition.json"), "utf8"));
    const after = JSON.parse(readFileSync(join(directory, "artifact-manifest.json"), "utf8"));
    assert.equal(owner.status, "reviewed");
    assert.equal(owner.decision, "accepted");
    assert.equal(owner.noWaiverReceipt.baseImageClassification, policy.baseImageClassification);
    assert.equal(JSON.parse(readFileSync(join(directory, "validation.json"), "utf8")).status, "passed_owner_accepted");
    assert.notDeepEqual(after, before);
    assert.equal(after.artifacts.find((entry) => entry.path === "owner-disposition.json").sha256, fileSha256(join(directory, "owner-disposition.json")));
    assert.deepEqual(validateEvidenceDirectory(directory, reviewedSha, reviewedSha, { requireOwner: true }), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validate-only keeps technical mode independent and blocks missing policy mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-policy-mode-"));
  try {
    const reviewedSha = "a".repeat(40);
    writeCompleteEvidenceFixture(directory, reviewedSha);
    const pending = validateOnlyEvidence(directory, { reviewedSha, checkoutSha: reviewedSha, technicalOnly: true, policyMode: "exact-head", encodedPolicy: "not-base64" });
    assert.deepEqual(pending.errors, []);
    assert.equal(JSON.parse(readFileSync(join(directory, "owner-disposition.json"), "utf8")).status, "awaiting_owner_review");
    const blocked = validateOnlyEvidence(directory, { reviewedSha, checkoutSha: reviewedSha, policyMode: null, encodedPolicy: null });
    assert.ok(blocked.errors.some((error) => error.includes("policy is missing")));
    const policy = Buffer.from(JSON.stringify(ownerPolicy({ reviewedSha }))).toString("base64");
    const accepted = validateOnlyEvidence(directory, { reviewedSha, checkoutSha: reviewedSha, policyMode: "exact-head", encodedPolicy: policy, now: ownerPolicyContext.now });
    assert.deepEqual(accepted.errors, []);
    assert.equal(JSON.parse(readFileSync(join(directory, "validation.json"), "utf8")).status, "passed_owner_accepted");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validate-only rejects tampered evidence before policy ingestion", () => {
  const directory = mkdtempSync(join(tmpdir(), "xot-supply-tamper-"));
  try {
    const reviewedSha = "a".repeat(40);
    writeCompleteEvidenceFixture(directory, reviewedSha);
    writeJsonFixture(directory, "root-npm-audit.json", { schema: "xot-hosted-npm-audit-v1", reviewedSha, status: "passed" });
    const policy = Buffer.from(JSON.stringify(ownerPolicy({ reviewedSha }))).toString("base64");
    const result = validateOnlyEvidence(directory, { reviewedSha, checkoutSha: reviewedSha, policyMode: "exact-head", encodedPolicy: policy, now: ownerPolicyContext.now });
    assert.ok(result.errors.some((error) => error.includes("digest mismatch")));
    assert.equal(JSON.parse(readFileSync(join(directory, "owner-disposition.json"), "utf8")).status, "awaiting_owner_review");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

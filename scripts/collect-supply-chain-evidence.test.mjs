import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
} from "./collect-supply-chain-evidence.mjs";

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

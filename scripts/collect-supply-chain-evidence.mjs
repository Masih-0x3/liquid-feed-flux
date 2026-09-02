#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TRIVY_IMAGE = "aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
const SYFT_IMAGE = "anchore/syft@sha256:95fe0835e5bebc6f8b1f8acef68d47d63d594ef4c0f25c097ff853b23cbac74c";
const SHA_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const BASE_EVIDENCE_ARTIFACTS = Object.freeze([
  "root-npm-audit.json",
  "renderer-npm-audit.json",
  "root-dev-npm-audit.json",
  "renderer-dev-npm-audit.json",
  "root-sbom.spdx.json",
  "renderer-sbom.spdx.json",
  "license-inventory.json",
  "deno-import-evidence.json",
  "renderer-image-provenance.json",
  "renderer-image-trivy.json",
  "renderer-image-sbom.spdx.json",
  "provenance.json",
  "owner-disposition.json",
]);
const EXPECTED_ARTIFACTS = Object.freeze([...BASE_EVIDENCE_ARTIFACTS, "artifact-manifest.json", "validation.json"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function parseJson(value, label) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error(`${label} output is malformed JSON`);
  }
}

function normalizeNpmAudit(value, surface, { status = 0, timedOut = false, reviewedSha = null } = {}) {
  if (timedOut) throw new Error(`${surface} npm audit timed out`);
  const report = parseJson(value, `${surface} npm audit`);
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!isPlainObject(report?.metadata) || !isPlainObject(vulnerabilities)) throw new Error(`${surface} npm audit metadata vulnerabilities must be a plain object`);
  const counts = Object.fromEntries(["info", "low", "moderate", "high", "critical"].map((key) => [key, Number(vulnerabilities[key] ?? 0)]));
  if (Object.values(counts).some((count) => !Number.isInteger(count) || count < 0)) throw new Error(`${surface} npm audit vulnerability counts are malformed`);
  const findingCount = Object.values(counts).reduce((total, count) => total + count, 0);
  if (!isPlainObject(report.vulnerabilities)) throw new Error(`${surface} npm audit vulnerabilities must be a plain object`);
  if (findingCount > 0 && Object.keys(report.vulnerabilities).length === 0) throw new Error(`${surface} npm audit findings are missing despite nonzero vulnerability counts`);
  if (status !== 0 && findingCount === 0) throw new Error(`${surface} npm audit command failed with status ${status}`);
  const findings = Object.entries(report.vulnerabilities).map(([pkg, detail]) => ({
    package: pkg,
    severity: detail?.severity ?? "unknown",
    range: detail?.range ?? null,
    advisory: (detail?.via ?? []).map((entry) => typeof entry === "object" ? entry.title : entry).filter(Boolean).slice(0, 5),
    fixAvailable: detail?.fixAvailable ?? null,
  })).sort((a, b) => a.package.localeCompare(b.package));
  return {
    schema: "xot-hosted-npm-audit-v1",
    surface,
    reviewedSha,
    status: status === 0 ? "passed" : "passed_with_findings",
    commandStatus: status,
    timedOut,
    reportVersion: report.auditReportVersion ?? null,
    vulnerabilities: counts,
    findings,
  };
}

function normalizeSpdx(value, surface, { status = 0, timedOut = false, reviewedSha = null } = {}) {
  if (timedOut) throw new Error(`${surface} SPDX SBOM timed out`);
  if (status !== 0) throw new Error(`${surface} SPDX SBOM command failed with status ${status}`);
  const report = parseJson(value, `${surface} SPDX SBOM`);
  if (report?.spdxVersion !== "SPDX-2.3" || !Array.isArray(report.packages) || report.packages.length === 0) {
    throw new Error(`${surface} SPDX SBOM must be SPDX-2.3 with non-empty packages`);
  }
  return {
    schema: "xot-hosted-spdx-sbom-v1",
    status: "passed",
    surface,
    reviewedSha,
    commandStatus: status,
    timedOut,
    spdxVersion: report.spdxVersion,
    name: report.name ?? null,
    creationInfo: {
      created: report.creationInfo?.created ?? null,
      creators: report.creationInfo?.creators ?? [],
    },
    packageCount: report.packages.length,
    packages: report.packages.map((pkg) => ({
      name: pkg.name ?? null,
      version: pkg.versionInfo ?? null,
      licenseDeclared: pkg.licenseDeclared ?? "NOASSERTION",
      licenseConcluded: pkg.licenseConcluded ?? "NOASSERTION",
    })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
  };
}

function normalizeTrivy(value, { status = 0, timedOut = false, reviewedSha = null } = {}) {
  if (timedOut) throw new Error("Trivy image scan timed out");
  if (status !== 0) throw new Error(`Trivy image scan command failed with status ${status}`);
  const report = parseJson(value, "Trivy");
  if (!Array.isArray(report.Results) || report.Results.length === 0) throw new Error("Trivy output must contain non-empty Results");
  const findings = (report.Results ?? []).flatMap((result) => (result.Vulnerabilities ?? []).map((vulnerability) => ({
    target: result.Target ?? null,
    package: vulnerability.PkgName ?? null,
    installedVersion: vulnerability.InstalledVersion ?? null,
    fixedVersion: vulnerability.FixedVersion ?? null,
    severity: vulnerability.Severity ?? "UNKNOWN",
    id: vulnerability.VulnerabilityID ?? null,
    title: vulnerability.Title ?? null,
  }))).sort((a, b) => `${a.severity}:${a.package}:${a.id}`.localeCompare(`${b.severity}:${b.package}:${b.id}`));
  return {
    schema: "xot-hosted-trivy-v1",
    status: "passed",
    reviewedSha,
    commandStatus: status,
    timedOut,
    resultCount: report.Results.length,
    artifactName: report.ArtifactName ?? null,
    artifactType: report.ArtifactType ?? null,
    findings,
    severityCounts: findings.reduce((counts, finding) => ({ ...counts, [finding.severity]: (counts[finding.severity] ?? 0) + 1 }), {}),
  };
}

function actionRefsFromWorkflow(source) {
  return [...source.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)].map((match) => {
    const ref = match[1];
    const at = ref.lastIndexOf("@");
    const version = at > 0 ? ref.slice(at + 1) : null;
    return { action: at > 0 ? ref.slice(0, at) : ref, version, shaPinned: SHA_RE.test(version ?? "") };
  });
}

function evaluateEvidenceContract({ reviewedSha, checkoutSha, actionRefs, scannerStatus, highOrCritical, ownerDisposition = "pending" }) {
  const errors = [];
  if (!SHA_RE.test(reviewedSha ?? "") || checkoutSha !== reviewedSha) errors.push("evidence is not bound to the exact reviewed SHA");
  if (!Array.isArray(actionRefs) || actionRefs.length === 0 || actionRefs.some((entry) => !entry.action?.startsWith("actions/") || !entry.shaPinned)) errors.push("every hosted workflow action must be an official actions/* SHA-pinned action");
  if (scannerStatus !== "passed") errors.push("hosted scanner execution did not pass");
  if (Number(highOrCritical ?? 0) > 0 && ownerDisposition !== "accepted") errors.push("actionable high or critical findings require an owner disposition");
  return errors;
}

function validateOwnerDisposition(value, now = Date.now()) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["owner disposition must be an object"];
  if (value.status === "awaiting_owner_review" && value.decision === "not_accepted") return errors;
  if (value.status !== "reviewed" || value.decision !== "accepted") return ["owner disposition must be pending or reviewed accepted"];
  if (typeof value.owner !== "string" || value.owner.trim().length === 0) errors.push("accepted owner disposition requires an owner");
  const signedAt = Date.parse(value.signedAt ?? "");
  if (!Number.isFinite(signedAt) || signedAt > now + 5 * 60 * 1000) errors.push("accepted owner disposition requires a dated signature");
  const actionableCount = Number(value.highOrCritical ?? 0);
  if (!Number.isInteger(actionableCount) || actionableCount < 0) errors.push("owner disposition actionable count must be a non-negative integer");
  if (actionableCount === 0) {
    if (value.findings !== undefined && (!Array.isArray(value.findings) || value.findings.length !== 0)) errors.push("zero-actionable owner disposition must contain no findings");
    const receipt = value.noWaiverReceipt;
    const receiptDate = Date.parse(receipt?.signedAt ?? "");
    if (!receipt || receipt.decision !== "no_waivers" || typeof receipt.owner !== "string" || receipt.owner.trim().length === 0 || !Number.isFinite(receiptDate) || receiptDate > now + 5 * 60 * 1000) errors.push("accepted clean scan requires a dated no-waiver receipt");
  } else {
    if (!Array.isArray(value.findings) || value.findings.length !== actionableCount) errors.push("accepted findings must match the exact actionable finding count");
    const findingIds = new Set();
    for (const finding of value.findings ?? []) {
      if (!isPlainObject(finding) || typeof finding.id !== "string" || finding.id.trim().length === 0 || findingIds.has(finding.id)) errors.push("each actionable finding requires a unique ID");
      else findingIds.add(finding.id);
      if (!isPlainObject(finding) || !["high", "critical", "HIGH", "CRITICAL"].includes(finding.severity) || finding.decision !== "accepted" || typeof finding.owner !== "string" || finding.owner.trim().length === 0) errors.push("each finding requires an accepted owner disposition");
      const expiry = Date.parse(finding.expiresAt ?? "");
      if (!Number.isFinite(expiry) || expiry <= now) errors.push("each finding requires a future expiry");
    }
  }
  return errors;
}

function normalizeDockerInspect(value, { status = 0, timedOut = false } = {}) {
  if (timedOut) throw new Error("renderer Docker image inspect timed out");
  if (status !== 0) throw new Error(`renderer Docker image inspect command failed with status ${status}`);
  const report = parseJson(value, "Docker image inspect");
  if (!isPlainObject(report) || typeof report.Id !== "string" || report.Id.length === 0) throw new Error("Docker image inspect output must contain a non-empty object");
  return report;
}

function run(command, args, cwd = REPO_ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  return {
    status: result.status ?? (result.error ? 124 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function recordTimeout(result, label, errors) {
  if (result.timedOut) errors.push(`${label} timed out after 5 minutes`);
}

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function validateEvidenceArtifacts(directory, includeFinal = true) {
  const expected = includeFinal ? EXPECTED_ARTIFACTS : [...BASE_EVIDENCE_ARTIFACTS, "artifact-manifest.json"];
  const errors = [];
  for (const artifact of expected) {
    try {
      if (statSync(join(directory, artifact)).size === 0) errors.push(`hosted evidence artifact is empty: ${artifact}`);
    } catch {
      errors.push(`hosted evidence artifact is missing: ${artifact}`);
    }
  }
  return errors;
}

function writeArtifactManifest(directory, reviewedSha, checkoutSha) {
  const artifacts = BASE_EVIDENCE_ARTIFACTS.map((path) => ({ path, sha256: sha256(readFileSync(join(directory, path))) }));
  writeJson(directory, "artifact-manifest.json", {
    schema: "xot-hosted-supply-artifact-manifest-v1",
    reviewedSha,
    checkoutSha,
    artifacts,
  });
}

function readArtifact(directory, path, schema, errors) {
  try {
    const value = JSON.parse(readFileSync(join(directory, path), "utf8"));
    if (value?.schema !== schema) errors.push(`${path} schema is invalid`);
    return value;
  } catch {
    errors.push(`${path} is malformed JSON`);
    return null;
  }
}

function validateEvidenceDirectory(directory, reviewedSha, checkoutSha) {
  const errors = validateEvidenceArtifacts(directory);
  const artifacts = {};
  const schemas = {
    "root-npm-audit.json": "xot-hosted-npm-audit-v1",
    "renderer-npm-audit.json": "xot-hosted-npm-audit-v1",
    "root-dev-npm-audit.json": "xot-hosted-npm-audit-v1",
    "renderer-dev-npm-audit.json": "xot-hosted-npm-audit-v1",
    "root-sbom.spdx.json": "xot-hosted-spdx-sbom-v1",
    "renderer-sbom.spdx.json": "xot-hosted-spdx-sbom-v1",
    "license-inventory.json": "xot-hosted-license-inventory-v1",
    "deno-import-evidence.json": "xot-hosted-deno-import-v1",
    "renderer-image-provenance.json": "xot-hosted-renderer-image-v1",
    "renderer-image-trivy.json": "xot-hosted-trivy-v1",
    "renderer-image-sbom.spdx.json": "xot-hosted-spdx-sbom-v1",
    "provenance.json": "xot-hosted-supply-provenance-v1",
    "owner-disposition.json": "xot-hosted-supply-owner-disposition-v1",
  };
  for (const [path, schema] of Object.entries(schemas)) {
    artifacts[path] = readArtifact(directory, path, schema, errors);
    if (artifacts[path] && "reviewedSha" in artifacts[path] && artifacts[path].reviewedSha !== reviewedSha) errors.push(`${path} is not bound to the expected reviewed SHA`);
  }
  const rootAudit = artifacts["root-npm-audit.json"];
  const rendererAudit = artifacts["renderer-npm-audit.json"];
  for (const [label, audit] of [["root", rootAudit], ["renderer", rendererAudit], ["root-dev", artifacts["root-dev-npm-audit.json"]], ["renderer-dev", artifacts["renderer-dev-npm-audit.json"]]]) {
    if (audit && (!["passed", "passed_with_findings"].includes(audit.status) || ![0, 1].includes(audit.commandStatus) || audit.timedOut || !isPlainObject(audit.vulnerabilities) || !Array.isArray(audit.findings))) errors.push(`${label} npm audit evidence is invalid`);
  }
  for (const path of ["root-sbom.spdx.json", "renderer-sbom.spdx.json", "renderer-image-sbom.spdx.json"]) {
    if (artifacts[path] && (artifacts[path].status !== "passed" || !Number.isInteger(artifacts[path].packageCount) || artifacts[path].packageCount <= 0 || !Array.isArray(artifacts[path].packages) || artifacts[path].packages.length === 0)) errors.push(`${path} must contain a non-empty package inventory`);
  }
  const licenseInventory = artifacts["license-inventory.json"];
  if (licenseInventory && (typeof licenseInventory.surfaces !== "object" || ["root", "renderer"].some((surface) => !Number.isInteger(licenseInventory.surfaces?.[surface]?.packageCount) || licenseInventory.surfaces[surface].packageCount <= 0 || !Array.isArray(licenseInventory.surfaces[surface].licenses)))) errors.push("license inventory must contain both non-empty audited surfaces");
  const trivy = artifacts["renderer-image-trivy.json"];
  if (trivy && (trivy.status !== "passed" || !Number.isInteger(trivy.resultCount) || trivy.resultCount <= 0)) errors.push("renderer-image-trivy.json must contain non-empty Results evidence");
  const highOrCritical = [
    artifacts["root-npm-audit.json"],
    artifacts["renderer-npm-audit.json"],
    artifacts["root-dev-npm-audit.json"],
    artifacts["renderer-dev-npm-audit.json"],
  ].flatMap((audit) => audit?.findings ?? []).filter((finding) => ["high", "critical"].includes(finding.severity)).length
    + (trivy?.findings ?? []).filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity)).length;
  const imageProvenance = artifacts["renderer-image-provenance.json"];
  if (imageProvenance && (imageProvenance.buildStatus !== 0 || imageProvenance.inspectStatus !== 0 || typeof imageProvenance.imageId !== "string" || imageProvenance.imageId.length === 0 || typeof imageProvenance.dockerVersion !== "string" || imageProvenance.dockerVersion.length === 0)) errors.push("renderer-image-provenance.json must contain successful build, inspect, and Docker version evidence");
  const deno = artifacts["deno-import-evidence.json"];
  if (deno && (deno.status !== "blocked" || typeof deno.blockedReason !== "string" || !Array.isArray(deno.deno?.remote_imports) || deno.deno.remote_imports.length === 0)) errors.push("deno-import-evidence.json must contain explicit blocked status and remote-import evidence");
  if (deno?.status === "blocked") errors.push("Deno/import runtime scan is blocked; only static lock/import inventory is available");

  const provenance = artifacts["provenance.json"];
  if (provenance) {
    if (provenance.reviewedSha !== reviewedSha || provenance.checkoutSha !== checkoutSha) errors.push("provenance is not bound to the current exact reviewed SHA");
    if (!Array.isArray(provenance.actionRefs) || provenance.actionRefs.length === 0 || provenance.actionRefs.some((entry) => !entry.action?.startsWith("actions/") || !entry.shaPinned)) errors.push("provenance contains an unofficial or unpinned workflow action");
  }
  const owner = artifacts["owner-disposition.json"];
  if (owner) errors.push(...validateOwnerDisposition(owner));
  if (highOrCritical > 0 && owner?.status !== "reviewed" && owner?.decision !== "accepted") errors.push("actionable high or critical findings require an owner disposition");

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(directory, "artifact-manifest.json"), "utf8"));
    if (manifest.schema !== "xot-hosted-supply-artifact-manifest-v1") errors.push("artifact manifest schema is invalid");
    if (manifest.reviewedSha !== reviewedSha || manifest.checkoutSha !== checkoutSha) errors.push("artifact manifest is not bound to the current exact reviewed SHA");
    const expectedPaths = JSON.stringify(BASE_EVIDENCE_ARTIFACTS);
    if (JSON.stringify((manifest.artifacts ?? []).map((entry) => entry.path)) !== expectedPaths) errors.push("artifact manifest coverage is invalid");
    for (const entry of manifest.artifacts ?? []) {
      if (typeof entry?.path !== "string" || !SHA256_RE.test(entry?.sha256 ?? "")) errors.push("artifact manifest contains an invalid digest");
      else if (!BASE_EVIDENCE_ARTIFACTS.includes(entry.path)) errors.push(`artifact manifest contains an unexpected path: ${entry.path}`);
      else if (sha256(readFileSync(join(directory, entry.path))) !== entry.sha256) errors.push(`artifact digest mismatch: ${entry.path}`);
    }
  } catch {
    errors.push("artifact-manifest.json is malformed JSON");
  }

  try {
    const validation = JSON.parse(readFileSync(join(directory, "validation.json"), "utf8"));
    const expectedStatus = errors.length === 0 ? "passed_pending_owner_review" : "failed";
    if (validation.schema !== "xot-hosted-supply-validation-v1" || validation.reviewedSha !== reviewedSha || validation.checkoutSha !== checkoutSha) errors.push("validation record identity is invalid");
    if (validation.status !== expectedStatus) errors.push("validation record status does not match independently verified evidence");
    if (JSON.stringify(validation.errors ?? []) !== JSON.stringify(errors)) errors.push("validation record errors do not match independently verified evidence");
  } catch {
    errors.push("validation.json is malformed JSON");
  }
  return errors;
}

function collect(outputDirectory, reviewedSha) {
  mkdirSync(outputDirectory, { recursive: true });
  const checkoutSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const actionRefs = actionRefsFromWorkflow(workflow);
  const errors = [];
  if (!SHA_RE.test(reviewedSha ?? "") || checkoutSha !== reviewedSha) errors.push("evidence is not bound to the exact reviewed SHA");
  if (!Array.isArray(actionRefs) || actionRefs.length === 0 || actionRefs.some((entry) => !entry.action?.startsWith("actions/") || !entry.shaPinned)) errors.push("every hosted workflow action must be an official actions/* SHA-pinned action");
  const auditResults = {};
  for (const [surface, cwd, args] of [
    ["root", REPO_ROOT, ["audit", "--omit=dev", "--json"]],
    ["renderer", join(REPO_ROOT, "services/video-renderer"), ["audit", "--omit=dev", "--json"]],
    ["root-dev", REPO_ROOT, ["audit", "--json"]],
    ["renderer-dev", join(REPO_ROOT, "services/video-renderer"), ["audit", "--json"]],
  ]) {
    const result = run("npm", args, cwd);
    recordTimeout(result, `${surface} npm audit`, errors);
    try {
      auditResults[surface] = normalizeNpmAudit(result.stdout, surface, { status: result.status, timedOut: result.timedOut, reviewedSha });
    } catch (error) {
      auditResults[surface] = { schema: "xot-hosted-npm-audit-v1", surface, reviewedSha, status: "malformed", commandStatus: result.status, timedOut: result.timedOut, error: error.message };
      errors.push(error.message);
    }
    writeJson(outputDirectory, `${surface}-npm-audit.json`, auditResults[surface]);
  }

  const sbomResults = {};
  for (const [surface, cwd] of [["root", REPO_ROOT], ["renderer", join(REPO_ROOT, "services/video-renderer")]]) {
    const result = run("npm", ["sbom", "--package-lock-only", "--omit=dev", "--sbom-format=spdx"], cwd);
    recordTimeout(result, `${surface} SPDX SBOM`, errors);
    try {
      sbomResults[surface] = normalizeSpdx(result.stdout, surface, { status: result.status, timedOut: result.timedOut, reviewedSha });
    } catch (error) {
      sbomResults[surface] = { schema: "xot-hosted-spdx-sbom-v1", surface, reviewedSha, status: "malformed", commandStatus: result.status, timedOut: result.timedOut, error: error.message };
      errors.push(error.message);
    }
    writeJson(outputDirectory, `${surface}-sbom.spdx.json`, sbomResults[surface]);
  }

  const licenseInventory = Object.fromEntries(Object.entries(sbomResults).map(([surface, sbom]) => [surface, {
    packageCount: sbom.packageCount ?? 0,
    licenses: [...new Set((sbom.packages ?? []).map((pkg) => pkg.licenseDeclared))].sort(),
    unknownLicensePackages: (sbom.packages ?? []).filter((pkg) => pkg.licenseDeclared === "NOASSERTION").map((pkg) => `${pkg.name}@${pkg.version}`),
  }]));
  writeJson(outputDirectory, "license-inventory.json", { schema: "xot-hosted-license-inventory-v1", reviewedSha, surfaces: licenseInventory });

  let deno;
  try {
    const surfaces = run("node", ["--input-type=module", "-e", "import { independentInventorySurfaces } from './scripts/check-supply-chain-contract.mjs'; console.log(JSON.stringify(independentInventorySurfaces(process.cwd()).deno));"]);
    recordTimeout(surfaces, "Deno/import inventory", errors);
    if (surfaces.status !== 0) throw new Error(`Deno/import inventory command failed with status ${surfaces.status}`);
    deno = JSON.parse(surfaces.stdout);
  } catch (error) {
    deno = { status: "unavailable", error: "Deno/import inventory failed closed" };
    errors.push(error.message);
  }
  writeJson(outputDirectory, "deno-import-evidence.json", {
    schema: "xot-hosted-deno-import-v1",
    reviewedSha,
    status: "blocked",
    blockedReason: "runtime Deno scanner is unavailable before the protected lifecycle bootstrap; static lock/import inventory is retained as supporting evidence",
    deno,
  });
  errors.push("Deno/import runtime scan is blocked; only static lock/import inventory is available");

  const image = `xot-renderer:${reviewedSha}`;
  const build = run("docker", ["build", "--pull", "--tag", image, "services/video-renderer"]);
  recordTimeout(build, "renderer Docker build", errors);
  let imageInspect = { status: "unavailable" };
  let inspectStatus = null;
  let inspectTimedOut = false;
  if (build.status === 0) {
    const inspect = run("docker", ["image", "inspect", image]);
    recordTimeout(inspect, "renderer Docker image inspect", errors);
    inspectStatus = inspect.status;
    inspectTimedOut = inspect.timedOut;
    try { imageInspect = normalizeDockerInspect(JSON.parse(inspect.stdout)?.[0], { status: inspect.status, timedOut: inspect.timedOut }); } catch (error) { errors.push(error.message); }
  } else errors.push("renderer Docker build failed");
  const dockerVersionResult = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  recordTimeout(dockerVersionResult, "Docker version probe", errors);
  const dockerVersion = dockerVersionResult.stdout.trim();
  if (dockerVersionResult.status !== 0) errors.push(`Docker version probe failed with status ${dockerVersionResult.status}`);
  writeJson(outputDirectory, "renderer-image-provenance.json", {
    schema: "xot-hosted-renderer-image-v1", reviewedSha, image, dockerVersion,
    buildStatus: build.status, buildTimedOut: build.timedOut, inspectStatus, inspectTimedOut,
    imageId: imageInspect.Id ?? null, architecture: imageInspect.Architecture ?? null,
    os: imageInspect.Os ?? null, rootfsLayers: imageInspect.RootFS?.Layers?.length ?? null,
    dockerfileSha256: sha256(readFileSync(join(REPO_ROOT, "services/video-renderer/Dockerfile"))),
  });

  let trivy = { schema: "xot-hosted-trivy-v1", status: "unavailable", reviewedSha, commandStatus: null, timedOut: false, scannerImage: TRIVY_IMAGE };
  let imageSbom = { schema: "xot-hosted-spdx-sbom-v1", status: "unavailable", reviewedSha, commandStatus: null, timedOut: false, scannerImage: SYFT_IMAGE };
  if (imageInspect.Id) {
    const trivyRun = run("docker", ["run", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock", TRIVY_IMAGE, "image", "--format", "json", "--scanners", "vuln", image]);
    recordTimeout(trivyRun, "Trivy image scan", errors);
    try { trivy = { ...normalizeTrivy(trivyRun.stdout, { status: trivyRun.status, timedOut: trivyRun.timedOut, reviewedSha }), scannerImage: TRIVY_IMAGE }; } catch (error) { errors.push(error.message); }
    const syftRun = run("docker", ["run", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock", SYFT_IMAGE, `docker:${image}`, "-o", "spdx-json"]);
    recordTimeout(syftRun, "Syft image SBOM", errors);
    try { imageSbom = { ...normalizeSpdx(syftRun.stdout, "renderer-image", { status: syftRun.status, timedOut: syftRun.timedOut, reviewedSha }), scannerImage: SYFT_IMAGE }; } catch (error) { errors.push(error.message); }
  }
  writeJson(outputDirectory, "renderer-image-trivy.json", trivy);
  writeJson(outputDirectory, "renderer-image-sbom.spdx.json", imageSbom);

  const highOrCritical = Object.values(auditResults).flatMap((audit) => audit?.findings ?? []).filter((finding) => ["high", "critical"].includes(finding.severity)).length
    + (trivy.findings ?? []).filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity)).length;
  const scannerStatus = trivy.status === "unavailable" || imageSbom.status === "unavailable" ? "failed" : "passed";
  errors.push(...evaluateEvidenceContract({ reviewedSha, checkoutSha, actionRefs, scannerStatus, highOrCritical }));
  const npmVersionResult = run("npm", ["--version"]);
  recordTimeout(npmVersionResult, "npm version probe", errors);
  const provenance = { schema: "xot-hosted-supply-provenance-v1", reviewedSha, checkoutSha, actionRefs, tools: { node: process.version, npm: npmVersionResult.stdout.trim(), docker: dockerVersion, trivy: TRIVY_IMAGE, syft: SYFT_IMAGE, supabaseCli: { declared: "2.111.0", observed: null } }, artifactPolicy: "redacted reviewable metadata only; no raw logs, secrets, tokens, credentials, or provider data" };
  writeJson(outputDirectory, "provenance.json", provenance);
  writeJson(outputDirectory, "owner-disposition.json", { schema: "xot-hosted-supply-owner-disposition-v1", reviewedSha, status: "awaiting_owner_review", decision: "not_accepted", highOrCritical, requiredOwner: "security/release owner", noWaiverReceipt: null, waiverEntries: [] });
  writeArtifactManifest(outputDirectory, reviewedSha, checkoutSha);
  errors.push(...validateEvidenceArtifacts(outputDirectory, false));
  const validation = { schema: "xot-hosted-supply-validation-v1", reviewedSha, checkoutSha, status: errors.length === 0 ? "passed_pending_owner_review" : "failed", errors };
  writeJson(outputDirectory, "validation.json", validation);
  return validation;
}

function validateOnly(outputDirectory) {
  const reviewedSha = process.env.XOT_REVIEWED_SHA ?? null;
  const checkoutSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const errors = validateEvidenceDirectory(outputDirectory, reviewedSha, checkoutSha);
  if (errors.length > 0) {
    console.error(`HOSTED_SUPPLY_EVIDENCE_FAIL\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
  } else console.log(`HOSTED_SUPPLY_EVIDENCE_PASS sha=${reviewedSha} ownerDisposition=pending`);
}

export {
  evaluateEvidenceContract,
  normalizeNpmAudit,
  normalizeSpdx,
  normalizeTrivy,
  normalizeDockerInspect,
  validateEvidenceArtifacts,
  validateEvidenceDirectory,
  validateOwnerDisposition,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output-dir");
  const reviewedSha = process.env.XOT_REVIEWED_SHA ?? null;
  if (args.includes("--validate-only")) validateOnly(args[outputIndex + 1]);
  else if (outputIndex >= 0 && args[outputIndex + 1]) {
    const validation = collect(resolve(args[outputIndex + 1]), reviewedSha);
    if (validation.status === "failed" && !args.includes("--collect-only")) process.exitCode = 1;
  } else {
    console.error("usage: collect-supply-chain-evidence.mjs --output-dir <directory>");
    process.exitCode = 2;
  }
}

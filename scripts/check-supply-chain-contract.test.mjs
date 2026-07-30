import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REPO_ROOT, validateSupplyChainContract } from "./check-supply-chain-contract.mjs";

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-supply-contract-"));
  try {
    for (const path of [
      ".github/workflows/ci.yml",
      "package.json",
      "package-lock.json",
      "deno.lock",
      "services/video-renderer/package.json",
      "services/video-renderer/package-lock.json",
      "services/video-renderer/Dockerfile",
      "docs/operations/supply-chain-exceptions.json",
    ]) cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true });
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the committed supply-chain source contract is internally consistent", () => {
  const result = validateSupplyChainContract({ now: Date.parse("2026-07-24T00:00:00Z") });
  assert.deepEqual(result.errors, []);
});

test("the renderer production audit cannot be deleted from the CI gate", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace("      - run: npm --prefix services/video-renderer audit --omit=dev --audit-level=high\n", ""));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("renderer audit")));
}));

test("the root install cannot run lifecycle scripts before the source gate", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace("      - run: npm ci --ignore-scripts", "      - run: npm ci"));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("supply-chain checks cannot be redirected through package script aliases", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "      - run: node scripts/check-supply-chain-contract.mjs",
    "      - run: npm run check:supply-chain-contract",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("registry and npm configuration preflight must complete before any root install", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "      - run: node scripts/check-supply-chain-contract.mjs\n      - run: npm ci --ignore-scripts",
    "      - run: npm ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("the second supply preflight must precede renderer install and audits", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "      - run: npm ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs\n      - run: npm --prefix services/video-renderer ci --ignore-scripts",
    "      - run: npm ci --ignore-scripts\n      - run: npm --prefix services/video-renderer ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("production audits must finish before mutable Node contract and test commands", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "      - run: npm --prefix services/video-renderer audit --omit=dev --audit-level=high\n      - run: node scripts/check-runtime-contract.mjs",
    "      - run: node scripts/check-runtime-contract.mjs\n      - run: npm --prefix services/video-renderer audit --omit=dev --audit-level=high",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("workflow-level defaults cannot redirect every supply-chain command", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, `defaults:\n  run:\n    working-directory: .ci/clean\n${readFileSync(path, "utf8")}`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed name, on, and jobs")));
}));

test("a trusted pull_request_target trigger cannot replace the reviewed PR trigger", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace("  pull_request:", "  pull_request_target:"));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed pull_request and push trigger block")));
}));

test("checkout cannot redirect the supply-chain gate to a trusted ref", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "      - uses: actions/checkout@v4",
    "      - uses: actions/checkout@v4\n        with:\n          ref: main",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("a non-blocking production audit is rejected", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "      - run: npm audit --omit=dev --audit-level=high",
    "      - run: npm audit --omit=dev --audit-level=high\n        continue-on-error: true",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must be a bare")));
}));

test("the containing CI job cannot skip the supply-chain gate", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "  lint-build:\n    runs-on: ubuntu-latest",
    "  lint-build:\n    if: ${{ false }}\n    runs-on: ubuntu-latest",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("lint-build job must retain only")));
}));

test("quoted YAML keys cannot skip the containing CI job", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "  lint-build:\n    runs-on: ubuntu-latest",
    "  lint-build:\n    \"if\": ${{ false }}\n    runs-on: ubuntu-latest",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("lint-build job must retain only")));
}));

test("duplicate CI jobs cannot replace the reviewed gate", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n  lint-build:\n    if: \${{ false }}\n    runs-on: ubuntu-latest\n    steps: []\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must appear exactly once")));
}));

test("quoted step properties cannot make a required audit non-blocking", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "      - run: npm audit --omit=dev --audit-level=high",
    "      - run: npm audit --omit=dev --audit-level=high\n        \"continue-on-error\": true",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must be a bare")));
}));

test("unchecksummed Deno remote imports are rejected", () => withFixture((root) => {
  const path = join(root, "deno.lock");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [specifier] = Object.keys(lock.remote);
  lock.remote[specifier] = "0".repeat(63);
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("SHA-256 checksum")));
}));

test("npm lock entries without an integrity value are rejected", () => withFixture((root) => {
  const path = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [entryPath] = Object.keys(lock.packages).filter((candidate) => candidate.startsWith("node_modules/"));
  delete lock.packages[entryPath].integrity;
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must have an integrity value")));
}));

test("root package manifest sections cannot drift from the reviewed lock root", () => withFixture((root) => {
  const path = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [name] = Object.keys(lock.packages[""].devDependencies);
  delete lock.packages[""].devDependencies[name];
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("root lock root devDependencies must match package.json")));
}));

test("reviewed npm package inventories cannot silently shrink", () => withFixture((root) => {
  const path = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [entryPath] = Object.keys(lock.packages).filter((candidate) => candidate.startsWith("node_modules/"));
  delete lock.packages[entryPath];
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("root package inventory must match the reviewed manifest")));
}));

test("reviewed Deno remote-import inventories cannot silently shrink", () => withFixture((root) => {
  const path = join(root, "deno.lock");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [specifier] = Object.keys(lock.remote);
  delete lock.remote[specifier];
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("Deno remote-import inventory must match the reviewed manifest")));
}));

test("linked npm lock entries cannot bypass production audit coverage", () => withFixture((root) => {
  const path = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [entryPath] = Object.keys(lock.packages).filter((candidate) => candidate.startsWith("node_modules/"));
  lock.packages[entryPath].link = true;
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("may not use a local link")));
}));

test("repository npm configuration cannot redirect audit traffic", () => withFixture((root) => {
  writeFileSync(join(root, ".npmrc"), "registry=https://unreviewed.example.invalid\n");
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes(".npmrc is not permitted")));
}));

test("an expired exception waiver is rejected", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.production_waivers.push({
    id: "TEST-EXPIRED",
    scope: "root",
    advisory: "test advisory",
    severity: "high",
    exploitability: "test",
    impact: "test",
    owner: "test",
    evidence: "test",
    expires_at: "2026-01-01T00:00:00Z",
  });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root, now: Date.parse("2026-07-24T00:00:00Z") }).errors.some((error) => error.includes("future expiry")));
}));

test("unreviewed exception waiver IDs cannot enter the ledger", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.status = "current_scan_evidence_recorded";
  ledger.last_scan_receipt = {
    sha: "a".repeat(40),
    source: "github-actions:run/123",
    completed_at: "2026-07-24T00:00:00Z",
    root_production_audit: "passed",
    renderer_production_audit: "passed",
  };
  ledger.production_waivers.push({
    id: "UNREVIEWED-WAIVER",
    scope: "root",
    advisory: "test advisory",
    severity: "high",
    exploitability: "test",
    impact: "test",
    owner: "test",
    evidence: "test",
    expires_at: "2026-12-01T00:00:00Z",
  });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root, now: Date.parse("2026-07-24T01:00:00Z") }).errors.some((error) => error.includes("production_waivers waiver inventory must match the reviewed manifest")));
}));

test("a ledger cannot claim current scan evidence without a complete receipt", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.status = "current_scan_evidence_recorded";
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("scan receipt")));
}));

test("a current scan receipt must bind to a full Git SHA", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.status = "current_scan_evidence_recorded";
  ledger.last_scan_receipt = {
    sha: "not-a-git-sha",
    source: "github-actions:run/123",
    completed_at: "2026-07-24T00:00:00Z",
    root_production_audit: "passed",
    renderer_production_audit: "passed",
  };
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root, now: Date.parse("2026-07-24T01:00:00Z") }).errors.some((error) => error.includes("full lowercase Git SHA")));
}));

test("a current scan receipt cannot be materially future-dated", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.status = "current_scan_evidence_recorded";
  ledger.last_scan_receipt = {
    sha: "a".repeat(40),
    source: "github-actions:run/123",
    completed_at: "2026-07-24T02:00:00Z",
    root_production_audit: "passed",
    renderer_production_audit: "passed",
  };
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root, now: Date.parse("2026-07-24T00:00:00Z") }).errors.some((error) => error.includes("materially in the future")));
}));

test("current scan receipt metadata cannot use an unreviewed source or status", () => withFixture((root) => {
  const path = join(root, "docs/operations/supply-chain-exceptions.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  ledger.status = "current_scan_evidence_recorded";
  ledger.last_scan_receipt = { sha: "a".repeat(40), source: "operator-note", completed_at: "2026-07-24T00:00:00Z", root_production_audit: "maybe", renderer_production_audit: "unknown" };
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  const errors = validateSupplyChainContract({ root, now: Date.parse("2026-07-24T01:00:00Z") }).errors;
  assert.ok(errors.some((error) => error.includes("reviewed github-actions or local evidence origin")));
  assert.ok(errors.some((error) => error.includes("root_production_audit must be explicitly passed or failed")));
  assert.ok(errors.some((error) => error.includes("renderer_production_audit must be explicitly passed or failed")));
}));

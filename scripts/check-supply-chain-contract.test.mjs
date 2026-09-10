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
      "scripts/collect-supply-chain-evidence.mjs",
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

function withFullInventoryFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-supply-inventory-contract-"));
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
      "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json",
      "scripts/check-supply-chain-contract.mjs",
      "scripts/check-supply-chain-contract.test.mjs",
      "scripts/collect-supply-chain-evidence.mjs",
      "scripts/collect-supply-chain-evidence.test.mjs",
      "scripts/build-e8-local-supply-build-inventory.test.mjs",
      "scripts/check-vite-env.mjs",
      "scripts/check-vite-env.test.mjs",
    ]) cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true });
    cpSync(join(REPO_ROOT, "src"), join(root, "src"), { recursive: true });
    cpSync(join(REPO_ROOT, "supabase/functions"), join(root, "supabase/functions"), { recursive: true });
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the committed supply-chain source contract is internally consistent", () => {
  const result = validateSupplyChainContract({ now: Date.parse("2026-07-24T00:00:00Z") });
  assert.deepEqual(result.errors, []);
});

test("the renderer production audit cannot be deleted from the hosted collector", () => withFullInventoryFixture((root) => {
  const path = join(root, "scripts/collect-supply-chain-evidence.mjs");
  writeFileSync(path, readFileSync(path, "utf8").replace("[\"renderer\", join(REPO_ROOT, \"services/video-renderer\"), [\"audit\", \"--omit=dev\", \"--json\"]],\n", ""));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("renderer npm audit") || error.includes("source-file coverage")));
}));

test("hosted supply-chain evidence is immutable, present, and before mutable tests", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", "actions/upload-artifact@v4"));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("immutable SHA")));

  writeFileSync(path, original.replace("--collect-only", "--validate-only"));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("hosted supply-chain")));
}));

test("workflow actions outside the official namespace are rejected", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    `untrusted/upload-artifact@${"c".repeat(40)}`,
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("official actions/*")));
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

test("the second supply preflight must precede renderer install", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "      - run: npm ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs\n      - run: npm --prefix services/video-renderer ci --ignore-scripts",
    "      - run: npm ci --ignore-scripts\n      - run: npm --prefix services/video-renderer ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("hosted evidence must finish before mutable Node contract and test commands", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "        run: node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir \"$RUNNER_TEMP/xot-supply-chain\"",
    "        run: node scripts/check-runtime-contract.mjs",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node") || error.includes("hosted supply-chain")));
}));

test("focused build identity tests must remain in the reviewed CI prefix", () => withFullInventoryFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  const focused = "      - run: node --test scripts/check-build-output-identity.test.mjs scripts/run-vite-build.test.mjs\n";
  writeFileSync(path, original.replace(focused, ""));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node") || error.includes("mutable Node/runtime")));
}));

test("focused build identity tests must follow runtime contract tests", () => withFullInventoryFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  const focused = "      - run: node --test scripts/check-build-output-identity.test.mjs scripts/run-vite-build.test.mjs\n";
  writeFileSync(path, original.replace(
    `${focused}      - run: node --test scripts/check-supply-chain-contract.test.mjs\n`,
    `      - run: node --test scripts/check-supply-chain-contract.test.mjs\n${focused}`,
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node") || error.includes("mutable Node/runtime")));
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
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2\n        with:\n          ref: main",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("reviewed checkout, setup-node")));
}));

test("a non-blocking hosted evidence collection is rejected", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "        run: node scripts/collect-supply-chain-evidence.mjs --collect-only --output-dir \"$RUNNER_TEMP/xot-supply-chain\"",
    "        run: node scripts/collect-supply-chain-evidence.mjs --collect-only --output-dir \"$RUNNER_TEMP/xot-supply-chain\"\n        continue-on-error: true",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must remain blocking")));
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

test("quoted step properties cannot make hosted evidence non-blocking", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, readFileSync(path, "utf8").replace(
    "        run: node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir \"$RUNNER_TEMP/xot-supply-chain\"",
    "        run: node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir \"$RUNNER_TEMP/xot-supply-chain\"\n        \"continue-on-error\": true",
  ));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("must remain blocking")));
}));

test("final owner validation must retain the exact-head policy mode and repository variable", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  for (const mutant of [
    original.replace("          XOT_SUPPLY_OWNER_POLICY_MODE: exact-head\n", ""),
    original.replace("          XOT_SUPPLY_OWNER_POLICY_B64: ${{ vars.XOT_SUPPLY_OWNER_POLICY_B64 }}\n", ""),
    original.replace("          XOT_SUPPLY_OWNER_POLICY_B64: ${{ vars.XOT_SUPPLY_OWNER_POLICY_B64 }}", "          XOT_SUPPLY_OWNER_POLICY_B64: ${{ secrets.XOT_SUPPLY_OWNER_POLICY_B64 }}"),
  ]) {
    writeFileSync(path, mutant);
    const errors = validateSupplyChainContract({ root }).errors;
    assert.ok(errors.some((error) => error.includes("exact-head owner policy") || error.includes("owner policy only from the reviewed repository variable")));
  }
}));

test("accepted hosted evidence must be uploaded only after successful final validation", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  const acceptedStep = [
    "      - name: Upload accepted hosted supply-chain evidence",
    "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2",
    "        with:",
    "          name: xot-supply-chain-accepted-${{ github.event.pull_request.head.sha || github.sha }}",
    "          path: ${{ runner.temp }}/xot-supply-chain",
    "          if-no-files-found: error",
  ].join("\n");
  const withoutAcceptedUpload = original.replace(`${acceptedStep}\n`, "");
  writeFileSync(path, withoutAcceptedUpload);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("accepted-bundle upload sequence")));
  writeFileSync(path, original.replace(`${acceptedStep}\n`, `${acceptedStep}\n      - run: echo after-accepted-upload\n`));
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("immediately before the accepted-bundle upload")));
}));

test("renderer Docker base must retain the reviewed immutable digest", () => withFixture((root) => {
  const path = join(root, "services/video-renderer/Dockerfile");
  const original = readFileSync(path, "utf8");
  for (const mutant of [
    original.replace(/FROM node:24-bookworm-slim@sha256:[a-f0-9]+/, "FROM node:24-bookworm-slim"),
    original.replace(/FROM node:24-bookworm-slim@sha256:[a-f0-9]+/, `FROM node:24-bookworm-slim@sha256:${"0".repeat(64)}`),
  ]) {
    writeFileSync(path, mutant);
    assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("renderer Docker base selector")));
  }
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

for (const surface of ["root_npm", "renderer_npm", "deno", "docker", "ci", "exceptions", "vite_env"]) {
  test(`independent checker rejects ${surface} inventory omission`, () => withFullInventoryFixture((root) => {
    const path = join(root, "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json");
    const inventory = JSON.parse(readFileSync(path, "utf8"));
    delete inventory.surfaces[surface];
    writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
    assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes(`${surface} coverage/hash binding`)));
  }));
}

test("independent checker rejects secret/env value fields", () => withFullInventoryFixture((root) => {
  const path = join(root, "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json");
  const inventory = JSON.parse(readFileSync(path, "utf8"));
  inventory.surfaces.vite_env.env_values = { VITE_SUPABASE_URL: "https://private.invalid" };
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("secret/env value fields are prohibited")));
}));

test("independent checker rejects a stale Vite public allowlist", () => withFullInventoryFixture((root) => {
  const path = join(root, "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json");
  const inventory = JSON.parse(readFileSync(path, "utf8"));
  inventory.surfaces.vite_env.public_allowlist = inventory.surfaces.vite_env.public_allowlist.filter((name) => name !== "VITE_SUPABASE_PROJECT_ID");
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
  assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("vite_env coverage/hash binding")));
}));

for (const [label, mutation] of [
  ["extra literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_INJECTED\",\n]);")],
  ["removed declaration spread", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "]);")],
  ["duplicate literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_SUPABASE_URL\",\n]);")],
  ["unknown literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_UNKNOWN\",\n]);")],
  ["composition spread drift", (source) => source.replace("  ...REQUIRED_VITE_ENV_NAMES,\n  ...OPTIONAL_VITE_ENV_NAMES,", "  ...OPTIONAL_VITE_ENV_NAMES,\n  ...REQUIRED_VITE_ENV_NAMES,")],
]) {
  test(`independent checker rejects ${label} after inventory regeneration`, () => withFullInventoryFixture((root) => {
    const checkerPath = join(root, "scripts/check-vite-env.mjs");
    writeFileSync(checkerPath, mutation(readFileSync(checkerPath, "utf8")));
    const errors = validateSupplyChainContract({ root }).errors;
    assert.ok(errors.some((error) => error.includes("independent source projection failed closed") && /composition|exactly nine|public env contract/i.test(error)));
  }));
}

for (const path of ["scripts/check-vite-env.mjs", "scripts/check-vite-env.test.mjs"]) {
  test(`independent checker rejects omitted ${path} source binding`, () => withFullInventoryFixture((root) => {
    const inventoryPath = join(root, "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    inventory.source_files = inventory.source_files.filter((entry) => entry.path !== path);
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("source-file coverage/hash binding")));
  }));
}

test("independent checker rejects a missing JSR lock package for a scoped subpath", () => withFullInventoryFixture((root) => {
  const lockPath = join(root, "deno.lock");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  delete lock.jsr["@supabase/functions-js@2.105.4"];
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const errors = validateSupplyChainContract({ root }).errors;
  assert.ok(errors.some((error) => error.includes("Deno source import missing lock integrity")));
}));

for (const [path, value] of [
  ["status", "AUDITED"],
  ["release", "OPEN"],
  ["release_gate", "OPEN"],
  ["no_live_contact", false],
  ["evidence.external_scans", "passed"],
  ["evidence.waivers", "completed"],
  ["evidence.sbom", "AUDITED"],
  ["evidence.image_scan", "passed"],
  ["evidence.audit_fetches", "completed"],
  ["evidence.dependency_update", "passed"],
]) {
  test(`independent checker rejects claim inflation ${path}`, () => withFullInventoryFixture((root) => {
    const inventoryPath = join(root, "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    const [section, field] = path.split(".");
    if (field) inventory[section][field] = value;
    else inventory[section] = value;
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    assert.ok(validateSupplyChainContract({ root }).errors.some((error) => error.includes("claims must remain conservative") || error.includes("must remain") || error.includes("no_live_contact")));
  }));
}

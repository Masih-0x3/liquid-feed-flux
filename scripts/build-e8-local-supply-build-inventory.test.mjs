import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLocalSupplyBuildInventory,
  collectSourceImports,
  inventoryToJson,
  parsePackageRef,
  packageNameFromLockPath,
  resolveDenoImportIntegrity,
  validateInventoryAgainstRepository,
  validateInventoryDocument,
} from "./build-e8-local-supply-build-inventory.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function withTempFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-e8d-inventory-"));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withRepositoryFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-e8d-composition-"));
  try {
    for (const path of [
      "package.json", "package-lock.json", "deno.lock", "services/video-renderer/package.json",
      "services/video-renderer/package-lock.json", "services/video-renderer/Dockerfile", ".github/workflows/ci.yml",
      "docs/operations/supply-chain-exceptions.json", "scripts/check-supply-chain-contract.mjs",
      "scripts/check-supply-chain-contract.test.mjs", "scripts/build-e8-local-supply-build-inventory.mjs",
      "scripts/build-e8-local-supply-build-inventory.test.mjs", "scripts/check-vite-env.mjs", "scripts/check-vite-env.test.mjs",
    ]) cpSync(join(ROOT, path), join(root, path), { recursive: true });
    cpSync(join(ROOT, "src"), join(root, "src"), { recursive: true });
    cpSync(join(ROOT, "supabase/functions"), join(root, "supabase/functions"), { recursive: true });
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("package ref parsing keeps primary package/version separate from peer suffixes", () => {
  assert.deepEqual(parsePackageRef("react@18.3.1_react-dom@18.3.1"), { name: "react", version: "18.3.1" });
  assert.deepEqual(parsePackageRef("@scope/pkg@1.2.3_peer@9.9.9"), { name: "@scope/pkg", version: "1.2.3" });
  assert.equal(packageNameFromLockPath("node_modules/foo/node_modules/@scope/bar"), "@scope/bar");
  assert.equal(packageNameFromLockPath("node_modules/@scope/pkg/node_modules/nested"), "nested");
});

test("Deno import inventory includes bare static, from, and dynamic imports", () => withTempFixture((root) => {
  writeFileSync(join(root, "bare.ts"), [
    'import "jsr:@supabase/functions-js/edge-runtime.d.ts";',
    'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";',
    'const x = await import("npm:ai@6.0.217");',
  ].join("\n"));
  assert.deepEqual(collectSourceImports(root, ["bare.ts"]).map((entry) => entry.specifier), [
    "https://deno.land/std@0.168.0/http/server.ts",
    "jsr:@supabase/functions-js/edge-runtime.d.ts",
    "npm:ai@6.0.217",
  ]);
}));

test("scoped JSR subpaths bind the package integrity and missing packages fail closed", () => {
  const lock = { jsr: { "@supabase/functions-js@2.105.4": { integrity: "e81b95eac034f9ebb8b62d64e9006958ce762622a882ad6b19ee9eab94da2043" }, "std@1.0.0": { integrity: "std-integrity" } } };
  assert.equal(resolveDenoImportIntegrity("jsr:@supabase/functions-js/edge-runtime.d.ts", lock), "e81b95eac034f9ebb8b62d64e9006958ce762622a882ad6b19ee9eab94da2043");
  assert.equal(resolveDenoImportIntegrity("jsr:std/path", lock), "std-integrity");
  assert.throws(() => resolveDenoImportIntegrity("jsr:@missing/pkg/subpath", lock), /lock integrity/i);
});

test("explicit and walked symlinks fail closed", () => withTempFixture((root) => {
  writeFileSync(join(root, "real.ts"), "export {};");
  symlinkSync("real.ts", join(root, "link.ts"));
  assert.throws(() => collectSourceImports(root, ["link.ts"]), /symlink|symbolic/i);
  assert.throws(() => collectSourceImports(root, ["missing/../real.ts"]), /path|repository/i);
}));

test("missing required source contract paths fail closed", () => withTempFixture((root) => {
  assert.throws(() => buildLocalSupplyBuildInventory({ root }), /repository path is missing/i);
}));

test("local supply/build inventory covers every accepted surface", () => {
  const inventory = buildLocalSupplyBuildInventory({ root: ROOT });

  assert.equal(inventory.schema, "xot-e8d-local-supply-build-inventory-v1");
  assert.equal(inventory.release, "CLOSED");
  assert.equal(inventory.exception_state, "awaiting_fresh_scan_evidence");
  assert.ok(inventory.surfaces.root_npm.packages.length > 0);
  assert.ok(inventory.surfaces.renderer_npm.packages.length > 0);
  assert.ok(inventory.surfaces.deno.npm_packages.length > 0);
  assert.ok(inventory.surfaces.deno.jsr_packages.length > 0);
  assert.ok(inventory.surfaces.deno.remote_imports.length > 0);
  assert.ok(inventory.surfaces.docker.apt_packages.length > 0);
  assert.ok(inventory.surfaces.ci.action_refs.length > 0);
  assert.ok(inventory.surfaces.vite_env.variable_names.length > 0);
  assert.deepEqual(inventory.surfaces.vite_env.public_allowlist, [
    "VITE_FOGLAMP_HUD",
    "VITE_SENTRY_DSN",
    "VITE_SENTRY_ENVIRONMENT",
    "VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE",
    "VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
    "VITE_SENTRY_TRACES_SAMPLE_RATE",
    "VITE_SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
  ]);
  assert.ok(inventory.source_files.some(({ path }) => path === "scripts/check-vite-env.mjs"));
  assert.ok(inventory.source_files.some(({ path }) => path === "scripts/check-vite-env.test.mjs"));
});

test("inventory serialization is deterministic and excludes source values", () => {
  const first = inventoryToJson(buildLocalSupplyBuildInventory({ root: ROOT }));
  const second = inventoryToJson(buildLocalSupplyBuildInventory({ root: ROOT }));

  assert.equal(first, second);
  assert.doesNotMatch(first, /(?:password|token|secret|api[_-]?key|private[_-]?key)["']?\s*:/i);
  assert.doesNotMatch(first, /(?:env_?value|credential_?value|raw_?value)/i);
});

test("inventory document rejects secret-like/value fields fail-closed", () => {
  const inventory = buildLocalSupplyBuildInventory({ root: ROOT });
  const mutant = JSON.parse(inventoryToJson(inventory));
  mutant.surfaces.vite_env.env_values = { VITE_SUPABASE_URL: "https://private.example.invalid" };

  const errors = validateInventoryDocument(mutant);
  assert.ok(errors.some((error) => error.includes("secret/env value fields")));
});

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
  test(`claim inflation mutation ${path} fails closed`, () => {
    const inventory = buildLocalSupplyBuildInventory({ root: ROOT });
    const [section, field] = path.split(".");
    if (field) inventory[section][field] = value;
    else inventory[section] = value;
    assert.ok(validateInventoryDocument(inventory).length > 0);
  });
}

for (const surface of ["root_npm", "renderer_npm", "deno", "docker", "ci", "exceptions", "vite_env"]) {
  test(`omitting ${surface} coverage fails closed`, () => {
    const inventory = buildLocalSupplyBuildInventory({ root: ROOT });
    delete inventory.surfaces[surface];
    const errors = validateInventoryAgainstRepository(inventory, { root: ROOT });
    assert.ok(errors.some((error) => error.includes("complete deterministic coverage")));
  });
}

test("generated inventory is the checked-in deterministic projection", () => {
  const checkedIn = readFileSync(new URL("../docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json", import.meta.url), "utf8");
  assert.equal(checkedIn, inventoryToJson(buildLocalSupplyBuildInventory({ root: ROOT })));
});

for (const path of ["scripts/check-vite-env.mjs", "scripts/check-vite-env.test.mjs"]) {
  test(`omitting ${path} fails closed as a source contract`, () => {
    const inventory = buildLocalSupplyBuildInventory({ root: ROOT });
    inventory.source_files = inventory.source_files.filter((entry) => entry.path !== path);
    assert.ok(validateInventoryAgainstRepository(inventory, { root: ROOT }).some((error) => error.includes("complete deterministic coverage")));
  });
}

for (const [label, mutation] of [
  ["extra literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_INJECTED\",\n]);")],
  ["removed declaration spread", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "]);")],
  ["duplicate literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_SUPABASE_URL\",\n]);")],
  ["unknown literal", (source) => source.replace("  ...OPTIONAL_VITE_ENV_NAMES,\n]);", "  ...OPTIONAL_VITE_ENV_NAMES,\n  \"VITE_UNKNOWN\",\n]);")],
  ["composition spread drift", (source) => source.replace("  ...REQUIRED_VITE_ENV_NAMES,\n  ...OPTIONAL_VITE_ENV_NAMES,", "  ...OPTIONAL_VITE_ENV_NAMES,\n  ...REQUIRED_VITE_ENV_NAMES,")],
]) {
  test(`builder rejects ${label} in public Vite export composition`, () => withRepositoryFixture((root) => {
    const path = join(root, "scripts/check-vite-env.mjs");
    const source = readFileSync(path, "utf8");
    writeFileSync(path, mutation(source));
    assert.throws(() => buildLocalSupplyBuildInventory({ root }), /composition|exactly nine|public env contract/i);
  }));
}

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REPO_ROOT, validateRuntimeContract } from "./check-runtime-contract.mjs";

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "xot-runtime-contract-"));
  try {
    for (const path of [
      ".github",
      ".nvmrc",
      ".vercelignore",
      "docs/operations/runtime-contract.json",
      "package.json",
      "package-lock.json",
      "vercel.json",
      "deno.lock",
      "services/video-renderer",
      "scripts/check-build-contract.mjs",
      "scripts/check-vite-env.mjs",
      "scripts/preview-identity.mjs",
      "scripts/check-build-output-identity.mjs",
      "scripts/run-vite-build.mjs",
      "scripts/check-release-state.sh",
      "supabase/functions",
    ]) cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true });
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the committed runtime freeze is internally consistent", () => {
  const result = validateRuntimeContract({ actualNodeVersion: "24.20.0", actualNpmVersion: "11.19.0", requireDeploymentMajor: true });
  assert.deepEqual(result.errors, []);
});

test("Vite 8 minimum patch and deployment major fail closed", () => {
  const expectedDeploymentMajor = JSON.parse(readFileSync(join(REPO_ROOT, "docs/operations/runtime-contract.json"), "utf8")).node.deployment_major;
  const mismatchedDeploymentMajor = expectedDeploymentMajor === 20 ? 22 : expectedDeploymentMajor + 1;
  const validDeploymentVersion = expectedDeploymentMajor === 20 ? "19.0" : "12.0";
  assert.ok(validateRuntimeContract({ actualNodeVersion: "20.18.9" }).errors.some((error) => error.includes("Vite 8 supported range")));
  assert.ok(validateRuntimeContract({ actualNodeVersion: `${mismatchedDeploymentMajor}.12.0`, requireDeploymentMajor: true }).errors.some((error) => error.includes("deployment/CI Node major")));
  assert.ok(validateRuntimeContract({ actualNodeVersion: "24.20.0", actualNpmVersion: "10.0.0" }).errors.some((error) => error.includes("npm major")));
  assert.deepEqual(validateRuntimeContract({ actualNodeVersion: `${expectedDeploymentMajor}.${validDeploymentVersion}` }).errors, []);
});

test("package engine drift is rejected", () => withFixture((root) => {
  const path = join(root, "package.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.engines.node = "22.x";
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("root Node engine")));
}));

test("local Node version file drift is rejected", () => withFixture((root) => {
  writeFileSync(join(root, ".nvmrc"), "22.23.1\n");
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "24.20.0" }).errors.some((error) => error.includes("local Node version")));
}));

test("an unreviewed Edge Supabase client import is rejected", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/index.ts");
  const value = readFileSync(path, "utf8").replace("@supabase/supabase-js@2.39.7", "@supabase/supabase-js@2.999.0");
  writeFileSync(path, value);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Edge Supabase import inventory")));
}));

test("a dynamically obscured Edge Supabase import cannot hide behind a reviewed one", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/index.ts");
  const value = readFileSync(path, "utf8");
  writeFileSync(path, `await import("@supabase/" + "supabase-js");\n${value}`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("non-literal Edge module loads")));
}));

test("a new JavaScript Edge Supabase import is included in the frozen inventory", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/runtime-bypass.js");
  writeFileSync(path, 'import { createClient } from "https://esm.sh/@supabase/supabase-js@9.9.9";\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Edge Supabase import inventory")));
}));

test("Vite range and resolved version drift are rejected", () => withFixture((root) => {
  const packagePath = join(root, "package.json");
  const packageValue = JSON.parse(readFileSync(packagePath, "utf8"));
  packageValue.devDependencies.vite = "^9.0.0";
  writeFileSync(packagePath, `${JSON.stringify(packageValue, null, 2)}\n`);
  const lockPath = join(root, "package-lock.json");
  const lockValue = JSON.parse(readFileSync(lockPath, "utf8"));
  lockValue.packages["node_modules/vite"].version = "9.0.0";
  writeFileSync(lockPath, `${JSON.stringify(lockValue, null, 2)}\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("Vite package range")));
  assert.ok(errors.some((error) => error.includes("Vite lock version")));
}));

test("Vercel cannot bypass prebuild or reproducible install commands", () => withFixture((root) => {
  const path = join(root, "vercel.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.buildCommand = "vite build";
  value.installCommand = "npm install";
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("Vercel build command")));
  assert.ok(errors.some((error) => error.includes("Vercel install command")));
}));

test("Vercel must include the renderer runtime metadata used by the build gate", () => withFixture((root) => {
  const path = join(root, ".vercelignore");
  writeFileSync(path, "services/video-renderer/**\n");
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Vercel ignore contract hash")));
}));

test("renderer Docker base must retain the reviewed immutable selector and digest", () => withFixture((root) => {
  const path = join(root, "services/video-renderer/Dockerfile");
  const original = readFileSync(path, "utf8");
  for (const mutant of [
    original.replace(/FROM node:24-bookworm-slim@sha256:[a-f0-9]+/, "FROM node:24-bookworm-slim"),
    original.replace(/FROM node:24-bookworm-slim@sha256:[a-f0-9]+/, `FROM node:24-bookworm-slim@sha256:${"0".repeat(64)}`),
  ]) {
    writeFileSync(path, mutant);
    assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("renderer Docker selector")));
  }
}));

test("the prebuild wrapper cannot silently drop runtime or environment checks", () => withFixture((root) => {
  const path = join(root, "scripts/check-build-contract.mjs");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// bypass\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("build contract wrapper hash")));
}));

test("the build owner script remains frozen", () => withFixture((root) => {
  const path = join(root, "scripts/run-vite-build.mjs");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// bypass\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("build script hash")));
}));

test("transitive Preview identity guards remain frozen", () => withFixture((root) => {
  const identityPath = join(root, "scripts/preview-identity.mjs");
  writeFileSync(identityPath, `${readFileSync(identityPath, "utf8")}\n// bypass\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Preview identity validator hash")));

  const outputPath = join(root, "scripts/check-build-output-identity.mjs");
  writeFileSync(outputPath, `${readFileSync(outputPath, "utf8")}\n// bypass\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("build output identity checker hash")));
}));

test("the active release-state guard remains frozen", () => withFixture((root) => {
  const path = join(root, "scripts/check-release-state.sh");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n# bypass\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("release-state guard hash")));
}));

test("comments and echo text cannot impersonate exact CI runtime steps", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const value = readFileSync(path, "utf8")
    .replace("      - run: node scripts/check-runtime-contract.mjs", "      # run: node scripts/check-runtime-contract.mjs")
    .replace("      - run: node --test scripts/check-runtime-contract.test.mjs", "      - run: echo node --test scripts/check-runtime-contract.test.mjs");
  writeFileSync(path, value);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CI must begin with checkout, setup-node")));
}));

test("the CI guard prefix preflights registry policy, suppresses lifecycle scripts, and bypasses package aliases", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("      - run: npm ci --ignore-scripts", "      - run: npm ci"));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CI must begin with checkout, setup-node")));

  writeFileSync(path, original.replace(
    "      - run: node scripts/check-runtime-contract.mjs",
    "      - run: npm run check:runtime-contract",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CI must begin with checkout, setup-node")));

  writeFileSync(path, original.replace(
    "      - run: node scripts/check-supply-chain-contract.mjs\n      - run: npm ci --ignore-scripts",
    "      - run: npm ci --ignore-scripts\n      - run: node scripts/check-supply-chain-contract.mjs",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CI must begin with checkout, setup-node")));
}));

test("CI runs the focused build identity tests exactly once between runtime and supply tests", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  const focused = "      - run: node --test scripts/check-build-output-identity.test.mjs scripts/run-vite-build.test.mjs";
  const missing = original.replace(`${focused}\n`, "");
  writeFileSync(path, missing);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("focused build identity test command")));

  const reordered = original.replace(
    `${focused}\n      - run: node --test scripts/check-supply-chain-contract.test.mjs`,
    `      - run: node --test scripts/check-supply-chain-contract.test.mjs\n${focused}`,
  );
  writeFileSync(path, reordered);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("focused build identity tests are out of order")));
}));

test("Deno function gates bypass the task runner in fresh npm installs", () => withFixture((root) => {
  const path = join(root, "package.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.scripts["lint:functions"] = "deno task lint:functions";
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("Deno function lint script")));

  value.scripts["lint:functions"] = "deno lint supabase/functions";
  value.scripts["check:functions"] = "deno task check:functions";
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const checkErrors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(checkErrors.some((error) => error.includes("Deno function check script")));

  value.scripts["check:functions"] = "deno check supabase/functions/*/index.ts";
  value.scripts["test:functions"] = "deno task test:functions";
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const testErrors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(testErrors.some((error) => error.includes("Deno function test script")));
}));

test("CI must explicitly bootstrap the pinned Deno package after lifecycle suppression", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("      - run: npm rebuild --ignore-scripts=false deno\n", ""));
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("CI Deno bootstrap command")));
}));

test("coordinated declaration edits cannot split the Node matrix", () => withFixture((root) => {
  const contractPath = join(root, "docs/operations/runtime-contract.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.node.root_engine = "22.x";
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const packagePath = join(root, "package.json");
  const packageValue = JSON.parse(readFileSync(packagePath, "utf8"));
  packageValue.engines.node = "22.x";
  writeFileSync(packagePath, `${JSON.stringify(packageValue, null, 2)}\n`);
  const lockPath = join(root, "package-lock.json");
  const lockValue = JSON.parse(readFileSync(lockPath, "utf8"));
  lockValue.packages[""].engines.node = "22.x";
  writeFileSync(lockPath, `${JSON.stringify(lockValue, null, 2)}\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("root/deployment Node invariant")));
}));

test("Deno lock integrity for current CDN clients is frozen", () => withFixture((root) => {
  const path = join(root, "deno.lock");
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.remote["https://esm.sh/@supabase/supabase-js@2.39.7"] = "0".repeat(64);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Deno lock integrity")));
}));

test("runtime checks must remain in the named blocking CI job", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const value = readFileSync(path, "utf8").replace(
    "  lint-build:\n    runs-on: ubuntu-latest",
    "  lint-build:\n    if: false\n    continue-on-error: true\n    runs-on: ubuntu-latest",
  );
  writeFileSync(path, value);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("can be skipped or ignored")));
}));

test("workflow and job default shells cannot turn runtime gates into no-ops", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, `defaults:\n  run:\n    shell: true {0}\n${original}`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("workflow-level defaults")));

  writeFileSync(path, original.replace(
    "  lint-build:\n    runs-on: ubuntu-latest",
    "  lint-build:\n    defaults:\n      run:\n        shell: true {0}\n    runs-on: ubuntu-latest",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("can be skipped or ignored")));
}));

test("quoted YAML keys cannot hide workflow or job defaults", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, `"defaults": { run: { shell: "true {0}" } }\n${original}`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("quoted YAML mapping keys")));

  writeFileSync(path, original.replace(
    "  lint-build:\n    runs-on: ubuntu-latest",
    "  lint-build:\n    'defaults': { run: { shell: 'true {0}' } }\n    runs-on: ubuntu-latest",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("quoted YAML mapping keys")));
}));

test("the canonical workflow hash rejects every alternate YAML spelling", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  for (const prefix of [
    "defaults : { run: { shell: true {0} } }\n",
    "? defaults\n: { run: { shell: true {0} } }\n",
  ]) {
    writeFileSync(path, `${prefix}${original}`);
    assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("canonical CI workflow hash")));
  }
}));

test("required runtime steps cannot override shell or working directory", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const value = readFileSync(path, "utf8").replace(
    "      - run: node scripts/check-runtime-contract.mjs",
    "      - run: node scripts/check-runtime-contract.mjs\n        shell: echo {0}\n        working-directory: /tmp",
  );
  writeFileSync(path, value);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("must be bare commands")));
}));

test("no step can be inserted before the runtime gate prefix", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const value = readFileSync(path, "utf8").replace(
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "      - run: echo fake-npm >> $GITHUB_PATH\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  );
  writeFileSync(path, value);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("must begin with checkout")));
}));

test("checkout and setup-node cannot be redirected or extended", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n        with:\n          repository: attacker/replacement",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("must begin with checkout")));

  writeFileSync(path, original.replace(
    "          cache: 'npm'",
    "          cache: 'npm'\n          registry-url: https://attacker.invalid",
  ));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("must begin with checkout")));

  writeFileSync(path, original.replace("        with:\n          node-version: '24'", "        env:\n          node-version: '24'"));
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("must begin with checkout")));
}));

test("YAML indirection cannot inject hidden CI defaults", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  writeFileSync(path, `x-defaults: &hidden\n  defaults:\n    run:\n      shell: true {0}\n${readFileSync(path, "utf8").replace("    runs-on: ubuntu-latest", "    <<: *hidden\n    runs-on: ubuntu-latest")}`);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("YAML anchors")));
}));

test("individual runtime CI steps cannot be conditional or non-blocking", () => withFixture((root) => {
  const path = join(root, ".github/workflows/ci.yml");
  const value = readFileSync(path, "utf8").replace(
    "      - run: node scripts/check-runtime-contract.mjs",
    "      - run: node scripts/check-runtime-contract.mjs\n        if: false\n        continue-on-error: true",
  );
  writeFileSync(path, value);
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("can be skipped or ignored")));
}));

test("TypeScript import-equals and createRequire surfaces cannot evade Edge inventory", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/import-equals.ts");
  writeFileSync(path, 'import sb = require("https://esm.sh/@supabase/supabase-js@9.9.9");\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("Edge Supabase import inventory")));

  writeFileSync(path, 'import { createRequire as hidden } from "node:module";\nconst req = hidden(import.meta.url);\nreq("https://esm.sh/@supabase/supabase-js@9.9.9");\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("createRequire aliases")));
}));

test("CommonJS module.require and require aliases cannot evade Edge inventory", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/commonjs-bypass.cjs");
  writeFileSync(path, 'module.require("https://esm.sh/@supabase/supabase-js@9.9.9");\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CommonJS")));

  writeFileSync(path, 'const hidden = require;\nhidden("https://esm.sh/@supabase/supabase-js@9.9.9");\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("CommonJS")));
}));

test("syntax errors fail the Edge module inventory closed", () => withFixture((root) => {
  const path = join(root, "supabase/functions/admin-actions/broken.ts");
  writeFileSync(path, 'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";\nconst broken = ;\n');
  assert.ok(validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors.some((error) => error.includes("cannot parse")));
}));

test("npm and Deno Supabase lock integrity is frozen", () => withFixture((root) => {
  const rootLockPath = join(root, "package-lock.json");
  const rootLock = JSON.parse(readFileSync(rootLockPath, "utf8"));
  rootLock.packages["node_modules/@supabase/supabase-js"].integrity = "sha512-tampered";
  writeFileSync(rootLockPath, `${JSON.stringify(rootLock, null, 2)}\n`);
  const denoLockPath = join(root, "deno.lock");
  const denoLock = JSON.parse(readFileSync(denoLockPath, "utf8"));
  denoLock.npm["@supabase/supabase-js@2.105.4"].integrity = "sha512-tampered";
  writeFileSync(denoLockPath, `${JSON.stringify(denoLock, null, 2)}\n`);
  const errors = validateRuntimeContract({ root, actualNodeVersion: "20.19.0" }).errors;
  assert.ok(errors.some((error) => error.includes("root Supabase lock integrity")));
  assert.ok(errors.some((error) => error.includes("Deno Supabase npm integrity")));
}));

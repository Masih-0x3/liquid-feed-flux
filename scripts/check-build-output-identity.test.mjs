import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { PRODUCTION_SUPABASE_PROJECT_REF } from "./preview-identity.mjs";
import { validateBuildOutputIdentity } from "./check-build-output-identity.mjs";

const CHECKER = join(process.cwd(), "scripts", "check-build-output-identity.mjs");
const EXPECTED = "abcdefghijklmnopqrst";
const PATH = process.env.PATH ?? "/usr/bin:/bin";

function fixture() {
  return mkdtempSync(join(tmpdir(), "xot-build-output-"));
}

function writeBundle(directory, text) {
  mkdirSync(join(directory, "assets"), { recursive: true });
  writeFileSync(join(directory, "index.html"), "<!doctype html><script type=module src=/assets/app.js></script>");
  writeFileSync(join(directory, "assets", "app.js"), text);
}

test("isolated synthetic output passes and reports only masked identity", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const supabase = "https://${EXPECTED}.supabase.co";`);
    const result = validateBuildOutputIdentity(directory, EXPECTED);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.filesScanned, 2);
    assert.match(result.expectedProject, /…/);
    assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrst/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production identity in a mixed output is rejected even when Preview identity is present", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const preview = "${EXPECTED}"; const stale = "${PRODUCTION_SUPABASE_PROJECT_REF}";`);
    const result = validateBuildOutputIdentity(directory, EXPECTED);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /production project identity/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("output without the expected Preview identity is rejected", () => {
  const directory = fixture();
  try {
    writeBundle(directory, "const unrelated = true;");
    const result = validateBuildOutputIdentity(directory, EXPECTED);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /expected Preview project identity/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing, empty, and production expected refs fail closed", () => {
  for (const expected of ["", undefined, PRODUCTION_SUPABASE_PROJECT_REF]) {
    const directory = fixture();
    try {
      writeBundle(directory, "const unrelated = true;");
      const result = validateBuildOutputIdentity(directory, expected);
      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /expected Preview project ref is missing or invalid/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the CLI skips only when no output directory is explicitly selected", () => {
  const result = spawnSync(process.execPath, [CHECKER], {
    cwd: process.cwd(),
    env: { PATH },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /BUILD_OUTPUT_IDENTITY_SKIPPED/);
});

test("the CLI scans only the caller-supplied output directory", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const preview = "${EXPECTED}";`);
    const result = spawnSync(process.execPath, [CHECKER, "--output-dir", directory], {
      cwd: process.cwd(),
      env: { PATH, VITE_SUPABASE_PROJECT_ID: EXPECTED },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /BUILD_OUTPUT_IDENTITY_PASS/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /abcdefghijklmnopqrst/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the prebuild contract never scans stale output selected by the environment", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const preview = "${EXPECTED}";`);
    assert.equal(validateBuildOutputIdentity(directory, EXPECTED).ok, true);
    const prebuildSource = readFileSync(join(process.cwd(), "scripts", "check-build-contract.mjs"), "utf8");
    assert.doesNotMatch(prebuildSource, /check-build-output-identity\.mjs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the build lifecycle owns the post-build identity scan with an explicit dist directory", () => {
  const packageValue = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(packageValue.scripts?.build, "node scripts/run-vite-build.mjs");
  assert.equal(packageValue.scripts?.postbuild, undefined);
});

test("mutation probes exercise both production and expected-ref output guards", async () => {
  const root = fixture();
  const moduleRoot = join(root, "module");
  mkdirSync(moduleRoot);
  try {
    const source = readFileSync(CHECKER, "utf8");
    copyFileSync(join(process.cwd(), "scripts", "preview-identity.mjs"), join(moduleRoot, "preview-identity.mjs"));
    const output = join(root, "output");
    mkdirSync(output);
    writeFileSync(join(output, "app.js"), `const preview = "${EXPECTED}"; const stale = "${PRODUCTION_SUPABASE_PROJECT_REF}";`);

    const productionAnchor = "if (bytes.includes(PRODUCTION_REF_BYTES)) {";
    assert.ok(source.includes(productionAnchor));
    const productionMutant = join(moduleRoot, "production-mutant.mjs");
    writeFileSync(productionMutant, source.replace(productionAnchor, "if (false) {"));
    const productionModule = await import(`${pathToFileURL(productionMutant).href}?mutation=production`);
    assert.equal(productionModule.validateBuildOutputIdentity(output, EXPECTED).ok, true);

    const expectedAnchor = "if (PROJECT_REF_RE.test(expectedRef) && expectedRef !== PRODUCTION_SUPABASE_PROJECT_REF && !expectedFound) {";
    assert.ok(source.includes(expectedAnchor));
    const expectedMutant = join(moduleRoot, "expected-mutant.mjs");
    writeFileSync(expectedMutant, source.replace(expectedAnchor, "if (false) {"));
    const expectedModule = await import(`${pathToFileURL(expectedMutant).href}?mutation=expected`);
    const expectedOnly = join(root, "expected-only");
    mkdirSync(expectedOnly);
    writeFileSync(join(expectedOnly, "app.js"), "const unrelated = true;");
    assert.equal(validateBuildOutputIdentity(expectedOnly, EXPECTED).ok, false);
    assert.equal(expectedModule.validateBuildOutputIdentity(expectedOnly, EXPECTED).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

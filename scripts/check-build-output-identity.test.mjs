import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { PRODUCTION_SUPABASE_PROJECT_REF } from "./preview-identity.mjs";
import {
  BUILD_TARGETS,
  selectBuildTarget,
  selectExpectedProjectRef,
  validateBuildOutputIdentity,
} from "./check-build-output-identity.mjs";

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
    const result = validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW);
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
    const result = validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW);
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
    const result = validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW);
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
      const result = validateBuildOutputIdentity(directory, expected, BUILD_TARGETS.PREVIEW);
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
      env: { PATH, XOT_ENVIRONMENT: "preview", VITE_SUPABASE_PROJECT_ID: EXPECTED },
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
    assert.equal(validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW).ok, true);
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

test("mutation probe exercises the expected-ref output guard", async () => {
  const root = fixture();
  const moduleRoot = join(root, "module");
  mkdirSync(moduleRoot);
  try {
    const source = readFileSync(CHECKER, "utf8");
    copyFileSync(join(process.cwd(), "scripts", "preview-identity.mjs"), join(moduleRoot, "preview-identity.mjs"));
    const output = join(root, "output");
    mkdirSync(output);
    const expectedAnchor = "if (PROJECT_REF_RE.test(expectedRef) && expectedRef !== PRODUCTION_SUPABASE_PROJECT_REF && !expectedFound) {";
    assert.ok(source.includes(expectedAnchor));
    const expectedMutant = join(moduleRoot, "expected-mutant.mjs");
    writeFileSync(expectedMutant, source.replace(expectedAnchor, "if (false) {"));
    const expectedModule = await import(`${pathToFileURL(expectedMutant).href}?mutation=expected`);
    const expectedOnly = join(root, "expected-only");
    mkdirSync(expectedOnly);
    writeFileSync(join(expectedOnly, "app.js"), "const unrelated = true;");
    assert.equal(validateBuildOutputIdentity(expectedOnly, EXPECTED, BUILD_TARGETS.PREVIEW).ok, false);
    assert.equal(expectedModule.validateBuildOutputIdentity(expectedOnly, EXPECTED, BUILD_TARGETS.PREVIEW).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mutation probe exercises the Production mixed-identity guard", async () => {
  const root = fixture();
  const moduleRoot = join(root, "module");
  mkdirSync(moduleRoot);
  try {
    const source = readFileSync(CHECKER, "utf8");
    copyFileSync(join(process.cwd(), "scripts", "preview-identity.mjs"), join(moduleRoot, "preview-identity.mjs"));
    const output = join(root, "output");
    mkdirSync(output);
    writeFileSync(join(output, "app.js"), `const production = "https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co"; const preview = "https://${EXPECTED}.supabase.co";`);
    const productionAnchor = `if ([...observedRefs].some((ref) => ref !== PRODUCTION_SUPABASE_PROJECT_REF)) {
      errors.push("buildOutput: a non-production Supabase project identity was found in Production output");`;
    assert.ok(source.includes(productionAnchor));
    const productionMutant = join(moduleRoot, "production-mutant.mjs");
    writeFileSync(productionMutant, source.replace(productionAnchor, `if (false) {
      errors.push("buildOutput: a non-production Supabase project identity was found in Production output");`));
    const productionModule = await import(`${pathToFileURL(productionMutant).href}?mutation=production`);
    assert.equal(validateBuildOutputIdentity(output, PRODUCTION_SUPABASE_PROJECT_REF, BUILD_TARGETS.PRODUCTION).ok, false);
    assert.equal(productionModule.validateBuildOutputIdentity(output, PRODUCTION_SUPABASE_PROJECT_REF, BUILD_TARGETS.PRODUCTION).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing, malformed, and ambiguous target selection fails closed", () => {
  assert.throws(() => selectBuildTarget({}), /explicit Preview or Production target/);
  assert.equal(selectBuildTarget({ VITE_SUPABASE_PROJECT_ID: EXPECTED }), BUILD_TARGETS.PREVIEW);
  assert.throws(
    () => selectBuildTarget({ VITE_SUPABASE_PROJECT_ID: PRODUCTION_SUPABASE_PROJECT_REF }),
    /explicit Preview or Production target/,
  );
  assert.throws(() => selectBuildTarget({ XOT_ENVIRONMENT: "staging" }), /selected build target is invalid/);
  assert.throws(
    () => selectBuildTarget({ XOT_ENVIRONMENT: "preview", VERCEL_ENV: "production" }),
    /conflicting Preview and Production targets/,
  );
  assert.throws(
    () => selectExpectedProjectRef({ XOT_ENVIRONMENT: "preview" }, BUILD_TARGETS.PREVIEW),
    /expected Preview project ref is missing or invalid/,
  );
  assert.throws(
    () => selectExpectedProjectRef({ XOT_ENVIRONMENT: "preview", VITE_SUPABASE_PROJECT_ID: EXPECTED, XOT_EXPECTED_PREVIEW_PROJECT_REF: "zyxwvutsrqponmlkjihg" }, BUILD_TARGETS.PREVIEW),
    /conflicting expected Supabase project refs/,
  );
});

test("the validator fails closed when target selection is missing or invalid", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const preview = "${EXPECTED}";`);
    for (const target of [undefined, "", "staging"]) {
      const result = validateBuildOutputIdentity(directory, EXPECTED, target);
      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /explicit Preview or Production target/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit Production output accepts only the masked production identity", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const supabase = "https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co";`);
    const result = validateBuildOutputIdentity(directory, PRODUCTION_SUPABASE_PROJECT_REF, BUILD_TARGETS.PRODUCTION);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.target, BUILD_TARGETS.PRODUCTION);
    assert.match(result.expectedProject, /…/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit Production output rejects missing, Preview, and other project identities", () => {
  for (const contents of [
    "const unrelated = true;",
    `const preview = "${EXPECTED}";`,
    `const production = "https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co"; const preview = "https://${EXPECTED}.supabase.co";`,
    `const other = "https://zyxwvutsrqponmlkjihg.supabase.co";`,
  ]) {
    const directory = fixture();
    try {
      writeBundle(directory, contents);
      const result = validateBuildOutputIdentity(directory, PRODUCTION_SUPABASE_PROJECT_REF, BUILD_TARGETS.PRODUCTION);
      assert.equal(result.ok, false, contents);
      assert.doesNotMatch(result.errors.join("\n"), new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
      assert.doesNotMatch(result.errors.join("\n"), /abcdefghijklmnopqrst|zyxwvutsrqponmlkjihg/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("explicit Preview output rejects any second project identity", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const preview = "${EXPECTED}"; const other = "https://zyxwvutsrqponmlkjihg.supabase.co";`);
    const result = validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unexpected Supabase project identity/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary browser event tokens are not treated as Supabase identities", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const supabase = "https://${EXPECTED}.supabase.co"; window.onunhandledrejection = handler;`);
    const result = validateBuildOutputIdentity(directory, EXPECTED, BUILD_TARGETS.PREVIEW);
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the production CLI selects Production and masks identities", () => {
  const directory = fixture();
  try {
    writeBundle(directory, `const production = "${PRODUCTION_SUPABASE_PROJECT_REF}";`);
    const result = spawnSync(process.execPath, [CHECKER, "--output-dir", directory], {
      cwd: process.cwd(),
      env: { PATH, XOT_ENVIRONMENT: "production", VITE_SUPABASE_PROJECT_ID: PRODUCTION_SUPABASE_PROJECT_REF },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /BUILD_OUTPUT_IDENTITY_PASS/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

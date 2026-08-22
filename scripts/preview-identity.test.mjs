import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertPreviewIdentity,
  validatePreviewIdentity,
} from "./preview-identity.mjs";

const CHECKER = join(process.cwd(), "scripts", "preview-identity.mjs");
const PATH = process.env.PATH ?? "/usr/bin:/bin";
const VALID = Object.freeze({
  environment: "preview",
  supabaseProjectRef: "abcdefghijklmnopqrst",
  supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co/",
  previewBranch: "preview/e10-p2",
  vercelDeploymentTarget: "preview",
  previewOrigin: "https://preview.example.test/",
});

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function run(env, extra = {}) {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: process.cwd(),
    env: { PATH, ...env },
    encoding: "utf8",
    ...extra,
  });
}

test("valid synthetic Preview tuple passes and is summarized without raw identity", () => {
  const result = validatePreviewIdentity(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.identity.environment, "preview");
  assert.match(result.identity.supabaseProjectRef, /…/);
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrst/);
  assert.doesNotMatch(JSON.stringify(result), /preview\.example\.test/);
  assert.doesNotThrow(() => assertPreviewIdentity(VALID));
});

for (const field of [
  "environment",
  "supabaseProjectRef",
  "supabaseUrl",
  "previewBranch",
  "vercelDeploymentTarget",
  "previewOrigin",
]) {
  test(`missing ${field} fails closed`, () => {
    const candidate = { ...VALID };
    delete candidate[field];
    const result = validatePreviewIdentity(candidate);
    assert.equal(result.ok, false);
    const expectedField = field === "supabaseUrl" ? "supabaseUrlHost" : field;
    assert.ok(result.errorCodes.some((code) => code.startsWith(`${expectedField}.`)));
  });
}

for (const [label, candidate] of [
  ["production ref", { ...VALID, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF, supabaseUrl: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/` }],
  ["production target", { ...VALID, vercelDeploymentTarget: "production" }],
  ["production environment", { ...VALID, environment: "production" }],
  ["production branch", { ...VALID, previewBranch: "main" }],
  ["URL/ref mismatch", { ...VALID, supabaseUrl: "https://zyxwvutsrqponmlkjihg.supabase.co/" }],
  ["URL host with path", { ...VALID, supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co/rest/v1" }],
  ["invalid origin", { ...VALID, previewOrigin: "http://preview.example.test/" }],
  ["production origin", { ...VALID, previewOrigin: "https://xot.iraneyes.com/" }],
  ["production origin trailing dot", { ...VALID, previewOrigin: "https://xot.iraneyes.com./" }],
  ["production origin encoded dot", { ...VALID, previewOrigin: "https://xot.iraneyes.com%2e/" }],
  ["production Vercel origin trailing dot", { ...VALID, previewOrigin: "https://xot.vercel.app." }],
  ["production Vercel origin encoded dot", { ...VALID, previewOrigin: "https://xot.vercel.app%2e/" }],
  ["production origin uppercase and whitespace", { ...VALID, previewOrigin: "  HTTPS://XOT.IRANEYES.COM./  " }],
  ["production origin default HTTPS port", { ...VALID, previewOrigin: "https://xot.iraneyes.com:443/" }],
  ["production origin path", { ...VALID, previewOrigin: "https://xot.iraneyes.com/path" }],
  ["production origin query", { ...VALID, previewOrigin: "https://xot.iraneyes.com/?x=1" }],
  ["production origin fragment", { ...VALID, previewOrigin: "https://xot.iraneyes.com/#fragment" }],
]) {
  test(`${label} fails closed`, () => assert.equal(validatePreviewIdentity(candidate).ok, false));
}

test("a production-looking subdomain is not overblocked", () => {
  assert.equal(validatePreviewIdentity({
    ...VALID,
    previewOrigin: "https://xot.iraneyes.com.attacker.example/",
  }).ok, true);
});

test("URL host supplied separately is accepted only when it matches the URL and ref", () => {
  const result = validatePreviewIdentity({ ...VALID, supabaseUrlHost: "abcdefghijklmnopqrst.supabase.co" });
  assert.equal(result.ok, true);
  assert.equal(validatePreviewIdentity({ ...VALID, supabaseUrlHost: "zyxwvutsrqponmlkjihg.supabase.co" }).ok, false);
});

test("conflicting identity aliases fail closed instead of selecting one value", () => {
  assert.equal(validatePreviewIdentity({
    ...VALID,
    XOT_ENVIRONMENT: "production",
  }).ok, false);
  assert.equal(validatePreviewIdentity({
    ...VALID,
    SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
  }).ok, false);
  assert.equal(validatePreviewIdentity({
    ...VALID,
    VERCEL_ENV: "production",
  }).ok, false);
});

test("secret-like and credential-like input is never echoed", () => {
  const sentinel = "Bearer super-secret-token-value-7f2a";
  const result = validatePreviewIdentity({
    ...VALID,
    supabaseUrl: `https://${sentinel}.supabase.co/`,
    previewOrigin: `https://preview.example.test/${sentinel}`,
  });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.throws(() => assertPreviewIdentity({ ...VALID, environment: sentinel }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
});

test("CLI accepts a valid synthetic tuple and emits only masked identity", () => {
  const result = run({
    XOT_ENVIRONMENT: VALID.environment,
    SUPABASE_PROJECT_REF: VALID.supabaseProjectRef,
    SUPABASE_URL: VALID.supabaseUrl,
    XOT_PREVIEW_BRANCH: VALID.previewBranch,
    VERCEL_DEPLOYMENT_TARGET: VALID.vercelDeploymentTarget,
    XOT_PREVIEW_ORIGIN: VALID.previewOrigin,
  });
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /PREVIEW_IDENTITY_PASS/);
  assert.doesNotMatch(output(result), /abcdefghijklmnopqrst|preview\.example\.test/);
});

test("CLI rejects production and does not echo the production ref", () => {
  const result = run({
    XOT_ENVIRONMENT: "preview",
    SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/`,
    XOT_PREVIEW_BRANCH: "preview/e10-p2",
    VERCEL_DEPLOYMENT_TARGET: "production",
    XOT_PREVIEW_ORIGIN: "https://xot.iraneyes.com/",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Preview identity rejected|must not identify production/);
  assert.doesNotMatch(output(result), new RegExp(PRODUCTION_SUPABASE_PROJECT_REF));
});

test("CLI mutation mode runs adversarial guard probes", () => {
  const result = run({
    XOT_ENVIRONMENT: VALID.environment,
    SUPABASE_PROJECT_REF: VALID.supabaseProjectRef,
    SUPABASE_URL: VALID.supabaseUrl,
    XOT_PREVIEW_BRANCH: VALID.previewBranch,
    VERCEL_DEPLOYMENT_TARGET: VALID.vercelDeploymentTarget,
    XOT_PREVIEW_ORIGIN: VALID.previewOrigin,
    MUTATION_TEST: "1",
  });
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /selfTest=pass cases=13/);
});

test("removing each primary guard remains rejected by the adversarial suite", async () => {
  const source = readFileSync(CHECKER, "utf8");
  const cases = [
    ["environment", 'if (identity.environment !== PREVIEW_ENVIRONMENT) {', { ...VALID, environment: "production" }],
    ["production ref", 'else if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {', { ...VALID, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF, supabaseUrl: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/` }],
    ["deployment target", 'if (identity.vercelDeploymentTarget !== PREVIEW_DEPLOYMENT_TARGET) {', { ...VALID, vercelDeploymentTarget: "production" }],
    ["origin", 'if (requireOrigin && !identity.previewOrigin) {', { ...VALID, previewOrigin: undefined }],
  ];
  const root = mkdtempSync(join(tmpdir(), "xot-preview-identity-"));
  try {
    for (const [label, needle, candidate] of cases) {
      assert.ok(source.includes(needle), `${label} mutation anchor missing`);
      const mutated = source.replace(needle, needle.startsWith("else if") ? "else if (false) {" : "if (false) {");
      const path = join(root, `${basename(CHECKER, ".mjs")}-${label}.mjs`);
      writeFileSync(path, mutated);
      const module = await import(`${pathToFileURL(path).href}?mutation=${label}`);
      assert.equal(module.validatePreviewIdentity(candidate).ok, true, `${label} mutation was not exercised`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

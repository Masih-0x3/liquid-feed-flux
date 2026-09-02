import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const ROOT = process.cwd();
const WRAPPER = join(ROOT, "scripts", "deploy-functions.sh");
const PRODUCTION_REF = "jzirqfzzvlbxwfzndaer";
const CURRENT_BRANCH = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const NODE_DIR = dirname(process.execPath);
const PATH_PREFIX = `${NODE_DIR}:/usr/local/bin:/usr/bin:/bin`;

const VALID = Object.freeze({
  XOT_ENVIRONMENT: "preview",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
  XOT_PREVIEW_BRANCH: CURRENT_BRANCH,
  VERCEL_DEPLOYMENT_TARGET: "preview",
  XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
});

function setupFakeNpx() {
  const root = mkdtempSync(join(tmpdir(), "xot-deploy-functions-"));
  const bin = join(root, "bin");
  const log = join(root, "npx.log");
  mkdirSync(bin);
  const fake = join(bin, "npx");
  writeFileSync(fake, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$FAKE_NPX_LOG\"\n");
  chmodSync(fake, 0o755);
  return { root, log, env: { FAKE_NPX_LOG: log, PATH: `${bin}:${PATH_PREFIX}` } };
}

function baseEnv(extra = {}) {
  return {
    PATH: PATH_PREFIX,
    DEPLOY_ALLOW_DIRTY: "1",
    DEPLOY_FUNCTIONS_DRY_RUN: "1",
    ...VALID,
    ...extra,
  };
}

function run(extra = {}, options = {}) {
  const fake = setupFakeNpx();
  try {
    const result = spawnSync("/bin/bash", [WRAPPER, "admin-actions"], {
      cwd: options.cwd ?? ROOT,
      env: { ...baseEnv(extra), ...fake.env, ...(options.env ?? {}) },
      encoding: "utf8",
    });
    return { ...result, output: `${result.stdout}\n${result.stderr}`, fake };
  } catch (error) {
    rmSync(fake.root, { recursive: true, force: true });
    throw error;
  }
}

function fakeCalls(fake) {
  return existsSync(fake.log) ? readFileSync(fake.log, "utf8").trim().split("\n").filter(Boolean) : [];
}

test("valid synthetic Preview tuple reaches dry-run and never invokes npx", () => {
  const result = run();
  try {
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /Dry run complete/);
    assert.match(result.stdout, /masked-preview-ref/);
    assert.doesNotMatch(result.output, /abcdefghijklmnopqrst|preview\.example\.test/);
    assert.deepEqual(fakeCalls(result.fake), []);
  } finally {
    rmSync(result.fake.root, { recursive: true, force: true });
  }
});

for (const [label, candidate] of [
  ["missing environment", { XOT_ENVIRONMENT: undefined }],
  ["missing project ref", { SUPABASE_PROJECT_REF: undefined }],
  ["missing URL", { SUPABASE_URL: undefined }],
  ["missing branch", { XOT_PREVIEW_BRANCH: undefined }],
  ["missing deployment target", { VERCEL_DEPLOYMENT_TARGET: undefined }],
  ["missing origin", { XOT_PREVIEW_ORIGIN: undefined }],
  ["production ref", { SUPABASE_PROJECT_REF: PRODUCTION_REF, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co/` }],
  ["production target", { VERCEL_DEPLOYMENT_TARGET: "production" }],
  ["URL/ref mismatch", { SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co/" }],
  ["wrong branch", { XOT_PREVIEW_BRANCH: `${CURRENT_BRANCH}-wrong` }],
  ["conflicting aliases", { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", VITE_SUPABASE_PROJECT_ID: PRODUCTION_REF }],
]) {
  test(`${label} fails before fake npx invocation`, () => {
    const result = run(candidate);
    try {
      assert.notEqual(result.status, 0, result.output);
      assert.deepEqual(fakeCalls(result.fake), []);
    } finally {
      rmSync(result.fake.root, { recursive: true, force: true });
    }
  });
}

test("detached HEAD fails before fake npx invocation", () => {
  const fixture = mkdtempSync(join(tmpdir(), "xot-detached-preview-"));
  const fake = setupFakeNpx();
  try {
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "supabase", "functions", "admin-actions"), { recursive: true });
    cpSync(join(ROOT, "supabase", "config.toml"), join(fixture, "supabase", "config.toml"));
    cpSync(join(ROOT, "supabase", "functions", "admin-actions", "index.ts"), join(fixture, "supabase", "functions", "admin-actions", "index.ts"));
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    execFileSync("git", ["add", "."], { cwd: fixture });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture"], { cwd: fixture });
    execFileSync("git", ["checkout", "--detach", "-q", "HEAD"], { cwd: fixture });
    const result = spawnSync("/bin/bash", [WRAPPER, "admin-actions"], {
      cwd: fixture,
      env: { ...baseEnv({ XOT_PREVIEW_BRANCH: "preview/detached-test" }), ...fake.env },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /detached HEAD/);
    assert.deepEqual(fakeCalls(fake), []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("dry-run cannot fall through even when fake npx would succeed", () => {
  const result = run({ DEPLOY_FUNCTIONS_DRY_RUN: "1" });
  try {
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(fakeCalls(result.fake), []);
    assert.match(result.stdout, /No CLI command/);
  } finally {
    rmSync(result.fake.root, { recursive: true, force: true });
  }
});

test("a guard-order mutation is observable because preflight must precede npx", () => {
  const fixture = mkdtempSync(join(tmpdir(), "xot-guard-order-"));
  const fake = setupFakeNpx();
  try {
    const scriptDir = join(fixture, "scripts");
    mkdirSync(scriptDir, { recursive: true });
    mkdirSync(join(fixture, "supabase", "functions", "admin-actions"), { recursive: true });
    let mutated = readFileSync(WRAPPER, "utf8");
    const anchor = 'if ! IDENTITY_PAYLOAD="$({';
    assert.ok(mutated.includes(anchor), "guard-order mutation anchor missing");
    mutated = mutated.replace(anchor, 'npx supabase functions deploy preguard\nif ! IDENTITY_PAYLOAD="$({');
    writeFileSync(join(scriptDir, "deploy-functions.sh"), mutated);
    chmodSync(join(scriptDir, "deploy-functions.sh"), 0o755);
    cpSync(join(ROOT, "scripts", "preview-identity.mjs"), join(scriptDir, "preview-identity.mjs"));
    cpSync(join(ROOT, "supabase", "config.toml"), join(fixture, "supabase", "config.toml"));
    cpSync(join(ROOT, "supabase", "functions", "admin-actions", "index.ts"), join(fixture, "supabase", "functions", "admin-actions", "index.ts"));
    execFileSync("git", ["init", "-q", "-b", CURRENT_BRANCH], { cwd: fixture });
    execFileSync("git", ["add", "."], { cwd: fixture });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture"], { cwd: fixture });
    const result = spawnSync("/bin/bash", [join(scriptDir, "deploy-functions.sh"), "admin-actions"], {
      cwd: fixture,
      env: { ...baseEnv(), ...fake.env },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(fakeCalls(fake), ["supabase functions deploy preguard"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("identity rejection does not echo secret-like values", () => {
  const sentinel = "super-secret-preview-token-7f2a";
  const result = run({
    SUPABASE_PROJECT_REF: sentinel,
    SUPABASE_URL: `https://${sentinel}.supabase.co/`,
  });
  try {
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.output, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(fakeCalls(result.fake), []);
  } finally {
    rmSync(result.fake.root, { recursive: true, force: true });
  }
});

test("dirty worktree is rejected unless explicitly overridden", () => {
  const result = run({}, { env: { DEPLOY_ALLOW_DIRTY: "0" } });
  try {
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /dirty working tree/);
    assert.deepEqual(fakeCalls(result.fake), []);
  } finally {
    rmSync(result.fake.root, { recursive: true, force: true });
  }
});

test("production ref is absent from config and wrapper source has no default target", () => {
  const config = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
  const source = readFileSync(WRAPPER, "utf8");
  assert.doesNotMatch(config, new RegExp(PRODUCTION_REF));
  assert.doesNotMatch(source, /SUPABASE_PROJECT_REF:-jzirqfzzvlbxwfzndaer/);
  assert.match(source, /--project-ref/);
});

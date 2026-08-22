import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKER = join(REPO_ROOT, "scripts/check-vite-env.mjs");
const PATH = process.env.PATH ?? "/usr/bin:/bin";

const required = {
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.synthetic-public-payload.synthetic-signature",
  VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
};

const productionRequired = {
  VITE_SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: required.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_PROJECT_ID: "jzirqfzzvlbxwfzndaer",
};

const sentry = {
  VITE_SENTRY_DSN: "https://publickey123@synthetic.ingest.sentry.io/12345",
  VITE_SENTRY_ENVIRONMENT: "production",
  VITE_SENTRY_TRACES_SAMPLE_RATE: "0.1",
  VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: "0",
  VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE: "1",
};

const previewIdentity = {
  XOT_ENVIRONMENT: "preview",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
  XOT_PREVIEW_BRANCH: "preview/e10-p2",
  VERCEL_DEPLOYMENT_TARGET: "preview",
  XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
};

function run(env = {}, options = {}) {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: REPO_ROOT,
    env: { PATH, ...env },
    encoding: "utf8",
    ...options,
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("missing build-critical public Supabase variables fail closed", () => {
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required frontend env/);
  assert.match(result.stderr, /VITE_SUPABASE_URL/);
  assert.match(result.stderr, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(result.stderr, /VITE_SUPABASE_PROJECT_ID/);
});

for (const [label, env] of [
  ["missing required", {}],
  ["unknown public name", { ...required, VITE_UNREVIEWED_PUBLIC_NAME: "synthetic" }],
  ["secret-like public name", { ...required, VITE_SERVICE_ROLE_KEY: "synthetic" }],
]) {
  test(`MUTATION_TEST still validates actual env: ${label}`, () => {
    const result = run({ ...env, MUTATION_TEST: "1" });
    assert.notEqual(result.status, 0, output(result));
    assert.doesNotMatch(output(result), /selfTest=pass/);
  });
}

test("the known public allowlist accepts required and optional public names", () => {
  const result = run({ ...required, ...sentry, VITE_FOGLAMP_HUD: "1" });
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /Frontend env contract OK/);
});

test("an explicit synthetic Preview tuple passes the Vite and identity contracts", () => {
  const result = run({ ...required, ...previewIdentity });
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /Frontend env contract OK/);
  assert.doesNotMatch(output(result), /abcdefghijklmnopqrst|preview\.example\.test/);
});

for (const [label, mutation] of [
  ["missing Preview environment", (() => { const value = { ...previewIdentity }; delete value.XOT_ENVIRONMENT; return value; })()],
  ["production Preview ref", { ...previewIdentity, SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer", SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/" }],
  ["mixed Preview and production target", { ...previewIdentity, VERCEL_ENV: "production" }],
  ["mismatched Preview URL", { ...previewIdentity, SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co/" }],
]) {
  test(`${label} fails through the Vite checker`, () => {
    const result = run({ ...required, ...mutation });
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /Preview identity/);
    assert.doesNotMatch(output(result), /jzirqfzzvlbxwfzndaer|preview\.example\.test/);
  });
}

test("explicit production mode accepts only the canonical public/server tuple", () => {
  const result = run({
    ...productionRequired,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
  });
  assert.equal(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /Preview identity/);
});

test("explicit production mode requires production observability aliases", () => {
  const rejected = run({
    ...productionRequired,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
    VITE_SENTRY_ENVIRONMENT: "preview",
    SENTRY_ENVIRONMENT: "preview",
  });
  assert.notEqual(rejected.status, 0, output(rejected));
  assert.match(output(rejected), /Observability environment/);

  const accepted = run({
    ...productionRequired,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
    VITE_SENTRY_ENVIRONMENT: "production",
    SENTRY_ENVIRONMENT: "production",
  });
  assert.equal(accepted.status, 0, output(accepted));
});

test("explicit production mode rejects mixed public and server Supabase identities", () => {
  const result = run({
    ...required,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
  });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /Production identity/);
  assert.doesNotMatch(output(result), /jzirqfzzvlbxwfzndaer|abcdefghijklmnopqrst/);
});

test("explicit production mode rejects conflicting server URL aliases", () => {
  const result = run({
    ...productionRequired,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
    SUPABASE_URL_HOST: "abcdefghijklmnopqrst.supabase.co",
  });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /Production identity/);
});

test("explicit production mode rejects conflicting production/staging mode aliases", () => {
  const result = run({
    ...productionRequired,
    XOT_ENVIRONMENT: "staging",
    VERCEL_ENV: "production",
  });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /Deployment mode/);
});

test("Preview rejects production Sentry environment and accepts matching aliases", () => {
  const rejected = run({
    ...required,
    ...previewIdentity,
    VITE_SENTRY_ENVIRONMENT: "production",
    SENTRY_ENVIRONMENT: "production",
  });
  assert.notEqual(rejected.status, 0, output(rejected));
  assert.match(output(rejected), /Observability environment/);

  const accepted = run({
    ...required,
    ...previewIdentity,
    VITE_SENTRY_ENVIRONMENT: "preview",
    SENTRY_ENVIRONMENT: "preview",
  });
  assert.equal(accepted.status, 0, output(accepted));
});

test("Preview rejects conflicting client/server observability aliases", () => {
  const result = run({
    ...required,
    ...previewIdentity,
    VITE_SENTRY_ENVIRONMENT: "preview",
    SENTRY_ENVIRONMENT: "staging",
  });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /Observability environment/);
});

test("bounded synthetic public env accepts MUTATION_TEST after actual validation", () => {
  const result = run({ ...required, ...sentry, VITE_FOGLAMP_HUD: "1", MUTATION_TEST: "1" });
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /selfTest=pass/);
});

test("unknown public Vite names are rejected", () => {
  const sentinel = "synthetic-unknown-value-7f2a";
  const result = run({ ...required, VITE_UNREVIEWED_PUBLIC_NAME: sentinel });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown public Vite env/);
  assert.match(result.stderr, /VITE_UNREVIEWED_PUBLIC_NAME/);
  assert.doesNotMatch(output(result), new RegExp(sentinel));
});

for (const name of [
  "VITE_CLIENT_SECRET",
  "VITE_ACCESS_TOKEN",
  "VITE_PASSWORD",
  "VITE_PRIVATE_KEY",
  "VITE_SERVICE_ROLE_KEY",
  "VITE_SIGNING_SECRET",
  "VITE_ADMIN_API_KEY",
]) {
  test(`secret-like public name ${name} is rejected`, () => {
    const result = run({ ...required, [name]: "synthetic-public-looking-value" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /secret-like public Vite env/i);
    assert.match(result.stderr, new RegExp(name));
  });
}

const malformed = [
  ["VITE_SUPABASE_URL", "http://abcdefghijklmnopqrst.supabase.co"],
  ["VITE_SUPABASE_URL", "https://not-supabase.example.invalid"],
  ["VITE_SUPABASE_PROJECT_ID", "not-a-project-ref"],
  ["VITE_SUPABASE_PUBLISHABLE_KEY", "not-a-public-key"],
  ["VITE_SENTRY_DSN", "https://secret@example.invalid/123"],
  ["VITE_SENTRY_ENVIRONMENT", "environment with spaces"],
  ["VITE_SENTRY_TRACES_SAMPLE_RATE", "1.1"],
  ["VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE", "-0.1"],
  ["VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE", "2"],
  ["VITE_FOGLAMP_HUD", "enabled"],
];

for (const [name, value] of malformed) {
  test(`malformed public value for ${name} is rejected without echoing it`, () => {
    const result = run({ ...required, [name]: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid frontend env/);
    assert.match(result.stderr, new RegExp(name));
    assert.doesNotMatch(output(result), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("a 100000-character public value fails closed without echoing the value", () => {
  const value = "x".repeat(100000);
  const result = run({ ...required, VITE_SENTRY_ENVIRONMENT: value });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid frontend env/);
  assert.doesNotMatch(output(result), /x{1000}/);
});

test("publishable JWT segments have explicit maximum lengths", () => {
  const segmentAtLimit = "a".repeat(2045);
  const segmentOverLimit = "a".repeat(2046);
  const atLimit = run({ ...required, VITE_SUPABASE_PUBLISHABLE_KEY: `eyJ${segmentAtLimit}.payload.signature` });
  const overLimit = run({ ...required, VITE_SUPABASE_PUBLISHABLE_KEY: `eyJ${segmentOverLimit}.payload.signature` });
  assert.equal(atLimit.status, 0, output(atLimit));
  assert.notEqual(overLimit.status, 0, output(overLimit));
  assert.doesNotMatch(output(overLimit), /a{1000}/);
});

test("Sentry DSN project IDs have explicit maximum lengths", () => {
  const atLimit = run({ ...required, VITE_SENTRY_DSN: "https://publickey123@synthetic.ingest.sentry.io/12345678901234567890" });
  const overLimit = run({ ...required, VITE_SENTRY_DSN: "https://publickey123@synthetic.ingest.sentry.io/123456789012345678901" });
  assert.equal(atLimit.status, 0, output(atLimit));
  assert.notEqual(overLimit.status, 0, output(overLimit));
});

test("a valid required-only environment succeeds without value disclosure", () => {
  const result = run(required);
  assert.equal(result.status, 0, output(result));
  for (const value of Object.values(required)) assert.doesNotMatch(output(result), new RegExp(value));
});

test("the checker does not load dotenv files or inherit unrelated Vite values", () => {
  const result = run({ ...required });
  assert.equal(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /\.env|VITE_SENTINEL/);
});

test("the checker mutation battery passes", () => {
  const result = run({ ...required, ...sentry, VITE_FOGLAMP_HUD: "1", MUTATION_TEST: "1" });
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /selfTest=pass/);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PREVIEW_CRON_POST_REPLAY_MARKER,
  PREVIEW_CRON_PRE_REPLAY_MARKER,
  PRODUCTION_EDGE_HOST,
  PRODUCTION_EDGE_URL_PREFIX,
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertPreviewCronIsolationContract,
  assertPreviewCronIsolationSql,
  buildPreviewCronIsolationSql,
  buildPreviewCronPostReplayGuardSql,
  buildPreviewCronPreReplayGateSql,
  findProductionTargetedCronSchedules,
  runPreviewCronIsolation,
} from "./preview-cron-isolation.mjs";

const root = join(import.meta.dirname, "..");

const validEnv = {
  XOT_ENVIRONMENT: "preview",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
  XOT_PREVIEW_BRANCH: "preview/cron-guard",
  VERCEL_DEPLOYMENT_TARGET: "preview",
  XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
};

test("historical source hazard is reproduced without rewriting migration files", () => {
  const findings = findProductionTargetedCronSchedules(root);
  assert.ok(findings.length >= 10);
  assert.ok(findings.some(({ name }) => name === "process-jobs"));
  assert.ok(findings.some(({ name }) => name === "x-poster-tick"));
  assert.ok(findings.every(({ filename }) => /^\d{14}_.+\.sql$/.test(filename)));
  assert.ok(findings.every(({ name }) => typeof name === "string" && name.length > 0));
});

test("pre-replay gate binds Preview identity, disables cron launch, and clears the queue", () => {
  const sql = buildPreviewCronPreReplayGateSql("abcdefghijklmnopqrst");
  assertPreviewCronIsolationSql(sql);
  assert.match(sql, new RegExp(PREVIEW_CRON_PRE_REPLAY_MARKER));
  assert.match(sql, /set_config\('app\.settings\.xot_environment', 'preview', false\)/);
  assert.match(sql, /set_config\('app\.settings\.supabase_url', 'https:\/\/abcdefghijklmnopqrst\.supabase\.co\/', false\)/);
  assert.match(sql, /target_environment <> 'preview'/);
  assert.match(sql, /configured_url <> expected_preview_url/);
  assert.match(sql, /ALTER DATABASE postgres SET cron\.launch_active_jobs = 'off'/);
  assert.match(sql, /cron\.alter_job\(scheduled_job\.jobid, active => false\)/);
  assert.match(sql, /to_regclass\('net\.http_request_queue'\) IS NOT NULL/);
  assert.match(sql, /DELETE FROM net\.http_request_queue/);
  assert.doesNotMatch(sql, /cron\.unschedule|DROP\s+JOB/i);
});

test("post-replay guard repeats identity verification and deactivates every schedule", () => {
  const sql = buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst");
  assertPreviewCronIsolationSql(sql);
  assert.match(sql, new RegExp(PREVIEW_CRON_POST_REPLAY_MARKER));
  assert.match(sql, /cron\.alter_job\(scheduled_job\.jobid, active => false\)/);
  assert.doesNotMatch(sql, /ALTER DATABASE postgres SET cron\.launch_active_jobs = 'off'/);
  assert.doesNotMatch(sql, /cron\.unschedule|DROP\s+JOB/i);
});

test("backward-compatible alias produces the post-replay guard", () => {
  const aliasSql = buildPreviewCronIsolationSql("abcdefghijklmnopqrst");
  const postSql = buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst");
  assert.equal(aliasSql, postSql);
  assert.match(aliasSql, new RegExp(PREVIEW_CRON_POST_REPLAY_MARKER));
});

test("production project cannot produce a Preview guard", () => {
  assert.throws(
    () => buildPreviewCronIsolationSql(PRODUCTION_SUPABASE_PROJECT_REF),
    /non-production.*project ref/,
  );
});

test("contract checker accepts the current source", () => {
  assert.ok(assertPreviewCronIsolationContract(root).length > 0);
});

test("guard mutation tests reject removal of target and active-state fences", () => {
  const source = readFileSync(join(root, "scripts/preview-cron-isolation.mjs"), "utf8");
  const guard = buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst");
  for (const mutation of [
    ["target guard", "target_environment <> 'preview'", "target_environment = 'preview'"],
    ["project guard", "configured_url <> expected_preview_url", "configured_url = expected_preview_url"],
    ["active fence", "active IS DISTINCT FROM false", "active = true"],
    ["deactivation", "active => false", "active => true"],
  ]) {
    const [, needle, replacement] = mutation;
    const mutated = guard.replace(needle, replacement);
    assert.throws(() => assertPreviewCronIsolationSql(mutated), /missing|activate|preserve|production|credentials/i, mutation[0]);
  }
  assert.match(source, new RegExp(PREVIEW_CRON_PRE_REPLAY_MARKER));
  assert.match(source, new RegExp(PREVIEW_CRON_POST_REPLAY_MARKER));
});

test("SQL assertion rejects production ref, credentials, and destructive operators", () => {
  const base = buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst");
  assert.throws(() => assertPreviewCronIsolationSql(base + `\n-- ${PRODUCTION_SUPABASE_PROJECT_REF}`), /production/);
  assert.throws(() => assertPreviewCronIsolationSql(base + " SELECT cron.unschedule('x-poster-tick');"), /preserve/);
  assert.throws(() => assertPreviewCronIsolationSql(base + " postgres://foo:bar@db.abcdefghijklmnopqrst.supabase.co/postgres"), /credentials/);
  assert.throws(() => assertPreviewCronIsolationSql(base.replace(PREVIEW_CRON_POST_REPLAY_MARKER, "")), /phase marker/);
});

test("execution path validates identity and connection before invoking CLI", () => {
  const env = {
    ...validEnv,
    XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  };
  const calls = [];
  const result = runPreviewCronIsolation({
    env,
    execFileSyncImpl: (...args) => calls.push(args),
  });
  assert.equal(result.projectRef, "abcdefghijklmnopqrst");
  assert.equal(result.marker, PREVIEW_CRON_POST_REPLAY_MARKER);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], "npx");
  assert.deepEqual(calls[0][1].slice(0, 4), ["--yes", "supabase@2.111.0", "db", "query"]);
  assert.match(calls[0][1].at(-1), /cron\.alter_job\(scheduled_job\.jobid, active => false\)/);
  assert.doesNotMatch(calls[0][1].at(-1), /ALTER DATABASE postgres SET cron\.launch_active_jobs = 'off'/);
  assert.throws(
    () => runPreviewCronIsolation({
      env: { ...env, XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:synthetic@db.zyxwvutsrqponmlkjihg.supabase.co:5432/postgres" },
      execFileSyncImpl: () => { throw new Error("must not invoke"); },
    }),
    /must match.*Preview project/,
  );
});

test("pre-replay execution emits the pre-replay marker", () => {
  const env = {
    ...validEnv,
    XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  };
  const calls = [];
  const result = runPreviewCronIsolation({
    phase: "pre-replay",
    env,
    execFileSyncImpl: (...args) => calls.push(args),
  });
  assert.equal(result.marker, PREVIEW_CRON_PRE_REPLAY_MARKER);
  assert.match(calls[0][1].at(-1), /ALTER DATABASE postgres SET cron\.launch_active_jobs = 'off'/);
});

test("pre-replay and post-replay markers are distinct", () => {
  assert.notEqual(PREVIEW_CRON_PRE_REPLAY_MARKER, PREVIEW_CRON_POST_REPLAY_MARKER);
  const pre = buildPreviewCronPreReplayGateSql("abcdefghijklmnopqrst");
  const post = buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst");
  assert.ok(pre.includes(PREVIEW_CRON_PRE_REPLAY_MARKER));
  assert.ok(!pre.includes(PREVIEW_CRON_POST_REPLAY_MARKER));
  assert.ok(post.includes(PREVIEW_CRON_POST_REPLAY_MARKER));
  assert.ok(!post.includes(PREVIEW_CRON_PRE_REPLAY_MARKER));
});

test("CLI supports --check, --pre-replay, and --post-replay with --execute as a post alias", () => {
  const source = readFileSync(join(root, "scripts/preview-cron-isolation.mjs"), "utf8");
  assert.match(source, /--pre-replay/);
  assert.match(source, /--post-replay/);
  assert.match(source, /--execute/);
  assert.match(source, /phase=pre-replay/);
  assert.match(source, /phase=post-replay/);

  const output = execFileSync("node", [join(root, "scripts", "preview-cron-isolation.mjs"), "--check"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(output, /PREVIEW_CRON_ISOLATION_SOURCE_CONTRACT_PASS/);
});

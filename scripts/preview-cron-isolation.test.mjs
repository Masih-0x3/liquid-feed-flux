import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PRODUCTION_EDGE_URL_PREFIX,
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertPreviewCronIsolationContract,
  assertPreviewCronIsolationSql,
  buildPreviewCronIsolationSql,
  findProductionTargetedCronSchedules,
  runPreviewCronIsolation,
} from "./preview-cron-isolation.mjs";

const root = join(import.meta.dirname, "..");

test("historical source hazard is reproduced without rewriting migration files", () => {
  const findings = findProductionTargetedCronSchedules(root);
  assert.ok(findings.length >= 10);
  assert.ok(findings.some(({ name }) => name === "process-jobs"));
  assert.ok(findings.some(({ name }) => name === "x-poster-tick"));
  assert.ok(findings.every(({ filename }) => /^\d{14}_.+\.sql$/.test(filename)));
  assert.ok(findings.every(({ name }) => typeof name === "string" && name.length > 0));
});

test("guard binds Preview identity and deactivates only production-targeted commands", () => {
  const sql = buildPreviewCronIsolationSql("abcdefghijklmnopqrst");
  assertPreviewCronIsolationSql(sql);
  assert.match(sql, /target_environment <> 'preview'/);
  assert.match(sql, /configured_url <> expected_preview_url/);
  assert.match(sql, /UPDATE cron\.job[\s\S]*SET active = false/);
  assert.match(sql, new RegExp(PRODUCTION_EDGE_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(sql, /cron\.unschedule|DROP\s+JOB/i);
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
  const guard = buildPreviewCronIsolationSql("abcdefghijklmnopqrst");
  for (const mutation of [
    ["target guard", "target_environment <> 'preview'", "target_environment = 'preview'"],
    ["project guard", "configured_url <> expected_preview_url", "configured_url = expected_preview_url"],
    ["active fence", "active IS DISTINCT FROM false", "active = true"],
    ["deactivation", "SET active = false", "SET active = true"],
  ]) {
    const [, needle, replacement] = mutation;
    const mutated = guard.replace(needle, replacement);
    assert.throws(() => assertPreviewCronIsolationSql(mutated), /missing|preserve|credentials/i, mutation[0]);
  }
  assert.match(source, /PREVIEW_CRON_GUARD_MARKER/);
});

test("execution path validates identity and connection before invoking CLI", () => {
  const validEnv = {
    XOT_ENVIRONMENT: "preview",
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
    XOT_PREVIEW_BRANCH: "preview/cron-guard",
    VERCEL_DEPLOYMENT_TARGET: "preview",
    XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
    XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  };
  const calls = [];
  const result = runPreviewCronIsolation({
    env: validEnv,
    execFileSyncImpl: (...args) => calls.push(args),
  });
  assert.equal(result.projectRef, "abcdefghijklmnopqrst");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], "npx");
  assert.deepEqual(calls[0][1].slice(0, 4), ["--yes", "supabase@2.111.0", "db", "query"]);
  assert.match(calls[0][1].at(-1), /UPDATE cron\.job/);
  assert.throws(
    () => runPreviewCronIsolation({
      env: { ...validEnv, XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:synthetic@db.zyxwvutsrqponmlkjihg.supabase.co:5432/postgres" },
      execFileSyncImpl: () => { throw new Error("must not invoke"); },
    }),
    /must match.*Preview project/,
  );
});

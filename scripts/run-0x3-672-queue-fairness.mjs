/**
 * 0X3-672 disposable queue-fairness harness.
 *
 * Boots the pinned Supabase Postgres image with --network none, applies every
 * migration in supabase/migrations in order, runs the queue-fairness SQL
 * fixture, and asserts the lane-fair claim contract. Also exercises SKIP
 * LOCKED across two concurrent claim_jobs calls.
 *
 * This harness never touches production, provider APIs, or unrelated Docker
 * resources: the container is network-less, name-scoped, and removed on exit.
 *
 * Usage:
 *   node scripts/run-0x3-672-queue-fairness.mjs          # assert fair contract
 *   REPRO_ONLY=1 node scripts/run-0x3-672-queue-fairness.mjs  # print evidence only
 */
import { execFileSync, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  normalizePortBindings,
  redactedDiagnostic,
  waitForDisposableReadiness,
} from "./e6DisposableReadiness.mjs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const CONTEXT = "orbstack";
const CONTAINER = "xot-0x3672-queue-fairness";
const IMAGE = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
const EXPECTED_IMAGE_CMD = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
const SQL_FIXTURE = join(ROOT, "scripts/xot-0x3-672-queue-fairness-fixture.sql");
const bootstrapPassword = randomBytes(48).toString("base64url");
const REPRO_ONLY = process.env.REPRO_ONLY === "1";
const TIMEOUTS = Object.freeze({
  dockerProbeMs: 15_000,
  dockerRunMs: 60_000,
  dockerSqlMs: 240_000,
  dockerCleanupMs: 30_000,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dockerText(args, input = undefined, timeout = TIMEOUTS.dockerProbeMs) {
  return execFileSync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
}

function dockerTextAsync(args, input = undefined, timeout = TIMEOUTS.dockerSqlMs) {
  return execFileAsync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  }).then(({ stdout }) => stdout);
}

function dockerWithBootstrap(...args) {
  return execFileSync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, POSTGRES_PASSWORD: bootstrapPassword },
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    timeout: TIMEOUTS.dockerRunMs,
  });
}

function runPsql(sql, timeout = TIMEOUTS.dockerSqlMs) {
  return dockerText([
    "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "supabase_admin", "-d", "postgres",
  ], sql, timeout);
}

function runPsqlScalar(sql) {
  return dockerText([
    "exec", "-i", CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1",
    "-U", "supabase_admin", "-d", "postgres",
  ], sql, TIMEOUTS.dockerSqlMs).trim();
}

function runPsqlScalarAsync(sql) {
  // -c instead of stdin: execFile does not write `input` to the child's
  // stdin, so a piped psql would see EOF and run nothing.
  return dockerTextAsync([
    "exec", "-i", CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1",
    "-U", "supabase_admin", "-d", "postgres", "-c", sql,
  ], undefined, TIMEOUTS.dockerSqlMs).then((out) => out.trim());
}

function extractSqlEvidence(error) {
  const rawDetail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).map(String).join("\n");
  const lines = rawDetail.split("\n");
  const evidence = lines.filter((line) => /\b(?:ERROR|CONTEXT|STATEMENT|DETAIL|HINT):/i.test(line));
  const detail = (evidence.length > 0 ? evidence : lines.filter((line) => line.trim() && !line.includes("Command failed"))).join(" ") || "sql_error";
  return redactedDiagnostic(detail);
}

function prelude() {
  return `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'service_role') $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL,
  name text NOT NULL, owner_id uuid, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`;
}

function applyMigrations() {
  const migrations = readdirSync(join(ROOT, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, body: readFileSync(join(ROOT, "supabase/migrations", name), "utf8") }));
  if (migrations.length < 140) throw new Error(`XOT672_BLOCKED migration_count=${migrations.length}`);
  try {
    runPsql(prelude());
  } catch (error) {
    throw new Error(`XOT672_FAIL stage=prelude detail=${extractSqlEvidence(error)}`);
  }
  for (const [index, migration] of migrations.entries()) {
    try {
      runPsql(`\\set ON_ERROR_STOP on\n${migration.body}`);
    } catch (error) {
      const detail = extractSqlEvidence(error);
      throw new Error(`XOT672_FAIL migration=${migration.name} index=${index + 1} sha256=${sha256(migration.body)} detail=${detail}`);
    }
  }
  return { count: migrations.length };
}

function requireStableCatalogReady() {
  return waitForDisposableReadiness({
    readLogs: () => dockerText(["logs", CONTAINER]),
    assertReady: () => dockerText(["exec", CONTAINER, "pg_isready", "-U", "supabase_admin", "-d", "postgres"]),
    readSample: () => runPsqlScalar(`SELECT concat_ws(E'\\t', pg_postmaster_start_time()::text, current_database(), version(), 'x', 'plpgsql', (SELECT oid::text FROM pg_database WHERE datname='postgres'), (SELECT oid::text FROM pg_roles WHERE rolname='postgres'), (SELECT oid::text FROM pg_roles WHERE rolname='supabase_admin'))`),
    sleep: () => dockerText(["exec", CONTAINER, "sh", "-c", "sleep 1"]),
  });
}

function parseFacts(output) {
  const facts = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(FACT_[A-Za-z0-9_]+)=(\S+)\s*$/);
    if (match) facts[match[1]] = match[2];
  }
  return facts;
}

const failures = [];
function expectFact(facts, key, predicate, label) {
  const value = facts[key];
  const ok = value !== undefined && predicate(value);
  const status = ok ? "PASS" : "FAIL";
  console.log(`  ${status} ${label}  (${key}=${value ?? "missing"})`);
  if (!ok) failures.push(`${label} [${key}=${value ?? "missing"}]`);
}

async function concurrentSkipLockedProbe() {
  // Seed a dedicated pending pool so both claimants have eligible work, then
  // run two concurrent claims: SKIP LOCKED must keep the admitted sets disjoint.
  runPsql(`
    INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
    SELECT 'translate', jsonb_build_object('tweet_id', 'xot672-par-' || g),
           'pending', 10, 0, now(), now(), 'xot672:par:' || g
    FROM generate_series(1, 40) g
    ON CONFLICT (idempotency_key) DO NOTHING;
  `);
  const [a, b] = await Promise.all([
    runPsqlScalarAsync(`SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.claim_jobs(15, NULL, 'xot672-par-a')`),
    runPsqlScalarAsync(`SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.claim_jobs(15, NULL, 'xot672-par-b')`),
  ]);
  const idsA = new Set(a ? a.split(",") : []);
  const idsB = b ? b.split(",") : [];
  const overlap = idsB.filter((id) => idsA.has(id));
  return { a: idsA.size, b: idsB.length, overlap: overlap.length };
}

async function resurrectionRaceProbe() {
  // Two concurrent gate evaluations on the same failed download row must not
  // both resurrect it: FOR UPDATE serializes them, so exactly one wins and a
  // stale loser sees the now-open row. The final cycle must advance exactly
  // once, and the row's claim surface (lease/attempts) stays consistent.
  runPsql(`
    INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key, result_meta)
    VALUES ('download_media',
            jsonb_build_object('tweet_id', 'xot672-race', 'source', 'video_render_gate'),
            'failed', 12, 5, now(), now() - interval '1 hour', 'xot672:race:dl',
            '{"video_render_retry_cycle": 1, "video_render_retry_media": "media-r"}')
    ON CONFLICT (idempotency_key) DO UPDATE
      SET status = 'failed', attempts = 5,
          result_meta = '{"video_render_retry_cycle": 1, "video_render_retry_media": "media-r"}';
  `);
  const [r1, r2] = await Promise.all([
    runPsqlScalarAsync(`SELECT public.enqueue_bounded_media_download('xot672:race:dl', 'xot672-race', 'media-r', 3)`),
    runPsqlScalarAsync(`SELECT public.enqueue_bounded_media_download('xot672:race:dl', 'xot672-race', 'media-r', 3)`),
  ]);
  const row = runPsqlScalar(`
    SELECT concat_ws('|', status, attempts, result_meta->>'video_render_retry_cycle')
    FROM public.jobs WHERE idempotency_key = 'xot672:race:dl'
  `);
  const results = [r1, r2].sort();
  const winners = results.filter((r) => r === "resurrected").length;
  const losers = results.filter((r) => r === "open").length;
  return { winners, losers, row, results };
}

let containerStarted = false;
try {
  const existing = dockerText(["ps", "-a", "--format", "{{.Names}}"])
    .trim().split("\n").filter(Boolean);
  if (existing.includes(CONTAINER)) throw new Error("XOT672_BLOCKED container name already in use");

  const imageInspect = JSON.parse(dockerText(["image", "inspect", IMAGE]))[0];
  if (!imageInspect?.RepoDigests?.includes(IMAGE)) throw new Error("XOT672_BLOCKED exact image digest not cached");

  dockerWithBootstrap("run", "--detach", "--pull=never", "--network", "none", "--restart=no",
    "-e", "POSTGRES_PASSWORD", "--name", CONTAINER, IMAGE,
    ...EXPECTED_IMAGE_CMD, "-c", "cron.database_name=postgres", "-c", "cron.launch_active_jobs=off");
  containerStarted = true;

  const ports = dockerText(["inspect", "--format", "{{json .HostConfig.PortBindings}}", CONTAINER]).trim();
  if (normalizePortBindings(JSON.parse(ports || "null")).length > 0) {
    throw new Error("XOT672_BLOCKED host port bindings present");
  }

  requireStableCatalogReady();
  const { count } = applyMigrations();
  console.log(`XOT672_MIGRATIONS_APPLIED ${count}`);

  const fixtureOutput = runPsql(readFileSync(SQL_FIXTURE, "utf8"));
  const facts = parseFacts(fixtureOutput);
  console.log("XOT672_FACTS " + JSON.stringify(facts, null, 2));

  const concurrency = await concurrentSkipLockedProbe();
  console.log(`XOT672_CONCURRENT a=${concurrency.a} b=${concurrency.b} overlap=${concurrency.overlap}`);

  const race = await resurrectionRaceProbe();
  console.log(`XOT672_RESURRECTION_RACE results=${race.results.join(",")} row=${race.row}`);

  if (!REPRO_ONLY) {
    console.log("XOT672_ASSERTIONS");
    // Scenario A: lane-fair admission under the incident backlog shape.
    expectFact(facts, "FACT_A_admitted_total", (v) => Number(v) === 20, "claim A fills the batch");
    expectFact(facts, "FACT_A_admitted_non_deliver", (v) => Number(v) >= 15, "claim A admits model/fast work (>=15)");
    expectFact(facts, "FACT_A_admitted_deliver", (v) => Number(v) <= 5, "claim A caps blocked deliveries (<=5)");
    expectFact(facts, "FACT_A_admitted_model", (v) => Number(v) >= 10, "claim A reserves the model share (>=10)");
    expectFact(facts, "FACT_A_admitted_fast", (v) => Number(v) >= 5, "claim A keeps a fast share (>=5)");
    expectFact(facts, "FACT_A_claim_state_all_preparing", (v) => v === "t" || v === "true", "claim A mints preparing claim state");
    expectFact(facts, "FACT_A_claim_token_single", (v) => v === "t" || v === "true", "claim A single claim token");
    expectFact(facts, "FACT_A_attempts_incremented", (v) => v === "t" || v === "true", "claim A increments attempts");
    expectFact(facts, "FACT_A_lease_five_minutes", (v) => v === "t" || v === "true", "claim A five-minute lease");
    // Scenario B: fresh arrivals bounded wait.
    expectFact(facts, "FACT_B_fresh_translates_claimed", (v) => Number(v) === 3, "claim B admits fresh translations immediately");
    expectFact(facts, "FACT_B_admitted_deliver", (v) => Number(v) <= 5, "claim B keeps deliveries capped");
    // Scenario C: deferred (not-due) deliveries stay out of admission.
    expectFact(facts, "FACT_C_deferred_deliver_admitted", (v) => Number(v) === 0, "claim C excludes deferred delivery");
    expectFact(facts, "FACT_C_admitted_non_deliver", (v) => Number(v) >= 15, "claim C keeps model/fast admission");
    // Scenario D/E: stale claims requeue; ambiguous provider outcomes never replay.
    expectFact(facts, "FACT_D_requeued", (v) => Number(v) >= 1, "stale claim requeued");
    expectFact(facts, "FACT_D_stale_back_to_pending", (v) => v === "t" || v === "true", "stale claim returned to pending");
    expectFact(facts, "FACT_E_ambiguous_reported", (v) => Number(v) >= 1, "ambiguous outcome counted");
    expectFact(facts, "FACT_E_ambiguous_not_requeued", (v) => v === "t" || v === "true", "ambiguous outcome stays running");
    // Scenario F: runtime-control pause gates admission.
    expectFact(facts, "FACT_F_translate_claimed_while_paused", (v) => Number(v) === 0, "paused translation not claimed");
    // Scenario G/H: scoped claims fill their own lane without cross-lane floor.
    expectFact(facts, "FACT_G_translate_only_claimed", (v) => Number(v) === 20, "translate-scoped claim fills batch");
    expectFact(facts, "FACT_H_deliver_only_claimed", (v) => Number(v) === 20, "deliver-scoped claim fills batch");
    // Scenario I: fresh work never waits more than two batches.
    expectFact(facts, "FACT_I_fresh_late_claimed_in_batches", (v) => Number(v) > 0 && Number(v) <= 2, "fresh translation claimed within 2 batches");
    // Scenario J: delivery-only backlog still drains at full batch.
    expectFact(facts, "FACT_J_deliver_only_backlog_claimed", (v) => Number(v) === 20, "delivery-only backlog fills batch");
    // Scenario K: a sustained, replenished fast backlog cannot starve the
    // model lane — the lane share holds across consecutive batches even when
    // fresh priority-15/30 work keeps arriving between claims.
    expectFact(facts, "FACT_K1_total", (v) => Number(v) === 20, "claim K1 fills the batch");
    expectFact(facts, "FACT_K1_translate", (v) => Number(v) === 10, "claim K1 model lane keeps its share despite deep fast backlog");
    expectFact(facts, "FACT_K1_fast", (v) => Number(v) === 5, "claim K1 fast lane keeps only its reserve");
    expectFact(facts, "FACT_K1_deliver", (v) => Number(v) === 5, "claim K1 delivery lane keeps its reserve");
    expectFact(facts, "FACT_K2_total", (v) => Number(v) === 20, "claim K2 fills the batch");
    expectFact(facts, "FACT_K2_translate", (v) => Number(v) === 10, "claim K2 model lane survives replenished fast inflow");
    expectFact(facts, "FACT_K2_fast", (v) => Number(v) === 5, "claim K2 fast lane keeps only its reserve");
    expectFact(facts, "FACT_K2_deliver", (v) => Number(v) === 5, "claim K2 delivery lane keeps its reserve");
    // Scenario L: bounded resurrection contract.
    expectFact(facts, "FACT_L1_result", (v) => v === "resurrected", "failed download resurrected within budget");
    expectFact(facts, "FACT_L1_status", (v) => v === "pending", "resurrected download is pending");
    expectFact(facts, "FACT_L1_cycle", (v) => v === "3", "resurrection increments the cycle");
    expectFact(facts, "FACT_L1_attempts", (v) => v === "0", "resurrection spends a fresh attempt budget");
    expectFact(facts, "FACT_L2_result", (v) => v === "open", "open download reported open");
    expectFact(facts, "FACT_L2_cycle", (v) => v === "3", "open download cycle untouched");
    expectFact(facts, "FACT_L3_result", (v) => v === "open", "stale evaluation cannot touch a claimed download");
    expectFact(facts, "FACT_L3_status", (v) => v === "running", "claimed download stays running");
    expectFact(facts, "FACT_L3_lease_kept", (v) => v === "t" || v === "true", "claimed download keeps its lease");
    expectFact(facts, "FACT_L3_cycle", (v) => v === "3", "claimed download keeps its cycle");
    expectFact(facts, "FACT_L4_result", (v) => v === "exhausted", "cycle-ceiling download is exhausted");
    expectFact(facts, "FACT_L4_status", (v) => v === "failed", "exhausted download not resurrected");
    expectFact(facts, "FACT_L4_cycle", (v) => v === "3", "exhausted download keeps its cycle");
    expectFact(facts, "FACT_L5_result", (v) => v === "resurrected", "new media identity resurrects");
    expectFact(facts, "FACT_L5_cycle", (v) => v === "1", "new media identity resets the cycle");
    expectFact(facts, "FACT_L5_media", (v) => v === "media-b", "new media identity stored");
    if (concurrency.overlap !== 0) failures.push(`concurrent claims overlapped ${concurrency.overlap}`);
    if (race.winners !== 1 || race.losers !== 1) {
      failures.push(`resurrection race winners=${race.winners} losers=${race.losers} results=${race.results.join(",")}`);
    }
    if (race.row !== "pending|0|2") {
      failures.push(`resurrection race final row state=${race.row} (expected pending|0|2)`);
    }
  }

  if (failures.length > 0) {
    console.error(`XOT672_CONTRACT_FAIL ${failures.length} violation(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("XOT672_QUEUE_FAIRNESS_PASS");
  }
} catch (error) {
  console.error(error instanceof Error ? redactedDiagnostic(error.message) : "XOT672_FAIL unknown");
  if (error?.stderr) console.error(redactedDiagnostic(String(error.stderr)));
  process.exitCode = 1;
} finally {
  if (containerStarted) {
    try {
      dockerText(["rm", "-f", "-v", "--", CONTAINER], undefined, TIMEOUTS.dockerCleanupMs);
    } catch {
      // best effort
    }
  }
}

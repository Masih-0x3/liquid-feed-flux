import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  E10_DISPOSABLE_PRELUDE,
  E10_INIT_COMPLETE_MARKER,
} from "./e10SqlBoundary.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const IMAGE = "public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const CUTOVER_MIGRATION = "20260825091418_v1_delivery_continuity_cutover.sql";
const labelValue = `${process.pid}-${randomBytes(4).toString("hex")}`;
const containerName = `xot-zero-write-${labelValue}`;
const password = randomBytes(36).toString("base64url");
let containerId = "";

function docker(args, input) {
  return execFileSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, POSTGRES_PASSWORD: password },
    input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000,
  });
}

function psql(sql) {
  return docker([
    "exec", "-i", "--", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=terse", "-U", "supabase_admin", "-d", "postgres",
  ], sql);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const logs = docker(["logs", "--", containerId]);
      if (logs.includes(E10_INIT_COMPLETE_MARKER)) {
        docker(["exec", "--", containerId, "pg_isready", "-U", "supabase_admin", "-d", "postgres"]);
        return;
      }
    } catch {
      // The image can restart once while its initialization scripts finish.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error("disposable PostgreSQL did not become ready");
}

const seedSql = String.raw`
INSERT INTO public.accounts (id, handle, created_at)
VALUES ('00000000-0000-0000-0000-000000009001', 'zero-write-fixture', '2020-01-01T00:00:00Z');

INSERT INTO public.posts (tweet_id, account_id, text_original, created_at)
VALUES
  ('zero-write-pending', '00000000-0000-0000-0000-000000009001', 'pending fixture', '2020-01-01T00:00:00Z'),
  ('zero-write-running', '00000000-0000-0000-0000-000000009001', 'running fixture', '2020-01-01T00:00:01Z');

INSERT INTO public.jobs (
  id, type, payload, status, next_run_at, created_at,
  locked_at, locked_by, lease_expires_at
)
VALUES
  ('00000000-0000-0000-0000-000000009011', 'deliver', '{"tweet_id":"zero-write-pending"}', 'pending', now() - interval '1 hour', '2020-01-01T00:00:02Z', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000009012', 'deliver', '{"tweet_id":"zero-write-running"}', 'running', now() - interval '1 hour', '2020-01-01T00:00:03Z', now() - interval '2 hours', 'zero-write-fixture', now() - interval '1 hour');
`;

const assertionSql = String.raw`
SELECT public.initialize_delivery_cutover('zero-write-disposable-fixture');

CREATE TEMP TABLE zero_write_before AS
SELECT id, to_jsonb(j) AS row_data
FROM public.jobs AS j
WHERE id IN (
  '00000000-0000-0000-0000-000000009011',
  '00000000-0000-0000-0000-000000009012'
);

DO $$
DECLARE
  claimed_count integer;
  delivery_attempts integer;
BEGIN
  FOR attempt IN 1..2 LOOP
    SELECT count(*) INTO claimed_count
    FROM public.claim_jobs(100, ARRAY['deliver']::text[], 'zero-write-fixture');
    IF claimed_count <> 0 THEN
      RAISE EXCEPTION 'historical delivery job was claimed';
    END IF;

    IF public.settle_delivery_cutover_blocked(
      '00000000-0000-0000-0000-000000009012',
      'delivery_cutover_blocked:fixture'
    ) THEN
      RAISE EXCEPTION 'historical delivery settlement reported a write';
    END IF;

    PERFORM public.reconcile_stuck_jobs();
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM zero_write_before AS b
    JOIN public.jobs AS j USING (id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(j)
  ) THEN
    RAISE EXCEPTION 'historical delivery job row changed';
  END IF;

  SELECT
    (SELECT count(*) FROM public.deliveries WHERE subject_id IN ('zero-write-pending', 'zero-write-running'))
    + (SELECT count(*) FROM public.x_deliveries WHERE post_id IN ('zero-write-pending', 'zero-write-running'))
  INTO delivery_attempts;
  IF delivery_attempts <> 0 THEN
    RAISE EXCEPTION 'historical delivery provider receipt was created';
  END IF;

  BEGIN
    UPDATE public.jobs SET last_error = 'must-not-write'
    WHERE id = '00000000-0000-0000-0000-000000009012';
    RAISE EXCEPTION 'historical update was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'delivery_cutover_blocked:historical_deliver_job_zero_write%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM public.jobs
    WHERE id = '00000000-0000-0000-0000-000000009011';
    RAISE EXCEPTION 'historical delete was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'delivery_cutover_blocked:historical_deliver_job_zero_write%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

SELECT 'HISTORICAL_DELIVERY_ZERO_WRITE_PASS';
`;

try {
  docker(["image", "inspect", "--", IMAGE]);
  containerId = docker([
    "run", "--detach", "--pull=never", "--network", "none", "--restart=no",
    "--label", `xot.zero-write=${labelValue}`, "-e", "POSTGRES_PASSWORD",
    "--name", containerName, IMAGE,
  ]).trim();
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("docker did not return an exact container ID");
  waitForPostgres();
  psql(E10_DISPOSABLE_PRELUDE);

  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const cutoverIndex = files.indexOf(CUTOVER_MIGRATION);
  if (cutoverIndex < 0) throw new Error("cutover migration is missing");
  for (const [index, filename] of files.entries()) {
    if (index === cutoverIndex) psql(seedSql);
    psql(readFileSync(join(MIGRATIONS, filename), "utf8"));
  }
  const output = psql(assertionSql);
  if (!output.includes("HISTORICAL_DELIVERY_ZERO_WRITE_PASS")) {
    throw new Error("zero-write assertion marker is missing");
  }
  process.stdout.write(`PASS: repeated claim, settlement, reconcile, update, and delete preserved both historical rows; image=${IMAGE}\n`);
} finally {
  if (containerId) {
    try { docker(["rm", "-f", "-v", "--", containerId]); } catch { /* report below */ }
  }
  const residual = docker(["ps", "-aq", "--filter", `label=xot.zero-write=${labelValue}`]).trim();
  if (residual) throw new Error(`disposable container cleanup failed: ${residual}`);
}

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function readReconcileFixMigration(): string {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const migration = readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_prevent_skip_reconcile_translate.sql"))
    .sort()
    .at(-1);

  expect(migration, "expected prevent_skip_reconcile_translate migration").toBeTruthy();
  return readFileSync(join(migrationsDir, migration!), "utf8");
}

function readHistoricalDeliveryReconcileMigration(): string {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const migration = readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_reconcile_historical_delivery_jobs.sql"))
    .sort()
    .at(-1);

  expect(migration, "expected historical delivery reconcile migration").toBeTruthy();
  return readFileSync(join(migrationsDir, migration!), "utf8");
}

describe("reconcile skipped-post migration", () => {
  it("does not recover translation for posts that were intentionally skipped", () => {
    const sql = readReconcileFixMigration();

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()");
    expect(sql).toContain("(p.delivery_decision IS NULL OR p.delivery_decision = 'deliver')");
    expect(sql).toContain("'translate:reconcile:' || p.tweet_id");
  });

  it("cancels only pending skipped-post translate reconcile jobs", () => {
    const sql = readReconcileFixMigration();

    expect(sql).toContain("prevent_skip_reconcile_translate");
    expect(sql).toContain("j.status = 'pending'");
    expect(sql).toContain("j.idempotency_key LIKE 'translate:reconcile:%'");
    expect(sql).toContain("p.delivery_decision = 'skip'");
    expect(sql).toContain("Cancelled: skipped post does not require reconcile translation");
  });
});

describe("historical delivery reconcile migration", () => {
  it("settles only expired historical deliver jobs before the release pass", () => {
    const sql = readHistoricalDeliveryReconcileMigration();

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()");
    expect(sql).toContain("historical_deliveries_settled");
    expect(sql).toContain("j.type = 'deliver'");
    expect(sql).toContain("j.status = 'running'");
    expect(sql).toContain("j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now()");
    expect(sql).toContain("j.lease_expires_at IS NULL");
    expect(sql).toContain("public.settle_delivery_cutover_blocked(");
    expect(sql).toContain("delivery_cutover_blocked:reconcile_historical_deliver");
  });

  it("keeps delivery creation strictly new-only and retains a release guard", () => {
    const sql = readHistoricalDeliveryReconcileMigration();
    const deliveryInsert = sql.indexOf("SELECT 'deliver'");
    const releasePass = sql.indexOf("UPDATE public.jobs AS j");

    expect(deliveryInsert).toBeGreaterThan(-1);
    expect(sql.indexOf("public.delivery_cutover_allows_post(p.tweet_id)", deliveryInsert))
      .toBeGreaterThan(deliveryInsert);
    expect(sql.indexOf("p.created_at > v_cutover", deliveryInsert)).toBeGreaterThan(deliveryInsert);
    expect(sql.indexOf("j.type <> 'deliver'", releasePass)).toBeGreaterThan(releasePass);
    expect(sql.indexOf("public.delivery_cutover_allows_job(", releasePass)).toBeGreaterThan(releasePass);
  });
});

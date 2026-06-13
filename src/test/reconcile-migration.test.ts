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

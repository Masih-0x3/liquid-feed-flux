import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260829100000_queue_settlement_and_retry_fixes.sql",
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

function assertPreProviderReleaseContract(sql: string): void {
  const reconcile = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs()"),
  );
  if (!reconcile.includes("j.provider_started_at IS NULL")) {
    throw new Error("provider-started guard removed");
  }
  if (!reconcile.includes("COALESCE(j.claim_state, 'idle') IN ('idle', 'preparing', 'ready')")) {
    throw new Error("ambiguous claim-state guard removed");
  }
}

describe("queue settlement P1 migration", () => {
  it("requeues only expired pre-provider jobs and clears the old fence", () => {
    const sql = readMigration();

    expect(sql).toContain("COALESCE(j.claim_state, 'idle') IN ('idle', 'preparing', 'ready')");
    expect(sql).toContain("j.provider_started_at IS NULL");
    expect(sql).toContain("claim_token = NULL");
    expect(sql).toContain("claim_generation = COALESCE(j.claim_generation, 0)");
    expect(sql).toContain("claim_state = 'idle'");
    expect(sql).toContain("claim_expires_at = NULL");
    expect(sql).not.toContain("FROM requeue r");
  });

  it("does not make an expired provider-started or ambiguous claim runnable", () => {
    const sql = readMigration();
    const reconcile = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs()"),
    );

    expect(reconcile).toContain("j.provider_started_at IS NULL");
    expect(reconcile).toContain("COALESCE(j.claim_state, 'idle') IN ('idle', 'preparing', 'ready')");
    expect(reconcile).not.toContain("claim_state IN ('posting', 'ambiguous')");
  });

  it("reclaims only an expired pre-provider X claim with a fresh generation", () => {
    const sql = readMigration();
    const xClaim = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.claim_x_post_delivery("),
      sql.indexOf("REVOKE ALL ON FUNCTION public.claim_x_post_delivery_unchecked"),
    );

    expect(xClaim).toContain("v_existing.claim_expires_at < now()");
    expect(xClaim).toContain("v_existing.provider_started_at IS NULL");
    expect(xClaim).toContain("claim_generation = COALESCE(claim_generation, 0) + 1");
    expect(xClaim).toContain("claim_state = 'preparing'");
    expect(xClaim).toContain("reason', 'reclaimed_pre_provider'");
    expect(xClaim).toContain("RETURN public.claim_x_post_delivery_unchecked(");
  });

  it("keeps retry_step idempotent and does not reset active claims", () => {
    const sql = readMigration();
    const retry = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.retry_step"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.retry_step"),
    );

    expect(retry).toContain("retry_key := left(lower(step) || ':manual_retry:' || tweet_id, 512);");
    expect(retry).toContain("ON CONFLICT (idempotency_key) DO UPDATE");
    expect(retry).toContain("WHEN public.jobs.status IN ('failed', 'completed') THEN 'pending'");
    expect(retry).toContain("ELSE public.jobs.status");
    expect(retry).toContain("WHEN public.jobs.status IN ('failed', 'completed') THEN NULL");
  });

  it("mutation guard: removing the pre-provider predicate is rejected", () => {
    const sql = readMigration().replaceAll("j.provider_started_at IS NULL", "TRUE");

    expect(() => assertPreProviderReleaseContract(sql)).toThrow(
      "provider-started guard removed",
    );
  });
});

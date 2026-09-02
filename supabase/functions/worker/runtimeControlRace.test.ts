import { assert, assertStringIncludes, assertThrows } from "jsr:@std/assert";

const MIGRATION = new URL(
  "../../migrations/20260828140000_runtime_control_claim_release_race_guards.sql",
  import.meta.url,
);

function assertClaimContract(sql: string): void {
  const claimStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.claim_jobs");
  const claimEnd = sql.indexOf("REVOKE ALL ON FUNCTION public.claim_jobs", claimStart);
  assert(claimStart >= 0 && claimEnd > claimStart, "claim_jobs function must be present");
  const claim = sql.slice(claimStart, claimEnd);

  assertStringIncludes(claim, "FOR UPDATE SKIP LOCKED");
  assertStringIncludes(claim, "public.delivery_cutover_allows_job(");
  assertStringIncludes(claim, "FROM public.runtime_controls AS controls");
  assertStringIncludes(claim, "dedupe_enabled");
  assertStringIncludes(claim, "translation_enabled");
  assertStringIncludes(claim, "posting_mode");
  assertStringIncludes(claim, "PERFORM public.lock_runtime_controls();");
  assertStringIncludes(sql, "pg_advisory_xact_lock");
}

Deno.test("claim_jobs rechecks runtime controls inside the transactional claim", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assertClaimContract(sql);

  for (const mutated of [
    sql.replace("public.delivery_cutover_allows_job(", "true OR ("),
    sql.replace("FROM public.runtime_controls AS controls", "FROM public.jobs AS controls"),
    sql.replace("PERFORM public.lock_runtime_controls();", "PERFORM 1;"),
  ]) {
    assertThrows(() => assertClaimContract(mutated));
  }
});

Deno.test("delivery release guard is transactional and fail closed", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assertStringIncludes(sql, "runtime_controls_delivery_release_guard");
  assertStringIncludes(sql, "RAISE EXCEPTION 'runtime_controls_posting_blocked'");
  assertStringIncludes(sql, "NEW.type = 'deliver'");
  assertStringIncludes(sql, "NEW.status = 'pending'");

  const guardStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.runtime_controls_delivery_release_guard");
  const guardEnd = sql.indexOf("DROP TRIGGER IF EXISTS runtime_controls_delivery_release_guard", guardStart);
  const guard = sql.slice(guardStart, guardEnd);
  const branch = guard.indexOf("IF TG_TABLE_NAME = 'jobs'");
  const lock = guard.indexOf("PERFORM public.lock_runtime_controls();");
  assert(branch >= 0 && lock > branch, "release guard must lock only inside the delivery/pending branch");
});

Deno.test("field-specific runtime control update uses a row lock and updates one field", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assertStringIncludes(sql, "update_runtime_controls(");
  assertStringIncludes(sql, "update_runtime_control(");
  assertStringIncludes(sql, "FOR UPDATE");
  assertStringIncludes(sql, "p_control_name");
  assertStringIncludes(sql, "dedupe_enabled = p_enabled");
  assertStringIncludes(sql, "translation_enabled = p_enabled");
  assertStringIncludes(sql, "ERRCODE = '42501'");
  assertStringIncludes(sql, "ERRCODE = '22023'");
});

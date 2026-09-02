import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const lifecyclePath = path.join(repoRoot, "supabase/functions/worker/jobLifecycle.ts");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const fenceSourcePath = path.join(repoRoot, "supabase/functions/_shared/durableClaimFence.ts");
const migrationPath = path.join(repoRoot, "supabase/migrations/20260806143000_b3_job_x_claim_fencing.sql");
const effectiveRepairMigrationPath = path.join(repoRoot, "supabase/migrations/20260827064509_repair_effective_claim_fence_and_delivery_cutover.sql");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`B3A_JOB_FENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseTS(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) fail(`${fileName}: TypeScript parse diagnostics`);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName,
  });
  if ((out.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error)) {
    fail(`${fileName}: TypeScript transpilation diagnostics`);
  }
}

/**
 * Transpile the real shared provider-boundary module to CommonJS and return the
 * required module. This makes the SF1 durability ordering and the claim-envelope
 * helpers LOAD-BEARING (real transpiled behavior, not just string matches).
 */
function buildFenceModule(fenceSource, mutate = (s) => s) {
  const source = mutate(fenceSource);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: fenceSourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error)) {
    fail("shared durableClaimFence transpilation diagnostics");
  }
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "xot-fence-"));
  const tmpFile = path.join(tmpDir, "durableClaimFence.js");
  writeFileSync(tmpFile, transpiled.outputText);
  const mod = createRequire(import.meta.url)(tmpFile);
  return { mod, tmpDir, tmpFile };
}

async function executeFenceBoundary(fenceSource, hooks) {
  const { mod, tmpDir } = buildFenceModule(fenceSource);
  try {
    return await mod.withProviderBoundary(hooks);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Runtime proof that the durableClaimFence module:
 *   - extracts a fresh cryptographically-random token + monotonic generation,
 *   - embeds that token/generation into a patch under reserved keys,
 *   - leaves the patch untouched when the envelope is missing,
 *   - rejects inactive / terminal claim states before any write,
 *   - emits token+generation (+ optional active state) fence pairs.
 */
function proveDurableClaimEnvelope(fenceSource, label = "current source") {
  const { mod, tmpDir } = buildFenceModule(fenceSource);
  try {
    const {
      CLAIM_TOKEN_PATCH_KEY,
      CLAIM_GENERATION_PATCH_KEY,
      CLAIM_STATE_PATCH_KEY,
      extractClaimEnvelope,
      embedClaimEnvelope,
      claimFencePairs,
      assertClaimEnvelope,
      ACTIVE_CLAIM_STATES,
    } = mod;

    const fresh = extractClaimEnvelope({
      claim_token: "fresh-token",
      claim_generation: 3,
      claim_state: "preparing",
    });
    if (!fresh || fresh.claimToken !== "fresh-token" || fresh.claimGeneration !== 3) {
      fail(`${label}: extractClaimEnvelope must return the fresh token and generation`);
    }
    if (extractClaimEnvelope({}) !== null) {
      fail(`${label}: extractClaimEnvelope must reject a missing token`);
    }
    if (extractClaimEnvelope({ claim_token: "t" }) !== null) {
      fail(`${label}: extractClaimEnvelope must reject a missing generation`);
    }
    if (extractClaimEnvelope({ claim_token: "t", claim_generation: 0 }) !== null) {
      fail(`${label}: extractClaimEnvelope must reject a zero/negative generation`);
    }
    if (extractClaimEnvelope({ claim_token: "t", claim_generation: "not-a-number" }) !== null) {
      fail(`${label}: extractClaimEnvelope must reject a non-numeric string generation`);
    }

    const patch = embedClaimEnvelope(
      { status: "completed", payload: "x" },
      { claim_token: "tok", claim_generation: 7, claim_state: "posting" },
    );
    if (patch.status !== "completed" || patch.payload !== "x") {
      fail(`${label}: embedClaimEnvelope must preserve the original patch`);
    }
    if (patch[CLAIM_TOKEN_PATCH_KEY] !== "tok") {
      fail(`${label}: embedClaimEnvelope must carry the claim token`);
    }
    if (patch[CLAIM_GENERATION_PATCH_KEY] !== 7) {
      fail(`${label}: embedClaimEnvelope must carry the claim generation`);
    }
    if (CLAIM_STATE_PATCH_KEY in patch) {
      fail(`${label}: embedClaimEnvelope must not carry state; state is the caller's responsibility`);
    }

    const untouched = embedClaimEnvelope({ status: "defer" }, {});
    if (Object.keys(untouched).length !== 1 || untouched.status !== "defer") {
      fail(`${label}: embedClaimEnvelope must leave patch untouched when no envelope`);
    }

    const pairs = claimFencePairs(
      { claim_token: "tok", claim_generation: 9, claim_state: "ready" },
      "ready",
    );
    const pairMap = new Map(pairs);
    if (pairMap.get("claim_token") !== "tok") fail(`${label}: claimFencePairs must carry the token`);
    if (pairMap.get("claim_generation") !== 9) fail(`${label}: claimFencePairs must carry the generation`);
    if (pairMap.get("claim_state") !== "ready") fail(`${label}: claimFencePairs must carry the state guard`);

    const badStatePairs = claimFencePairs(
      { claim_token: "tok", claim_generation: 1, claim_state: "posted" },
      "posted",
    );
    const badPairMap = new Map(badStatePairs);
    if (badPairMap.has("claim_state")) {
      fail(`${label}: claimFencePairs must reject an inactive state guard`);
    }

    let missingEnv = "";
    try {
      assertClaimEnvelope({ id: "x", locked_by: "w" }, "complete", (m) => {
        missingEnv = m;
        throw new Error(m);
      });
    } catch {}
    if (!missingEnv.includes("missing_claim_fence")) {
      fail(`${label}: assertClaimEnvelope must fail closed on a missing envelope`);
    }

    let missingState = "";
    try {
      assertClaimEnvelope(
        { claim_token: "tok", claim_generation: 1 },
        "complete",
        (m) => { missingState = m; throw new Error(m); },
      );
    } catch {}
    if (!missingState.includes("missing_claim_state")) {
      fail(`${label}: assertClaimEnvelope must reject a missing claim state`);
    }

    let invalidState = "";
    try {
      assertClaimEnvelope(
        { claim_token: "tok", claim_generation: 1, claim_state: "posted" },
        "complete",
        (m) => { invalidState = m; throw new Error(m); },
      );
    } catch {}
    if (!invalidState.includes("invalid_claim_state")) {
      fail(`${label}: assertClaimEnvelope must reject a terminal/invalid claim state`);
    }

    for (const s of ["preparing", "ready", "posting", "idle"]) {
      if (!ACTIVE_CLAIM_STATES.has(s)) fail(`${label}: ACTIVE_CLAIM_STATES must include ${s}`);
    }
    for (const s of ["posted", "failed", "ambiguous", "skipped"]) {
      if (ACTIVE_CLAIM_STATES.has(s)) fail(`${label}: ACTIVE_CLAIM_STATES must exclude terminal ${s}`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Walk the AST and ensure every updateJobOrThrow call wraps its patch with
 * claimEnvelopedPatch(job, { ... }). A broken envelope is any plain object,
 * variable, or call that is not the abstraction.
 */
function assertUpdateJobOrThrowWrapped(source, fileName, label) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) fail(`${label}: ${fileName} parse diagnostics`);
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "updateJobOrThrow"
    ) {
      const patchArg = node.arguments[2];
      if (
        !patchArg ||
        !ts.isCallExpression(patchArg) ||
        !ts.isIdentifier(patchArg.expression) ||
        patchArg.expression.text !== "claimEnvelopedPatch" ||
        patchArg.arguments.length < 2 ||
        !ts.isObjectLiteralExpression(patchArg.arguments[1])
      ) {
        fail(`${label}: ${fileName}: every updateJobOrThrow patch must be claimEnvelopedPatch(job, { ... })`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

async function assertContract({ lifecycle, worker, fence, migration, packageJson, ci }, label = "current source") {
  parseTS(lifecycle, lifecyclePath);
  parseTS(worker, workerPath);

  // The final effective migration wins at runtime.  Keep this check separate
  // from the original B3 source so a later CREATE OR REPLACE cannot silently
  // remove the durable claim envelope or the delivery admission guard.
  const effectiveRepairMigration = fs.readFileSync(effectiveRepairMigrationPath, "utf8");
  const effectiveClaimStart = effectiveRepairMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.claim_jobs(",
  );
  const effectiveClaimEnd = effectiveRepairMigration.indexOf("\n$$;", effectiveClaimStart);
  if (effectiveClaimStart < 0 || effectiveClaimEnd < 0) {
    fail(`${label}: effective claim_jobs repair function is missing`);
  }
  const effectiveClaimBody = effectiveRepairMigration.slice(effectiveClaimStart, effectiveClaimEnd);
  for (const marker of [
    "fresh_claim_token uuid := gen_random_uuid();",
    "claim_token = fresh_claim_token",
    "claim_generation = COALESCE(claim_generation, 0) + 1",
    "claim_state = 'preparing'",
    "claim_started_at = now()",
    "claim_expires_at = now() + lease_duration",
    "provider_started_at = NULL",
    "public.delivery_cutover_allows_job(",
    "FOR UPDATE SKIP LOCKED",
  ]) {
    if (!effectiveClaimBody.includes(marker)) {
      fail(`${label}: effective claim_jobs repair lacks ${marker}`);
    }
  }
  const effectiveSettlement = effectiveRepairMigration.slice(
    effectiveRepairMigration.indexOf("CREATE OR REPLACE FUNCTION public.settle_delivery_cutover_blocked("),
    effectiveRepairMigration.indexOf("\n$$;", effectiveRepairMigration.indexOf("CREATE OR REPLACE FUNCTION public.settle_delivery_cutover_blocked(")),
  );
  if (!effectiveSettlement.includes("claim_state = 'failed'") ||
    !effectiveSettlement.includes("claim_expires_at = NULL")) {
    fail(`${label}: effective cutover settlement must close the durable claim envelope`);
  }

  // 1. claim_jobs mints a fresh cryptographically random token + monotonic generation.
  if (!migration.includes("fresh_claim_token uuid := gen_random_uuid();")) {
    fail(`${label}: claim_jobs must mint a fresh random claim token`);
  }
  if (!migration.includes("claim_token = fresh_claim_token")) {
    fail(`${label}: claim_jobs must atomically assign the fresh token`);
  }
  if (!migration.includes("claim_generation = COALESCE(claim_generation, 0) + 1")) {
    fail(`${label}: claim_jobs must monotonically increment the generation`);
  }
  if (!migration.includes("FOR UPDATE SKIP LOCKED")) {
    fail(`${label}: claim_jobs must preserve FOR UPDATE SKIP LOCKED`);
  }

  // 2. SECURITY DEFINER with empty/closed search_path and service_role-only grants.
  const definerBlocks = migration.match(/SECURITY DEFINER[\s\S]*?LANGUAGE plpgsql[\s\S]*?\$\$/g) ?? [];
  for (const block of definerBlocks) {
    if (!/SET search_path TO (public|pg_catalog)[,;]/.test(block)) {
      fail(`${label}: every SECURITY DEFINER function must carry a closed search_path`);
    }
  }
  const revokes = (migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length;
  const grantsService = (migration.match(/GRANT EXECUTE ON FUNCTION public\.[a-z_]+\([^)]*\) TO service_role/g) ?? []).length;
  if (revokes !== grantsService) {
    fail(`${label}: every new function must be revoked from public and granted to service_role only`);
  }

  // 3. Provider-start boundary marker exists and must return false when the fence is stale.
  if (!migration.includes("CREATE OR REPLACE FUNCTION public.mark_job_provider_started(")) {
    fail(`${label}: mark_job_provider_started is missing`);
  }
  if (!migration.includes("AND claim_token = p_claim_token")) {
    fail(`${label}: provider boundary must be fenced by the claim token`);
  }
  if (!migration.includes("AND claim_generation = p_claim_generation")) {
    fail(`${label}: provider boundary must be fenced by the claim generation`);
  }
  if (!migration.includes("RETURN v_updated = 1;")) {
    fail(`${label}: provider boundary must return false on a zero-row stale claim`);
  }

  // Runtime wiring (SF1): the worker must call the durable marker before any
  // side-effect-capable handler. Provider marker failure/rejection must abort
  // with zero provider calls.
  if (!lifecycle.includes("export async function markJobProviderStarted(")) {
    fail(`${label}: worker must expose markJobProviderStarted`);
  }
  if (!lifecycle.includes('supabase.rpc("mark_job_provider_started"')) {
    fail(`${label}: worker provider marker must invoke the mark_job_provider_started RPC`);
  }
  if (!worker.includes("markJobProviderStarted(supabase, job)")) {
    fail(`${label}: worker dispatch must call the provider-start marker before handlers`);
  }
  if (!worker.includes("job_provider_start_marker_failed")) {
    fail(`${label}: a failed provider marker must abort the job non-success (SF1)`);
  }
  if (!worker.includes("job_provider_start_marker_rejected")) {
    fail(`${label}: a rejected provider marker must NOT proceed to the provider (SF1)`);
  }
  // SF7 maintenance reachability: the worker must actually invoke the reconcile
  // RPC from its maintenance tail (not just define SQL that nothing calls).
  if (!worker.includes('supabase.rpc(\n        "reconcile_expired_job_claims"')) {
    fail(`${label}: worker maintenance must invoke reconcile_expired_job_claims (SF7)`);
  }
  if (!worker.includes("worker_claim_reconcile_failed")) {
    fail(`${label}: reconcile invocation must be best-effort-bounded (SF7)`);
  }

  // Runtime ordering proof (SF1 load-bearing with fakes): execute the REAL
  // transpiled withProviderBoundary helper and assert the durability ordering.
  //  (a) marker success precedes provider, and completion success => 'success'.
  {
    const order = [];
    const out = await executeFenceBoundary(fence, {
      markStarted: async () => { order.push("marker"); return true; },
      provider: async () => { order.push("provider"); return { ok: true }; },
      complete: async () => { order.push("complete"); return true; },
    });
    if (out.status !== "success") fail(`${label}: boundary success ordering (SF1)`);
    if (order.join(",") !== "marker,provider,complete") {
      fail(`${label}: marker must precede provider and complete (SF1): ${order.join(",")}`);
    }
  }
  //  (b) marker DB error => provider called ZERO times, marker_failed.
  {
    let providerCalls = 0;
    let markerErrors = 0;
    const out = await executeFenceBoundary(fence, {
      markStarted: async () => { throw new Error("db_down"); },
      provider: async () => { providerCalls += 1; return "x"; },
      complete: async () => true,
      onMarkerError: () => { markerErrors += 1; },
    });
    if (out.status !== "marker_failed") {
      fail(`${label}: marker DB error must be marker_failed (SF1)`);
    }
    if (providerCalls !== 0) {
      fail(`${label}: marker DB error must yield ZERO provider calls (SF1)`);
    }
    if (markerErrors !== 1) {
      fail(`${label}: marker DB error must route onMarkerError (SF1)`);
    }
  }
  //  (c) provider allowed but completion DB unknown/false => ambiguous, never success.
  {
    const out = await executeFenceBoundary(fence, {
      markStarted: async () => true,
      provider: async () => ({ posted: true }),
      complete: async () => false,
    });
    if (out.status !== "ambiguous" || out.completionSucceeded !== false) {
      fail(`${label}: provider-allowed-but-completion-false must be ambiguous (SF1)`);
    }
  }
  //  (d) marker rejected (zero-row fence) => provider never called.
  {
    let providerCalls = 0;
    const out = await executeFenceBoundary(fence, {
      markStarted: async () => false,
      provider: async () => { providerCalls += 1; return "x"; },
      complete: async () => true,
    });
    if (out.status !== "marker_rejected") {
      fail(`${label}: rejected marker must be marker_rejected (SF1)`);
    }
    if (providerCalls !== 0) {
      fail(`${label}: rejected marker must never call the provider (SF1)`);
    }
  }

  // SF3: the unsafe pre-generation 10-arg complete/fail overloads must be
  // explicitly DROPPED so no fenceless completion surface remains.
  if (!migration.includes("DROP FUNCTION IF EXISTS public.complete_x_post_delivery(uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text)")) {
    fail(`${label}: old 10-arg complete_x_post_delivery overload must be dropped (SF3)`);
  }
  if (!migration.includes("DROP FUNCTION IF EXISTS public.fail_x_post_delivery(uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text)")) {
    fail(`${label}: old 10-arg fail_x_post_delivery overload must be dropped (SF3)`);
  }

  // SF4: p_force_retry must be enforced server-side from authoritative receipt state.
  if (!migration.includes("IF FOUND AND NOT COALESCE(p_force_retry, false) THEN")) {
    fail(`${label}: claim must enforce force_retry against prior failed/skipped (SF4)`);
  }
  if (!migration.includes("AND status IN ('failed', 'skipped')")) {
    fail(`${label}: claim must inspect prior failed/skipped receipt state (SF4)`);
  }

  // SF5: claim_jobs must be revoked from public, anon, AND authenticated.
  if (!migration.includes("REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text) FROM public, anon, authenticated;")) {
    fail(`${label}: claim_jobs must be revoked from public, anon, authenticated (SF5)`);
  }

  // SF7: expired-running job recovery with token semantics + reconcile path.
  if (!migration.includes("CREATE OR REPLACE FUNCTION public.reconcile_expired_job_claims(")) {
    fail(`${label}: expired-running reconcile function is missing (SF7)`);
  }
  if (!migration.includes("AND j.provider_started_at IS NULL")) {
    fail(`${label}: reconcile must only requeue never-provider-started jobs (SF7)`);
  }
  if (!migration.includes("claim_token = NULL,")) {
    fail(`${label}: reconcile must invalidate the stale claim token (SF7)`);
  }
  if (!migration.includes("AND j.provider_started_at IS NOT NULL")) {
    fail(`${label}: reconcile must treat provider-started expired claims as ambiguous (SF7)`);
  }

  // 4. The lifecycle writer must embed, validate, and eq-fence token+generation+state.
  if (!lifecycle.includes('const values: Record<string, unknown> = { ...patch };')) {
    fail(`${label}: updateJobOrThrow must copy the patch before stripping reserved keys`);
  }
  if (!lifecycle.includes('delete values[CLAIM_TOKEN_PATCH_KEY];')) {
    fail(`${label}: updateJobOrThrow must strip the token reserved key before writing`);
  }
  if (!lifecycle.includes('delete values[CLAIM_GENERATION_PATCH_KEY];')) {
    fail(`${label}: updateJobOrThrow must strip the generation reserved key before writing`);
  }
  if (!lifecycle.includes('delete values[CLAIM_STATE_PATCH_KEY];')) {
    fail(`${label}: updateJobOrThrow must strip the state reserved key before writing`);
  }
  if (!lifecycle.includes('assertClaimEnvelope(')) {
    fail(`${label}: updateJobOrThrow must validate the claim envelope before touching the database`);
  }
  if (!lifecycle.includes('updateQuery = updateQuery.eq("claim_token", claimToken);')) {
    fail(`${label}: lifecycle checked write must gate on the claim token`);
  }
  if (!lifecycle.includes('updateQuery = updateQuery.eq("claim_generation", claimGeneration);')) {
    fail(`${label}: lifecycle checked write must gate on the claim generation`);
  }
  if (!lifecycle.includes('updateQuery = updateQuery.eq("locked_by", owner);')) {
    fail(`${label}: lifecycle checked write must retain the owner fence`);
  }
  if (!lifecycle.includes('updateQuery = updateQuery.eq("claim_state", expectedClaimState);')) {
    fail(`${label}: lifecycle checked write must gate on the claim state`);
  }

  // 5. The claim envelope abstraction must carry token+generation+state.
  if (!lifecycle.includes('from "../_shared/durableClaimFence.ts"')) {
    fail(`${label}: jobLifecycle must import the durable claim fence module`);
  }
  if (!lifecycle.includes('const enveloped = embedClaimEnvelope(patch, job);')) {
    fail(`${label}: claimEnvelopedPatch must embed the token/generation envelope`);
  }
  if (!lifecycle.includes('const expectedState = claimState ??')) {
    fail(`${label}: claimEnvelopedPatch must derive an expected claim state`);
  }
  if (!lifecycle.includes('enveloped[CLAIM_STATE_PATCH_KEY] = expectedState;')) {
    fail(`${label}: claimEnvelopedPatch must apply the state fence`);
  }

  // Runtime proof: the durableClaimFence helpers fail closed and carry token+generation.
  proveDurableClaimEnvelope(fence, label);

  // 6. Worker and lifecycle terminal transitions must pass the envelope to the fenced helper.
  assertUpdateJobOrThrowWrapped(lifecycle, lifecyclePath, label);
  assertUpdateJobOrThrowWrapped(worker, workerPath, label);

  // 7. package + CI wiring.
  const pkg = JSON.parse(packageJson);
  if (pkg.scripts?.["check:b3a-job-fence"] !== "node scripts/check-b3a-job-fence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:b3a-job-fence")) {
    fail(`${label}: CI contract is missing`);
  }
}

function sources() {
  return {
    lifecycle: fs.readFileSync(lifecyclePath, "utf8"),
    worker: fs.readFileSync(workerPath, "utf8"),
    fence: fs.readFileSync(fenceSourcePath, "utf8"),
    migration: fs.readFileSync(migrationPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

async function assertRejects(mutator, label) {
  try {
    await assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("B3A_JOB_FENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

await assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  await (async () => {
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace("claim_token = fresh_claim_token", "claim_token = claim_token"),
    }), "removed fresh claim token mint");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace("claim_generation = COALESCE(claim_generation, 0) + 1", "claim_generation = 0"),
    }), "removed monotonic generation increment");
    await assertRejects((s) => ({
      ...s,
      lifecycle: s.lifecycle.replace('updateQuery = updateQuery.eq("claim_token", claimToken);', "// removed claim token fence"),
    }), "removed claim token equality fence");
    await assertRejects((s) => ({
      ...s,
      lifecycle: s.lifecycle.replace('updateQuery = updateQuery.eq("claim_generation", claimGeneration);', "// removed claim generation fence"),
    }), "removed claim generation equality fence");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(/FOR UPDATE SKIP LOCKED/g, "FOR UPDATE"),
    }), "removed SKIP LOCKED");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(/AND claim_token = p_claim_token/g, "AND locked_by IS NOT NULL"),
    }), "removed provider-boundary claim token fence");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(
        "DROP FUNCTION IF EXISTS public.complete_x_post_delivery(uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text);",
        "-- old complete overload retained",
      ),
    }), "old 10-arg complete overload must be dropped (SF3)");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(
        "IF FOUND AND NOT COALESCE(p_force_retry, false) THEN",
        "IF FOUND THEN",
      ),
    }), "force_retry enforcement removed (SF4)");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(
        "REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text) FROM public, anon, authenticated;",
        "REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text) FROM public, anon;",
      ),
    }), "claim_jobs authenticated revoke removed (SF5)");
    await assertRejects((s) => ({
      ...s,
      migration: s.migration.replace(
        "AND j.provider_started_at IS NULL",
        "AND j.provider_started_at IS NOT NULL",
      ),
    }), "reconcile requeue of never-provider-started jobs removed (SF7)");
    await assertRejects((s) => ({
      ...s,
      worker: s.worker.replace("await markJobProviderStarted(supabase, job);", "await Promise.resolve(true);"),
    }), "worker provider-start marker skipped (SF1)");
    await assertRejects((s) => ({
      ...s,
      worker: s.worker.replaceAll("job_provider_start_marker_rejected", "provider_ok"),
    }), "rejected provider marker not fail-closed (SF1)");

    // B3A envelope adversarial mutations: a broken envelope must be rejected.
    await assertRejects((s) => ({
      ...s,
      lifecycle: s.lifecycle.replace(
        'const enveloped = embedClaimEnvelope(patch, job);',
        'const enveloped = { ...patch };',
      ),
    }), "claimEnvelopedPatch no longer embeds the token/generation envelope");
    await assertRejects((s) => ({
      ...s,
      lifecycle: s.lifecycle.replace(
        'enveloped[CLAIM_STATE_PATCH_KEY] = expectedState;',
        '// state fence removed',
      ),
    }), "claimEnvelopedPatch no longer applies the state fence");
    await assertRejects((s) => ({
      ...s,
      worker: s.worker.replace(
        'claimEnvelopedPatch(job, {',
        '({',
      ),
    }), "worker terminal transition uses a broken envelope");
    await assertRejects((s) => ({
      ...s,
      fence: s.fence.replace(
        '[CLAIM_TOKEN_PATCH_KEY]: envelope.claimToken,',
        '// token removed',
      ),
    }), "embedClaimEnvelope no longer carries the token");
    await assertRejects((s) => ({
      ...s,
      fence: s.fence.replace(
        '[CLAIM_GENERATION_PATCH_KEY]: envelope.claimGeneration,',
        '// generation removed',
      ),
    }), "embedClaimEnvelope no longer carries the generation");
  })();
}

console.log(`B3A_JOB_FENCE_SOURCE_CONTRACT_PASS token=fresh generation=monotonic envelope=token,generation,state providerBoundary=fenced selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

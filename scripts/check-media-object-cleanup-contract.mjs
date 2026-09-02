// AIR-001 offline contract: media object ownership and deletion-claim source.
//
// Runs entirely without Deno, a database, a Supabase client, the network, a
// build, or the server. Deno is never invoked. It:
//   1. statically parses/transpiles the runtime + Deno test sources with the
//      committed TypeScript compiler (pure parse/transpile, no net);
//   2. checks the migration + sources for the required fail-closed contract
//      markers;
//   3. runs a pure-Node in-memory model of the database RPC semantics
//      (media_objects_claim_old / media_objects_finalize_delete) and asserts the
//      AIR-001 behaviors directly;
//   4. transpiles the real runtime (legacyMediaCleanup.ts) to a throwaway CJS
//      module in the OS temp dir and drives runMediaObjectCleanup against the
//      model-backed client, proving the runtime binds the exact RPC names and
//      fails closed (storage failure => zero finalize/zero DB clear; immediate
//      rerun sees the active lease / no work).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/20260806123000_media_object_cleanup_claims.sql",
);
const runtimePath = path.join(
  repoRoot,
  "supabase/functions/_shared/legacyMediaCleanup.ts",
);
const runnerPath = path.join(
  repoRoot,
  "supabase/functions/media-processor/cleanupOldMedia.ts",
);
const denoTestPath = path.join(
  repoRoot,
  "supabase/functions/_shared/legacyMediaCleanup.test.ts",
);
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

export const CLAIM_RPC = "media_objects_claim_old";
export const FINALIZE_RPC = "media_objects_finalize_delete";
export const PREVIEW_RPC = "media_objects_preview_old";

function fail(message) {
  throw new Error(`MEDIA_OBJECT_CLEANUP_CONTRACT_FAIL ${message}`);
}

function parseSource(source, label) {
  const sourceFile = ts.createSourceFile(
    `virtual/${label}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail(`${label}: parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: `virtual/${label}.ts`,
  });
  if ((transpiled.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: transpilation diagnostics`);
  }
  return transpiled.outputText;
}

// ---------------------------------------------------------------------------
// Static contract markers
// ---------------------------------------------------------------------------

function assertSecurityContract() {
  const migration = fs.readFileSync(migrationPath, "utf8");
  for (const needle of [
    "SECURITY DEFINER",
    "SET search_path TO public, pg_catalog",
    "FOR UPDATE SKIP LOCKED",
    "status = 'deleting'",
    "REVOKE ALL ON FUNCTION public.media_objects_claim_old",
    "GRANT EXECUTE ON FUNCTION public.media_objects_claim_old",
    "REVOKE ALL ON FUNCTION public.media_objects_finalize_delete",
    "GRANT EXECUTE ON FUNCTION public.media_objects_finalize_delete",
    "FOR UPDATE",
  ]) {
    if (!migration.includes(needle)) fail(`migration missing: ${needle}`);
  }
  if (!/REVOKE ALL ON TABLE public\.media_objects FROM public, anon, authenticated/.test(migration)) {
    fail("migration must revoke registry table access from public roles");
  }
  if (!/status IN \('active',\s*'deleting',\s*'deleted'\)/.test(migration) &&
      !/status IN \('active','deleting','deleted'\)/.test(migration)) {
    fail("migration must declare the active/deleting/deleted lifecycle");
  }
  if (!/UNIQUE\s*\(bucket_id,\s*storage_path\)/.test(migration)) {
    fail("migration must declare bucket+path unique ownership");
  }
  if (!/BEFORE INSERT OR UPDATE OF storage_path/.test(migration)) {
    fail("migration must guard storage_path attachment via a BEFORE trigger");
  }
  if (!/object_id\s+uuid\s+REFERENCES public\.media_objects/.test(migration)) {
    fail("migration must add a nullable media.object_id FK");
  }
  // O1: attachment trigger must be SECURITY DEFINER with locked empty search_path
  // and direct execute revoked from public roles.
  if (!/FUNCTION public\.media_objects_attach_guard/.test(migration)) {
    fail("migration must define the attach guard function");
  }
  if (!/FUNCTION public\.media_objects_attach_guard[\s\S]{0,200}?SECURITY DEFINER/.test(migration)) {
    fail("migration attach guard must be SECURITY DEFINER (in its own signature window)");
  }
  if (!/REVOKE ALL ON FUNCTION public\.media_objects_attach_guard\(\) FROM public, anon, authenticated/.test(migration)) {
    fail("migration attach guard execute must be revoked from public roles");
  }
  // F4 preview RPC + shared eligibility helper must exist and be revoke-locked.
  if (!migration.includes(PREVIEW_RPC)) {
    fail("migration must define the read-only preview RPC for dry-run");
  }
  if (!/media_objects_preview_old\(text,int,int\)/.test(migration)) {
    fail("migration preview RPC signature missing");
  }
  if (!/REVOKE ALL ON FUNCTION public\.media_objects_preview_old/.test(migration)) {
    fail("migration preview RPC execute must be revoked from public roles");
  }
  if (!migration.includes("_media_object_eligible")) {
    fail("migration must factor shared eligibility into _media_object_eligible");
  }
  // finalize must accept ONLY the exact 'deleting' status. A lexical less-than
  // comparison (v_status < 'deleting') would also admit 'deleted', letting an
  // already-finalized object be cleared again. Require exact equality and
  // forbid the lexical comparison in the finalize function.
  if (!/v_status\s*<>\s*'deleting'/.test(migration)) {
    fail("migration finalize must require exact 'deleting' status (v_status <> 'deleting')");
  }
  if (/v_status\s*<\s*'deleting'/.test(migration)) {
    fail("migration finalize must NOT use lexical v_status < 'deleting' (would admit 'deleted')");
  }

  const runtime = fs.readFileSync(runtimePath, "utf8");
  const runner = fs.readFileSync(runnerPath, "utf8");
  for (const needle of [CLAIM_RPC, FINALIZE_RPC]) {
    if (!runtime.includes(needle) || !runner.includes(needle)) {
      fail(`runtime/runner must bind exact RPC ${needle}`);
    }
  }
  if (!runtime.includes(PREVIEW_RPC)) {
    fail("runtime must bind the preview RPC");
  }
  if (!runner.includes("media_objects_preview_old")) {
    fail("runner must bind the preview RPC");
  }
  if (!/media_object_claim_failed/.test(runtime)) {
    fail("runtime must fail closed with a bounded claim-failure code");
  }
  if (!/media_object_claim_invalid/.test(runtime)) {
    fail("runtime must fail closed with a bounded claim-invalid code");
  }
  if (!/media_object_preview_failed|media_object_preview_invalid/.test(runtime)) {
    fail("runtime must fail closed on a malformed preview result");
  }
  if (/\.error\.message|queryError\.message|renderQueryError\.message|deno-lint-ignore no-explicit-any/.test(runtime) ||
      /queryError\.message|renderQueryError\.message|deno-lint-ignore no-explicit-any/.test(runner)) {
    fail("runtime/runner must not leak raw provider/database error text");
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (pkg.scripts?.["check:media-object-cleanup"] !== "node scripts/check-media-object-cleanup-contract.mjs") {
    fail("package script check:media-object-cleanup is missing or miswired");
  }
  const ci = fs.readFileSync(ciPath, "utf8");
  if (!ci.includes("- run: npm run check:media-object-cleanup")) {
    fail("hosted CI contract for check:media-object-cleanup is missing");
  }
}

// ---------------------------------------------------------------------------
// In-memory model of the AIR-001 database contract
// ---------------------------------------------------------------------------

const HOUR_MS = 3600_000;
const LEASE_MS = 10 * 60_000;
function ageMs(days) {
  return Math.round(days * 24 * HOUR_MS);
}

class Model {
  constructor() {
    this.nowMs = Date.now();
    this.objects = new Map();
    this.media = new Map();
    this.nextId = 1;
    this.rejectedAttaches = [];
  }

  addMedia(mediaId, storagePath, opts = {}) {
    const owner = this.objectByPath(storagePath);
    if (owner && owner.status !== "active") {
      this.rejectedAttaches.push({ storagePath, status: owner.status });
      return false;
    }
    let objectId = owner?.id ?? null;
    if (!objectId) {
      objectId = `obj-${this.nextId++}`;
      this.objects.set(objectId, {
        id: objectId,
        bucket_id: "temp-media",
        storage_path: storagePath,
        status: "active",
        deletion_token: null,
        claimed_at: null,
        claim_expires_at: null,
        mime_type: opts.mime_type ?? null,
        expired_delete_at: opts.expired_delete_at ?? null,
      });
    }
    const downloadedAt = opts.downloaded_at ?? (this.nowMs - ageMs(opts.ageDays ?? 0));
    this.media.set(mediaId, {
      id: mediaId,
      storage_path: storagePath,
      downloaded_at: downloadedAt,
      kind: opts.kind ?? "image",
      mime_type: opts.mime_type ?? "image/jpeg",
      object_id: objectId,
      file_size: opts.ageDays ? 1024 : null,
    });
    return true;
  }

  objectByPath(storagePath) {
    for (const obj of this.objects.values()) if (obj.storage_path === storagePath) return obj;
    return null;
  }

  refsByPath(storagePath) {
    return [...this.media.values()].filter((m) => m.storage_path === storagePath);
  }

  eligible({ daysOld = 90, nowMs = this.nowMs } = {}) {
    const cutoff = nowMs - ageMs(daysOld);
    const out = [];
    for (const obj of this.objects.values()) {
      // An object is claimable if it is old and NOT under a live lease.
      //   - active: always stable unless under a live lease from a prior claim.
      //   - deleting: reclaimable ONLY once the prior lease has expired; a live
      //     deleting lease blocks immediate reclaim. Status stays 'deleting',
      //     so a late reference can never attach.
      const liveLease = obj.claim_expires_at && obj.claim_expires_at > nowMs;
      if (liveLease) continue;
      if (obj.status !== "active" && obj.status !== "deleting") continue;
      const refs = this.refsByPath(obj.storage_path);
      if (refs.length === 0) continue;
      const hasOld = refs.some((m) => m.downloaded_at && m.downloaded_at < cutoff);
      const hasFresh = refs.some((m) => !m.downloaded_at || m.downloaded_at >= cutoff);
      if (!hasOld || hasFresh) continue;
      out.push(obj);
    }
    return out;
  }

  claimOld({ max = 100, daysOld = 90, nowMs = this.nowMs } = {}) {
    const claimed = [];
    for (const obj of this.eligible({ daysOld, nowMs })) {
      if (claimed.length >= max) break;
      obj.status = "deleting"; // active->deleting first claim; deleting->deleting reclaim
      obj.deletion_token = `tok-${obj.id}-${obj.claimed_at ?? "first"}`;
      obj.claimed_at = nowMs;
      obj.claim_expires_at = nowMs + LEASE_MS;
      claimed.push({
        object_id: obj.id,
        bucket: obj.bucket_id,
        storage_path: obj.storage_path,
        mime_type: obj.mime_type ?? null,
        deletion_token: obj.deletion_token,
      });
    }
    return claimed;
  }

  preview({ daysOld = 90, max = 100, nowMs = this.nowMs } = {}) {
    // Read-only: same physical-object eligibility as claim, but NO state change.
    const eligible = this.eligible({ daysOld, nowMs });
    return {
      count: Math.min(eligible.length, max),
      objects: eligible.slice(0, max).map((obj) => ({
        object_id: obj.id,
        storage_path: obj.storage_path,
      })),
    };
  }

  finalizeDelete({ p_object_id, p_deletion_token: token }, nowMs = this.nowMs) {
    const obj = this.objects.get(p_object_id);
    if (!obj) return false;
    // Status must be EXACTLY 'deleting' (not active, not deleted).
    if (obj.status !== "deleting" || !obj.deletion_token || token !== obj.deletion_token) return false;
    if (!obj.claim_expires_at || obj.claim_expires_at < nowMs) return false;
    for (const [, m] of this.media) {
      if (m.storage_path === obj.storage_path) {
        m.storage_path = null;
        m.downloaded_at = null;
        m.file_size = null;
        m.mime_type = null;
      }
    }
    obj.status = "deleted";
    obj.claim_expires_at = null;
    obj.deleted_at = nowMs;
    return true;
  }
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function runModelHarness() {
  // 1. mixed-age shared path => zero claimed/deleted, fresh survives.
  {
    const m = new Model();
    m.addMedia("old-1", "shared.jpg", { ageDays: 120 });
    m.addMedia("fresh-1", "shared.jpg", { ageDays: 2 });
    const claimed = m.claimOld({ daysOld: 90 });
    assertEqual(claimed.length, 0, "mixed-age shared path claims zero");
    assertEqual(m.media.get("fresh-1").storage_path, "shared.jpg", "fresh shared-path ref survives");
    assertEqual(m.media.get("fresh-1").downloaded_at !== null, true, "fresh ref not cleared");
  }
  // 2. Duplicate old refs, same path => one claim/delete/finalize.
  {
    const m = new Model();
    m.addMedia("old-a", "dup/a.jpg", { ageDays: 120 });
    m.addMedia("old-b", "dup/a.jpg", { ageDays: 140 });
    const claimed = m.claimOld({ daysOld: 90 });
    assertEqual(claimed.length, 1, "duplicate old refs claim one physical object");
    assertEqual(claimed[0].storage_path, "dup/a.jpg", "claimed path correct");
    const cleared = m.finalizeDelete({
      p_object_id: claimed[0].object_id,
      p_deletion_token: claimed[0].deletion_token,
    });
    assertEqual(cleared, true, "duplicate-old finalize succeeds once");
    assertEqual(m.media.get("old-a").storage_path, null, "duplicate old ref A cleared");
    assertEqual(m.media.get("old-b").storage_path, null, "duplicate old ref B cleared");
  }
  // 3. Storage failure => zero finalize / zero DB clear; immediate retry sees no work.
  {
    const m = new Model();
    m.addMedia("old-1", "fail/s.jpg", { ageDays: 120 });
    const claimed = m.claimOld({ daysOld: 90 });
    assertEqual(claimed.length, 1, "eligible object claimed");
    assertEqual(m.objects.get(claimed[0].object_id).status, "deleting", "lease held after storage failure");
    assertEqual(m.claimOld({ daysOld: 90 }).length, 0, "immediate rerun sees active lease, no work");
  }
  // 4. Stale/wrong token rejected; fresh token succeeds once; repeat idempotent.
  {
    const m = new Model();
    m.addMedia("old-1", "t.jpg", { ageDays: 120 });
    const claimed = m.claimOld({ daysOld: 90 });
    assertEqual(m.finalizeDelete({ p_object_id: claimed[0].object_id, p_deletion_token: "tok-wrong" }), false, "wrong token rejected");
    assertEqual(m.finalizeDelete({ p_object_id: claimed[0].object_id, p_deletion_token: claimed[0].deletion_token }), true, "fresh token succeeds once");
    assertEqual(m.finalizeDelete({ p_object_id: claimed[0].object_id, p_deletion_token: claimed[0].deletion_token }), false, "repeat finalize idempotent (non-success)");
  }
  // 4b. Exact-equality: a 'deleted' object cannot be finalized even if a token
  //     were somehow still held (only EXACTLY 'deleting' is accepted).
  {
    const m = new Model();
    m.addMedia("old-1", "del.jpg", { ageDays: 120 });
    const claimed = m.claimOld({ daysOld: 90 });
    const obj = m.objects.get(claimed[0].object_id);
    obj.status = "deleted"; // simulate an already-finalized object retaining its token
    assertEqual(m.finalizeDelete({ p_object_id: obj.id, p_deletion_token: obj.deletion_token }), false, "deleted status rejects finalize even with matching token");
  }
  // 5. Late reference attachment while deleting rejected.
  {
    const m = new Model();
    m.addMedia("old-1", "l.jpg", { ageDays: 120 });
    const claimed = m.claimOld({ daysOld: 90 });
    assertEqual(claimed.length, 1, "late-attach fixture claims an object");
    assertEqual(m.addMedia("late-fresh", "l.jpg", { ageDays: 1 }), false, "late reference to deleting object rejected");
    assertEqual(m.rejectedAttaches.length, 1, "late attach recorded as rejected");
  }
  // 6. Stranded deleting reclaim after lease expiry (F2): a live deleting lease
  //    blocks immediate reclaim, but once expired the same object is reclaimable
  //    with a fresh token; old token cannot finalize, new token finalizes once,
  //    replay fails. Late attachment stays rejected throughout.
  {
    const m = new Model();
    m.addMedia("old-1", "strand.jpg", { ageDays: 120 });
    const first = m.claimOld({ daysOld: 90 });
    assertEqual(first.length, 1, "stranded fixture claims once");
    assertEqual(m.claimOld({ daysOld: 90 }).length, 0, "live deleting lease blocks immediate reclaim");
    const t0 = m.nowMs + LEASE_MS + 1000; // lease fully expired
    assertEqual(m.claimOld({ daysOld: 90, nowMs: t0 }).length, 1, "expired deleting lease is reclaimable");
    // immediately after the reclaim (within its fresh lease) there is no double-take
    assertEqual(m.claimOld({ daysOld: 90, nowMs: t0 }).length, 0, "the reclaimed object now has a fresh lease (no double-take)");
  }
  // 6b. Old token cannot finalize after a new claim; new token finalizes once; replay fails.
  {
    const m = new Model();
    m.addMedia("old-1", "t2.jpg", { ageDays: 120 });
    const first = m.claimOld({ daysOld: 90 });
    const oldToken = first[0].deletion_token;
    // simulate a reclaim at the clock advance, reclaim, get fresh token.
    const t = m.nowMs + LEASE_MS + 1000;
    const reclaimed = m.claimOld({ daysOld: 90, nowMs: t });
    const newToken = reclaimed[0].deletion_token;
    assertEqual(reclaimed[0].object_id, first[0].object_id, "same physical object reclaimed");
    assertEqual(oldToken !== newToken, true, "reclaim issues a fresh token");
    assertEqual(m.finalizeDelete({ p_object_id: first[0].object_id, p_deletion_token: oldToken }, t), false, "old token cannot finalize after new claim");
    assertEqual(m.finalizeDelete({ p_object_id: first[0].object_id, p_deletion_token: newToken }, t), true, "new token finalizes once");
    assertEqual(m.finalizeDelete({ p_object_id: first[0].object_id, p_deletion_token: newToken }, t), false, "replay finalize fails (idempotent non-success)");
  }
  // 7. Preview (F4): dry-run count equals claim count under the same contract,
  //    produces no mutation, and counts physical objects (one per exact path).
  {
    const m = new Model();
    m.addMedia("old-1", "prev/d.jpg", { ageDays: 120 });
    m.addMedia("old-2", "prev/d.jpg", { ageDays: 140 }); // same physical path => one object
    m.addMedia("fresh-1", "prev/f.jpg", { ageDays: 1 });
    const preview = m.preview({ daysOld: 90 });
    assertEqual(preview.count, 1, "preview counts one physical object for a shared old path");
    assertEqual(preview.objects[0].storage_path, "prev/d.jpg", "preview reports the exact path");
    const claimCount = m.claimOld({ daysOld: 90 }).length;
    assertEqual(preview.count, claimCount, "preview count equals claim count for same snapshot");
  }
}

// ---------------------------------------------------------------------------
// Runtime end-to-end harness
// ---------------------------------------------------------------------------

function makeModelClient(m, calls, removeError = null) {
  return {
    async rpc(name, args) {
      if (name === CLAIM_RPC) {
        return { data: m.claimOld({ daysOld: args?.p_days_old ?? 90 }), error: null };
      }
      if (name === FINALIZE_RPC) {
        calls.finalized.push({
          p_object_id: args?.p_object_id,
          p_deletion_token: args?.p_deletion_token,
        });
        const ok = m.finalizeDelete({
          p_object_id: args?.p_object_id,
          p_deletion_token: args?.p_deletion_token,
        });
        return { data: ok, error: null };
      }
      if (name === PREVIEW_RPC) {
        return { data: m.preview({ daysOld: args?.p_days_old ?? 90 }).objects, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from() {
        return {
          async remove(paths) {
            calls.removed.push([...paths]);
            return { error: removeError };
          },
        };
      },
    },
  };
}

async function runRuntimeHarness() {
  const output = parseSource(fs.readFileSync(runtimePath, "utf8"), "legacyMediaCleanup");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xot-air001-"));
  try {
    const modPath = path.join(tmpDir, "legacyMediaCleanup.cjs");
    fs.writeFileSync(modPath, output);
    const _require = createRequire(path.join(tmpDir, "xot.cjs"));
    const mod = _require(modPath);
    if (!mod || typeof mod.runMediaObjectCleanup !== "function") {
      fail("runtime module did not export runMediaObjectCleanup");
    }
    const { runMediaObjectCleanup } = mod;

    // duplicate old refs to one path => one physical deletion signal.
    const m = new Model();
    m.addMedia("old-1", "dup/a.jpg", { ageDays: 120 });
    m.addMedia("old-2", "dup/a.jpg", { ageDays: 140 });
    const calls = { removed: [], finalized: [] };
    const client = makeModelClient(m, calls);
    const run = await runMediaObjectCleanup(client, { daysOld: 90 });
    assertEqual(run.claimedCount, 1, "runtime claimed one physical object");
    assertEqual(run.deletedCount, 1, "runtime deleted one physical object (not two rows)");
    assertEqual(run.failedCount, 0, "runtime failed zero");
    assertEqual(calls.removed.length, 1, "runtime storage remove once per physical object");
    assertEqual(calls.finalized.length, 1, "runtime finalize once per physical object");

    // storage failure => zero finalize, zero DB clear, lease retained.
    const m2 = new Model();
    m2.addMedia("old-1", "dup/f.jpg", { ageDays: 120 });
    const calls2 = { removed: [], finalized: [] };
    const client2 = makeModelClient(m2, calls2, new Error("storage unavailable"));
    const run2 = await runMediaObjectCleanup(client2, { daysOld: 90 });
    assertEqual(run2.deletedCount, 0, "storage failure: zero deleted");
    assertEqual(run2.failedCount, 1, "storage failure: one failed");
    assertEqual(calls2.finalized.length, 0, "storage failure: zero finalize / zero DB clear");
    const firstObjectId = m2.objects.keys().next().value;
    assertEqual(m2.objects.get(firstObjectId).status, "deleting", "storage failure: lease retained");

    // F1: a malformed claim row must FAIL CLOSED (throw) before any storage call.
    const m3 = new Model();
    const malformedClient = {
      async rpc(name) {
        if (name === CLAIM_RPC) return { data: [{ object_id: "o", storage_path: "p", bucket: "temp-media" }], error: null };
        throw new Error("unexpected rpc");
      },
      storage: { from() { throw new Error("unexpected storage mutation"); } },
    };
    let malformedThrew = false;
    try {
      await runMediaObjectCleanup(malformedClient, { daysOld: 90 });
    } catch (error) {
      malformedThrew = String(error).includes("media_object_claim_invalid");
    }
    if (!malformedThrew) fail("malformed claim row must fail closed");

    // F4: previewObjectCleanup returns physical-object count with no mutation.
    const m4 = new Model();
    m4.addMedia("old-1", "pre/d.jpg", { ageDays: 120 });
    m4.addMedia("old-2", "pre/d.jpg", { ageDays: 140 });
    const previewCalls = { removed: [], finalized: [] };
    const previewClient = makeModelClient(m4, previewCalls);
    const previewResult = await mod.previewObjectCleanup(previewClient, { daysOld: 90 });
    assertEqual(previewResult.count, 1, "preview counts one physical object");
    assertEqual(previewResult.objects.length, 1, "preview returns one object");
    assertEqual(previewCalls.removed.length, 0, "preview performs no storage remove");
    assertEqual(previewCalls.finalized.length, 0, "preview performs no finalize");
    assertEqual(m4.objects.get(m4.objects.keys().next().value).status, "active", "preview does not mutate status");

    // F2: expired deleting reclaim via runtime+model (storage failure then lease expiry).
    const m5 = new Model();
    m5.addMedia("old-1", "reclaim/f.jpg", { ageDays: 120 });
    const calls5 = { removed: [], finalized: [] };
    const client5 = makeModelClient(m5, calls5, new Error("storage unavailable"));
    await runMediaObjectCleanup(client5, { daysOld: 90 }); // claim -> storage fail, lease retained
    assertEqual(m5.objects.get([...m5.objects.keys()][0]).status, "deleting", "stranded deleting after storage failure");
    assertEqual(m5.claimOld({ daysOld: 90 }).length, 0, "immediate rerun sees live deleting lease");
    // advance clock past expiry; the object becomes reclaimable again
    assertEqual(m5.claimOld({ daysOld: 90, nowMs: m5.nowMs + LEASE_MS + 1000 }).length, 1, "expired deleting lease reclaimable");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

parseSource(fs.readFileSync(runtimePath, "utf8"), "legacyMediaCleanup");
parseSource(fs.readFileSync(runnerPath, "utf8"), "cleanupOldMedia");
parseSource(fs.readFileSync(denoTestPath, "utf8"), "legacyMediaCleanup.test");
assertSecurityContract();
runModelHarness();
await runRuntimeHarness();

console.log("MEDIA_OBJECT_CLEANUP_SOURCE_CONTRACT_PASS model=claim-finalize-attach+reclaim+preview runtime=end-to-end security=fail-closed");

if (process.env.MUTATION_TEST === "1") {
  const mutantDefiner = fs.readFileSync(migrationPath, "utf8").split("SECURITY DEFINER").join("");
  if (mutantDefiner.includes("SECURITY DEFINER")) fail("could not construct SECURITY DEFINER mutant");
  let rejectedDefiner = false;
  const originalMig = fs.readFileSync(migrationPath, "utf8");
  fs.writeFileSync(migrationPath, mutantDefiner);
  try {
    assertSecurityContract();
  } catch (error) {
    rejectedDefiner = String(error).includes("MEDIA_OBJECT_CLEANUP_CONTRACT_FAIL");
  } finally {
    fs.writeFileSync(migrationPath, originalMig);
  }
  if (!rejectedDefiner) fail("SECURITY DEFINER removal mutant survived");

  // O1: removing SECURITY DEFINER specifically from the attach guard must be rejected.
  let rejectedGuardDefiner = false;
  const mutantGuard = originalMig.replace(
    /FUNCTION public\.media_objects_attach_guard[\s\S]{0,200}?SECURITY DEFINER/,
    (match) => {
      // strip the SECURITY DEFINER but keep the rest of the signature intact
      return match.split("SECURITY DEFINER").join("");
    },
  );
  fs.writeFileSync(migrationPath, mutantGuard);
  try {
    assertSecurityContract();
  } catch (error) {
    rejectedGuardDefiner = String(error).includes("MEDIA_OBJECT_CLEANUP_CONTRACT_FAIL");
  } finally {
    fs.writeFileSync(migrationPath, originalMig);
  }
  if (!rejectedGuardDefiner) fail("attach-guard SECURITY DEFINER removal mutant survived");

  let rejectedSkip = false;
  const mutantSkip = originalMig.split("FOR UPDATE SKIP LOCKED").join("FOR UPDATE");
  if (mutantSkip.includes("FOR UPDATE SKIP LOCKED")) fail("could not mutate FOR UPDATE SKIP LOCKED");
  fs.writeFileSync(migrationPath, mutantSkip);
  try {
    assertSecurityContract();
  } catch (error) {
    rejectedSkip = String(error).includes("MEDIA_OBJECT_CLEANUP_CONTRACT_FAIL");
  } finally {
    fs.writeFileSync(migrationPath, originalMig);
  }
  if (!rejectedSkip) fail("FOR UPDATE SKIP LOCKED removal mutant survived");

  // Exact-equality finalize: reverting to lexical v_status < 'deleting' (which
  // would admit 'deleted') must be rejected by the source contract.
  let rejectedLexical = false;
  const mutantLexical = originalMig.split("v_status <> 'deleting'").join("v_status < 'deleting'");
  if (mutantLexical.includes("v_status <> 'deleting'")) fail("could not construct lexical < 'deleting' mutant");
  fs.writeFileSync(migrationPath, mutantLexical);
  try {
    assertSecurityContract();
  } catch (error) {
    rejectedLexical = String(error).includes("MEDIA_OBJECT_CLEANUP_CONTRACT_FAIL");
  } finally {
    fs.writeFileSync(migrationPath, originalMig);
  }
  if (!rejectedLexical) fail("lexical v_status < 'deleting' finalize mutant survived");
  console.log("MEDIA_OBJECT_CLEANUP_MUTATION_PASS secure-definer,skip-locked,exact-finalize");
}

console.log("MEDIA_OBJECT_CLEANUP_CONTRACT_PASS static=model+runtime offline=no-deno/no-net/no-db");
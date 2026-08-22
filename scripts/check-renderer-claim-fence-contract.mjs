import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  migration: path.join(repoRoot, "supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql"),
  renderer: path.join(repoRoot, "services/video-renderer/src/renderer.js"),
  lease: path.join(repoRoot, "services/video-renderer/src/renderLease.js"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`RENDERER_CLAIM_FENCE_CONTRACT_FAIL ${message}`);
}

function count(source, fragment) {
  return source.split(fragment).length - 1;
}

function assertServiceRoleOnly(migration, signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM public, anon, authenticated;`).test(migration)) {
    fail(`${signature} must be revoked from public, anon, and authenticated`);
  }
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`).test(migration)) {
    fail(`${signature} must be granted only to service_role`);
  }
}

export function assertRendererClaimFenceContract(input, label = "current source") {
  const { migration, renderer, lease, packageJson, ci } = input;
  for (const fragment of [
    "ADD COLUMN IF NOT EXISTS claim_token uuid",
    "ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0",
    "claim_token = gen_random_uuid()",
    "claim_generation = COALESCE(vr.claim_generation, 0) + 1",
    "CREATE OR REPLACE FUNCTION public.renew_video_render_lease(",
    "DROP FUNCTION IF EXISTS public.complete_video_render(",
    "DROP FUNCTION IF EXISTS public.block_video_render(uuid,text,jsonb,jsonb);",
    "DROP FUNCTION IF EXISTS public.fail_video_render(uuid,text,jsonb);",
    "RETURN jsonb_build_object('accepted', false, 'reason', 'stale_video_render_claim');",
    "'accepted', true",
  ]) {
    if (!migration.includes(fragment)) fail(`${label}: migration missing ${fragment}`);
  }
  if (count(migration, "claim_token = gen_random_uuid()") < 2) {
    fail(`${label}: both claim entry points must mint a fresh token`);
  }
  if (count(migration, "claim_generation = COALESCE(vr.claim_generation, 0) + 1") < 2) {
    fail(`${label}: both claim entry points must increment the generation`);
  }
  for (const fence of [
    "AND status = 'running'",
    "AND locked_by = p_worker_id",
    "AND claim_token = p_claim_token",
    "AND claim_generation = p_claim_generation",
  ]) {
    if (count(migration, fence) < 4) {
      fail(`${label}: renewal and all terminal writes must enforce ${fence}`);
    }
  }
  if (!migration.includes("AND lease_expires_at >= now();")) {
    fail(`${label}: an already-expired lease must not be renewable`);
  }

  for (const signature of [
    "claim_video_renders(integer,text)",
    "claim_video_render_by_id(uuid,text)",
    "renew_video_render_lease(uuid,text,uuid,bigint,integer)",
    "complete_video_render(uuid,text,uuid,bigint,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb)",
    "block_video_render(uuid,text,uuid,bigint,text,jsonb,jsonb)",
    "fail_video_render(uuid,text,uuid,bigint,text,jsonb)",
  ]) {
    assertServiceRoleOnly(migration, signature);
  }

  for (const fragment of [
    "createRenderLeaseController({",
    "}).start();",
    "await renderLease.stop();",
    "lease.assertCurrent();",
    "p_worker_id: config.rendererId",
    "p_claim_token: fence.claimToken",
    "p_claim_generation: fence.claimGeneration",
    "assertRenderTerminalAccepted(data, row, \"complete\")",
    "assertRenderTerminalAccepted(data, row, \"block\")",
    "assertRenderTerminalAccepted(data, row, \"fail\")",
    "rendererId: runtimeConfig.rendererId",
    "upsert: false",
    "removeStaleGenerationOutput({",
  ]) {
    if (!renderer.includes(fragment)) fail(`${label}: renderer missing ${fragment}`);
  }
  if (renderer.includes("upsert: true")) fail(`${label}: renderer output must never overwrite an earlier generation`);

  for (const fragment of [
    "`g${claimGeneration}.mp4`",
    "supabase.rpc(\"renew_video_render_lease\"",
    "data !== true",
    "result.accepted !== true",
    "remove([outputStoragePath])",
  ]) {
    if (!lease.includes(fragment)) fail(`${label}: lease helper missing ${fragment}`);
  }

  const pkg = JSON.parse(packageJson);
  assert.equal(
    pkg.scripts?.["check:b4-renderer-claim-fence"],
    "node scripts/check-renderer-claim-fence-contract.mjs",
    `${label}: package checker script must remain wired`,
  );
  assert.equal(
    pkg.scripts?.["test:renderer-claim-fence"],
    "node --test scripts/check-renderer-claim-fence-contract.test.mjs",
    `${label}: package checker test must remain wired`,
  );
  if (!ci.includes("- run: npm run check:b4-renderer-claim-fence")) {
    fail(`${label}: hosted CI source contract is missing`);
  }
  if (!ci.includes("- run: npm --prefix services/video-renderer test")) {
    fail(`${label}: hosted CI renderer tests are missing`);
  }
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, file]) => [
    name,
    fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
  ]));
}

function assertMutationRejected(mutator, label) {
  try {
    assertRendererClaimFenceContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("RENDERER_CLAIM_FENCE_CONTRACT_FAIL") || error instanceof assert.AssertionError) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertRendererClaimFenceContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertMutationRejected((input) => ({
    ...input,
    migration: input.migration.replaceAll("claim_token = gen_random_uuid()", "claim_token = NULL"),
  }), "predictable claim token mutant");
  assertMutationRejected((input) => ({
    ...input,
    migration: input.migration.replaceAll("AND claim_generation = p_claim_generation", ""),
  }), "generation fence bypass mutant");
  assertMutationRejected((input) => ({
    ...input,
    renderer: input.renderer.replace("upsert: false", "upsert: true"),
  }), "mutable output overwrite mutant");
  assertMutationRejected((input) => ({
    ...input,
    lease: input.lease.replace("remove([outputStoragePath])", "remove([])"),
  }), "stale generation cleanup mutant");
  assertMutationRejected((input) => ({
    ...input,
    lease: input.lease.replace("result.accepted !== true", "false"),
  }), "implicit terminal acceptance mutant");
}

console.log(
  `RENDERER_CLAIM_FENCE_CONTRACT_PASS claims=2 terminals=3 immutableOutput=true selfTest=${
    process.env.MUTATION_TEST === "1" ? "pass" : "skipped"
  }`,
);

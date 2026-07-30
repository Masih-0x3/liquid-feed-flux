import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKER_PATH = "supabase/functions/worker/index.ts";

function handleSource(source) {
  const start = source.indexOf("async function handleDeliverJob(");
  const end = source.indexOf("// ─── handleEnrichJob", start);
  assert.ok(start >= 0 && end > start, "handleDeliverJob source boundary must remain discoverable");
  return source.slice(start, end);
}

function validate(source = readFileSync(join(ROOT, WORKER_PATH), "utf8")) {
  const handle = handleSource(source);
  assert.match(handle, /if \(existingDeliveryError\) throw existingDeliveryError;/, "posted-delivery query errors must not be treated as an empty result");
  assert.match(handle, /if \(!Array\.isArray\(existingDelivery\)\)/, "posted-delivery response shape must be checked");
  assert.match(handle, /new JobDeferred\(\s*"telegram_duplicate_check_failed"/, "posted-delivery uncertainty must defer");
  assert.match(handle, /new JobDeferred\(\s*"telegram_url_duplicate_check_failed"/, "URL-delivery uncertainty must defer");
  assert.match(handle, /try \{\s*await repairStaleMediaObject\([\s\S]*?catch \(_repairError\) \{[\s\S]*?"stale_media_repair_failed"/, "stale-media repair failures must remain retryable");
  assert.match(handle, /if \(error instanceof JobDeferred\) throw error;/, "handleDeliverJob must preserve JobDeferred through its boundary catch");

  assert.match(source, /if \(error instanceof JobDeferred\) \{[\s\S]*?status: "pending"[\s\S]*?next_run_at: error\.nextRunAt[\s\S]*?recordPipelineEvent\(supabase, job, "queued"/, "worker dispatch must requeue JobDeferred results");

  const providerIndex = Math.min(
    ...["sendTelegramPhotoFromStorage", "sendTelegramPhotoGroupFromStorage", "sendTelegramVideoFromStorage", "sendTelegramMedia", "https://api.telegram.org"].map((needle) => handle.indexOf(needle)).filter((index) => index >= 0),
  );
  const claimIndex = handle.indexOf("claimTelegramDelivery(supabase");
  assert.ok(claimIndex >= 0 && providerIndex > claimIndex, "atomic delivery claim must precede provider work");
  assert.match(handle, /completeTelegramDelivery\(supabase/, "successful delivery must complete its claimed receipt through the RPC boundary");
  assert.match(handle, /markTelegramDeliveryAmbiguous\(supabase/, "post-call uncertainty must persist as an ambiguous delivery state");
  assert.equal(handle.includes('supabase.from("deliveries").insert'), false, "delivery handler must not append an unclaimed receipt after provider work");

  return {
    deferredGuards: (handle.match(/new JobDeferred\(/g) ?? []).length,
    providerBeforeReceipt: providerIndex >= 0 && providerIndex > claimIndex,
  };
}

const result = validate();

if (process.env.MUTATION_TEST === "1") {
  const source = readFileSync(join(ROOT, WORKER_PATH), "utf8");
  const start = source.indexOf("async function handleDeliverJob(");
  const end = source.indexOf("// ─── handleEnrichJob", start);
  const handle = source.slice(start, end);
  const mutatedHandle = handle.replace("if (error instanceof JobDeferred) throw error;", "if (false) throw error;");
  assert.notEqual(mutatedHandle, handle, "delivery handler mutation fixture must target the scoped catch");
  assert.throws(
    () => validate(source.slice(0, start) + mutatedHandle + source.slice(end)),
    "JobDeferred preservation mutation must fail the delivery contract",
  );
  const repairMutation = handle.replace('"stale_media_repair_failed"', '"stale_media_repair_failed_mutated"');
  assert.notEqual(repairMutation, handle, "stale-media repair mutation fixture must target the stable code");
  assert.throws(
    () => validate(source.slice(0, start) + repairMutation + source.slice(end)),
    "stale-media repair fallback mutation must fail the delivery contract",
  );
  const claimMutation = handle.replace("claimTelegramDelivery(supabase", "claimTelegramDeliveryMutated(supabase");
  assert.notEqual(claimMutation, handle, "atomic claim mutation fixture must target the claim boundary");
  assert.throws(
    () => validate(source.slice(0, start) + claimMutation + source.slice(end)),
    "atomic claim mutation must fail the delivery contract",
  );
}

console.log(`WORKER_DELIVERY_DEFERRED_SOURCE_CONTRACT_PASS deferredGuards=${result.deferredGuards} providerAfterClaim=${result.providerBeforeReceipt} mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
if (result.providerBeforeReceipt) console.log("WORKER_DELIVERY_ATOMIC_CLAIM_SOURCE_SIGNAL claim precedes provider; completion and ambiguity use the durable claim RPC");

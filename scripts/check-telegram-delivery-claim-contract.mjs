import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const paths = {
  migration: join(ROOT, "supabase/migrations/20260730070000_telegram_delivery_claims.sql"),
  claim: join(ROOT, "supabase/functions/worker/telegramDeliveryClaim.ts"),
  worker: join(ROOT, "supabase/functions/worker/index.ts"),
  delivery: join(ROOT, "supabase/functions/worker/telegramDelivery.ts"),
  package: join(ROOT, "package.json"),
  ci: join(ROOT, ".github/workflows/ci.yml"),
};

function sourceSet() {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]));
}

function workerHandle(source) {
  const start = source.indexOf("async function handleDeliverJob(");
  const end = source.indexOf("// ─── handleEnrichJob", start);
  assert.ok(start >= 0 && end > start, "delivery handler boundary must remain discoverable");
  return source.slice(start, end);
}

function parseTypeScript(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, `${fileName} must parse without TypeScript diagnostics`);
}

function validate(sources = sourceSet()) {
  parseTypeScript(sources.claim, paths.claim);
  parseTypeScript(sources.worker, paths.worker);
  parseTypeScript(sources.delivery, paths.delivery);

  for (const needle of [
    "uq_deliveries_telegram_delivery_key",
    "claim_telegram_delivery",
    "start_telegram_delivery",
    "complete_telegram_delivery",
    "mark_telegram_delivery_ambiguous",
    "claim_state IN ('idle', 'preparing', 'posting', 'posted', 'failed', 'ambiguous', 'skipped')",
    "delivery_key IS NULL",
    "status = 'posted'",
    "REVOKE ALL ON FUNCTION public.claim_telegram_delivery",
    "GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery",
  ]) {
    assert.match(sources.migration, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `migration must retain ${needle}`);
  }

  for (const needle of [
    "export async function claimTelegramDelivery",
    "export async function startTelegramDelivery",
    "export async function completeTelegramDelivery",
    "export async function markTelegramDeliveryAmbiguous",
    "telegram_delivery_claim_invalid_response",
    "return data === true",
  ]) {
    assert.ok(sources.claim.includes(needle), `claim adapter must retain ${needle}`);
  }

  const handle = workerHandle(sources.worker);
  assert.match(handle, /claimTelegramDelivery\(supabase/, "delivery handler must claim before provider work");
  assert.match(handle, /startTelegramDelivery\(supabase/, "delivery handler must mark provider start through the claim RPC");
  assert.match(handle, /completeTelegramDelivery\(supabase/, "delivery handler must complete through the claim RPC");
  assert.match(handle, /markTelegramDeliveryAmbiguous\(supabase/, "delivery handler must preserve post-call ambiguity");
  assert.match(handle, /beforeTelegramProviderCall/, "provider helpers must receive the pre-call claim boundary");
  assert.match(handle, /telegram_delivery_ambiguous_requires_reconciliation/, "ambiguous provider outcomes must not auto-retry");
  assert.match(handle, /telegram_delivery_no_provider_call/, "claimed deliveries with no provider call must defer before completion");
  assert.doesNotMatch(handle, /supabase\.from\("deliveries"\)\.insert/, "delivery handler must not append an unclaimed receipt after provider work");

  const claimIndex = handle.indexOf("claimTelegramDelivery(supabase");
  const providerIndex = Math.min(
    ...["sendTelegramPhotoFromStorage", "sendTelegramPhotoGroupFromStorage", "sendTelegramVideoFromStorage", "sendTelegramMedia", "https://api.telegram.org"].map((needle) => handle.indexOf(needle)).filter((index) => index >= 0),
  );
  assert.ok(claimIndex >= 0 && providerIndex > claimIndex, "claim must precede every provider call site");

  for (const needle of [
    "export type BeforeTelegramProviderCall",
    "beforeProviderCall?: BeforeTelegramProviderCall",
    "await beforeProviderCall?.();",
  ]) {
    assert.ok(sources.delivery.includes(needle), `Telegram provider helper must retain ${needle}`);
  }
  for (const name of ["sendTelegramPhotoFromStorage", "sendTelegramPhotoGroupFromStorage", "sendTelegramVideoFromStorage", "sendTelegramMedia"]) {
    assert.match(sources.delivery, new RegExp(`${name}[\\s\\S]*?beforeProviderCall\\?`), `${name} must accept the pre-provider callback`);
  }

  const packageJson = JSON.parse(sources.package);
  assert.equal(packageJson.scripts?.["check:telegram-delivery-claim"], "node scripts/check-telegram-delivery-claim-contract.mjs", "package script must be wired");
  assert.match(sources.ci, /npm run check:telegram-delivery-claim/, "hosted CI must run the claim contract");
  return { providerBeforeClaim: providerIndex > claimIndex, receiptAfterClaim: !handle.includes('deliveries").insert') };
}

const result = validate();

if (process.env.MUTATION_TEST === "1") {
  const sources = sourceSet();
  const mutations = [
    ["migration claim RPC", { ...sources, migration: sources.migration.replaceAll("claim_telegram_delivery", "telegram_delivery_claim_removed") }],
    ["claim malformed-response guard", { ...sources, claim: sources.claim.replaceAll("telegram_delivery_claim_invalid_response", "telegram_delivery_claim_guard_removed") }],
    ["worker claim boundary", { ...sources, worker: sources.worker.replaceAll("claimTelegramDelivery(supabase", "claimTelegramDeliveryMutated(supabase") }],
    ["provider pre-call callback", { ...sources, delivery: sources.delivery.replaceAll("await beforeProviderCall?.();", "await beforeProviderCallMutated?.();") }],
    ["legacy receipt insert", { ...sources, worker: sources.worker.replace("completeTelegramDelivery(supabase", "supabase.from(\"deliveries\").insert({ completeTelegramDelivery(supabase") }],
  ];
  for (const [label, mutated] of mutations) {
    assert.throws(() => validate(mutated), `${label} mutation must fail the claim contract`);
  }
}

console.log(`TELEGRAM_DELIVERY_CLAIM_SOURCE_CONTRACT_PASS providerBeforeClaim=${result.providerBeforeClaim} receiptAfterClaim=${result.receiptAfterClaim} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PATH = "supabase/functions/x-poster/index.ts";

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `source section is missing: ${startNeedle}`);
  return source.slice(start, end);
}

function validate(source = readFileSync(join(ROOT, PATH), "utf8")) {
  const manual = section(source, "async function handleManualVideoIntakePost(", "// ─── Main ────────────────────────────────────────────");
  const manualClaim = manual.indexOf("deliveryClaim = await claimXPostDelivery(");
  const manualPreparation = manual.indexOf("preparedVideo = await downloadMediaForUpload(");
  assert.ok(manualClaim >= 0 && manualPreparation > manualClaim, "manual X must claim before media preparation");
  assert.ok(manual.indexOf("await requireDeliveryCutover(params.sb, tweetId);") < manualClaim, "manual claim must remain behind the cutover gate");
  const manualPreparationSection = manual.slice(manualClaim, manual.indexOf("// Durable provider-start boundary", manualPreparation));
  assert.match(manualPreparationSection, /failXPostDelivery\(params\.sb,[\s\S]*?skipReason: 'media_preparation_failed'/, "manual preparation failure must settle the claim");
  assert.match(manualPreparationSection, /failXPostDelivery\(params\.sb,[\s\S]*?skipReason: 'stale_media_repair_queued'/, "manual stale-media repair must settle the claim");

  const automatic = source.slice(source.indexOf("for (const post of candidates)"));
  const automaticClaim = automatic.indexOf("deliveryClaim = await claimXPostDelivery(");
  const automaticPreparation = automatic.indexOf("let preparedMediaUploads: PreparedMediaUpload[] = [];");
  assert.ok(automaticClaim >= 0 && automaticPreparation > automaticClaim, "automatic X must claim before media preparation");
  assert.ok(automatic.indexOf("await requireDeliveryCutover(sb, tweetId);") < automaticClaim, "automatic claim must remain behind the cutover gate");
  const automaticPreparationSection = automatic.slice(automaticClaim, automatic.indexOf("if (!dryRun && sel.tier === 'video')", automaticPreparation));
  assert.match(automaticPreparationSection, /failXPostDelivery\(sb,[\s\S]*?skipReason: 'media_preparation_failed'/, "automatic preparation failure must settle the claim");
  assert.match(automaticPreparationSection, /failXPostDelivery\(sb,[\s\S]*?skipReason: 'stale_media_repair_queued'/, "automatic stale-media repair must settle the claim");

  assert.match(manualPreparationSection, /forceRetry: duplicateOverride/);
  assert.match(automatic.slice(automaticClaim, automatic.indexOf("let preparedMediaUploads", automaticClaim)), /forceRetry/);
  assert.ok(automatic.indexOf("providerOk = await markXPostDeliveryProviderStarted(", automaticPreparation) > automaticPreparation, "automatic provider boundary must remain after preparation");
  assert.ok(manual.indexOf("providerStarted = await markXPostDeliveryProviderStarted(", manualPreparation) > manualPreparation, "manual provider boundary must remain after preparation");
}

const source = readFileSync(join(ROOT, PATH), "utf8");
validate(source);

if (process.env.MUTATION_TEST === "1") {
  const preparation = "let preparedMediaUploads: PreparedMediaUpload[] = [];";
  const claim = "if (!dryRun) {\n      try {\n        await requireDeliveryCutover(sb, tweetId);";
  assert.ok(source.includes(preparation) && source.includes(claim), "automatic claim-order mutation fixture must target current source");
  assert.throws(
    () => validate(source.replace("deliveryClaim = await claimXPostDelivery(", "// claim removed by mutation\n        deliveryClaim = null;\n        /*")),
    "removing the automatic claim boundary must fail",
  );
  assert.throws(
    () => validate(source.replace("skipReason: 'media_preparation_failed',", "skipReason: null,")),
    "removing the pre-provider settlement reason must fail",
  );
}

console.log(`X_POSTER_CLAIM_ORDER_SOURCE_CONTRACT_PASS manual=claim-before-media automatic=claim-before-media mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

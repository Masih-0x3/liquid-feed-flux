import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`TELEGRAM_DELIVERY_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseWorker(source) {
  const sourceFile = ts.createSourceFile(
    workerPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("worker parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: workerPath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("worker transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ worker, packageJson, ci }, label = "current source") {
  parseWorker(worker);
  const handler = section(
    worker,
    "async function handleDeliverJob(",
    "\n// ─── handleEnrichJob",
    `${label} handleDeliverJob`,
  );
  const duplicateChecks = section(
    handler,
    "    // Idempotency: skip if already posted",
    "    // Duplicate Gate is expected to run before translation",
    `${label} delivery duplicate checks`,
  );

  if (!handler.includes(
    'const { data: account, error: accountError } = await supabase',
  ) || !handler.includes('if (accountError) {') || !handler.includes(
    'throw new JobDeferred(\n        "telegram_account_read_failed",',
  ) || !handler.includes('{ tweet_id: tweetId, check: "account" },')) {
    fail(`${label}: account read errors must defer before provider work`);
  }
  if (!handler.includes(
    'const { data: media, error: mediaError } = await supabase',
  ) || !handler.includes('if (mediaError) {') || !handler.includes(
    'throw new JobDeferred(\n        "telegram_media_read_failed",',
  ) || !handler.includes('{ tweet_id: tweetId, check: "media" },')) {
    fail(`${label}: media read errors must defer before provider work`);
  }

  if (!duplicateChecks.includes(
    'throw new JobDeferred(\n        "telegram_duplicate_check_failed",',
  )) {
    fail(`${label}: posted-delivery duplicate check must defer on database error`);
  }
  if (!duplicateChecks.includes(
    '{ tweet_id: tweetId, check: "posted_delivery" },',
  )) {
    fail(`${label}: posted-delivery defer must carry a bounded diagnostic`);
  }
  if (!duplicateChecks.includes(
    "const { data: existingDelivery, error: existingDeliveryError } = await supabase",
  ) || !duplicateChecks.includes("if (existingDeliveryError) throw existingDeliveryError;")) {
    fail(`${label}: posted-delivery duplicate lookup errors must be fail closed`);
  }
  if (!duplicateChecks.includes(
    'if (!Array.isArray(existingDelivery)) {\n        throw new Error("telegram_duplicate_check_invalid_response");\n      }',
  )) {
    fail(`${label}: posted-delivery duplicate lookup shape must be fail closed`);
  }
  if (!duplicateChecks.includes(
    'throw new JobDeferred(\n          "telegram_url_duplicate_check_failed",',
  )) {
    fail(`${label}: URL duplicate check must defer on database error`);
  }
  if (!duplicateChecks.includes(
    '{ tweet_id: tweetId, check: "url_delivery" },',
  )) {
    fail(`${label}: URL duplicate defer must carry a bounded diagnostic`);
  }
  if (!duplicateChecks.includes(
    "const { data: siblingPosts, error: siblingPostsError } = await supabase.from(\"posts\").select(",
  ) || !duplicateChecks.includes("if (siblingPostsError) throw siblingPostsError;") ||
    !duplicateChecks.includes('if (!Array.isArray(siblingPosts)) {\n          throw new Error("telegram_url_sibling_posts_invalid_response");\n        }') ||
    !duplicateChecks.includes("const { data: siblingDeliveries, error: siblingDeliveriesError } = await supabase") ||
    !duplicateChecks.includes("if (siblingDeliveriesError) throw siblingDeliveriesError;") ||
    !duplicateChecks.includes('if (!Array.isArray(siblingDeliveries)) {\n            throw new Error("telegram_url_sibling_deliveries_invalid_response");\n          }')) {
    fail(`${label}: URL duplicate lookup errors must be fail closed`);
  }
  if (!duplicateChecks.includes(
    'const siblingIds = (siblingPosts || []).map((p: unknown) => {',
  ) || !duplicateChecks.includes(
    'if (!p || typeof p !== "object" || Array.isArray(p)) {',
  ) || !duplicateChecks.includes(
    'const tweetIdValue = (p as Record<string, unknown>).tweet_id;',
  ) || !duplicateChecks.includes(
    'if (typeof tweetIdValue !== "string" || tweetIdValue.trim().length === 0) {',
  ) || !duplicateChecks.includes(
    'return tweetIdValue.trim();',
  )) {
    fail(`${label}: URL sibling rows must validate and normalize non-empty tweet_id shape`);
  }
  if (duplicateChecks.includes('catch (_e) { /* best-effort */ }')) {
    fail(`${label}: delivery duplicate checks still fail open`);
  }
  if (!handler.includes("completeTelegramDelivery(supabase")) {
    fail(`${label}: successful Telegram sends must complete through the claim RPC`);
  }
  if (!handler.includes("telegram_delivery_completion_unknown") ||
    !handler.includes("markTelegramDeliveryAmbiguous(supabase")) {
    fail(`${label}: completion failure must persist an ambiguous outcome`);
  }
  if (handler.includes('supabase.from("deliveries").insert')) {
    fail(`${label}: successful Telegram sends must not append an unclaimed receipt`);
  }

  const catchStart = handler.lastIndexOf("  } catch (error) {");
  if (catchStart < 0) fail(`${label} handleDeliverJob catch marker is missing`);
  const handlerCatch = handler.slice(catchStart);
  if (!handlerCatch.includes("if (error instanceof JobDeferred) throw error;")) {
    fail(`${label}: handler catch must preserve JobDeferred semantics`);
  }
  if (
    handlerCatch.indexOf("if (error instanceof JobDeferred) throw error;") >
      handlerCatch.indexOf('const e = workerBoundaryError(error, "deliver_failed");')
  ) {
    fail(`${label}: JobDeferred must be preserved before generic error wrapping`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:telegram-delivery-fail-closed"] !==
    "node scripts/check-telegram-delivery-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:telegram-delivery-fail-closed")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    worker: fs.readFileSync(workerPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("TELEGRAM_DELIVERY_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n        "telegram_duplicate_check_failed",',
      'catch (_e) { /* best-effort */ }',
    ),
  }), "posted-delivery duplicate fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n          "telegram_url_duplicate_check_failed",',
      'catch (_e) { /* best-effort */ }',
    ),
  }), "URL duplicate fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "if (existingDeliveryError) throw existingDeliveryError;",
      "if (false) throw existingDeliveryError;",
    ),
  }), "posted-delivery lookup error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "if (siblingPostsError) throw siblingPostsError;",
      "if (false) throw siblingPostsError;",
    ),
  }), "URL sibling-post lookup error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "if (siblingDeliveriesError) throw siblingDeliveriesError;",
      "if (false) throw siblingDeliveriesError;",
    ),
  }), "URL sibling-delivery lookup error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (!Array.isArray(existingDelivery)) {\n        throw new Error("telegram_duplicate_check_invalid_response");\n      }',
      "if (false) { throw new Error(\"telegram_duplicate_check_invalid_response\"); }",
    ),
  }), "posted-delivery malformed response fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (!Array.isArray(siblingPosts)) {\n          throw new Error("telegram_url_sibling_posts_invalid_response");\n        }',
      "if (false) { throw new Error(\"telegram_url_sibling_posts_invalid_response\"); }",
    ),
  }), "URL sibling-post malformed response fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (!Array.isArray(siblingDeliveries)) {\n            throw new Error("telegram_url_sibling_deliveries_invalid_response");\n          }',
      "if (false) { throw new Error(\"telegram_url_sibling_deliveries_invalid_response\"); }",
    ),
  }), "URL sibling-delivery malformed response fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (typeof tweetIdValue !== "string" || tweetIdValue.trim().length === 0) {',
      "if (false) {",
    ),
  }), "URL sibling-row ID shape fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "return tweetIdValue.trim();",
      "return tweetIdValue;",
    ),
  }), "URL sibling-row ID normalization removal mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n        "telegram_account_read_failed",',
      'if (false) { throw accountError; }',
    ),
  }), "account read error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n        "telegram_media_read_failed",',
      'if (false) { throw mediaError; }',
    ),
  }), "media read error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: (() => {
      const start = source.worker.indexOf("async function handleDeliverJob(");
      const end = source.worker.indexOf("\n// ─── handleEnrichJob", start);
      if (start < 0 || end < 0) return source.worker;
      const handler = source.worker.slice(start, end).replace(
        "if (error instanceof JobDeferred) throw error;",
        "if (false) { throw error; }",
      );
      return `${source.worker.slice(0, start)}${handler}${source.worker.slice(end)}`;
    })(),
  }), "lost JobDeferred semantics mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replaceAll(
      "completeTelegramDelivery(supabase",
      "completeTelegramDeliveryMutated(supabase",
    ),
  }), "delivery completion boundary removal");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replaceAll(
      "telegram_delivery_completion_unknown",
      "completion_unknown_guard_removed",
    ),
  }), "delivery ambiguity guard removal");
}

console.log(
  `TELEGRAM_DELIVERY_FAIL_CLOSED_SOURCE_CONTRACT_PASS duplicateChecks=2 jobDeferredPreserved=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);

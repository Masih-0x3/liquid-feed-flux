import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`HYDRATE_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseWorker(source) {
  const sourceFile = ts.createSourceFile(workerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
  const hydrateQueue = section(worker, "async function queueTranslateAfterHydrate", "async function handleHydrateTweetJob", `${label} hydrate queue helpers`);
  for (const marker of ["hydrate_translate_enqueue_failed", "dedupe_translate_enqueue_failed", "hydrate_dedupe_enqueue_failed", "dedupe_pending_update_failed", "classifyQueueInsertResult(insertedRows, \"hydrate_dedupe_enqueue_failed\")", "classifyQueueInsertResult(insertedRows, \"dedupe_translate_enqueue_failed\")", '}).select("id");']) {
    if (!hydrateQueue.includes(marker)) fail(`${label}: missing canonical checked queue marker ${marker}`);
  }
  if (hydrateQueue.includes(".then(() => null, () => null)") || hydrateQueue.includes('supabase.from("pipeline_events").insert')) {
    fail(`${label}: queue mutations must not swallow or bypass checked event writes`);
  }
  const hydrateDedupeQueue = section(worker, "async function queueDedupeAfterHydrate(", "async function queueTranslateFromDedupe(", `${label} hydrate dedupe queue`);
  const translateQueue = section(worker, "async function queueTranslateFromDedupe(", "async function markDedupePending(", `${label} dedupe translate queue`);
  for (const [queue, queueLabel] of [[hydrateDedupeQueue, "hydrate dedupe"], [translateQueue, "dedupe translate"]]) {
    const guard = queue.indexOf("classifyQueueInsertResult(insertedRows,");
    if (guard < 0 || (queue.indexOf("await insertPipelineEvent(") >= 0 && guard > queue.indexOf("await insertPipelineEvent("))) {
      fail(`${label}: ${queueLabel} duplicate guard must precede event mutation`);
    }
  }
  const hydrateHandler = section(
    worker,
    "async function handleHydrateTweetJob(",
    "async function handleResolveMediaJob(",
    `${label} hydration handler`,
  );
  const budgetFallback = section(
    hydrateHandler,
    "if (used24h >= hydrationCfg.daily_budget)",
    "  const numericId =",
    `${label} hydration budget fallback`,
  );
  if (!budgetFallback.includes('await insertPipelineEvent(') ||
      budgetFallback.includes('supabase.from("pipeline_events").insert') ||
      budgetFallback.includes('catch { /* best-effort */ }')) {
    fail(`${label}: hydration budget fallback event must use the checked pipeline-event helper`);
  }
  const translateHandler = section(worker, "async function handleTranslateJob(", "async function handleModerateJob(", `${label} translate routing`);
  if (!translateHandler.includes('throw new JobDeferred(\n          "hydrate_job_enqueue_failed",')) {
    fail(`${label}: post-translation hydrate enqueue failures must defer the job`);
  }
  if (translateHandler.includes('"Failed to create post-translate hydrate job:"')) {
    fail(`${label}: post-translation hydrate enqueue failures still fail open`);
  }
  const legacyGate = section(worker, "async function isDuplicateGateEnabled", "async function queueDedupeOrTranslateAfterHydrate", `${label} legacy gate seam`);
  const queueRouting = section(worker, "async function queueDedupeOrTranslateAfterHydrate(", "async function handleHydrateTweetJob(", `${label} queue routing`);
  if (queueRouting.includes("isDuplicateGateEnabled(") || legacyGate.includes("queueDedupeAfterHydrate")) fail(`${label}: legacy duplicate-gate seam must not route hydration`);
  const claimFilter = section(worker, "export function filterWorkerJobTypes(", "export function runtimeControlsNoopResponse(", `${label} runtime claim filter`);
  for (const marker of ['paused.add("dedupe");', 'paused.add("compute_signature");', 'paused.add("translate");']) {
    if (!claimFilter.includes(marker)) fail(`${label}: runtime claim filter is missing ${marker}`);
  }
  const hydrateHandoff = section(worker, "async function queueDedupeOrTranslateAfterHydrate(", "async function handleHydrateTweetJob(", `${label} canonical hydrate handoff`);
  if (!hydrateHandoff.includes("await queueDedupeAfterHydrate(supabase, tweetId);") || hydrateHandoff.includes("translation_enabled")) {
    fail(`${label}: hydrate must always queue canonical dedupe and never bypass to translation`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:hydrate-queue-fail-closed"] !== "node scripts/check-hydrate-queue-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:hydrate-queue-fail-closed")) {
    fail(`${label}: hosted CI command is missing`);
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
    if (String(error).includes("HYDRATE_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace("await queueDedupeAfterHydrate(supabase, tweetId);", "/* canonical dedupe handoff omitted */"),
  }), "canonical dedupe handoff removal");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace("classifyQueueInsertResult(insertedRows, \"hydrate_dedupe_enqueue_failed\")", "\"inserted\""),
  }), "ignored duplicate mutation guard removal");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.split('}).select("id");').join("});"),
  }), "queue insert result capture removal");
}

console.log(`HYDRATE_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_PASS canonicalQueueWrites=2 duplicateMutationGuard=true pendingStateWriteChecked=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

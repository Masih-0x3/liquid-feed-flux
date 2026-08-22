import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/worker/videoRenderWorkflow.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`VIDEO_RENDER_GATE_QUEUE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("video render workflow parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("video render workflow transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  const start = source.indexOf('if (decision.action === "wait_media")');
  const end = source.indexOf('if (decision.action === "wait_render")', start);
  if (start < 0 || end < 0) fail(`${label}: wait_media gate markers are missing`);
  const waitMedia = source.slice(start, end);
  if (!waitMedia.includes("video_render_download_enqueue_failed")) {
    fail(`${label}: wait_media enqueue failure is not propagated`);
  }
  if (!waitMedia.includes("const { error: downloadQueueError } = await supabase.from(\"jobs\").upsert({")) {
    fail(`${label}: wait_media queue write is not result-checked`);
  }
  const deliveryStart = source.indexOf("async function enqueueDeliverJob(");
  const deliveryEnd = source.indexOf("export async function enqueuePostDeliveryAfterRenderGate", deliveryStart);
  if (deliveryStart < 0 || deliveryEnd < 0) fail(`${label}: delivery enqueue helper markers are missing`);
  const deliveryEnqueue = source.slice(deliveryStart, deliveryEnd);
  if (!deliveryEnqueue.includes("const { error: deliveryJobError } = await supabase")) {
    fail(`${label}: delivery enqueue result is not retained`);
  }
  if (!deliveryEnqueue.includes('throw new Error("deliver_enqueue_failed");')) {
    fail(`${label}: delivery enqueue failure is not propagated`);
  }
  if (waitMedia.includes("downloadQueueError.message") ||
      deliveryEnqueue.includes("deliveryJobError.message") ||
      deliveryEnqueue.includes("existingDelError.message") ||
      deliveryEnqueue.includes("pendingReceiptError.message")) {
    fail(`${label}: video-render queue failures must use stable redacted codes`);
  }
  if (deliveryEnqueue.includes("return false;")) {
    fail(`${label}: delivery enqueue failure still returns a false success path`);
  }
  for (const marker of [
    "error: existingDelError",
    "if (existingDelError) {",
    "deliver_pending_receipt_read_failed",
    "deliver_pending_receipt_invalid_response",
    "error: pendingReceiptError",
    "if (pendingReceiptError) {",
    "deliver_pending_receipt_write_failed",
  ]) {
    if (!deliveryEnqueue.includes(marker)) fail(`${label}: pending delivery receipt gate is missing: ${marker}`);
  }
  if (deliveryEnqueue.includes("catch (_e)")) {
    fail(`${label}: pending delivery receipt failures must not be swallowed`);
  }
  const configStart = source.indexOf("async function loadVideoRenderConfig(");
  const configEnd = source.indexOf("async function loadVideoRenderDecision(", configStart);
  if (configStart < 0 || configEnd < 0) fail(`${label}: render config helper markers are missing`);
  const config = source.slice(configStart, configEnd);
  if (!config.includes("const { data, error } = await supabase")) {
    fail(`${label}: render config read error is not retained`);
  }
  if (!config.includes("if (error) throw error;")) {
    fail(`${label}: render config read errors are not fail closed`);
  }
  if (!config.includes('throw new Error("video_render_config_read_failed");')) {
    fail(`${label}: render config read failure code is missing`);
  }
  if (config.includes("return normalizeVideoRenderConfigValue({")) {
    fail(`${label}: render config read failure still falls back to defaults`);
  }
  const decisionStart = source.indexOf("async function loadVideoRenderDecision(");
  const decisionEnd = source.indexOf("async function dispatchVideoRendererForTarget(", decisionStart);
  if (decisionStart < 0 || decisionEnd < 0) fail(`${label}: render decision helper markers are missing`);
  const decision = source.slice(decisionStart, decisionEnd);
  if (!decision.includes("if (!Array.isArray(mediaRes.data))")) {
    fail(`${label}: media decision reads must reject malformed successful data`);
  }
  if (!decision.includes("if (!Array.isArray(renderRes.data))")) {
    fail(`${label}: render decision reads must reject malformed successful data`);
  }
  if (decision.includes("(mediaRes.data ?? [])") || decision.includes("(renderRes.data ?? [])")) {
    fail(`${label}: render decision reads still normalize unknown data to empty arrays`);
  }
  const dispatchStart = source.indexOf("async function dispatchVideoRendererForTarget(");
  const dispatchEnd = source.indexOf("export async function prepareVideoRenderGate", dispatchStart);
  if (dispatchStart < 0 || dispatchEnd < 0) fail(`${label}: renderer dispatch helper markers are missing`);
  const dispatch = source.slice(dispatchStart, dispatchEnd);
  if (!dispatch.includes("const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599")) {
    fail(`${label}: renderer HTTP failures must retain only a bounded status`);
  }
  if (!dispatch.includes("`renderer_http_${status}`")) {
    fail(`${label}: renderer HTTP failure telemetry must use a stable status code`);
  }
  if (!dispatch.includes('"renderer_dispatch_failed"')) {
    fail(`${label}: renderer transport failures must use a stable code`);
  }
  if (/resp\.text\s*\(|error\.message|String\(error\)/.test(dispatch)) {
    fail(`${label}: renderer dispatch telemetry must not persist raw response/error text`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:video-render-gate-queue"] !== "node scripts/check-video-render-gate-queue-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:video-render-gate-queue")) {
    fail(`${label}: hosted CI command is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("VIDEO_RENDER_GATE_QUEUE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('throw new Error("video_render_download_enqueue_failed");', "console.warn(\"download queue failed\");"),
  }), "wait_media enqueue failure continuation");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const { error: downloadQueueError } = await supabase.from(\"jobs\").upsert({", "await supabase.from(\"jobs\").upsert({"),
  }), "wait_media result destructure removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('throw new Error("deliver_enqueue_failed");', "console.warn(\"deliver enqueue failed\");"),
  }), "delivery enqueue failure continuation");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const { error: deliveryJobError } = await supabase", "await supabase"),
  }), "delivery enqueue result destructure removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (existingDelError) {", "if (false) {"),
  }), "pending receipt read failure continuation");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (pendingReceiptError) {", "if (false) {"),
  }), "pending receipt write failure continuation");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'throw new Error("deliver_pending_receipt_read_failed");',
      "throw new Error(`pending receipt read failed: ${existingDelError.message}`);",
    ),
  }), "pending receipt raw read error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'throw new Error("deliver_pending_receipt_write_failed");',
      "throw new Error(`pending receipt write failed: ${pendingReceiptError.message}`);",
    ),
  }), "pending receipt raw write error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (error) throw error;", "if (false) throw error;"),
  }), "render config read error guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('throw new Error("video_render_config_read_failed");', "return normalizeVideoRenderConfigValue({ render_version: VIDEO_RENDER_VERSION });"),
  }), "render config default fallback mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('if (!Array.isArray(mediaRes.data)) {', 'if (false) {'),
  }), "media decision malformed-data guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('if (!Array.isArray(renderRes.data)) {', 'if (false) {'),
  }), "render decision malformed-data guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599", "const status = resp.status"),
  }), "renderer status bound removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('`renderer_http_${status}`', 'String(error)'),
  }), "renderer HTTP raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('"renderer_dispatch_failed"', 'error instanceof Error ? error.message : String(error)'),
  }), "renderer transport raw error mutant");
}

console.log(`VIDEO_RENDER_GATE_QUEUE_SOURCE_CONTRACT_PASS waitMediaQueueChecked=true falseQueuedReceiptPrevented=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

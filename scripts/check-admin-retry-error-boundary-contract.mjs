import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-retry/index.ts");

function fail(message) {
  throw new Error(`ADMIN_RETRY_ERROR_BOUNDARY_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract(source, label = "current source") {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label}: parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: transpilation diagnostics`);
  }
  if (!source.includes("function safeAdminRetryErrorCode(error: unknown): string")) {
    fail(`${label}: stable admin-retry error-code helper is missing`);
  }
  if (!source.includes('return match?.[1] ?? "admin_retry_failed";')) {
    fail(`${label}: admin-retry fallback error code is missing`);
  }
  const eventStart = source.indexOf("async function recordAdminRetryPipelineEvents(");
  const eventEnd = source.indexOf("serve(async (req) => {", eventStart);
  if (eventStart < 0 || eventEnd < 0) fail(`${label}: pipeline-event helper markers are missing`);
  const eventHelper = source.slice(eventStart, eventEnd);
  if (!eventHelper.includes("const { error: pipelineEventError } = await writer")) {
    fail(`${label}: pipeline-event insert result must be checked`);
  }
  if (!eventHelper.includes("if (pipelineEventError) {") ||
      (eventHelper.match(/admin_retry_pipeline_event_insert_failed/g) ?? []).length < 2) {
    fail(`${label}: returned and thrown pipeline-event failures need stable diagnostics`);
  }
  if (eventHelper.includes("catch (_e) {}") || eventHelper.includes("error: _e")) {
    fail(`${label}: pipeline-event diagnostics must not be silent or raw`);
  }
  const resend = source.slice(source.indexOf("if (action === 'resend_delivery')"), source.indexOf("// Handle retry failed deliveries action"));
  if (!resend.includes("await recordAdminRetryPipelineEvents(supabase, {")) {
    fail(`${label}: resend delivery must use checked pipeline-event helper`);
  }
  const retryFailed = source.slice(source.indexOf("if (action === 'retry_failed_deliveries')"), source.indexOf("// Handle test template action"));
  if (!retryFailed.includes("await recordAdminRetryPipelineEvents(supabase, rows);")) {
    fail(`${label}: retry-failed-deliveries must use checked pipeline-event helper`);
  }
  if (!source.includes("throw new Error('admin_retry_webhook_test_failed');")) {
    fail(`${label}: webhook self-test must use a stable failure code`);
  }
  if (source.includes("Webhook test failed: ${webhookResponse.error.message}")) {
    fail(`${label}: webhook self-test must not forward SDK error text`);
  }
  if (!source.includes("const errorCode = safeAdminRetryErrorCode(error);")) {
    fail(`${label}: outer admin-retry error boundary must normalize failures`);
  }
  if (!source.includes("error: errorCode")) fail(`${label}: admin-retry logs must use normalized error code`);
  if (!source.includes("captureEdgeException(new Error(errorCode),")) {
    fail(`${label}: Sentry boundary must use normalized error code`);
  }
  if (source.includes("error: (error as Error).message") || source.includes("captureEdgeException(error,")) {
    fail(`${label}: raw outer error text must not cross logs or Sentry`);
  }
}

const source = fs.readFileSync(sourcePath, "utf8");
assertContract(source);

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(source), label);
  } catch (error) {
    if (String(error).includes("ADMIN_RETRY_ERROR_BOUNDARY_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects((value) => value.replace("const { error: pipelineEventError } = await writer", "await writer"), "pipeline-event result ignored");
  assertRejects((value) => value.replace("if (pipelineEventError) {", "if (false) {"), "pipeline-event failure guard removed");
  assertRejects((value) => value.replace("error: 'admin_retry_pipeline_event_insert_failed',", "error: _e,"), "pipeline-event raw error");
  assertRejects((value) => value.replace("throw new Error('admin_retry_webhook_test_failed');", "throw new Error(`Webhook test failed: ${webhookResponse.error.message}`);"), "webhook raw error");
  assertRejects((value) => value.replace("const errorCode = safeAdminRetryErrorCode(error);", "const errorCode = (error as Error).message;"), "outer raw error logging");
  assertRejects((value) => value.replace("captureEdgeException(new Error(errorCode),", "captureEdgeException(error,"), "outer raw Sentry error");
}

console.log(`ADMIN_RETRY_ERROR_BOUNDARY_SOURCE_CONTRACT_PASS selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

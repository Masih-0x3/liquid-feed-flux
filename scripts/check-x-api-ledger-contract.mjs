import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/_shared/xApiLedger.ts");

function fail(message) {
  throw new Error(`X_API_LEDGER_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract(source, label = "current source") {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label}: parse diagnostics`);
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: transpilation diagnostics`);
  }
  if (!source.includes("function safeXApiLedgerErrorCode(error: unknown): string")) {
    fail(`${label}: stable X API ledger error helper is missing`);
  }
  if (!source.includes("function safeXApiEventError(value: unknown")) {
    fail(`${label}: input X API error sanitizer is missing`);
  }
  if (!source.includes("const SAFE_X_API_ERROR_CODE =")) {
    fail(`${label}: X API error code shape guard is missing`);
  }
  if (!source.includes("SAFE_X_API_ERROR_CODE.test(message)")) {
    fail(`${label}: X API error code shape guard is not enforced`);
  }
  if (!source.includes("return message === 'x_api_event_insert_failed'")) {
    fail(`${label}: X API ledger error helper must allowlist only its stable code`);
  }
  if (!source.includes("const { error: eventInsertError } = await ledger.from('x_api_events').insert({")) {
    fail(`${label}: X API ledger insert result must be checked`);
  }
  if (!source.includes("if (eventInsertError) {") ||
      (source.match(/x_api_event_insert_failed/g) ?? []).length < 2) {
    fail(`${label}: returned and thrown X API ledger failures need stable diagnostics`);
  }
  if (!source.includes("error: safeXApiEventError(input.error, status),")) {
    fail(`${label}: caller-supplied X API error must be normalized before persistence`);
  }
  if (source.includes("error: input.error ? String(input.error)") ||
      source.includes("error: input.error,")) {
    fail(`${label}: raw caller-supplied X API error crosses the ledger boundary`);
  }
  if (source.includes("recordXApiEvent failed:") ||
      source.includes("String(e)") || source.includes("error: error.message") ||
      source.includes("error: eventInsertError.message")) {
    fail(`${label}: raw X API ledger exceptions must not cross telemetry`);
  }
  if (!source.includes("type XApiLedgerClient = {") ||
      !source.includes("function checkedXApiLedgerClient(client: unknown): XApiLedgerClient | null") ||
      !source.includes("export async function recordXApiEvent(supabase: unknown") ||
      !source.includes("if (!ledger) {")) {
    fail(`${label}: X API ledger client boundary must be unknown-backed and fail closed`);
  }
}

const source = fs.readFileSync(sourcePath, "utf8");
assertContract(source);

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(source), label);
  } catch (error) {
    if (String(error).includes("X_API_LEDGER_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects((value) => value.replace("error: safeXApiEventError(input.error, status),", "error: input.error ? String(input.error) : null,"), "raw caller error persistence");
  assertRejects((value) => value.replace("if (message.length >= 3 && message.length <= 96 && SAFE_X_API_ERROR_CODE.test(message))", "if (true)"), "X API error code shape guard removed");
  assertRejects((value) => value.replace("const { error: eventInsertError } = await ledger.from('x_api_events').insert({", "await ledger.from('x_api_events').insert({"), "result ignored");
  assertRejects((value) => value.replace("if (eventInsertError) {", "if (false) {"), "returned-error guard removed");
  assertRejects((value) => value.replace("return message === 'x_api_event_insert_failed'", "return message"), "raw error allowlist removed");
  assertRejects((value) => value.replace("error: safeXApiLedgerErrorCode(error),", "error: error.message,"), "raw thrown error telemetry");
  assertRejects((value) => value.replace("error: safeXApiLedgerErrorCode(eventInsertError),", "error: eventInsertError.message,"), "raw returned error telemetry");
  assertRejects((value) => value.replace("export async function recordXApiEvent(supabase: unknown", "export async function recordXApiEvent(supabase: any"), "any client boundary");
  assertRejects((value) => value.replace("if (!ledger) {", "if (false) {"), "client guard removed");
}

console.log(`X_API_LEDGER_SOURCE_CONTRACT_PASS stableErrors=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

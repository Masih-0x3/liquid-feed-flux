import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/enrichmentActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`ENRICHMENT_ADMIN_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("enrichment admin parse diagnostics");
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((out.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("enrichment admin transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parse(source);
  for (const [needle, name] of [
    ["const { data, error: lookupError } = await table(supabase, \"post_enrichments\")", "latest enrichment lookup result"],
    ["if (lookupError) throw lookupError;", "latest enrichment lookup error"],
    ["const { error: updateError } = await table(supabase, \"post_enrichments\")", "latest enrichment update result"],
    ["if (updateError) throw updateError;", "latest enrichment update error"],
    ["const { error: postUpdateError } = await table(supabase, \"posts\").update({ enrich_status: \"approved\" })", "approve post update result"],
    ["const { error: postUpdateError } = await table(supabase, \"posts\").update({ enrich_status: \"rejected\" })", "reject post update result"],
    ["const { data: rows, error: settingsError } = await table(supabase, \"settings\")", "voice profile settings result"],
    ["if (settingsError) throw settingsError;", "voice profile settings error"],
    ["if (!Array.isArray(rows)) throw new Error(\"voice_profile_settings_invalid_response\");", "voice profile settings shape"],
    ["const { error: settingsUpsertError } = await table(supabase, \"settings\").upsert([", "voice profile settings write result"],
    ["if (settingsUpsertError) throw settingsUpsertError;", "voice profile settings write error"],
    ["const { error: resetPostError } = await table(supabase, \"posts\").update({", "manual enrich reset write result"],
    ["if (resetPostError) throw resetPostError;", "manual enrich reset write error"],
  ]) if (!source.includes(needle)) fail(`${label}: missing ${name}`);
  if (!source.includes("function normalizeWorkerDispatchResult(value: unknown): SafeWorkerDispatchResult")) {
    fail(`${label}: worker dispatch result must be normalized before persistence or response`);
  }
  if (!source.includes("const workerDispatchRaw = deps.dispatchWorkerForManualEnrich")) {
    fail(`${label}: manual enrichment must keep the delegated worker result behind a raw boundary`);
  }
  if (!source.includes("const workerDispatch = normalizeWorkerDispatchResult(workerDispatchRaw);")) {
    fail(`${label}: normalized worker dispatch result is missing`);
  }
  if (source.includes("message?: string") || source.includes("message: workerDispatch.message")) {
    fail(`${label}: worker dispatch message text must not cross the admin or pipeline boundary`);
  }
  if (!source.includes("/^enrich_worker_(?:config_missing|request_failed|http_[1-5][0-9]{2})$/")) {
    fail(`${label}: worker dispatch errors must be restricted to stable operation codes`);
  }
  const postUpdateGuard = "if (postUpdateError) throw postUpdateError;";
  if (source.split(postUpdateGuard).length - 1 !== 2) fail(`${label}: approve and reject post update guards must both remain present`);

  const dispatch = section(
    source,
    "export async function dispatchWorkerForManualEnrich(",
    "export async function approveEnrichmentAdminAction(",
    `${label} manual enrichment worker dispatch`,
  );
  for (const marker of [
    'return { ok: false, error: "enrich_worker_config_missing" };',
    "function boundedHttpStatus(value: unknown): number",
    "function enrichDispatchErrorCode(status?: unknown): string",
    "error: enrichDispatchErrorCode(resp.status),",
    'error: "enrich_worker_request_failed"',
  ]) if (!source.includes(marker)) fail(`${label}: missing bounded dispatch marker ${marker}`);
  if (dispatch.includes("parsed.error") || dispatch.includes("text.slice") || dispatch.includes("(e as Error).message")) {
    fail(`${label}: manual enrichment worker dispatch must not forward raw response or exception text`);
  }
  if (!dispatch.includes("status: boundedHttpStatus(resp.status) || 502,")) {
    fail(`${label}: manual enrichment worker dispatch must bound provider status`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:enrichment-admin-actions"] !== "node scripts/check-enrichment-admin-actions-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:enrichment-admin-actions")) fail(`${label}: hosted CI command is missing`);
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
    if (String(error).includes("ENRICHMENT_ADMIN_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, label] of [
    ["if (lookupError) throw lookupError;", "latest enrichment lookup error bypass"],
    ["if (updateError) throw updateError;", "latest enrichment update error bypass"],
    ["if (settingsError) throw settingsError;", "voice profile settings error bypass"],
    ["if (!Array.isArray(rows)) throw new Error(\"voice_profile_settings_invalid_response\");", "voice profile settings shape bypass"],
    ["if (settingsUpsertError) throw settingsUpsertError;", "voice profile settings write bypass"],
    ["if (resetPostError) throw resetPostError;", "manual enrich reset write bypass"],
  ]) assertRejects((source) => ({ ...source, source: source.source.replace(needle, "if (false) throw new Error('ignored');") }), label);
  assertRejects((source) => ({ ...source, source: source.source.replace("if (postUpdateError) throw postUpdateError;", "if (false) throw new Error('ignored');") }), "approve/reject status write bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace('error: enrichDispatchErrorCode(resp.status),', 'error: parsed.error ?? text.slice(0, 300),') }), "worker dispatch raw provider error forwarding");
  assertRejects((source) => ({ ...source, source: source.source.replace('return { ok: false, error: "enrich_worker_request_failed" };', 'return { ok: false, error: (e as Error).message };') }), "worker dispatch raw catch forwarding");
  assertRejects((source) => ({ ...source, source: source.source.replace("status: boundedHttpStatus(resp.status) || 502,", "status: resp.status,") }), "worker dispatch unbounded status");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "const workerDispatch = normalizeWorkerDispatchResult(workerDispatchRaw);",
      "const workerDispatch = workerDispatchRaw;",
    ),
  }), "worker dispatch raw result bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "processed: workerDispatch.processed,",
      "processed: workerDispatch.processed,\n        message: workerDispatch.message,",
    ),
  }), "worker dispatch message persistence");
}

console.log(`ENRICHMENT_ADMIN_SOURCE_CONTRACT_PASS adminReadsAndWrites=failClosed voiceProfileAmbiguity=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const repoRoot = process.cwd();
const paths = {
  action: join(repoRoot, "supabase/functions/admin-actions/manualVideoIntakeActions.ts"),
  packageJson: join(repoRoot, "package.json"),
  ci: join(repoRoot, ".github/workflows/ci.yml"),
};
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`MANUAL_INTAKE_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, readFileSync(filePath, "utf8")]));
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertTranspiles(filePath, source) {
  const parsed = typescript.createSourceFile(filePath, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
  if (parsed.parseDiagnostics.length > 0) fail(`${filePath} has TypeScript parse diagnostics`);
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
    fileName: filePath,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail(`${filePath} has TypeScript transpilation diagnostics`);
}

function assertContract(source, label = "current source") {
  assertTranspiles(paths.action, source.action);
  for (const [needle, name] of [
    ["const { data: cfgRow, error: cfgError } = await table(supabase, \"settings\")", "render configuration read result"],
    ["if (cfgError) throw cfgError;", "render configuration read error"],
    ["if (cfgRow !== null && (typeof cfgRow !== \"object\" || Array.isArray(cfgRow)))", "render configuration shape condition"],
    ["manual_video_render_config_invalid_response", "render configuration shape guard"],
    ["const { error: intakeUpdateError } = await table(supabase, \"manual_video_intakes\").update({", "render-queued intake write result"],
    ["if (intakeUpdateError) throw intakeUpdateError;", "render-queued intake write error"],
    ["const { data, error } = await table(supabase, \"settings\").select(\"value\").eq(", "X posting configuration read result"],
    ["if (error) throw error;", "X posting configuration read error"],
    ["if (data !== null && (typeof data !== \"object\" || Array.isArray(data)))", "X posting configuration shape condition"],
    ["manual_x_posting_config_invalid_response", "X posting configuration shape guard"],
    ["const { error: intakeFailureUpdateError } = await table(supabase, \"manual_video_intakes\").update({", "render failure intake write result"],
    ["if (intakeFailureUpdateError) throw intakeFailureUpdateError;", "render failure intake write error"],
    ["const { error: translationFailureUpdateError } = await table(supabase, \"manual_video_intakes\").update({", "create translation failure write result"],
    ["if (translationFailureUpdateError) throw translationFailureUpdateError;", "create translation failure write error"],
    ["const { error: refreshFailureUpdateError } = await table(supabase, \"manual_video_intakes\").update({", "refresh translation failure write result"],
    ["if (refreshFailureUpdateError) throw refreshFailureUpdateError;", "refresh translation failure write error"],
    ["const { error: postFailureUpdateError } = await table(supabase, \"manual_video_intakes\").update({", "post failure intake write result"],
    ["if (postFailureUpdateError) throw postFailureUpdateError;", "post failure intake write error"],
    ["const { data, error } = await table(supabase, \"x_deliveries\")", "latest X delivery read result"],
    ["if (error) throw error;\n  if (data !== null && (!data || typeof data !== \"object\" || Array.isArray(data)))", "latest X delivery read/shape guard"],
    ["manual_x_delivery_invalid_response", "latest X delivery malformed response"],
    ["const { data, error: intakeSnapshotUpdateError } = await table(supabase, \"manual_video_intakes\")", "snapshot update result"],
    ["if (intakeSnapshotUpdateError) throw intakeSnapshotUpdateError;", "snapshot update persistence error"],
    ["manual_intake_snapshot_update_invalid_response", "snapshot update response shape"],
  ]) assertIncludes(source.action, needle, `${label}: ${name}`);
  for (const marker of [
    'return { ok: false, error: "manual_dedupe_refresh_failed" };',
    'last_error: "manual_render_queue_failed",',
    'last_error: "translation_failed",',
  ]) assertIncludes(source.action, marker, `${label}: bounded manual-intake failure marker`);
  if (source.action.includes("errorMessage(") || source.action.includes("String(error)") ||
      source.action.includes("last_error: `translation_failed:") ||
      source.action.includes("last_error: errorMessage")) {
    fail(`${label}: manual intake failures must not expose raw exception text`);
  }

  const packageData = JSON.parse(source.packageJson);
  assert.equal(packageData.scripts?.["check:manual-intake-persistence"], "node scripts/check-manual-intake-persistence-contract.mjs", "package script must retain manual intake persistence contract");
  assertIncludes(source.ci, "- run: npm run check:manual-intake-persistence", `${label}: hosted CI manual intake persistence contract`);
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, label] of [
    ["if (cfgError) throw cfgError;", "render configuration read bypass"],
    ["if (intakeUpdateError) throw intakeUpdateError;", "render-queued intake write bypass"],
    ["if (intakeFailureUpdateError) throw intakeFailureUpdateError;", "render failure intake write bypass"],
    ["if (translationFailureUpdateError) throw translationFailureUpdateError;", "create translation failure write bypass"],
    ["if (refreshFailureUpdateError) throw refreshFailureUpdateError;", "refresh translation failure write bypass"],
    ["if (postFailureUpdateError) throw postFailureUpdateError;", "post failure intake write bypass"],
  ]) assertRejects((source) => ({ ...source, action: source.action.replace(needle, "if (false) throw new Error('ignored');") }), label);
  assertRejects((source) => ({
    ...source,
    action: source.action.replaceAll("if (error) throw error;", "if (false) throw new Error('ignored');"),
  }), "X posting configuration read bypass");
  assertRejects((source) => ({ ...source, action: source.action.replace("if (cfgRow !== null && (typeof cfgRow !== \"object\" || Array.isArray(cfgRow)))", "if (false)") }), "render configuration shape bypass");
  assertRejects((source) => ({ ...source, action: source.action.replace("if (data !== null && (typeof data !== \"object\" || Array.isArray(data)))", "if (false)") }), "X posting configuration shape bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      "if (error) throw error;\n  if (data !== null && (!data || typeof data !== \"object\" || Array.isArray(data)))",
      "if (false) throw error;\n  if (data !== null && (!data || typeof data !== \"object\" || Array.isArray(data)))",
    ),
  }), "latest X delivery read bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      "manual_x_delivery_invalid_response",
      "manual_x_delivery_shape_guard_removed",
    ),
  }), "latest X delivery shape bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      "if (intakeSnapshotUpdateError) throw intakeSnapshotUpdateError;",
      "if (false) throw intakeSnapshotUpdateError;",
    ),
  }), "snapshot update persistence bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      "manual_intake_snapshot_update_invalid_response",
      "manual_intake_snapshot_shape_guard_removed",
    ),
  }), "snapshot update shape bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'last_error: "manual_render_queue_failed",',
      'last_error: errorMessage(error),',
    ),
  }), "manual render queue raw error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'last_error: "translation_failed",',
      'last_error: `translation_failed:${error}` ,',
    ),
  }), "manual translation raw error mutant");
  assertRejects((source) => ({ ...source, packageJson: source.packageJson.replace("    \"check:manual-intake-persistence\": \"node scripts/check-manual-intake-persistence-contract.mjs\",\n", "") }), "package wiring bypass");
  assertRejects((source) => ({ ...source, ci: source.ci.replace("      - run: npm run check:manual-intake-persistence\n", "") }), "hosted CI wiring bypass");
}

console.log(`MANUAL_INTAKE_PERSISTENCE_SOURCE_CONTRACT_PASS authoritativeWrites=checked configShapes=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

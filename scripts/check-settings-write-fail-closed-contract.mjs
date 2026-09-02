import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const settingsPath = path.join(repoRoot, "supabase/functions/admin-actions/settings.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`SETTINGS_WRITE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    settingsPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("settings action parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: settingsPath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("settings action transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ settings, packageJson, ci }, label = "current source") {
  parseSource(settings);
  if (!settings.includes('return "invalid scoring_policy";') ||
      settings.includes('invalid scoring_policy: ${(e as Error).message}')) {
    fail(`${label}: scoring policy validation must use a stable error code without exception text`);
  }
  const action = section(
    settings,
    "export async function saveSettingsAdminAction",
    "\n}",
    `${label} saveSettingsAdminAction`,
  );
  if (!action.includes("const { data: prev, error: previousSettingsError } = await settings.select(\"value\")")) {
    fail(`${label}: x_posting_config previous read must retain its error envelope`);
  }
  if (!action.includes('"x_posting_config_previous_read_failed"')) {
    fail(`${label}: x_posting_config previous read errors must return a stable failure`);
  }
  if (!action.includes('"x_posting_config_previous_invalid_response"')) {
    fail(`${label}: x_posting_config previous response shape must fail closed`);
  }
  if (!action.includes("const previousValue = prev?.value;") ||
    !action.includes("if (previousValue !== undefined &&") ||
    !action.includes("Array.isArray(previousValue)")) {
    fail(`${label}: x_posting_config previous value shape must fail closed`);
  }
  if (!action.includes("if (previousSettingsError) {")) {
    fail(`${label}: previous settings errors must be checked before restamping`);
  }
  const readErrorIndex = action.indexOf("if (previousSettingsError) {");
  const restampIndex = action.indexOf("if (shouldRestampXPostingStart", readErrorIndex);
  if (readErrorIndex < 0 || restampIndex < 0 || readErrorIndex >= restampIndex) {
    fail(`${label}: previous read gate must precede restamp decisions`);
  }
  if (!action.includes("const { error } = await settings.upsert(")) {
    fail(`${label}: final settings write must retain its error envelope`);
  }
  if (!action.includes("if (error) throw error;")) {
    fail(`${label}: final settings write errors must not report success`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:settings-write-fail-closed"] !==
    "node scripts/check-settings-write-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:settings-write-fail-closed")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    settings: fs.readFileSync(settingsPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("SETTINGS_WRITE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    settings: source.settings.replace(
      'return "invalid scoring_policy";',
      'return `invalid scoring_policy: ${(e as Error).message}`;',
    ),
  }), "scoring-policy validation raw error mutant");
  assertRejects((source) => ({
    ...source,
    settings: source.settings.replace(
      'if (previousSettingsError) {',
      'if (false) {',
    ),
  }), "previous-settings-read error ignored mutant");
  assertRejects((source) => ({
    ...source,
    settings: source.settings.replaceAll(
      '"x_posting_config_previous_invalid_response"',
      '"ignored_invalid_response"',
    ),
  }), "previous-settings malformed response ignored mutant");
  assertRejects((source) => ({
    ...source,
    settings: source.settings.replace(
      "if (previousValue !== undefined &&",
      "if (false &&",
    ),
  }), "previous-settings value shape ignored mutant");
  assertRejects((source) => ({
    ...source,
    settings: source.settings.replace(
      'if (error) throw error;',
      'if (false) throw error;',
    ),
  }), "final-settings write error ignored mutant");
}

console.log(
  `SETTINGS_WRITE_FAIL_CLOSED_SOURCE_CONTRACT_PASS previousRead=true finalWrite=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/_shared/legacyMediaCleanup.ts");

function fail(message) {
  throw new Error(`LEGACY_CLEANUP_ORDER_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("legacy cleanup parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("legacy cleanup transpilation diagnostics");
  }
}

function assertContract(source, label = "current source") {
  parseSource(source);
  const failureBranch = source.indexOf("if (error) {");
  const failureIncrement = source.indexOf("failedCount += paths.length;", failureBranch);
  const failureContinue = source.indexOf("continue;", failureIncrement);
  const databaseClear = source.indexOf("const ids =", failureBranch);
  if (failureBranch < 0 || failureIncrement < 0 || failureContinue < 0 || databaseClear < 0) {
    fail(`${label}: storage failure branch or database clear boundary is missing`);
  }
  if (failureContinue > databaseClear) {
    fail(`${label}: database ownership may clear after storage failure`);
  }
  if (!source.includes('await supabase.storage.from("temp-media").remove(paths)')) {
    fail(`${label}: storage deletion sink changed unexpectedly`);
  }
  return { storageFailureGuard: 1, dbClearAfterSuccessOnly: true };
}

const source = fs.readFileSync(sourcePath, "utf8");
const result = assertContract(source);

if (process.env.MUTATION_TEST === "1") {
  const mutant = source.replace("        continue;\n", "");
  let rejected = false;
  try {
    assertContract(mutant, "storage-failure-clear mutant");
  } catch (error) {
    rejected = String(error).includes("LEGACY_CLEANUP_ORDER_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("storage-failure-clear mutant was not rejected");
}

console.log(
  `LEGACY_CLEANUP_ORDER_SOURCE_CONTRACT_PASS storageFailureGuard=${result.storageFailureGuard} dbClearAfterSuccessOnly=${result.dbClearAfterSuccessOnly} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);

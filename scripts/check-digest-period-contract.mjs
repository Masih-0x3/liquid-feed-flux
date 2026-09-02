import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/digest-compiler/index.ts");

function fail(message) {
  throw new Error(`DIGEST_PERIOD_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("digest compiler parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("digest compiler transpilation diagnostics");
  }
  return sourceFile;
}

function walk(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => walk(child, callback));
}

function hasIdentifier(node, name) {
  let found = false;
  walk(node, (child) => {
    if (ts.isIdentifier(child) && child.text === name) found = true;
  });
  return found;
}

function isCallTo(node, name) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === name;
}

function assertContract(source, label = "current source") {
  const sourceFile = parseSource(source);
  let periodHelper = null;
  let periodEndDeclaration = null;
  let workflowRunIdDeclaration = null;
  let workflowRunKeyAssignment = null;

  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "floorDigestPeriodEnd") periodHelper = node;
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    if (node.name.text === "periodEnd") periodEndDeclaration = node;
    if (node.name.text === "workflowRunId") workflowRunIdDeclaration = node;
  });
  walk(sourceFile, (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
      && node.left.text === "workflowRunKey"
    ) {
      workflowRunKeyAssignment = node;
    }
  });

  if (!periodHelper?.body) fail(`${label}: deterministic period helper is missing`);
  const helperText = source.slice(periodHelper.pos, periodHelper.end);
  if (!helperText.includes("Math.floor") || !helperText.includes("frequencyMinutes")) {
    fail(`${label}: period helper does not quantize by frequency`);
  }
  if (!periodEndDeclaration?.initializer || !isCallTo(periodEndDeclaration.initializer, "floorDigestPeriodEnd")) {
    fail(`${label}: periodEnd is not derived from floorDigestPeriodEnd`);
  }
  if (!workflowRunIdDeclaration?.initializer || !hasIdentifier(workflowRunIdDeclaration.initializer, "periodEnd")) {
    fail(`${label}: workflowRunId is not tied to the deterministic period`);
  }
  if (!workflowRunKeyAssignment?.right || !hasIdentifier(workflowRunKeyAssignment.right, "periodEnd")) {
    fail(`${label}: workflowRunKey is not tied to the deterministic period`);
  }
  return { periodHelpers: 1, deterministicKeys: 2 };
}

const source = fs.readFileSync(sourcePath, "utf8");
const result = assertContract(source);

if (process.env.MUTATION_TEST === "1") {
  const mutants = [
    ["unbucketed-period", source.replace(
      "const periodEnd = floorDigestPeriodEnd(new Date(), digestConfig.frequency_minutes);",
      "const periodEnd = new Date();",
    )],
    ["workflow-id-wall-clock", source.replace(
      "const workflowRunId = `digest:${periodEnd.toISOString()}`;",
      "const workflowRunId = `digest:${new Date().toISOString()}`;",
    )],
    ["workflow-key-wall-clock", source.replace(
      "workflowRunKey = `digest-compiler:${periodEnd.toISOString()}`;",
      "workflowRunKey = `digest-compiler:${new Date().toISOString()}`;",
    )],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, `${name} mutant`);
    } catch (error) {
      rejected = String(error).includes("DIGEST_PERIOD_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(`${name} mutant was not rejected`);
  }
}

console.log(
  `DIGEST_PERIOD_SOURCE_CONTRACT_PASS periodHelpers=${result.periodHelpers} deterministicKeys=${result.deterministicKeys} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);

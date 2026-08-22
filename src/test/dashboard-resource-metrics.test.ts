import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { it } from "vitest";
import {
  cronCadenceSeconds,
  estimateMonthlyRuns,
  percentUsed,
} from "../../supabase/functions/admin-actions/dashboardResourceMetrics.ts";

const repoRoot = process.cwd();
const resourceMetricsPath = path.join(
  repoRoot,
  "supabase/functions/admin-actions/dashboardResourceMetrics.ts",
);
const dashboardSummariesPath = path.join(
  repoRoot,
  "supabase/functions/admin-actions/dashboardSummaries.ts",
);

const EXPECTED_FUNCTION_HASHES = {
  estimateMonthlyRuns:
    "ae0d923bd921838b7c2944bf2a8d1f09534e79f2be3c755ed1e51589b5273ee9",
  cronCadenceSeconds:
    "2e35abfd3860ca78cc39e35814d83ec874bdc728fbf692d3359eb09595477c2a",
  percentUsed:
    "bbbad23d7ae9ebc886010a586d61df9d8a20272f165e385b836d833a6aebc47b",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseModule(filePath: string, source: string): ts.SourceFile {
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : filePath.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const diagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, `${filePath} parses`);
  return sourceFile;
}

function functionDeclarations(
  sourceFile: ts.SourceFile,
  names: string[],
): Map<string, ts.FunctionDeclaration[]> {
  const declarations = new Map<string, ts.FunctionDeclaration[]>();
  for (const name of names) declarations.set(name, []);
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    const matches = declarations.get(statement.name.text);
    if (matches) matches.push(statement);
  }
  return declarations;
}

function assertSourceContract(
  resourceSource: string,
  summariesSource: string,
  label: string,
): void {
  const resourceFile = parseModule(resourceMetricsPath, resourceSource);
  const summariesFile = parseModule(dashboardSummariesPath, summariesSource);
  const names = Object.keys(EXPECTED_FUNCTION_HASHES);
  const resourceDeclarations = functionDeclarations(resourceFile, names);
  const summaryDeclarations = functionDeclarations(summariesFile, names);

  for (const name of names) {
    const implementations = resourceDeclarations.get(name) ?? [];
    assert.equal(
      implementations.length,
      1,
      `${label}: ${name} must have exactly one implementation in the resource module`,
    );
    assert.equal(
      sha256(implementations[0].getText(resourceFile)),
      EXPECTED_FUNCTION_HASHES[name as keyof typeof EXPECTED_FUNCTION_HASHES],
      `${label}: ${name} body/declaration changed`,
    );
    assert.equal(
      (summaryDeclarations.get(name) ?? []).length,
      0,
      `${label}: ${name} implementation remains in dashboardSummaries.ts`,
    );
  }

  const importedNames = new Set<string>();
  const reExportedNames = new Set<string>();
  for (const statement of summariesFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleName = statement.moduleSpecifier.getText(summariesFile);
      if (moduleName === '"./dashboardResourceMetrics.ts"') {
        const namedBindings = statement.importClause?.namedBindings;
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            importedNames.add(element.name.text);
          }
        }
      }
    }
    if (ts.isExportDeclaration(statement)) {
      const moduleName = statement.moduleSpecifier?.getText(summariesFile);
      if (!moduleName) {
        const exportClause = statement.exportClause;
        if (exportClause && ts.isNamedExports(exportClause)) {
          for (const element of exportClause.elements) {
            reExportedNames.add(element.name.text);
          }
        }
      }
    }
  }
  assert.deepEqual(importedNames, new Set(names), `${label}: import seam`);
  assert.deepEqual(reExportedNames, new Set(names), `${label}: re-export seam`);
}

function assertRejectsMutation(mutator: () => void, label: string): void {
  assert.throws(mutator, /dashboard resource metrics contract/, label);
}

it("keeps resource metric helpers behaviorally stable", () => {
  assert.equal(estimateMonthlyRuns("* * * * *"), 43_200);
  assert.equal(estimateMonthlyRuns("*/10 * * * *"), 4_320);
  assert.equal(estimateMonthlyRuns("0 3 * * *"), 30);
  assert.equal(cronCadenceSeconds("*/2 * * * *"), 120);
  assert.equal(cronCadenceSeconds("*/5 * * * * *"), 5);
  assert.equal(cronCadenceSeconds("0 3 * * *"), null);
  assert.equal(percentUsed(250, 1000), 25);
  assert.equal(percentUsed(1, 0), null);
  assert.equal(percentUsed(Number.NaN, 100), null);
});

it("enforces the pure-module extraction seam and exact declarations", () => {
  const resourceSource = readFileSync(resourceMetricsPath, "utf8");
  const summariesSource = readFileSync(dashboardSummariesPath, "utf8");
  assertSourceContract(resourceSource, summariesSource, "dashboard resource metrics contract");

  assertRejectsMutation(
    () => assertSourceContract(
      resourceSource.replace("if (value === \"* * * * *\") return 43_200;", "if (value === \"* * * * *\") return 1;"),
      summariesSource,
      "dashboard resource metrics contract body mutation",
    ),
    "body mutation must fail closed",
  );
  assertRejectsMutation(
    () => assertSourceContract(
      resourceSource,
      summariesSource.replace(
        "export { cronCadenceSeconds, estimateMonthlyRuns, percentUsed };",
        "",
      ),
      "dashboard resource metrics contract missing re-export mutation",
    ),
    "missing re-export must fail closed",
  );
});

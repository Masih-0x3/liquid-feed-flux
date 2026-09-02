import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`ADMIN_ACTIONS_TYPE_BOUNDARY_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
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

  for (const marker of [
    'import type { SupabaseAdminClient } from "./types.ts";',
    "async function runTranslationOnlyForAdmin(supabase: SupabaseAdminClient, tweetId: string)",
    "serve(async (req: Request): Promise<Response> => {",
  ]) {
    if (!source.includes(marker)) fail(`${label}: missing ${marker}`);
  }
  if (source.includes("deno-lint-ignore no-explicit-any")) {
    fail(`${label}: admin-actions type suppression remains`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:admin-actions-type-boundary"] !== "node scripts/check-admin-actions-type-boundary-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:admin-actions-type-boundary")) {
    fail(`${label}: CI command is missing`);
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
  assert.throws(
    () => assertContract(mutator(sources()), label),
    /ADMIN_ACTIONS_TYPE_BOUNDARY_SOURCE_CONTRACT_FAIL/,
  );
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (input) => ({ ...input, source: input.source.replace(
      "supabase: SupabaseAdminClient, tweetId",
      "supabase: any, tweetId",
    ) }),
    "translation client any mutant",
  );
  assertRejects(
    (input) => ({ ...input, source: input.source.replace(
      "serve(async (req: Request): Promise<Response> => {",
      "serve(async (req) => {",
    ) }),
    "serve callback annotation mutant",
  );
  assertRejects(
    (input) => ({ ...input, source: input.source.replace(
      'import type { SupabaseAdminClient } from "./types.ts";\n',
      "",
    ) }),
    "type import removal mutant",
  );
  assertRejects(
    (input) => ({ ...input, ci: input.ci.replace(
      "      - run: npm run check:admin-actions-type-boundary\n",
      "",
    ) }),
    "CI command removal mutant",
  );
}

console.log(`ADMIN_ACTIONS_TYPE_BOUNDARY_SOURCE_CONTRACT_PASS typedBoundaries=2 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

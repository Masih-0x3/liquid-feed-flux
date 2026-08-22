import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  component: path.join(repoRoot, "src/components/settings/ContentFilterSettings.tsx"),
  actionNames: path.join(repoRoot, "supabase/functions/_shared/adminActionNames.ts"),
  dispatcher: path.join(repoRoot, "supabase/functions/admin-actions/index.ts"),
  handler: path.join(repoRoot, "supabase/functions/admin-actions/authorStats.ts"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("CONTENT_FILTER_AUTHOR_STATS_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(filePath, input) {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, input, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + " has TypeScript parse diagnostics");
  }
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(path.basename(filePath) + " has TypeScript transpilation diagnostics");
  }
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(label + " is missing: " + expected);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(label + " must not include: " + unexpected);
}

function assertOrder(input, first, second, label) {
  const firstIndex = input.indexOf(first);
  const secondIndex = input.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    fail(label + " has invalid order");
  }
}

function assertContract(sources, label) {
  for (const [name, filePath] of Object.entries(paths)) {
    if (name === "packageJson" || name === "ci") continue;
    parseAndTranspile(filePath, sources[name]);
  }

  assertIncludes(sources.component, "import { invokeAdminAction } from '@/api/adminActions';", label + " admin action client import");
  assertNotIncludes(sources.component, "@/integrations/supabase/client", label + " browser Supabase client import");
  assertNotIncludes(sources.component, ".from('posts')", label + " browser posts enumeration");
  assertIncludes(
    sources.component,
    "const shouldLoadAuthors = filterStatus === 'active' &&\n    filterMode === 'granular' &&\n    authorOverridesOpen;",
    label + " granular/open query guard",
  );
  assertIncludes(sources.component, "queryKey: ['content-filter-author-stats', 500]", label + " bounded author query key");
  assertIncludes(sources.component, "action: 'get_recent_author_stats'", label + " author stats action call");
  assertIncludes(sources.component, "limit: 500,", label + " bounded author request");
  assertIncludes(sources.component, "enabled: shouldLoadAuthors", label + " lazy author query enablement");
  assertIncludes(
    sources.component,
    "const configuredHandles = Object.keys(config.author_rules).sort((left, right) => left.localeCompare(right));",
    label + " configured author handles",
  );
  assertIncludes(
    sources.component,
    "const configuredAuthors = configuredHandles.map((handle) => (\n      sampledByHandle.get(handle) ?? { handle, count: 0 }\n    ));",
    label + " configured author rule preservation",
  );
  assertIncludes(
    sources.component,
    "return [...configuredAuthors, ...sampleAuthors];",
    label + " configured authors visible before capped sample",
  );
  assertIncludes(sources.component, "{visibleAuthors.map(({ handle, count }) => {", label + " all configured authors rendered");
  assertIncludes(sources.component, "Could not load the bounded recent author sample.", label + " author read error state");
  assertIncludes(sources.component, "Retry authors", label + " author read retry");
  assertIncludes(sources.component, "Posts in sample", label + " scoped author count header");
  assertIncludes(
    sources.component,
    "This is a bounded recent sample, not an all-time count.",
    label + " bounded sample copy",
  );
  assertIncludes(
    sources.component,
    "newest posts with an author handle",
    label + " filtered sample scope copy",
  );

  assertIncludes(sources.actionNames, "'get_recent_author_stats'", label + " registered action name");
  assertIncludes(sources.dispatcher, "import { getRecentAuthorStatsAdminAction } from \"./authorStats.ts\";", label + " author stats handler import");
  assertIncludes(sources.dispatcher, "case 'get_recent_author_stats': {", label + " author stats dispatcher case");
  assertIncludes(sources.dispatcher, "getRecentAuthorStatsAdminAction(supabase, body)", label + " author stats dispatcher call");
  assertOrder(
    sources.dispatcher,
    "const authResult = await requireAdmin(req, corsHeaders);",
    "case 'get_recent_author_stats': {",
    label + " auth before author stats dispatch",
  );

  assertIncludes(sources.handler, "export const AUTHOR_STATS_MAX_POST_LIMIT = 500;", label + " server post cap");
  assertIncludes(
    sources.handler,
    "return Math.min(value, AUTHOR_STATS_MAX_POST_LIMIT);",
    label + " server request cap enforcement",
  );
  assertIncludes(sources.handler, ".order(\"created_at\", { ascending: false })", label + " recent sample ordering");
  assertIncludes(sources.handler, ".limit(limit);", label + " server bounded posts query");
  assertIncludes(sources.handler, "scope: \"recent_posts_sample\"", label + " server sample scope");
  assertIncludes(sources.handler, "sampled_posts: records.length", label + " server sampled row count");
  assertIncludes(sources.handler, ".slice(0, AUTHOR_STATS_MAX_AUTHORS);", label + " bounded author response");
  assertIncludes(sources.handler, '"author_stats_invalid_response"', label + " malformed author stats response");
  assertIncludes(sources.handler, '"author_stats_invalid_row"', label + " malformed author stats row");
  assertIncludes(sources.handler, "if (!Array.isArray(data))", label + " author stats array guard");
  const packageData = JSON.parse(sources.packageJson);
  if (packageData.scripts?.["check:content-filter-author-stats"] !== "node scripts/check-content-filter-author-stats-contract.mjs") fail(label + " package script is missing");
  assertIncludes(sources.ci, "- run: npm run check:content-filter-author-stats", label + " hosted CI contract");

  return { guardedReads: 1, serverCap: 500 };
}

function makeClientEnumerationMutant(input) {
  return input.replace(
    "import { invokeAdminAction } from '@/api/adminActions';",
    "import { supabase } from '@/integrations/supabase/client';",
  );
}

function makeUnconditionalQueryMutant(input) {
  return input.replace("enabled: shouldLoadAuthors", "enabled: true");
}

function makeActionNameMutant(input) {
  return input.replace("action: 'get_recent_author_stats'", "action: 'get_health'");
}

function makeSampleCopyMutant(input) {
  return input.replace(
    "This is a bounded recent sample, not an all-time count.",
    "These are author counts.",
  );
}

function makeConfiguredRulesMutant(input) {
  return input.replace(
    "return [...configuredAuthors, ...sampleAuthors];",
    "return sampleAuthors;",
  );
}

function makeActionRegistrationMutant(input) {
  return input.replace("'get_recent_author_stats'", "'get_author_stats'");
}

function makeDispatcherMutant(input) {
  return input.replace("case 'get_recent_author_stats': {", "case 'get_author_stats': {");
}

function makeServerCapMutant(input) {
  return input.replace(
    "return Math.min(value, AUTHOR_STATS_MAX_POST_LIMIT);",
    "return value;",
  );
}

function makeServerLimitMutant(input) {
  return input.replace(".limit(limit);", ".limit(10000);");
}

function makeResponseShapeMutant(input) {
  return input.replace('"author_stats_invalid_response"', '"author_stats_shape_guard_removed"');
}

function makeRowShapeMutant(input) {
  return input.replace('"author_stats_invalid_row"', '"author_stats_row_guard_removed"');
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test") || process.env.MUTATION_TEST === "1";

if (selfTest) {
  const mutants = [
    ["client-enumeration", { ...source, component: makeClientEnumerationMutant(source.component) }],
    ["unconditional-query", { ...source, component: makeUnconditionalQueryMutant(source.component) }],
    ["action-name", { ...source, component: makeActionNameMutant(source.component) }],
    ["sample-copy", { ...source, component: makeSampleCopyMutant(source.component) }],
    ["configured-rules", { ...source, component: makeConfiguredRulesMutant(source.component) }],
    ["action-registration", { ...source, actionNames: makeActionRegistrationMutant(source.actionNames) }],
    ["dispatcher", { ...source, dispatcher: makeDispatcherMutant(source.dispatcher) }],
    ["server-cap", { ...source, handler: makeServerCapMutant(source.handler) }],
    ["server-limit", { ...source, handler: makeServerLimitMutant(source.handler) }],
    ["response-shape", { ...source, handler: makeResponseShapeMutant(source.handler) }],
    ["row-shape", { ...source, handler: makeRowShapeMutant(source.handler) }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("CONTENT_FILTER_AUTHOR_STATS_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "CONTENT_FILTER_AUTHOR_STATS_SOURCE_CONTRACT_PASS guardedReads=" + result.guardedReads
    + " serverCap=" + result.serverCap
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);

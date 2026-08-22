import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/dashboardSummaries.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`DASHBOARD_SUMMARY_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("dashboard summary parse diagnostics");
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((out.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("dashboard summary transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parse(source);
  for (const [needle, name] of [
    ["function checkedDashboardRows(", "central dashboard row shape helper"],
    ["throw new Error(`${section}_invalid_response`);", "malformed row response rejection"],
    ["return { data: checkedDashboardRows(result.data, \"dashboard_rows\"), error: null };", "generic row-query shape gate"],
    ["return checkedDashboardRows(data, \"dashboard_posts\");", "posts shape gate"],
    ["checkedDashboardRows(data, \"dashboard_openai_usage\")", "OpenAI usage shape gate"],
    ["checkedDashboardRows(runRows, \"dashboard_workflow_runs\")", "workflow-run shape gate"],
    ["checkedDashboardRows(callRows, \"dashboard_ai_call_ledger\")", "AI-call shape gate"],
    ["checkedDashboardRows(budgetRows, \"dashboard_budget_ledger\")", "budget shape gate"],
    ["checkedDashboardRows(jobs, \"dashboard_jobs\")", "job shape gate"],
    ["checkedDashboardRows(activeJobs, \"dashboard_active_jobs\")", "active-job shape gate"],
    ["checkedDashboardRows(xRows, \"dashboard_x_deliveries\")", "X-delivery shape gate"],
    ["checkedDashboardRows(eventRows, \"dashboard_x_api_events\")", "X API event shape gate"],
    ["checkedDashboardRows(postsRes.data, \"dashboard_performance_posts\")", "performance post shape gate"],
    ["checkedDashboardRows(deliveries, \"dashboard_performance_deliveries\")", "performance delivery shape gate"],
    ["checkedDashboardRows(xDeliveries, \"dashboard_performance_x_deliveries\")", "performance X-delivery shape gate"],
    ["checkedDashboardRows(scoreEvents, \"dashboard_performance_score_events\")", "performance score-event shape gate"],
    ["checkedDashboardRows(scoreEventsRes.data, \"dashboard_scoring_events\")", "scoring shape gate"],
    ["checkedDashboardRows(feedbackRes.data, \"dashboard_feedback_events\")", "feedback shape gate"],
    ["typeof base === \"object\" && !Array.isArray(base)", "base summary object shape gate"],
  ]) if (!source.includes(needle)) fail(`${label}: missing ${name}`);

  for (const marker of [
    'return "dashboard_query_failed";',
    'error: "system_resource_usage_unavailable",',
    'error: "dashboard_x_local_usage_unavailable",',
    'error: "dashboard_openai_usage_unavailable",',
    'error: "dashboard_system_performance_unavailable",',
    'error: "dashboard_scoring_tuning_unavailable",',
  ]) if (!source.includes(marker)) fail(`${label}: missing bounded dashboard failure marker ${marker}`);
  if (source.includes("resourceRes.error.message") ||
      source.includes("error instanceof Error ? error.message") ||
      source.includes("error instanceof Error ? error.message : String(error)") ||
      source.includes("return String(error)")) {
    fail(`${label}: dashboard failures must not expose raw database/exception text`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:dashboard-summary"] !== "node scripts/check-dashboard-summary-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:dashboard-summary")) fail(`${label}: hosted CI command is missing`);
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
    if (String(error).includes("DASHBOARD_SUMMARY_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, replacement, label] of [
    ["throw new Error(`${section}_invalid_response`);", "return [];", "central malformed response bypass"],
    ["return checkedDashboardRows(data, \"dashboard_posts\");", "return (data ?? []) as Record<string, unknown>[];", "posts malformed response bypass"],
    ["checkedDashboardRows(jobs, \"dashboard_jobs\")", "(jobs ?? []) as Array<Record<string, unknown>>", "jobs malformed response bypass"],
    ["checkedDashboardRows(eventRows, \"dashboard_x_api_events\")", "(eventRows ?? []) as Array<Record<string, unknown>>", "X API events malformed response bypass"],
    ["typeof base === \"object\" && !Array.isArray(base)", "typeof base === \"object\"", "base array response bypass"],
    ["return \"dashboard_query_failed\";", "return error.message;", "dashboard fallback raw error bypass"],
    ['error: "system_resource_usage_unavailable",', "error: resourceRes.error.message,", "resource fallback raw error bypass"],
    ['error: "dashboard_x_local_usage_unavailable",', "error: errorMessage(error),", "X local usage fallback raw error bypass"],
    ['error: "dashboard_system_performance_unavailable",', "error: error instanceof Error ? error.message : String(error),", "system performance fallback raw error bypass"],
  ]) assertRejects((source) => ({ ...source, source: source.source.replace(needle, replacement) }), label);
}

console.log(`DASHBOARD_SUMMARY_SOURCE_CONTRACT_PASS rowShapes=failClosed degradedSections=preserved selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

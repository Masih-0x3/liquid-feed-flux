import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  monitoring: path.join(repoRoot, "src/pages/Monitoring.tsx"),
  drawer: path.join(repoRoot, "src/components/monitoring/MonitoringDetailDrawer.tsx"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("MONITORING_TIMELINE_IDENTITY_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(filePath, input) {
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

function assertOrder(input, first, second, label) {
  const firstIndex = input.indexOf(first);
  const secondIndex = input.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    fail(label + " has invalid order");
  }
}

function countOccurrences(input, expected) {
  return input.split(expected).length - 1;
}

function assertOccurrenceCount(input, expected, count, label) {
  if (countOccurrences(input, expected) !== count) {
    fail(label + " must occur " + count + " time(s): " + expected);
  }
}

function sliceBetween(input, start, end, label) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    fail(label + " could not be scoped");
  }
  return input.slice(startIndex, endIndex);
}

function assertContract(sources, label) {
  parseAndTranspile(paths.monitoring, sources.monitoring);
  parseAndTranspile(paths.drawer, sources.drawer);

  assertIncludes(sources.monitoring, "interface TimelineState", label + " paired timeline state");
  assertIncludes(sources.monitoring, "const timelineRequestRef = useRef(0);", label + " request generation state");
  assertIncludes(sources.monitoring, "const requestId = ++timelineRequestRef.current;", label + " request generation increment");
  assertIncludes(
    sources.monitoring,
    "setTimelineState({ tweetId, events: [], loading: true, error: false });",
    label + " timeline loading reset",
  );
  assertIncludes(
    sources.monitoring,
    "if (timelineRequestRef.current !== requestId) return;",
    label + " late response guard",
  );
  assertOccurrenceCount(
    sources.monitoring,
    "if (timelineRequestRef.current !== requestId) return;",
    2,
    label + " successful and failed late response guards",
  );
  assertIncludes(
    sources.monitoring,
    "setTimelineState({ tweetId, events: data.events as PipelineEvent[], loading: false, error: false });",
    label + " matching response state",
  );
  assertIncludes(
    sources.monitoring,
    "setTimelineState({ tweetId, events: [], loading: false, error: true });",
    label + " matching error state",
  );
  const openDetailsHandler = sliceBetween(
    sources.monitoring,
    "const openDetails = useCallback(async (tweetId: string) => {",
    "useEffect(() => {",
    label + " timeline read handler",
  );
  const successfulTimelineRead = sliceBetween(
    openDetailsHandler,
    "const data = await invokeAdminRead<",
    "} catch {",
    label + " successful timeline read",
  );
  assertOrder(
    successfulTimelineRead,
    "if (timelineRequestRef.current !== requestId) return;",
    "setTimelineState({ tweetId, events: data.events as PipelineEvent[], loading: false, error: false });",
    label + " success guard before matching state commit",
  );
  const failedTimelineRead = sliceBetween(
    openDetailsHandler,
    "} catch {",
    "  }, []);",
    label + " failed timeline read",
  );
  assertOrder(
    failedTimelineRead,
    "if (timelineRequestRef.current !== requestId) return;",
    "setTimelineState({ tweetId, events: [], loading: false, error: true });",
    label + " failure guard before matching error commit",
  );
  assertIncludes(sources.monitoring, "const hasMatchingTimeline = Boolean(", label + " timeline identity derivation");
  assertIncludes(sources.monitoring, "timelineState.tweetId === drawerTweetId", label + " timeline identity comparison");
  assertIncludes(sources.monitoring, "const timeline = hasMatchingTimeline ? timelineState.events : [];", label + " stale timeline suppression");
  assertIncludes(
    sources.monitoring,
    "const timelineLoading = Boolean(\n    drawerOpen && drawerTweetId && (!hasMatchingTimeline || timelineState.loading),\n  );",
    label + " full timeline loading derivation",
  );
  assertIncludes(sources.monitoring, "const timelineError = hasMatchingTimeline && timelineState.error;", label + " timeline error derivation");

  assertIncludes(sources.monitoring, "const closeDetails = useCallback(() => {", label + " centralized close helper");
  assertIncludes(sources.monitoring, "timelineRequestRef.current += 1;", label + " close invalidation");
  assertIncludes(sources.monitoring, "setTimelineState({ tweetId: null, events: [], loading: false, error: false });", label + " close clearing");
  assertOccurrenceCount(sources.monitoring, "setDrawerOpen(false);", 1, label + " centralized drawer close");
  assertOccurrenceCount(sources.monitoring, "setDrawerTweetId(null);", 1, label + " centralized selected ID clear");
  assertOccurrenceCount(sources.monitoring, "setDrawerTweetId(tweetId);", 1, label + " matched selection opening");
  const drawerOpenChangeHandler = sliceBetween(
    sources.monitoring,
    "const handleDrawerOpenChange = useCallback((open: boolean) => {",
    "const openDetails = useCallback(async (tweetId: string) => {",
    label + " drawer change handler",
  );
  assertIncludes(drawerOpenChangeHandler, "closeDetails();", label + " drawer change close invalidation");
  assertIncludes(sources.monitoring, "onOpenChange={handleDrawerOpenChange}", label + " drawer close handler");
  assertIncludes(sources.monitoring, "timelineLoading={timelineLoading}", label + " drawer loading prop");
  assertIncludes(sources.monitoring, "timelineError={timelineError}", label + " drawer error prop");
  assertIncludes(
    sources.monitoring,
    "if (drawerTweetId) void openDetails(drawerTweetId);",
    label + " current selection timeline retry",
  );
  const enrichmentHandler = sliceBetween(
    sources.monitoring,
    "const handleTestEnrich = async (tweetId: string) => {",
    "const openManualScore = (entry: MonitoringEntry) => {",
    label + " enrichment handler",
  );
  const enrichmentStart = sliceBetween(
    enrichmentHandler,
    "setEnrichingTweetIds((prev) => new Set(prev).add(tweetId));",
    "try {",
    label + " enrichment start",
  );
  assertIncludes(
    enrichmentStart,
    "void openDetails(tweetId);",
    label + " enrichment starts a matched timeline read",
  );
  const enrichmentPoll = sliceBetween(
    enrichmentHandler,
    "const interval = setInterval(async () => {",
    "}, 3000);",
    label + " enrichment poll",
  );
  assertIncludes(
    enrichmentPoll,
    "if (post.enrich_status === 'awaiting_approval') {\n            void openDetails(tweetId);",
    label + " enrichment-ready drawer opening through matched read",
  );

  assertIncludes(sources.drawer, "timelineLoading: boolean;", label + " drawer loading prop type");
  assertIncludes(sources.drawer, "timelineError: boolean;", label + " drawer error prop type");
  assertIncludes(sources.drawer, "onRetryTimeline: () => void;", label + " drawer retry prop type");
  assertIncludes(sources.drawer, "{timelineLoading ? (", label + " drawer loading branch");
  assertIncludes(sources.drawer, ") : timelineError ? (", label + " drawer error branch");
  assertIncludes(sources.drawer, "Loading timeline…", label + " drawer loading copy");
  assertIncludes(sources.drawer, "Retry timeline", label + " drawer retry copy");
  assertIncludes(sources.drawer, "onClick={onRetryTimeline}", label + " drawer retry action");

  assertOrder(openDetailsHandler, "const requestId = ++timelineRequestRef.current;", "invokeAdminRead", label + " request before admin read");
  assertOrder(openDetailsHandler, "get_pipeline_events", "if (timelineRequestRef.current !== requestId) return;", label + " admin read before success guard");
  assertOccurrenceCount(openDetailsHandler, ".from('pipeline_events')", 0, label + " no direct browser pipeline_events query in open details");
  assertIncludes(openDetailsHandler, "action: 'get_pipeline_events'", label + " admin read action is get_pipeline_events");
  assertIncludes(openDetailsHandler, "if (!data?.success || !Array.isArray(data.events))", label + " admin read response envelope validation");
  assertOrder(sources.monitoring, "timelineRequestRef.current += 1;", "setTimelineState({ tweetId: null, events: [], loading: false, error: false });", label + " invalidation before clearing");
  assertOrder(sources.drawer, "{timelineLoading ? (", ") : timelineError ? (", label + " drawer state priority");

  return { guardedReads: 1, drawerStates: 3 };
}

function makeLateResponseMutant(input) {
  return input.replace(
    "if (timelineRequestRef.current !== requestId) return;",
    "if (false) return;",
  );
}

function makeDirectBrowserQueryMutant(input) {
  return input.replace(
    "      const data = await invokeAdminRead<{ success?: boolean; error?: string; events?: unknown[] }>({\n        action: 'get_pipeline_events',\n        tweet_id: tweetId,\n      });",
    "      const { data, error } = await supabase\n        .from('pipeline_events')\n        .select('subject_type, subject_id, step, status, started_at, ended_at, error, meta')\n        .eq('subject_type', 'post')\n        .eq('subject_id', tweetId)\n        .order('started_at', { ascending: false })\n        .limit(200);\n      if (error) throw error;",
  );
}

function makeSuccessCommitOrderMutant(input) {
  return input.replace(
    "if (timelineRequestRef.current !== requestId) return;\n      setTimelineState({ tweetId, events: data.events as PipelineEvent[], loading: false, error: false });",
    "setTimelineState({ tweetId, events: data.events as PipelineEvent[], loading: false, error: false });\n      if (timelineRequestRef.current !== requestId) return;",
  );
}

function makeFailureCommitOrderMutant(input) {
  return input.replace(
    "if (timelineRequestRef.current !== requestId) return;\n      setTimelineState({ tweetId, events: [], loading: false, error: true });",
    "setTimelineState({ tweetId, events: [], loading: false, error: true });\n      if (timelineRequestRef.current !== requestId) return;",
  );
}

function makeIdentityMutant(input) {
  return input.replace(
    "const timeline = hasMatchingTimeline ? timelineState.events : [];",
    "const timeline = timelineState.events;",
  );
}

function makeCloseInvalidationMutant(input) {
  return input.replace("timelineRequestRef.current += 1;", "void timelineRequestRef.current;");
}

function makeCloseClearMutant(input) {
  return input.replace(
    "setTimelineState({ tweetId: null, events: [], loading: false, error: false });",
    "setTimelineState({ tweetId: null, events: timelineState.events, loading: false, error: false });",
  );
}

function makeDrawerHandlerMutant(input) {
  return input.replace("onOpenChange={handleDrawerOpenChange}", "onOpenChange={setDrawerOpen}");
}

function makeDrawerCloseHandlerMutant(input) {
  return input.replace(
    "    closeDetails();\n  }, [closeDetails]);",
    "    setDrawerOpen(false);\n  }, [closeDetails]);",
  );
}

function makeRetryMutant(input) {
  return input.replace(
    "if (drawerTweetId) void openDetails(drawerTweetId);",
    "void drawerTweetId;",
  );
}

function makeEnrichmentStartOpenMutant(input) {
  return input.replace(
    "setEnrichingTweetIds((prev) => new Set(prev).add(tweetId));\n    void openDetails(tweetId);",
    "setEnrichingTweetIds((prev) => new Set(prev).add(tweetId));\n    void tweetId;",
  );
}

function makeEnrichmentPollOpenMutant(input) {
  return input.replace(
    "if (post.enrich_status === 'awaiting_approval') {\n            void openDetails(tweetId);\n          }",
    "if (post.enrich_status === 'awaiting_approval') {\n            void tweetId;\n          }",
  );
}

function makeDrawerLoadingMutant(input) {
  return input.replace("{timelineLoading ? (", "{false ? (");
}

function makeTimelineLoadingPredicateMutant(input) {
  return input.replace(
    "const timelineLoading = Boolean(\n    drawerOpen && drawerTweetId && (!hasMatchingTimeline || timelineState.loading),\n  );",
    "const timelineLoading = Boolean(false);",
  );
}

function makeDrawerRetryMutant(input) {
  return input.replace("onClick={onRetryTimeline}", "onClick={() => undefined}");
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["late-response", { ...source, monitoring: makeLateResponseMutant(source.monitoring) }],
    ["direct-browser-query", { ...source, monitoring: makeDirectBrowserQueryMutant(source.monitoring) }],
    ["success-commit-order", { ...source, monitoring: makeSuccessCommitOrderMutant(source.monitoring) }],
    ["failure-commit-order", { ...source, monitoring: makeFailureCommitOrderMutant(source.monitoring) }],
    ["identity-suppression", { ...source, monitoring: makeIdentityMutant(source.monitoring) }],
    ["close-invalidation", { ...source, monitoring: makeCloseInvalidationMutant(source.monitoring) }],
    ["close-clear", { ...source, monitoring: makeCloseClearMutant(source.monitoring) }],
    ["drawer-handler", { ...source, monitoring: makeDrawerHandlerMutant(source.monitoring) }],
    ["drawer-close-handler", { ...source, monitoring: makeDrawerCloseHandlerMutant(source.monitoring) }],
    ["retry-handler", { ...source, monitoring: makeRetryMutant(source.monitoring) }],
    ["enrichment-start-open", { ...source, monitoring: makeEnrichmentStartOpenMutant(source.monitoring) }],
    ["enrichment-poll-open", { ...source, monitoring: makeEnrichmentPollOpenMutant(source.monitoring) }],
    ["timeline-loading-predicate", { ...source, monitoring: makeTimelineLoadingPredicateMutant(source.monitoring) }],
    ["drawer-loading", { ...source, drawer: makeDrawerLoadingMutant(source.drawer) }],
    ["drawer-retry", { ...source, drawer: makeDrawerRetryMutant(source.drawer) }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("MONITORING_TIMELINE_IDENTITY_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "MONITORING_TIMELINE_IDENTITY_SOURCE_CONTRACT_PASS guardedReads=" + result.guardedReads
    + " drawerStates=" + result.drawerStates
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);

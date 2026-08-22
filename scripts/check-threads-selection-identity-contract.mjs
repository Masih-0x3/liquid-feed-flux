import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const filePath = path.join(repoRoot, "src/pages/Threads.tsx");
const source = fs.readFileSync(filePath, "utf8");

function fail(message) {
  throw new Error("THREADS_SELECTION_IDENTITY_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(input) {
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail("Threads.tsx has TypeScript parse diagnostics");
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
    fail("Threads.tsx has TypeScript transpilation diagnostics");
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

function assertContract(input, label) {
  parseAndTranspile(input);

  assertIncludes(input, "useState, useEffect, useCallback, useRef", label + " request generation import");
  assertIncludes(input, "interface ThreadPostsState", label + " paired posts state");
  assertIncludes(input, "const previewRequestRef = useRef(0);", label + " request generation state");
  assertIncludes(input, "const requestId = ++previewRequestRef.current;", label + " request generation increment");
  assertIncludes(
    input,
    "setThreadPostsState({ threadId: thread.id, posts: [], loading: true, error: false });",
    label + " loading reset",
  );
  assertIncludes(
    input,
    "if (previewRequestRef.current !== requestId) return;",
    label + " late response guard",
  );
  if (countOccurrences(input, "if (previewRequestRef.current !== requestId) return;") !== 2) {
    fail(label + " must guard both successful and failed late responses");
  }
  assertIncludes(
    input,
    "setThreadPostsState({ threadId: thread.id, posts: (data as Post[]) || [], loading: false, error: false });",
    label + " matching response state",
  );
  assertIncludes(
    input,
    "setThreadPostsState({ threadId: thread.id, posts: [], loading: false, error: true });",
    label + " matching error state",
  );
  assertIncludes(input, "const hasMatchingThreadPosts = Boolean(", label + " selection identity derivation");
  assertIncludes(input, "threadPostsState.threadId === selectedThread.id", label + " selection identity comparison");
  assertIncludes(input, "const threadPosts = hasMatchingThreadPosts ? threadPostsState.posts : [];", label + " stale post suppression");
  assertIncludes(input, "const previewLoading = Boolean(selectedThread) && (!hasMatchingThreadPosts || threadPostsState.loading);", label + " explicit loading state");
  assertIncludes(input, "{previewLoading ? (", label + " loading render branch");
  assertIncludes(input, "const previewError = hasMatchingThreadPosts && threadPostsState.error;", label + " explicit error state");
  if (/const canPostSelectedThread\s*=/.test(input)) {
    fail(label + " must not expose a delivery action while ordered thread delivery is unavailable");
  }
  assertIncludes(input, ">Delivery unavailable<", label + " unavailable delivery state");
  assertIncludes(input, "Thread delivery is unavailable until ordered delivery is implemented. This preview does not queue a message.", label + " no-queue notice");
  assertIncludes(input, "onOpenChange={handlePreviewOpenChange}", label + " close handler");
  assertIncludes(input, "previewRequestRef.current += 1;", label + " close invalidation");
  assertIncludes(input, "setThreadPostsState({ threadId: null, posts: [], loading: false, error: false });", label + " close clearing");
  assertIncludes(input, "Retry loading posts", label + " recovery action");
  assertIncludes(input, "onClick={() => { void fetchThreadPosts(selectedThread); }}", label + " retry handler");

  assertOrder(input, "const requestId = ++previewRequestRef.current;", ".from('posts')", label + " request before query");
  assertOrder(input, ".from('posts')", "if (previewRequestRef.current !== requestId) return;", label + " late response before commit");
  assertOrder(input, "previewRequestRef.current += 1;", "setThreadPostsState({ threadId: null, posts: [], loading: false, error: false });", label + " close invalidation before clearing");

  return { guardedReads: 1, guardedActions: 0 };
}

function makeLateResponseMutant(input) {
  return input.replace(
    "if (previewRequestRef.current !== requestId) return;",
    "if (false) return;",
  );
}

function makeIdentityMutant(input) {
  return input.replace(
    "const threadPosts = hasMatchingThreadPosts ? threadPostsState.posts : [];",
    "const threadPosts = threadPostsState.posts;",
  );
}

function makeCloseInvalidationMutant(input) {
  return input.replace("previewRequestRef.current += 1;", "void previewRequestRef.current;");
}

function makeActionGateMutant(input) {
  return input.replace("disabled={!canPostSelectedThread}", "disabled={false}");
}

function makeActionSelectedThreadPredicateMutant(input) {
  return input.replace(
    "selectedThread && hasMatchingThreadPosts &&",
    "hasMatchingThreadPosts &&",
  );
}

function makeActionIdentityPredicateMutant(input) {
  return input.replace(
    "selectedThread && hasMatchingThreadPosts &&",
    "selectedThread &&",
  );
}

function makeActionLoadingPredicateMutant(input) {
  return input.replace("!threadPostsState.loading && ", "");
}

function makeActionErrorPredicateMutant(input) {
  return input.replace("!threadPostsState.error && ", "");
}

function makeActionContentPredicateMutant(input) {
  return input.replace("threadPosts.length > 0,", "true,");
}

function makeRetryHandlerMutant(input) {
  return input.replace(
    "onClick={() => { void fetchThreadPosts(selectedThread); }}",
    "onClick={() => undefined}",
  );
}

function makeLoadingMutant(input) {
  return input.replace("{previewLoading ? (", "{false ? (");
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["late-response", makeLateResponseMutant(source)],
    ["identity-suppression", makeIdentityMutant(source)],
    ["close-invalidation", makeCloseInvalidationMutant(source)],
    ["retry-handler", makeRetryHandlerMutant(source)],
    ["loading-state", makeLoadingMutant(source)],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("THREADS_SELECTION_IDENTITY_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "THREADS_SELECTION_IDENTITY_SOURCE_CONTRACT_PASS guardedReads=" + result.guardedReads
    + " guardedActions=" + result.guardedActions
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);

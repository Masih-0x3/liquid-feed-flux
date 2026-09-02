import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  authState: path.join(repoRoot, "src/lib/authState.ts"),
  authContext: path.join(repoRoot, "src/contexts/AuthContext.tsx"),
  appLayout: path.join(repoRoot, "src/components/layout/AppLayout.tsx"),
  authPage: path.join(repoRoot, "src/pages/AuthPage.tsx"),
  authTest: path.join(repoRoot, "src/test/auth.test.tsx"),
  layoutTest: path.join(repoRoot, "src/test/app-layout.test.tsx"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("AUTH_STATE_SOURCE_CONTRACT_FAIL " + message);
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(label + " is missing: " + expected);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(label + " must not contain: " + unexpected);
}

function assertOrder(input, first, second, label) {
  const firstIndex = input.indexOf(first);
  const secondIndex = input.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    fail(label + " has invalid order");
  }
}

function parseAndTranspile(filePath, input, scriptKind) {
  const parsed = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  if (parsed.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + " has TypeScript parse diagnostics");
  }

  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(path.basename(filePath) + " has TypeScript transpilation diagnostics");
  }
  return output.outputText;
}

async function loadAuthState(input) {
  const output = parseAndTranspile(paths.authState, input, ts.ScriptKind.TS);
  return import("data:text/javascript;charset=utf-8," + encodeURIComponent(output));
}

async function assertPureStateFixtures(authState, label) {
  const fault = {
    operation: "role",
    message: "We could not verify your access level. Retry before continuing.",
  };
  const fixtures = [
    ["booting", { booting: true, sessionPresent: false, role: null, failure: null }, "booting"],
    ["unauthenticated", { booting: false, sessionPresent: false, role: null, failure: null }, "unauthenticated"],
    ["role-loading", { booting: false, sessionPresent: true, role: null, failure: null }, "authenticated-role-loading"],
    ["admin", { booting: false, sessionPresent: true, role: "admin", failure: null }, "authorised"],
    ["read_only", { booting: false, sessionPresent: true, role: "read_only", failure: null }, "authorised"],
    ["legacy", { booting: false, sessionPresent: true, role: "viewer", failure: null }, "denied"],
    ["fault", { booting: false, sessionPresent: true, role: null, failure: fault }, "degraded"],
  ];

  for (const [name, input, expected] of fixtures) {
    assert.equal(
      authState.deriveAuthStatus(input),
      expected,
      label + " " + name + " fixture must resolve to " + expected,
    );
  }

  assert.equal(authState.isAppRole("admin"), true, label + " must accept admin");
  assert.equal(authState.isAppRole("read_only"), true, label + " must accept read_only");
  assert.equal(authState.isAppRole("viewer"), false, label + " must reject legacy viewer");
  assert.equal(authState.isAppRole("owner"), false, label + " must reject unknown role");
  assert.equal(authState.isAuthPending("booting"), true, label + " booting must be pending");
  assert.equal(authState.isAuthPending("authenticated-role-loading"), true, label + " role loading must be pending");
  assert.equal(authState.isAuthPending("degraded"), false, label + " degraded must not masquerade as loading");
  assert.equal(authState.canRenderProtectedShell("authorised"), true, label + " canonical roles can render the protected shell");
  for (const status of ["booting", "unauthenticated", "authenticated-role-loading", "denied", "degraded"]) {
    assert.equal(
      authState.canRenderProtectedShell(status),
      false,
      label + " " + status + " must fail closed before protected-shell render",
    );
  }

  const thenableResult = await authState.withAuthDeadline(
    () => ({ then: (resolve) => resolve("thenable-result") }),
    20,
    "role",
  );
  assert.equal(thenableResult, "thenable-result", label + " must normalize thenable query builders");
  await assert.rejects(
    () => authState.withAuthDeadline(() => new Promise(() => {}), 1, "session"),
    (error) => error instanceof authState.AuthDeadlineError && error.operation === "session",
    label + " must surface deadline ownership as AuthDeadlineError",
  );
}

async function assertContract(sources, label) {
  for (const [name, filePath, scriptKind] of [
    ["authState", paths.authState, ts.ScriptKind.TS],
    ["authContext", paths.authContext, ts.ScriptKind.TSX],
    ["appLayout", paths.appLayout, ts.ScriptKind.TSX],
    ["authPage", paths.authPage, ts.ScriptKind.TSX],
    ["authTest", paths.authTest, ts.ScriptKind.TSX],
    ["layoutTest", paths.layoutTest, ts.ScriptKind.TSX],
  ]) {
    parseAndTranspile(filePath, sources[name], scriptKind);
  }

  const authState = await loadAuthState(sources.authState);
  await assertPureStateFixtures(authState, label);

  assertIncludes(sources.authState, 'if (input.failure) return "degraded";', label + " fault transition");
  assertIncludes(sources.authState, 'if (!input.sessionPresent) return "unauthenticated";', label + " anonymous transition");
  assertIncludes(sources.authState, 'return isAppRole(input.role) ? "authorised" : "denied";', label + " role transition");
  assertIncludes(sources.authState, 'return status === "authorised";', label + " protected-shell guard");
  assertIncludes(sources.authState, "export function withAuthDeadline<T>(", label + " central deadline helper");
  assertIncludes(sources.authState, "void Promise.resolve(operation()).then(", label + " thenable normalization");
  assertIncludes(sources.authState, "if (timeoutId !== null) clearTimeout(timeoutId);", label + " deadline cleanup");

  assertIncludes(sources.authContext, "withAuthDeadline,", label + " provider deadline import");
  assertIncludes(sources.authContext, "AUTH_BOOTSTRAP_DEADLINE_MS", label + " session deadline");
  assertIncludes(sources.authContext, "AUTH_ROLE_DEADLINE_MS", label + " role deadline");
  assertIncludes(sources.authContext, "AUTH_SIGN_IN_DEADLINE_MS", label + " sign-in deadline");
  assertIncludes(sources.authContext, "AUTH_SIGN_OUT_DEADLINE_MS", label + " sign-out deadline");
  assertIncludes(sources.authContext, "if (response.error) throw response.error;", label + " role error boundary");
  assertIncludes(sources.authContext, "response.data.length !== 1", label + " exact-one role boundary");
  assertIncludes(sources.authContext, "if (!isAppRole(role))", label + " malformed-role boundary");
  assertNotIncludes(sources.authContext, "return \"viewer\"", label + " legacy viewer fallback");
  assertIncludes(
    sources.authContext,
    "const resolveSession = useCallback(async (nextSession: Session | null, generation: number) => {\n    if (!isCurrent(generation)) return;",
    label + " stale-session guard",
  );
  assertIncludes(sources.authContext, "deferredTimers.forEach((timer) => clearTimeout(timer));", label + " deferred-event cleanup");
  assertNotIncludes(sources.authContext, "Promise.race(", label + " unowned auth races");
  assertNotIncludes(sources.authContext, "console.warn('Could not load user role:", label + " raw role error logging");

  assertIncludes(sources.appLayout, "status === 'booting' || status === 'authenticated-role-loading'", label + " protected pending gate");
  assertIncludes(sources.appLayout, "if (status === 'degraded')", label + " degraded gate");
  assertIncludes(sources.appLayout, "Authentication needs attention", label + " degraded recovery copy");
  assertIncludes(sources.appLayout, "await refreshSession();", label + " degraded retry");
  assertIncludes(sources.appLayout, "if (status === 'denied' || (!isAdmin && !isReadOnly))", label + " denied gate");
  assertIncludes(sources.appLayout, "Your account does not have admin access.", label + " denied copy");
  assertIncludes(sources.appLayout, "Sign out", label + " denied account-switch action");
  assertNotIncludes(sources.appLayout, "loading || (user && role === null)", label + " legacy indefinite spinner");
  assertOrder(
    sources.appLayout,
    "if (status === 'degraded')",
    "return (\n    <div className=\"relative flex h-svh",
    label + " degraded shell boundary",
  );

  assertIncludes(sources.authPage, "status === 'authorised' || status === 'denied'", label + " authenticated redirect");
  assertIncludes(sources.authPage, "if (status === 'degraded')", label + " sign-in degraded state");
  assertIncludes(sources.authPage, "await refreshSession();", label + " sign-in recovery");
  assertNotIncludes(sources.authPage, "Promise.race(", label + " duplicate sign-in race");
  assertNotIncludes(sources.authPage, "setTimeout(", label + " duplicate sign-in timeout");

  assertIncludes(sources.authTest, 'expect(result.current.status).toBe("booting");', label + " initial status fixture");
  assertIncludes(sources.authTest, '["read_only", "authorised", false]', label + " read_only role fixture");
  assertIncludes(sources.authTest, '"multiple", [{ role: "admin" }, { role: "read_only" }]', label + " multi-role fixture");
  assertIncludes(sources.layoutTest, 'status: "degraded"', label + " degraded layout fixture");
  assertIncludes(sources.layoutTest, "keeps the protected shell unmounted while authentication is degraded", label + " degraded shell regression");
  assertIncludes(sources.layoutTest, "keeps denied users out of the shell while allowing account switching", label + " denied shell regression");

  return { states: 7, protectedShellStates: 2 };
}

const currentResult = await assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test") || process.env.MUTATION_TEST === "1";

if (selfTest) {
  const mutants = [
    [
      "role-fault-becomes-denial",
      {
        ...source,
        authState: source.authState.replace(
          'if (input.failure) return "degraded";',
          'if (input.failure) return "denied";',
        ),
      },
    ],
    [
      "anonymous-becomes-authorised",
      {
        ...source,
        authState: source.authState.replace(
          'if (!input.sessionPresent) return "unauthenticated";',
          'if (!input.sessionPresent) return "authorised";',
        ),
      },
    ],
    [
      "stale-session-guard-removed",
      {
        ...source,
        authContext: source.authContext.replace(
          "const resolveSession = useCallback(async (nextSession: Session | null, generation: number) => {\n    if (!isCurrent(generation)) return;",
          "const resolveSession = useCallback(async (nextSession: Session | null, generation: number) => {\n    if (false) return;",
        ),
      },
    ],
    [
      "thenable-normalization-removed",
      {
        ...source,
        authState: source.authState.replace(
          "void Promise.resolve(operation()).then(",
          "void operation().then(",
        ),
      },
    ],
    [
      "degraded-layout-bypass",
      {
        ...source,
        appLayout: source.appLayout.replace(
          "if (status === 'denied' || (!isAdmin && !isReadOnly))",
          "if (false)",
        ),
      },
    ],
    [
      "role-cardinality-bypass",
      {
        ...source,
        authContext: source.authContext.replace(
          "if (!Array.isArray(response.data) || response.data.length !== 1)",
          "if (!Array.isArray(response.data) || response.data.length < 1)",
        ),
      },
    ],
    [
      "auth-page-duplicate-timeout",
      {
        ...source,
        authPage: source.authPage + "\nconst duplicateAuthRace = Promise.race([]);",
      },
    ],
  ];

  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      await assertContract(mutant, "mutant " + name);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, "mutation " + name + " must be rejected");
  }
}

console.log(
  "AUTH_STATE_SOURCE_CONTRACT_PASS states=" + currentResult.states +
  " protectedShellStates=" + currentResult.protectedShellStates +
  " selfTest=" + (selfTest ? "pass" : "skipped"),
);

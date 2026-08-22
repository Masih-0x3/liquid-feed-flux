import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bootstrapPath = join(repoRoot, "src/lib/sentryBootstrap.ts");
const instrumentPath = join(repoRoot, "src/instrument.ts");
const mainPath = join(repoRoot, "src/main.tsx");
const boundaryPath = join(repoRoot, "src/components/errors/AppErrorBoundary.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path];
  }).filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

const bootstrapSource = readFileSync(bootstrapPath, "utf8");
const instrumentSource = readFileSync(instrumentPath, "utf8");
const mainSource = readFileSync(mainPath, "utf8");
const boundarySource = readFileSync(boundaryPath, "utf8");
function assertScrubContract(source, label = "Sentry source") {
  assert.match(source, /function scrubSentryEvent/, `${label} must define an event scrubber`);
  assert.match(source, /record\.message = "react_render_error"/, `${label} must replace raw event messages`);
  assert.match(source, /delete record\.user/, `${label} must remove user identity payloads`);
  assert.match(source, /delete safeRequest\.headers/, `${label} must remove request headers`);
  assert.match(source, /delete safeRequest\.query_string/, `${label} must remove signed query data`);
  assert.match(source, /safeValue\.value = "react_render_error"/, `${label} must replace exception values`);
  assert.match(source, /scrubSentryEvent\(event\)/, `${label} beforeSend must use the scrubber`);
}
assertScrubContract(bootstrapSource);
if (process.env.MUTATION_TEST === "1") {
  assert.throws(
    () => assertScrubContract(bootstrapSource.replace("delete safeRequest.headers;", ""), "mutated Sentry source"),
    /must remove request headers/,
    "request-header scrub mutation must fail",
  );
}
const staticSentryImport = /\bimport\s+(?!\()[\s\S]*?\bfrom\s+["']@sentry\/react["']|\bimport\s+["']@sentry\/react["']/;
const staticSentryImportPaths = sourceFiles(join(repoRoot, "src")).filter((path) =>
  staticSentryImport.test(readFileSync(path, "utf8")),
);

assert.deepEqual(
  staticSentryImportPaths,
  [],
  "no source module may retain a runtime static @sentry/react import",
);
assert.match(
  instrumentSource,
  /\(\) => import\(["']@sentry\/react["']\)/,
  "the Sentry SDK must be loaded through a dynamic import",
);
assert.match(
  mainSource,
  /<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/,
  "the local fallback must wrap App",
);
assert.match(
  mainSource,
  /void initializeSentry\(\);/,
  "Sentry initialization must happen after the application render is scheduled",
);
assert.match(
  boundarySource,
  /componentDidCatch\(error: Error, info: ErrorInfo\)[\s\S]*?captureAppReactException\(error,/,
  "the local error boundary must hand React errors to the async capture path",
);
assert.match(
  bootstrapSource,
  /sendDefaultPii:\s*false/,
  "the existing privacy contract must remain fail-closed for PII",
);

for (const [path, source] of [
  [bootstrapPath, bootstrapSource],
  [instrumentPath, instrumentSource],
  [mainPath, mainSource],
  [boundaryPath, boundarySource],
]) {
  const transpile = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (transpile.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

const bootstrapTranspile = typescript.transpileModule(bootstrapSource, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: bootstrapPath,
  reportDiagnostics: true,
});
const bootstrap = await import(
  `data:text/javascript;base64,${Buffer.from(bootstrapTranspile.outputText).toString("base64")}`,
);

assert.equal(bootstrap.readSampleRate(undefined, 0.1), 0.1);
assert.equal(bootstrap.readSampleRate("2", 0.1), 1);
assert.equal(bootstrap.readSampleRate("-1", 0.1), 0);
assert.equal(bootstrap.readSampleRate("invalid", 0.1), 0.1);

function makeSdk() {
  const state = {
    browserTracingCalls: 0,
    captureCalls: [],
    initCalls: [],
    replayCalls: 0,
  };
  return {
    sdk: {
      browserTracingIntegration() {
        state.browserTracingCalls += 1;
        return { name: "tracing" };
      },
      captureReactException(error, context) {
        state.captureCalls.push({ context, error });
      },
      init(options) {
        state.initCalls.push(options);
      },
      replayIntegration() {
        state.replayCalls += 1;
        return { name: "replay" };
      },
    },
    state,
  };
}

let disabledLoads = 0;
const disabled = bootstrap.createSentryBootstrap(
  async () => {
    disabledLoads += 1;
    return makeSdk().sdk;
  },
  {
    dsn: " ",
    environment: "test",
    releaseSha: "disabled",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  },
);
assert.equal(await disabled.initialize(), null);
disabled.captureReactException(new Error("disabled"), { componentStack: null });
await Promise.resolve();
assert.equal(disabledLoads, 0, "a missing DSN must not load the SDK");

const enabledFake = makeSdk();
let enabledLoads = 0;
const enabled = bootstrap.createSentryBootstrap(
  async () => {
    enabledLoads += 1;
    return enabledFake.sdk;
  },
  {
    dsn: "https://public@example.invalid/1",
    environment: "staging",
    releaseSha: "abc1234",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  },
);
const firstInitialization = enabled.initialize();
const secondInitialization = enabled.initialize();
assert.equal(firstInitialization, secondInitialization, "initialization must be singleton");
assert.equal(await firstInitialization, enabledFake.sdk);
assert.equal(enabledLoads, 1);
assert.equal(enabledFake.state.initCalls.length, 1);
const initOptions = enabledFake.state.initCalls[0];
assert.equal(initOptions.dsn, "https://public@example.invalid/1");
assert.equal(initOptions.environment, "staging");
assert.equal(initOptions.release, "xot-web@abc1234");
assert.equal(initOptions.sendDefaultPii, false);
assert.equal(initOptions.tracesSampleRate, 0.1);
assert.equal(initOptions.replaysSessionSampleRate, 0);
assert.equal(initOptions.replaysOnErrorSampleRate, 1);
assert.equal(enabledFake.state.browserTracingCalls, 1);
assert.equal(enabledFake.state.replayCalls, 1);
const taggedEvent = initOptions.beforeSend({ tags: { existing: "tag" } });
assert.deepEqual(taggedEvent.tags, { existing: "tag", service: "xot-web" });
const maliciousEvent = initOptions.beforeSend({
  message: "signed_url=https://media.example.test/a?token=secret",
  user: { id: "user-secret" },
  request: {
    url: "https://media.example.test/a?token=secret#fragment",
    headers: { Authorization: "Bearer secret" },
    cookies: "session=secret",
    data: { prompt: "raw user payload" },
    query_string: "token=secret",
  },
  exception: {
    values: [{
      type: "Error",
      value: "raw signed URL https://media.example.test/a?token=secret",
      stacktrace: { frames: [{ filename: "https://media.example.test/a?token=secret" }] },
    }],
  },
  breadcrumbs: [{ message: "raw payload" }],
  extra: { raw: "payload" },
  contexts: { request: { body: "payload" } },
  tags: { existing: "tag" },
});
assert.equal(maliciousEvent.message, "react_render_error");
assert.equal(maliciousEvent.request.url, "https://media.example.test/a");
assert.equal("headers" in maliciousEvent.request, false);
assert.equal("cookies" in maliciousEvent.request, false);
assert.equal("data" in maliciousEvent.request, false);
assert.equal("query_string" in maliciousEvent.request, false);
assert.equal(maliciousEvent.exception.values[0].value, "react_render_error");
assert.equal("stacktrace" in maliciousEvent.exception.values[0], false);
assert.equal("user" in maliciousEvent, false);
assert.equal("breadcrumbs" in maliciousEvent, false);
assert.equal("extra" in maliciousEvent, false);
assert.equal("contexts" in maliciousEvent, false);
const capturedError = new Error("render failure");
enabled.captureReactException(capturedError, { componentStack: "at App" });
await Promise.resolve();
assert.equal(enabledFake.state.captureCalls.length, 1);
assert.equal(enabledFake.state.captureCalls[0].error, capturedError);
assert.equal(enabledFake.state.captureCalls[0].context.componentStack, "at App");

const zeroSampleFake = makeSdk();
const zeroSample = bootstrap.createSentryBootstrap(
  async () => zeroSampleFake.sdk,
  {
    dsn: "https://public@example.invalid/2",
    environment: "test",
    releaseSha: "zero",
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
);
await zeroSample.initialize();
assert.equal(zeroSampleFake.state.browserTracingCalls, 0);
assert.equal(zeroSampleFake.state.replayCalls, 0);
assert.equal(zeroSampleFake.state.initCalls[0].integrations.length, 0);

const failedLoad = bootstrap.createSentryBootstrap(
  async () => {
    throw new Error("SDK unavailable");
  },
  {
    dsn: "https://public@example.invalid/3",
    environment: "test",
    releaseSha: "failure",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  },
);
assert.equal(await failedLoad.initialize(), null);
failedLoad.captureReactException(new Error("must not throw"), { componentStack: "at Fallback" });
await Promise.resolve();

const synchronouslyFailedLoad = bootstrap.createSentryBootstrap(
  () => {
    throw new Error("SDK synchronously unavailable");
  },
  {
    dsn: "https://public@example.invalid/4",
    environment: "test",
    releaseSha: "sync-failure",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  },
);
assert.doesNotThrow(
  () => synchronouslyFailedLoad.captureReactException(
    new Error("must not escape componentDidCatch"),
    { componentStack: "at Fallback" },
  ),
  "a synchronously throwing loader must be converted into a safe null initialization",
);
assert.equal(await synchronouslyFailedLoad.initialize(), null);

console.log("SENTRY_LAZY_SOURCE_CONTRACT_PASS 24 scenarios=7");

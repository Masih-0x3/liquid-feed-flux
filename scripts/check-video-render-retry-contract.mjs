import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(repoRoot, "src/lib/videoRenderRetryState.ts");
const hookPath = join(repoRoot, "src/hooks/useVideoRenderData.ts");
const pagePath = join(repoRoot, "src/pages/VideoRenders.tsx");
const panelPath = join(repoRoot, "src/components/video/VideoRenderDetailPanel.tsx");
const testPath = join(repoRoot, "src/test/video-renders-page.test.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const stateSource = readFileSync(statePath, "utf8");
const hookSource = readFileSync(hookPath, "utf8");
const pageSource = readFileSync(pagePath, "utf8");
const panelSource = readFileSync(panelPath, "utf8");
const testSource = readFileSync(testPath, "utf8");

for (const [path, source] of [
  [statePath, stateSource],
  [hookPath, hookSource],
  [pagePath, pageSource],
  [panelPath, panelSource],
  [testPath, testSource],
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

const stateTranspile = typescript.transpileModule(stateSource, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: statePath,
  reportDiagnostics: true,
});
const state = await import(
  `data:text/javascript;base64,${Buffer.from(stateTranspile.outputText).toString("base64")}`,
);

const renderA = { render_id: "render-a" };
const renderB = { render_id: "render-b" };
const tweetA = { tweet_id: "tweet-a" };
assert.equal(state.videoRenderRetryKey(renderA), "retry:render:render-a");
assert.equal(state.videoRenderRetryKey(renderB), "retry:render:render-b");
assert.equal(state.videoRenderRetryKey(tweetA), "retry:tweet:tweet-a");
assert.equal(state.videoRenderRetryKey({}), null);

let pending = state.beginVideoRenderRetry(new Map(), renderA);
assert.equal(state.isVideoRenderRetryPending(pending, renderA), true);
assert.equal(state.isVideoRenderRetryPending(pending, renderB), false);
pending = state.beginVideoRenderRetry(pending, renderB);
assert.equal(state.isVideoRenderRetryPending(pending, renderA), true);
assert.equal(state.isVideoRenderRetryPending(pending, renderB), true);
pending = state.settleVideoRenderRetry(pending, renderA);
assert.equal(state.isVideoRenderRetryPending(pending, renderA), false);
assert.equal(state.isVideoRenderRetryPending(pending, renderB), true);
pending = state.beginVideoRenderRetry(pending, renderB);
assert.equal(pending.get("retry:render:render-b"), 2);
pending = state.settleVideoRenderRetry(pending, renderB);
assert.equal(state.isVideoRenderRetryPending(pending, renderB), true);
pending = state.settleVideoRenderRetry(pending, renderB);
assert.equal(state.isVideoRenderRetryPending(pending, renderB), false);

function sourceFile(path, source) {
  return typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    path.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS,
  );
}

function findNodes(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isIdentifier(node, name) {
  return typescript.isIdentifier(node) && node.text === name;
}

function isRetryProperty(node, name) {
  return typescript.isPropertyAccessExpression(node) &&
    isIdentifier(node.expression, "retry") &&
    node.name.text === name;
}

function retryPendingCalls(path, source) {
  return findNodes(sourceFile(path, source), (node) =>
    typescript.isCallExpression(node) && isRetryProperty(node.expression, "isPendingFor"),
  );
}

assert.equal(
  retryPendingCalls(pagePath, pageSource).length,
  0,
  "page must not own target-specific retry pending checks",
);

for (const [path, source, expectedMinimum] of [
  [panelPath, panelSource, 2],
]) {
  const file = sourceFile(path, source);
  assert.equal(
    findNodes(file, (node) => isRetryProperty(node, "isPending")).length,
    0,
    `${path} must not drive retry controls from global retry.isPending`,
  );
  const calls = retryPendingCalls(path, source);
  assert.ok(calls.length >= expectedMinimum, `${path} must use target-specific retry pending state`);
  for (const call of calls) {
    assert.equal(
      call.arguments.length,
      1,
      `${path} retry pending check must receive exactly one target`,
    );
    assert.equal(
      typescript.isObjectLiteralExpression(call.arguments[0]),
      true,
      `${path} retry pending check must use an explicit render/tweet target object`,
    );
  }
}

const hookFile = sourceFile(hookPath, hookSource);
const retryHook = findNodes(hookFile, (node) =>
  typescript.isFunctionDeclaration(node) && node.name?.text === "useRetryVideoRender",
)[0];
assert.ok(retryHook, "retry hook must retain useRetryVideoRender");
for (const name of [
  "beginVideoRenderRetry",
  "settleVideoRenderRetry",
  "isVideoRenderRetryPending",
]) {
  assert.ok(
    findNodes(retryHook, (node) =>
      typescript.isCallExpression(node) && isIdentifier(node.expression, name),
    ).length > 0,
    `retry hook must use ${name}`,
  );
}
assert.ok(
  findNodes(retryHook, (node) =>
    typescript.isPropertyAccessExpression(node) &&
    isIdentifier(node.expression, "retry") &&
    node.name.text === "mutateAsync",
  ).length === 1,
  "retry hook must retain exactly one per-call retry promise invocation",
);
assert.equal(
  findNodes(retryHook, (node) =>
    typescript.isPropertyAccessExpression(node) &&
    isIdentifier(node.expression, "retry") &&
    node.name.text === "mutate",
  ).length,
  0,
  "retry hook must not depend on mutate-level callbacks for concurrent cleanup",
);
const finallyCalls = findNodes(retryHook, (node) =>
  typescript.isCallExpression(node) &&
  typescript.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "finally",
);
assert.equal(finallyCalls.length, 1, "retry promise must clean up exactly once in finally");
assert.ok(
  findNodes(finallyCalls[0], (node) =>
    typescript.isCallExpression(node) && isIdentifier(node.expression, "settleVideoRenderRetry"),
  ).length === 1,
  "retry promise finally must decrement the keyed pending count",
);

const testFile = sourceFile(testPath, testSource);
const retryHookMock = findNodes(testFile, (node) =>
  typescript.isCallExpression(node) &&
  typescript.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "mockReturnValue" &&
  node.expression.expression.getText(testFile) === "videoHooks.useRetryVideoRender",
);
assert.equal(retryHookMock.length, 1, "page test must mock the retry hook exactly once");
const retryMockResult = retryHookMock[0].arguments[0];
assert.ok(
  typescript.isObjectLiteralExpression(retryMockResult),
  "page test retry-hook mock must return an object",
);
assert.ok(
  retryMockResult.properties.some((property) =>
    typescript.isPropertyAssignment(property) &&
    ((typescript.isIdentifier(property.name) && property.name.text === "isPendingFor") ||
      (typescript.isStringLiteral(property.name) && property.name.text === "isPendingFor")),
  ),
  "page test retry-hook mock must provide target-specific isPendingFor",
);

console.log("VIDEO_RENDER_RETRY_SOURCE_CONTRACT_PASS keys=4 transitions=9");

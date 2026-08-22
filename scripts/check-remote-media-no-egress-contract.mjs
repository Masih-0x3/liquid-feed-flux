import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const testPath = join(repoRoot, "supabase/functions/_shared/remoteMediaNoEgress.test.ts");
const packagePath = join(repoRoot, "package.json");
const require = createRequire(import.meta.url);
const ts = require("typescript");

const requiredCodes = new Set([
  "remote_media_url_scheme_blocked",
  "remote_media_url_host_blocked",
  "remote_media_url_port_blocked",
  "remote_media_url_fragment_blocked",
  "remote_dns_non_public",
  "remote_dns_no_records",
  "remote_dns_result_invalid",
  "remote_dns_resolution_failed",
  "remote_media_redirect_limit_exceeded",
  "remote_media_content_length_exceeded",
  "remote_media_body_exceeded",
  "remote_media_content_encoding_blocked",
  "remote_media_content_type_blocked",
  "remote_media_magic_mismatch",
  "remote_media_fetch_failed",
  "remote_json_url_port_blocked",
  "remote_json_redirect_blocked",
  "remote_json_content_encoding_blocked",
  "remote_json_content_type_blocked",
  "remote_json_content_length_exceeded",
  "remote_media_fetch_timeout",
  "remote_json_fetch_timeout",
]);

function parse(source) {
  return ts.createSourceFile(testPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function callName(node) {
  if (!ts.isCallExpression(node)) return "";
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) {
    const left = ts.isIdentifier(node.expression.expression)
      ? node.expression.expression.text
      : "";
    return `${left}.${node.expression.name.text}`;
  }
  return "";
}

function stringArg(node, index) {
  const arg = node.arguments[index];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function isDeadBranch(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent) && ((parent.expression.kind === ts.SyntaxKind.FalseKeyword) ||
      (ts.isNumericLiteral(parent.expression) && parent.expression.text === "0"))) return true;
    if (ts.isConditionalExpression(parent) && ts.isNumericLiteral(parent.condition) && parent.condition.text === "0") return true;
  }
  return false;
}

function validateTestSource(source) {
  const file = parse(source);
  const imports = file.statements.filter(ts.isImportDeclaration);
  const policyImport = imports.find((node) =>
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./remoteMediaPolicy.ts"
  );
  assert.ok(policyImport, "test must import the real remoteMediaPolicy module");
  assert.ok(
    policyImport.importClause?.namedBindings && ts.isNamedImports(policyImport.importClause.namedBindings),
    "test must use named exports from the real policy module",
  );
  const importedNames = new Set(policyImport.importClause.namedBindings.elements.map((element) => element.name.text));
  assert.ok(importedNames.has("fetchReviewedRemoteMedia"), "test must import fetchReviewedRemoteMedia");
  assert.ok(importedNames.has("fetchReviewedRemoteJson"), "test must import fetchReviewedRemoteJson");

  const calls = [];
  walk(file, (node) => { if (ts.isCallExpression(node)) calls.push(node); });
  const policyCalls = calls.filter((node) => callName(node) === "fetchReviewedRemoteMedia" || callName(node) === "fetchReviewedRemoteJson");
  for (const node of policyCalls) assert.equal(isDeadBranch(node), false, "policy capsule calls must be live, not dead-branch decoys");
  assert.ok(policyCalls.some((node) => callName(node) === "fetchReviewedRemoteMedia"), "test must execute the real media capsule");
  assert.ok(policyCalls.some((node) => callName(node) === "fetchReviewedRemoteJson"), "test must execute the real JSON capsule");
  const importedPolicyNames = new Set(["fetchReviewedRemoteMedia", "fetchReviewedRemoteJson"]);
  const shadowedPolicyNames = [];
  walk(file, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && importedPolicyNames.has(node.name.text)) shadowedPolicyNames.push(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && importedPolicyNames.has(node.name.text)) shadowedPolicyNames.push(node.name.text);
  });
  assert.deepEqual(shadowedPolicyNames, [], "policy capsule names must not be shadowed by local functions or variables");
  for (const node of policyCalls) {
    let hasCountingSeam = false;
    walk(node, (child) => { if (callName(child) === "countingFetch") hasCountingSeam = true; });
    assert.ok(hasCountingSeam, `${callName(node)} must use the shared live counting fetch seam`);
  }
  const countingFunction = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "countingFetch");
  assert.ok(countingFunction?.body, "shared counting fetch seam must be an executable function");
  let incrementsAllowed = false;
  let incrementsForbidden = false;
  walk(countingFunction.body, (node) => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusEqualsToken || !ts.isPropertyAccessExpression(node.left)) return;
    if (node.left.name.text === "allowed") incrementsAllowed = true;
    if (node.left.name.text === "forbidden") incrementsForbidden = true;
  });
  assert.ok(incrementsAllowed && incrementsForbidden, "the shared seam must increment the live allowed and forbidden counters");
  assert.ok(calls.filter((node) => callName(node) === "restoreDescriptor").length >= 4, "all mutable global descriptors must restore through the shared exact-descriptor helper");
  assert.ok(calls.filter((node) => callName(node) === "assertDescriptorRestored").length === 4, "fetch, DNS, setTimeout, and clearTimeout descriptor identities must all be asserted");
  let pendingResourceZero = false;
  let abortListenerZero = false;
  let streamCancelOne = false;
  for (const node of calls) {
    if (callName(node) !== "assert.equal") continue;
    const first = node.arguments[0];
    const second = node.arguments[1];
    if (ts.isPropertyAccessExpression(first) && first.name.text === "pendingInjectedResources" && ts.isNumericLiteral(second) && second.text === "0") pendingResourceZero = true;
    if (ts.isIdentifier(first) && first.text === "activeAbortListeners" && ts.isNumericLiteral(second) && second.text === "0") abortListenerZero = true;
    if (ts.isIdentifier(first) && first.text === "cancelled" && ts.isNumericLiteral(second) && second.text === "1") streamCancelOne = true;
  }
  assert.ok(pendingResourceZero, "test must assert that no injected test resources remain pending");
  assert.ok(abortListenerZero, "test must assert abort listeners are detached");
  assert.ok(streamCancelOne, "test must assert streamed reader cancellation");
  const owningTests = calls.filter((node) => callName(node) === "Deno.test");
  assert.equal(owningTests.length, 3, "all three owning tests must remain present");
  for (const test of owningTests) {
    const body = test.arguments[1];
    assert.ok(body, "Deno.test must have an executable callback");
    let ownsPolicyCall = false;
    walk(body, (child) => { if (policyCalls.includes(child)) ownsPolicyCall = true; });
    assert.ok(ownsPolicyCall, `owning test ${stringArg(test, 0)} must call an imported policy capsule directly`);
  }

  for (const node of calls) {
    assert.notEqual(callName(node), "fetch", "test must not call the global/native fetch seam directly");
    assert.notEqual(callName(node), "Deno.resolveDns", "test must not call native DNS directly");
  }
  assert.ok(
    calls.some((node) => (callName(node) === "defineDescriptorValue" || callName(node) === "Object.defineProperty") &&
      node.arguments[0]?.getText(file) === "Deno" &&
      node.arguments[1]?.getText(file) === '"resolveDns"'),
    "test must instrument the native Deno resolver escape path",
  );
  let nativeFetchAssignment = false;
  walk(file, (node) => {
    if (ts.isCallExpression(node) && callName(node) === "defineDescriptorValue" &&
      node.arguments[0]?.getText(file) === "globalThis" && node.arguments[1]?.getText(file) === '"fetch"') nativeFetchAssignment = true;
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) && node.left.expression.text === "globalThis" &&
      node.left.name.text === "fetch") nativeFetchAssignment = true;
  });
  assert.ok(nativeFetchAssignment, "test must instrument the native/global fetch escape path");

  const forbiddenCalls = calls.filter((node) => callName(node) === "expectForbidden");
  const policyCodeCalls = calls.filter((node) => ["expectPolicyCode", "expectAllowedFailure"].includes(callName(node)));
  assert.ok(forbiddenCalls.length >= 4, "forbidden corpus must contain a meaningful case count");
  for (const node of forbiddenCalls) assert.equal(isDeadBranch(node), false, "forbidden cases must be live, not dead-branch decoys");
  const tableValues = new Map();
  walk(file, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) ||
      !["forbidden", "dnsCases"].includes(node.name.text) || !node.initializer) return;
    let initializer = node.initializer;
    while (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer)) initializer = initializer.expression;
    if (!ts.isArrayLiteralExpression(initializer)) return;
    assert.equal(isDeadBranch(node), false, `${node.name.text} table must be live, not a dead-branch decoy`);
    const values = [];
    for (const element of initializer.elements) {
      if (ts.isArrayLiteralExpression(element)) {
        const code = element.elements[1];
        if (code && ts.isStringLiteral(code)) values.push(code.text);
      }
    }
    tableValues.set(node.name.text, values);
  });
  function liveCodesForCall(node) {
    const name = callName(node);
    const codeArg = name === "expectPolicyCode" ? node.arguments[0] : node.arguments[1];
    if (codeArg && ts.isStringLiteral(codeArg)) return [codeArg.text];
    if (!codeArg || !ts.isIdentifier(codeArg)) return [];
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer)) continue;
      const declaration = parent.initializer.declarations[0];
      if (!declaration || !ts.isArrayBindingPattern(declaration.name) || !ts.isIdentifier(parent.expression)) continue;
      const binding = declaration.name.elements.find((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === codeArg.text);
      if (binding && tableValues.has(parent.expression.text)) return tableValues.get(parent.expression.text);
    }
    return [];
  }
  const liveCodes = new Set(policyCodeCalls.flatMap(liveCodesForCall).concat(forbiddenCalls.flatMap(liveCodesForCall)));
  for (const code of requiredCodes) assert.ok(liveCodes.has(code), `missing live executable case ${code}`);
  for (const node of [...forbiddenCalls, ...calls.filter((call) => callName(call) === "expectAllowedFailure")]) {
    const operation = node.arguments[3];
    assert.ok(operation && (ts.isArrowFunction(operation) || ts.isFunctionExpression(operation)), "forbidden case must provide an executable operation callback");
    let invokesPolicy = false;
    walk(operation, (child) => {
      if (policyCalls.includes(child)) invokesPolicy = true;
    });
    assert.ok(invokesPolicy, `forbidden case ${stringArg(node, 0)} must execute the real policy boundary`);
  }

  const expectForbiddenFunction = file.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "expectForbidden"
  );
  assert.ok(expectForbiddenFunction?.body, "zero-forbidden assertion must live in an executable helper");
  let zeroAssertion = false;
  walk(expectForbiddenFunction.body, (node) => {
    if (!ts.isCallExpression(node) || callName(node) !== "assert.equal") return;
    const member = node.arguments[0];
    const zero = node.arguments[1];
    if (ts.isPropertyAccessExpression(member) && member.name.text === "forbidden" && ts.isNumericLiteral(zero) && zero.text === "0") {
      zeroAssertion = true;
    }
  });
  assert.ok(zeroAssertion, "forbidden cases must assert the actual forbidden counter equals zero");

  const testNames = new Set(calls.filter((node) => callName(node) === "Deno.test").map((node) => stringArg(node, 0)).filter(Boolean));
  assert.ok([...testNames].some((name) => name.includes("zero egress")), "test must name the zero-egress media corpus");
  assert.ok([...testNames].some((name) => name.includes("redirect") && name.includes("timeout")), "test must name redirect/body/timeout coverage");
  assert.ok([...testNames].some((name) => name.includes("JSON") && name.includes("tears down")), "test must name JSON teardown coverage");
  const timerFunction = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "withFastTimers");
  assert.ok(timerFunction, "test must provide an accelerated timer harness");
  let clearsTimers = false;
  walk(timerFunction, (node) => {
    if (callName(node) === "active.clear") clearsTimers = true;
  });
  assert.ok(clearsTimers, "timer harness must clear its active set");
  let cancelsReader = false;
  walk(file, (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "cancel") cancelsReader = true;
  });
  assert.ok(cancelsReader, "stream fixture must expose reader cancellation teardown");
  for (const node of calls) assert.doesNotMatch(callName(node), /^Deno\.(listen|connect|createHttpClient|Command)$/);
  for (const node of imports) {
    if (ts.isStringLiteral(node.moduleSpecifier)) assert.doesNotMatch(node.moduleSpecifier.text, /^node:(?:net|dns|child_process)$/);
  }
}

function validatePackage(pkg) {
  const command = pkg.scripts?.["test:remote-media-no-egress"];
  assert.equal(typeof command, "string", "package must expose the focused no-egress test command");
  assert.match(command, /deno\s+test/);
  assert.match(command, /--deny-net(?:\s|$)/, "focused test command must explicitly deny all network access");
  assert.match(command, /remoteMediaNoEgress\.test\.ts/);
  assert.doesNotMatch(command, /--allow-net|-A\b/, "focused test command must not grant network access");
}

function replaceNode(source, predicate, replacement) {
  const file = parse(source);
  let target;
  walk(file, (node) => { if (!target && predicate(node)) target = node; });
  assert.ok(target, "mutation target must be found in the parsed test AST");
  return source.slice(0, target.getStart(file)) + replacement + source.slice(target.end);
}

const testSource = readFileSync(testPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
validateTestSource(testSource);
validatePackage(packageJson);

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  assert.throws(() => validatePackage({ scripts: { "test:remote-media-no-egress": packageJson.scripts["test:remote-media-no-egress"].replace("--deny-net", "") } }));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isNumericLiteral(node) && node.text === "0" && node.parent && ts.isCallExpression(node.parent) && callName(node.parent) === "assert.equal" && ts.isPropertyAccessExpression(node.parent.arguments[0]) && node.parent.arguments[0].name.text === "forbidden",
    "1",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "forbidden",
    "state.allowed += 1",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isCallExpression(node) && callName(node) === "assertDescriptorRestored",
    "assert.equal",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isCallExpression(node) && callName(node) === "countingFetch",
    "fakeFetch()",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isCallExpression(node) && callName(node) === "expectForbidden" && node.arguments[1]?.getText(parse(testSource)) === "code",
    "expectPolicyCode",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isCallExpression(node) && callName(node) === "defineDescriptorValue" && node.arguments[0]?.getText(parse(testSource)) === "Deno",
    "fetch(Deno)",
  )));
  assert.throws(() => validateTestSource(replaceNode(
    testSource,
    (node) => ts.isIdentifier(node) && node.text === "fetchReviewedRemoteMedia" && node.parent && ts.isImportSpecifier(node.parent),
    "removedPolicyExport",
  )));
  selfTest = "pass";
}

console.log(`REMOTE_MEDIA_NO_EGRESS_CONTRACT_PASS cases=${requiredCodes.size} selfTest=${selfTest}`);

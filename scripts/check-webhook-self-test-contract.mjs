import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  internalAuth: path.join(repoRoot, "supabase/functions/_shared/internalAuth.ts"),
  adminRetry: path.join(repoRoot, "supabase/functions/admin-retry/index.ts"),
  webhook: path.join(repoRoot, "supabase/functions/webhooks-rssapp/index.ts"),
  settings: path.join(repoRoot, "src/pages/Settings.tsx"),
  dashboard: path.join(repoRoot, "src/components/dashboard/DashboardHealth.tsx"),
  matrix: path.join(repoRoot, "docs/operations/function-auth-matrix.md"),
};
const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("WEBHOOK_SELF_TEST_SOURCE_CONTRACT_FAIL " + message);
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function nameOf(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function isIdentifier(node, expected) {
  return ts.isIdentifier(node) && node.text === expected;
}

function isCallTo(node, expectedName) {
  return ts.isCallExpression(node) && isIdentifier(node.expression, expectedName);
}

function propertyPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node)) return null;
  const parent = propertyPath(node.expression);
  return parent ? parent + "." + node.name.text : null;
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
}

const noWriteCallTerminals = new Set([
  "from",
  "insert",
  "update",
  "upsert",
  "delete",
  "rpc",
  "invoke",
  "fetch",
  "dispatch",
  "enqueue",
  "send",
  "post",
  "put",
  "upload",
  "remove",
]);

function isNoWriteTerminal(terminal) {
  return noWriteCallTerminals.has(terminal)
    || terminal?.startsWith("dispatch")
    || terminal?.startsWith("enqueue");
}

function isNoWriteCallPath(callPath) {
  if (!callPath) return false;
  const segments = callPath.split(".");
  return (callPath.startsWith("supabase.")
      && (segments.includes("[dynamic]") || segments.some(isNoWriteTerminal)))
    || isNoWriteTerminal(segments.at(-1));
}

function resolvePropertyPath(node, aliases, seen = new Set()) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const alias = aliases.get(node.text);
    if (!alias) return node.text;
    seen.add(node.text);
    return alias;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const parent = resolvePropertyPath(node.expression, aliases, seen);
    return parent ? parent + "." + node.name.text : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = resolvePropertyPath(node.expression, aliases, seen);
    const argument = unwrap(node.argumentExpression);
    const key = ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
      ? argument.text
      : "[dynamic]";
    return parent ? parent + "." + key : null;
  }
  if (ts.isCallExpression(node)) {
    return resolvePropertyPath(node.expression, aliases, seen);
  }
  return null;
}

function collectNoWriteAliases(root, cutoff) {
  const aliases = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    visit(root, (node) => {
      if (node.pos >= cutoff) return;
      let name = null;
      let initializer = null;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        name = node.name.text;
        initializer = node.initializer;
      } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
        name = node.left.text;
        initializer = node.right;
      }
      if (!name || !initializer || aliases.has(name)) return;
      const initializerPath = resolvePropertyPath(initializer, aliases);
      if (initializerPath === "supabase"
        || initializerPath?.startsWith("supabase.")
        || isNoWriteCallPath(initializerPath)) {
        aliases.set(name, initializerPath);
        changed = true;
      }
    });
  }
  return aliases;
}

function isNoWriteCall(node, aliases) {
  return ts.isCallExpression(node)
    && isNoWriteCallPath(resolvePropertyPath(node.expression, aliases));
}

function unexpectedCallPaths(root, aliases, predicate, allowedPaths) {
  const unexpected = [];
  visit(root, (node) => {
    if (!ts.isCallExpression(node) || !predicate(node)) return;
    const callPath = resolvePropertyPath(node.expression, aliases);
    if (!callPath || !allowedPaths.has(callPath)) {
      unexpected.push(callPath ?? "<unresolved call>");
    }
  });
  return [...new Set(unexpected)];
}

const preValidationAllowedCallPaths = new Set([
  "createClient",
  "Deno.env.get",
  "readRssWebhookAuthMode",
  "requireRssWebhookAuth",
  "readBoundedRssWebhookBody",
  "parseBoundedRssWebhookJson",
  "extractBoundedRssWebhookItems",
  "isRssWebhookPayloadError",
  "webhookPayloadErrorResponse",
  "webhookUnauthorizedResponse",
  "console.log",
  "JSON.stringify",
  "Array.isArray",
  "Boolean",
  "Object.keys",
]);

const validationAllowedCallPaths = new Set([
  "console.log",
  "JSON.stringify",
]);

function findNamedFunction(sourceFile, expectedName) {
  let found = null;
  visit(sourceFile, (node) => {
    if (!found && ts.isFunctionDeclaration(node) && node.name?.text === expectedName) {
      found = node;
    }
  });
  return found;
}

function findServeCallback(sourceFile) {
  let callback = null;
  visit(sourceFile, (node) => {
    if (callback || !ts.isCallExpression(node) || !isIdentifier(node.expression, "serve")) return;
    const candidate = node.arguments[0];
    if ((ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) && ts.isBlock(candidate.body)) {
      callback = candidate;
    }
  });
  return callback;
}

function findObjectProperty(object, expectedName) {
  if (!ts.isObjectLiteralExpression(object)) return null;
  return object.properties.find(
    (property) => ts.isPropertyAssignment(property) && nameOf(property.name) === expectedName,
  ) ?? null;
}

function callsIn(node, expectedName) {
  const calls = [];
  visit(node, (candidate) => {
    if (isCallTo(candidate, expectedName)) calls.push(candidate);
  });
  return calls;
}

function parseAndTranspile(filePath, input) {
  const isTsx = filePath.endsWith(".tsx");
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + " has TypeScript parse diagnostics");
  }
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  if (isTsx) compilerOptions.jsx = ts.JsxEmit.ReactJSX;
  const transpile = ts.transpileModule(input, {
    compilerOptions,
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((transpile.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(path.basename(filePath) + " has TypeScript transpilation diagnostics");
  }
  return sourceFile;
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(label + " is missing: " + expected);
}

function assertNotIncludes(input, unwanted, label) {
  if (input.includes(unwanted)) fail(label + " must not contain: " + unwanted);
}

function isTrueLiteral(node) {
  return node.kind === ts.SyntaxKind.TrueKeyword;
}

function isValidateOnlyDeclaration(node) {
  return ts.isVariableDeclaration(node)
    && nameOf(node.name) === "validateOnly"
    && ts.isBinaryExpression(unwrap(node.initializer))
    && unwrap(node.initializer).operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isPropertyAccessExpression(unwrap(node.initializer).left)
    && isIdentifier(unwrap(node.initializer).left.expression, "payloadAny")
    && unwrap(node.initializer).left.name.text === "validate_only"
    && isTrueLiteral(unwrap(node.initializer).right);
}

function isActionCondition(node) {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && isIdentifier(node.left, "action")
    && ts.isStringLiteral(node.right)
    && node.right.text === "test_webhook";
}

function assertContract(sources, label) {
  const internalAuthFile = parseAndTranspile(paths.internalAuth, sources.internalAuth);
  const adminRetryFile = parseAndTranspile(paths.adminRetry, sources.adminRetry);
  const webhookFile = parseAndTranspile(paths.webhook, sources.webhook);
  parseAndTranspile(paths.settings, sources.settings);
  parseAndTranspile(paths.dashboard, sources.dashboard);

  const tokenReader = findNamedFunction(internalAuthFile, "readRssWebhookExpectedToken");
  const authHeaders = findNamedFunction(internalAuthFile, "rssWebhookInternalAuthHeaders");
  const authMode = findNamedFunction(internalAuthFile, "readRssWebhookAuthMode");
  const rssAuth = findNamedFunction(internalAuthFile, "requireRssWebhookAuth");
  if (!tokenReader?.body || !authHeaders?.body || !authMode?.body || !rssAuth?.body) {
    fail(label + " RSS token reader/header/preflight/auth helpers are incomplete");
  }
  const tokenEnvCalls = callsIn(tokenReader.body, "readOptionalEnv");
  const tokenEnvNames = tokenEnvCalls.map((call) => {
    const arg = call.arguments[0];
    return ts.isStringLiteral(arg) ? arg.text : null;
  });
  const expectedTokenEnvNames = ["RSSAPP_WEBHOOK_TOKEN", "RSSAPP_TOKEN"];
  if (tokenEnvNames.length !== expectedTokenEnvNames.length
    || expectedTokenEnvNames.some((name, index) => tokenEnvNames[index] !== name)) {
    fail(label + " dedicated RSS token precedence changed");
  }
  if (callsIn(authHeaders.body, "readRssWebhookExpectedToken").length !== 1
    || !authHeaders.body.getText(internalAuthFile).includes("'x-webhook-token': token")
    || !authHeaders.body.getText(internalAuthFile).includes("hmacSha256Hex")) {
    fail(label + " internal RSS test auth must use a dedicated token or HMAC header");
  }
  if (callsIn(rssAuth.body, "readRssWebhookExpectedToken").length !== 1
    || rssAuth.body.getText(internalAuthFile).includes("verify_webhook_internal_token")) {
    fail(label + " incoming RSS auth must use only the dedicated token reader");
  }
  if (!authMode.body.getText(internalAuthFile).includes("parseRssAppSignatureHeader")
    || !authMode.body.getText(internalAuthFile).includes("readRssWebhookToken")) {
    fail(label + " RSS preflight must distinguish signed and token credentials");
  }

  const importIncludesHeaderHelper = adminRetryFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.endsWith("/_shared/internalAuth.ts")) {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return ts.isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === "rssWebhookInternalAuthHeaders");
  });
  if (!importIncludesHeaderHelper) fail(label + " admin-retry must import rssWebhookInternalAuthHeaders");

  let testWebhookBranch = null;
  visit(adminRetryFile, (node) => {
    if (!testWebhookBranch && ts.isIfStatement(node) && isActionCondition(node.expression)) {
      testWebhookBranch = node;
    }
  });
  if (!testWebhookBranch || !ts.isBlock(testWebhookBranch.thenStatement)) {
    fail(label + " admin-retry test_webhook branch is missing");
  }
  const adminInvokeCalls = [];
  visit(testWebhookBranch.thenStatement, (node) => {
    if (ts.isCallExpression(node) && propertyPath(node.expression) === "supabase.functions.invoke") {
      adminInvokeCalls.push(node);
    }
  });
  if (adminInvokeCalls.length !== 1 || !ts.isStringLiteral(adminInvokeCalls[0].arguments[0])
    || adminInvokeCalls[0].arguments[0].text !== "webhooks-rssapp") {
    fail(label + " test_webhook must invoke only webhooks-rssapp");
  }
  const invokeOptions = unwrap(adminInvokeCalls[0].arguments[1]);
  const bodyProperty = findObjectProperty(invokeOptions, "body");
  const headersProperty = findObjectProperty(invokeOptions, "headers");
  const invokeBody = unwrap(bodyProperty?.initializer);
  const invokeHeaders = headersProperty?.initializer;
  if (!bodyProperty || !headersProperty || !isIdentifier(invokeBody, "rawWebhookBody")
    || !ts.isAwaitExpression(invokeHeaders)
    || !isCallTo(invokeHeaders.expression, "rssWebhookInternalAuthHeaders")) {
    fail(label + " test_webhook must send the raw signed body without an explicit invoke Content-Type wrapper");
  }
  const testWebhookSource = testWebhookBranch.thenStatement.getText(adminRetryFile);
  for (const expected of [
    "const validationPayload = { data: { items_new: [testRSSItem] }, validate_only: true };",
    "const rawWebhookBody = JSON.stringify(validationPayload);",
    "body: rawWebhookBody",
    "headers: await rssWebhookInternalAuthHeaders(rawWebhookBody),",
  ]) {
    if (!testWebhookSource.includes(expected)) {
      fail(label + " test_webhook must sign or token-authenticate the exact JSON validation body");
    }
  }
  if (testWebhookSource.includes("test:") || sources.adminRetry.includes("webhookResponse.data")) {
    fail(label + " test_webhook must not rely on legacy test data or return target payloads");
  }
  if (!testWebhookBranch.thenStatement.getText(adminRetryFile).includes("validation_only: true")) {
    fail(label + " admin-retry success response must identify the no-write result");
  }

  const webhookServe = findServeCallback(webhookFile);
  if (!webhookServe?.body) fail(label + " webhook serve callback is missing");
  const validateDeclarations = [];
  let validateBranch = null;
  let authCall = null;
  const dataCallsBeforeValidation = [];
  const persistenceCallsInValidation = [];
  const validationResponses = [];
  const duplicateGateCalls = [];
  visit(webhookServe.body, (node) => {
    if (isValidateOnlyDeclaration(node)) validateDeclarations.push(node);
    if (!validateBranch && ts.isIfStatement(node) && isIdentifier(node.expression, "validateOnly")) {
      validateBranch = node;
    }
    if (!authCall && isCallTo(node, "requireRssWebhookAuth")) authCall = node;
  });
  if (validateDeclarations.length !== 1 || !validateBranch || !ts.isBlock(validateBranch.thenStatement)
    || !authCall || authCall.pos >= validateBranch.pos || validateDeclarations[0].pos >= validateBranch.pos) {
    fail(label + " webhook must authenticate and parse validate_only before its no-write branch");
  }
  const aliasesBeforeValidation = collectNoWriteAliases(webhookServe.body, validateBranch.pos);
  const aliasesInValidation = collectNoWriteAliases(webhookServe.body, validateBranch.end);
  const unexpectedPreValidationCalls = unexpectedCallPaths(
    webhookServe.body,
    aliasesBeforeValidation,
    (node) => node.pos < validateBranch.pos,
    preValidationAllowedCallPaths,
  );
  if (unexpectedPreValidationCalls.length > 0) {
    fail(label + " webhook pre-validation path contains an unreviewed call: "
      + unexpectedPreValidationCalls.join(", "));
  }
  visit(webhookServe.body, (node) => {
    if (ts.isCallExpression(node)) {
      if (node.pos < validateBranch.pos && isNoWriteCall(node, aliasesBeforeValidation)) {
        dataCallsBeforeValidation.push(node);
      }
      if (isCallTo(node, "isDuplicateGateEnabled")) duplicateGateCalls.push(node);
    }
  });
  if (dataCallsBeforeValidation.length > 0) {
    fail(label + " webhook must not query, dispatch, or call a provider before validate_only returns");
  }
  const unexpectedValidationCalls = unexpectedCallPaths(
    validateBranch.thenStatement,
    aliasesInValidation,
    () => true,
    validationAllowedCallPaths,
  );
  if (unexpectedValidationCalls.length > 0) {
    fail(label + " validate_only branch contains an unreviewed call: "
      + unexpectedValidationCalls.join(", "));
  }
  visit(validateBranch.thenStatement, (node) => {
    if (ts.isCallExpression(node)) {
      if (isNoWriteCall(node, aliasesInValidation)
        || isCallTo(node, "isDuplicateGateEnabled")
        || isCallTo(node, "isHydrationEnabled")) {
        persistenceCallsInValidation.push(node);
      }
    }
    if (ts.isNewExpression(node) && isIdentifier(node.expression, "Response")) {
      validationResponses.push(node);
    }
  });
  if (persistenceCallsInValidation.length > 0 || validationResponses.length !== 1
    || !validateBranch.thenStatement.getText(webhookFile).includes("validate_only: true")
    || !validateBranch.thenStatement.getText(webhookFile).includes("no post or job was created")) {
    fail(label + " validate_only branch must be an explicit no-write response");
  }
  if (duplicateGateCalls.length !== 1 || duplicateGateCalls[0].pos <= validateBranch.end) {
    fail(label + " normal webhook persistence path must remain after validate_only return");
  }

  assertIncludes(sources.settings, "Validate Webhook", label + " Settings control");
  assertIncludes(sources.settings, "It does not create posts or jobs.", label + " Settings copy");
  assertIncludes(sources.settings, "Webhook validation passed", label + " Settings success");
  assertNotIncludes(sources.settings, "sample content", label + " Settings copy");
  assertNotIncludes(sources.settings, "live pipeline test", label + " Settings copy");
  assertIncludes(sources.dashboard, "case 'validate-webhook'", label + " Dashboard action");
  assertIncludes(sources.dashboard, "Validate webhook", label + " Dashboard control");
  assertIncludes(sources.dashboard, "It does not create posts or jobs.", label + " Dashboard copy");
  assertIncludes(sources.dashboard, "Webhook validation passed", label + " Dashboard success");
  assertNotIncludes(sources.dashboard, "test-pipeline", label + " Dashboard action");
  assertNotIncludes(sources.dashboard, "sample content", label + " Dashboard copy");
  assertNotIncludes(sources.dashboard, "Live test", label + " Dashboard copy");
  assertIncludes(sources.matrix, "non-mutating `test_webhook` validation", label + " auth matrix");
  assertIncludes(sources.matrix, "only `validate_only`", label + " auth matrix");

  return {
    adminInvokes: adminInvokeCalls.length,
    validationResponses: validationResponses.length,
    uiControls: 2,
  };
}

function makeMissingValidationFlagMutant(input) {
  return input.replace("validate_only: true", "validate_only: false");
}

function makePreValidationQueryMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10) + "    await supabase.from('posts').select('tweet_id').limit(1);",
  );
}

function makePreValidationAliasQueryMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const client = supabase;" + String.fromCharCode(10)
      + "    await client.from('posts').select('tweet_id').limit(1);",
  );
}

function makePreValidationIndirectDispatchMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const invoke = supabase.functions.invoke;" + String.fromCharCode(10)
      + "    await invoke('worker', { body: {} });",
  );
}

function makePreValidationBracketQueryMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    await supabase['from']('posts').select('tweet_id').limit(1);",
  );
}

function makePreValidationBracketDispatchAliasMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const invoke = supabase.functions['invoke'];" + String.fromCharCode(10)
      + "    await invoke('worker', { body: {} });",
  );
}

function makePreValidationDynamicBracketMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const operation = 'from';" + String.fromCharCode(10)
      + "    await supabase[operation]('posts').select('tweet_id').limit(1);",
  );
}

function makePreValidationBoundDispatchMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const callWebhook = supabase.functions.invoke.bind(supabase.functions);" + String.fromCharCode(10)
      + "    await callWebhook('worker', { body: {} });",
  );
}

function makePreValidationHigherOrderDispatchMutant(input) {
  const marker = "const validateOnly = payloadAny.validate_only === true;";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only marker");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "    const getInvoke = () => supabase.functions.invoke;" + String.fromCharCode(10)
      + "    const callWebhook = getInvoke();" + String.fromCharCode(10)
      + "    await callWebhook('worker', { body: {} });",
  );
}

function makeValidationBranchAliasQueryMutant(input) {
  const marker = "if (validateOnly) {";
  if (!input.includes(marker)) fail("self-test cannot locate validate_only branch");
  return input.replace(
    marker,
    marker + String.fromCharCode(10)
      + "      const client = supabase;" + String.fromCharCode(10)
      + "      await client.from('posts').select('tweet_id').limit(1);",
  );
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["missing-validate-flag", { ...source, adminRetry: makeMissingValidationFlagMutant(source.adminRetry) }],
    ["pre-validation-query", { ...source, webhook: makePreValidationQueryMutant(source.webhook) }],
    ["pre-validation-alias-query", { ...source, webhook: makePreValidationAliasQueryMutant(source.webhook) }],
    ["pre-validation-indirect-dispatch", { ...source, webhook: makePreValidationIndirectDispatchMutant(source.webhook) }],
    ["pre-validation-bracket-query", { ...source, webhook: makePreValidationBracketQueryMutant(source.webhook) }],
    ["pre-validation-bracket-dispatch-alias", { ...source, webhook: makePreValidationBracketDispatchAliasMutant(source.webhook) }],
    ["pre-validation-dynamic-bracket", { ...source, webhook: makePreValidationDynamicBracketMutant(source.webhook) }],
    ["pre-validation-bound-dispatch", { ...source, webhook: makePreValidationBoundDispatchMutant(source.webhook) }],
    ["pre-validation-higher-order-dispatch", { ...source, webhook: makePreValidationHigherOrderDispatchMutant(source.webhook) }],
    ["validation-branch-alias-query", { ...source, webhook: makeValidationBranchAliasQueryMutant(source.webhook) }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("WEBHOOK_SELF_TEST_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "WEBHOOK_SELF_TEST_SOURCE_CONTRACT_PASS adminInvokes=" + result.adminInvokes
    + " validationResponses=" + result.validationResponses
    + " uiControls=" + result.uiControls
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);

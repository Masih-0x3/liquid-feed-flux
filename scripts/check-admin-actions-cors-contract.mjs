import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/index.ts");
const source = fs.readFileSync(sourcePath, "utf8");

function fail(message) {
  throw new Error("ADMIN_ACTIONS_CORS_SOURCE_CONTRACT_FAIL " + message);
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

function isCallTo(node, name) {
  return ts.isCallExpression(node) && isIdentifier(node.expression, name);
}

function isObjectFreeze(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && isIdentifier(node.expression.expression, "Object")
    && node.expression.name.text === "freeze";
}

function isConstDeclaration(declaration) {
  return ts.isVariableDeclaration(declaration)
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function isDescendantOf(node, ancestor) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function findDirectVariableDeclaration(block, expectedName) {
  for (const statement of block.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (nameOf(declaration.name) === expectedName) return declaration;
    }
  }
  return null;
}

function findNamedFunction(sourceFile, expectedName) {
  let found = null;
  visit(sourceFile, (node) => {
    if (!found && ts.isFunctionDeclaration(node) && node.name?.text === expectedName) {
      found = node;
    }
  });
  return found;
}

function functionCalls(functionNode, expectedName) {
  const calls = [];
  visit(functionNode.body, (node) => {
    if (isCallTo(node, expectedName)) calls.push(node);
  });
  return calls;
}

function containsCorsHeadersSpread(node) {
  let found = false;
  visit(node, (candidate) => {
    if (ts.isSpreadAssignment(candidate) && isIdentifier(candidate.expression, "corsHeaders")) {
      found = true;
    }
  });
  return found;
}

function isNegatedOrigin(node) {
  return ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.ExclamationToken
    && isIdentifier(node.operand, "origin");
}

function isNegatedAllowedOrigin(node) {
  return ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.ExclamationToken
    && ts.isCallExpression(node.operand)
    && ts.isPropertyAccessExpression(node.operand.expression)
    && isIdentifier(node.operand.expression.expression, "allowedOrigins")
    && node.operand.expression.name.text === "has"
    && node.operand.arguments.length === 1
    && isIdentifier(node.operand.arguments[0], "origin");
}

function isMissingOrDisallowedOriginGuard(node) {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.BarBarToken
    && ((isNegatedOrigin(node.left) && isNegatedAllowedOrigin(node.right))
      || (isNegatedOrigin(node.right) && isNegatedAllowedOrigin(node.left)));
}

function isOptionsGuard(node) {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isPropertyAccessExpression(node.left)
    && isIdentifier(node.left.expression, "req")
    && node.left.name.text === "method"
    && ts.isStringLiteral(node.right)
    && node.right.text === "OPTIONS";
}

function parseAndTranspile(input, label) {
  const sourceFile = ts.createSourceFile(sourcePath, input, ts.ScriptTarget.Latest, true);
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(label + " has TypeScript parse diagnostics");
  }
  const transpile = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpile.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(label + " has TypeScript transpilation diagnostics");
  }
  return sourceFile;
}

function assertContract(input, label) {
  const sourceFile = parseAndTranspile(input, label);
  const makeCorsHeaders = findNamedFunction(sourceFile, "makeCorsHeaders");
  if (!makeCorsHeaders?.body) fail(label + " makeCorsHeaders is missing");
  if (makeCorsHeaders.parameters.length !== 1 || makeCorsHeaders.parameters[0].questionToken) {
    fail(label + " makeCorsHeaders must require one Request parameter");
  }

  const fallbackIdentifiers = [];
  const corsDeclarations = [];
  const corsAssignments = [];
  const makeCorsCalls = [];
  const corsOriginProperties = [];
  const freezeCalls = [];
  let readsRequestOrigin = false;
  let hasVaryOrigin = false;
  let hasAllowHeaders = false;

  visit(sourceFile, (node) => {
    if (isIdentifier(node, "fallbackOrigin")) fallbackIdentifiers.push(node);
    if (ts.isVariableDeclaration(node) && nameOf(node.name) === "corsHeaders") corsDeclarations.push(node);
    if (isCallTo(node, "makeCorsHeaders")) makeCorsCalls.push(node);
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isIdentifier(node.left, "corsHeaders")) {
      corsAssignments.push(node);
    }
  });
  visit(makeCorsHeaders.body, (node) => {
    if (isObjectFreeze(node)) freezeCalls.push(node);
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "get"
      && ts.isPropertyAccessExpression(node.expression.expression)
      && node.expression.expression.name.text === "headers"
      && isIdentifier(node.expression.expression.expression, "req")
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === "Origin") {
      readsRequestOrigin = true;
    }
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === "Vary"
      && ts.isStringLiteral(node.initializer) && node.initializer.text === "Origin") {
      hasVaryOrigin = true;
    }
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === "Access-Control-Allow-Headers") {
      hasAllowHeaders = true;
    }
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === "Access-Control-Allow-Origin") {
      corsOriginProperties.push(node);
    }
  });

  if (fallbackIdentifiers.length > 0) fail(label + " fallback-origin identifier remains");
  if (!readsRequestOrigin) fail(label + " makeCorsHeaders does not read req.headers Origin");
  if (!hasVaryOrigin) fail(label + " makeCorsHeaders must retain Vary: Origin");
  if (!hasAllowHeaders) fail(label + " allowed requests lost Access-Control-Allow-Headers");
  if (freezeCalls.length < 2) fail(label + " CORS records must be immutable for both response branches");
  if (corsOriginProperties.length !== 1 || !isIdentifier(corsOriginProperties[0].initializer, "origin")) {
    fail(label + " allowed CORS response must expose only the current request origin");
  }

  const rejectionGuard = makeCorsHeaders.body.statements.find(
    (statement) => ts.isIfStatement(statement) && isMissingOrDisallowedOriginGuard(statement.expression),
  );
  if (!rejectionGuard || !ts.isBlock(rejectionGuard.thenStatement)
    || !rejectionGuard.thenStatement.statements.some(ts.isReturnStatement)) {
    fail(label + " missing/disallowed Origin must return before ACAO construction");
  }

  if (corsAssignments.length > 0) fail(label + " corsHeaders must never be assigned after declaration");
  if (corsDeclarations.length !== 1 || !isConstDeclaration(corsDeclarations[0])) {
    fail(label + " must contain exactly one const corsHeaders declaration");
  }

  const serveCalls = [];
  visit(sourceFile, (node) => {
    if (isCallTo(node, "serve")) serveCalls.push(node);
  });
  if (serveCalls.length !== 1) fail(label + " expected exactly one serve callback");
  const serveCallback = serveCalls[0].arguments[0];
  if (!serveCallback || (!ts.isArrowFunction(serveCallback) && !ts.isFunctionExpression(serveCallback))
    || !ts.isBlock(serveCallback.body)) {
    fail(label + " serve must receive a block-bodied request callback");
  }
  const serveBody = serveCallback.body;
  const requestCorsDeclaration = findDirectVariableDeclaration(serveBody, "corsHeaders");
  if (!requestCorsDeclaration || requestCorsDeclaration !== corsDeclarations[0]
    || !isCallTo(requestCorsDeclaration.initializer, "makeCorsHeaders")
    || requestCorsDeclaration.initializer.arguments.length !== 1
    || !isIdentifier(requestCorsDeclaration.initializer.arguments[0], "req")) {
    fail(label + " corsHeaders must be constructed once from the current request at serve entry");
  }
  if (makeCorsCalls.length !== 1 || makeCorsCalls[0] !== requestCorsDeclaration.initializer) {
    fail(label + " makeCorsHeaders must be called only by the request-local corsHeaders declaration");
  }

  const authFunction = findNamedFunction(sourceFile, "requireAuthenticatedAppRole")
    ?? findNamedFunction(sourceFile, "requireAdmin");
  if (!authFunction?.body || authFunction.parameters.length < 1) {
    fail(label + " canonical authentication function is missing");
  }
  const authFunctionName = authFunction.name.text;
  const requireCalls = functionCalls(serveCallback, "requireAdmin").length > 0
    ? functionCalls(serveCallback, "requireAdmin")
    : functionCalls(serveCallback, authFunctionName);
  if (requireCalls.length !== 1 || requireCalls[0].arguments.length < 1
    || !isIdentifier(requireCalls[0].arguments[0], "req")) {
    fail(label + " serve must pass the request to canonical authentication");
  }
  const authResponses = [];
  visit(authFunction.body, (node) => {
    if (ts.isNewExpression(node) && isIdentifier(node.expression, "Response")) authResponses.push(node);
  });
  if (authResponses.length !== 3 || authResponses.some((response) => !containsCorsHeadersSpread(response))) {
    fail(label + " every auth error response must use its request-local corsHeaders");
  }
  const authGetUserPosition = input.indexOf(".auth.getUser(", authFunction.pos);
  const serviceRolePosition = input.indexOf("SUPABASE_SERVICE_ROLE_KEY", authFunction.pos);
  if (authGetUserPosition < 0 || serviceRolePosition < 0 || authGetUserPosition > serviceRolePosition) {
    fail(label + " service client must remain after JWT validation");
  }

  const createJsonResponse = findNamedFunction(sourceFile, "createJsonResponse");
  if (!createJsonResponse?.body || createJsonResponse.parameters.length !== 3
    || nameOf(createJsonResponse.parameters[2].name) !== "corsHeaders") {
    fail(label + " createJsonResponse must receive request-local corsHeaders");
  }
  if (!containsCorsHeadersSpread(createJsonResponse.body)) {
    fail(label + " createJsonResponse must spread its request-local corsHeaders");
  }
  const localJsonResponse = findDirectVariableDeclaration(serveBody, "jsonResponse");
  if (!localJsonResponse || !isConstDeclaration(localJsonResponse)
    || !ts.isArrowFunction(localJsonResponse.initializer)
    || !isCallTo(localJsonResponse.initializer.body, "createJsonResponse")) {
    fail(label + " serve must create a request-local JSON response adapter");
  }
  const adapterArguments = localJsonResponse.initializer.body.arguments;
  if (adapterArguments.length !== 3 || !isIdentifier(adapterArguments[2], "corsHeaders")) {
    fail(label + " JSON response adapter must capture the current request corsHeaders");
  }

  const responseCalls = [];
  const preflightResponses = [];
  let hasOptionsPreflight = false;
  visit(sourceFile, (node) => {
    if (isCallTo(node, "jsonResponse")) responseCalls.push(node);
    if (ts.isIfStatement(node) && isDescendantOf(node, serveCallback) && isOptionsGuard(node.expression)) {
      hasOptionsPreflight = true;
    }
    if (ts.isNewExpression(node) && isIdentifier(node.expression, "Response") && isDescendantOf(node, serveCallback)) {
      preflightResponses.push(node);
    }
  });
  if (responseCalls.length < 2 || responseCalls.some((call) => !isDescendantOf(call, serveCallback))) {
    fail(label + " every JSON response must remain inside the request-local serve callback");
  }
  if (!hasOptionsPreflight || !preflightResponses.some((response) => containsCorsHeadersSpread(response))) {
    fail(label + " OPTIONS response must use the request-local corsHeaders");
  }

  return {
    corsResponseCount: responseCalls.length,
    authResponseCount: authResponses.length,
  };
}

function makeModuleGlobalMutant(input, moduleGlobalName) {
  const newLine = String.fromCharCode(10);
  const serveMarker = "serve(async (req: Request): Promise<Response> => {";
  const localDeclaration = "  const corsHeaders = makeCorsHeaders(req);";
  if (!input.includes(serveMarker) || !input.includes(localDeclaration)) {
    fail("self-test mutant cannot locate the request-local CORS declaration");
  }
  const requestReplacement = moduleGlobalName === "corsHeaders"
    ? "  corsHeaders = makeCorsHeaders(req);"
    : "  " + moduleGlobalName + " = makeCorsHeaders(req);" + newLine
      + "  const corsHeaders = " + moduleGlobalName + ";";
  return input
    .replace(
      serveMarker,
      "let " + moduleGlobalName + ' = makeCorsHeaders(new Request("http://localhost"));'
        + newLine + newLine + serveMarker,
    )
    .replace(localDeclaration, requestReplacement);
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["module-global", makeModuleGlobalMutant(source, "corsHeaders")],
    ["module-global-alias", makeModuleGlobalMutant(source, "crossRequestCorsHeaders")],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("ADMIN_ACTIONS_CORS_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "ADMIN_ACTIONS_CORS_SOURCE_CONTRACT_PASS jsonResponses=" + result.corsResponseCount
    + " authResponses=" + result.authResponseCount
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);

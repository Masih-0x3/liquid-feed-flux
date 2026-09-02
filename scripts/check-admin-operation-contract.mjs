import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  names: path.join(root, "supabase/functions/_shared/adminActionNames.ts"),
  client: path.join(root, "src/api/adminOperationClient.ts"),
  server: path.join(root, "supabase/functions/admin-actions/index.ts"),
  status: path.join(root, "supabase/functions/admin-actions/adminOperation.ts"),
  basic: path.join(root, "supabase/functions/admin-actions/basicActions.ts"),
  hydrate: path.join(root, "supabase/functions/admin-actions/xPostingActions.ts"),
  caller: path.join(root, "src/pages/Monitoring.tsx"),
};

function read(file) { return fs.readFileSync(file, "utf8"); }
function fail(message) { throw new Error(`ADMIN_OPERATION_CONTRACT_FAIL ${message}`); }
function parse(source, file) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) fail(`${file}: source parse failed`);
  return sf;
}
function descendants(node, visit) {
  visit(node);
  node.forEachChild((child) => descendants(child, visit));
}
function namedFunction(sf, name) {
  let found;
  descendants(sf, (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name &&
      node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      found = node.initializer;
    }
  });
  if (!found) fail(`${sf.fileName}: missing live function ${name}`);
  return found;
}
function namedVariableInitializer(sf, name) {
  let found;
  descendants(sf, (node) => {
    if (!found && ts.isVariableDeclaration(node) && node.name.getText(sf) === name) found = node.initializer;
  });
  if (!found) fail(`${sf.fileName}: missing live variable ${name}`);
  return found;
}
function ownerFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return null;
}
function isDead(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isIfStatement(current) && current.expression.kind === ts.SyntaxKind.FalseKeyword) return true;
  }
  return false;
}
function liveNodes(node, predicate) {
  const result = [];
  descendants(node, (child) => { if (!isDead(child) && predicate(child)) result.push(child); });
  return result;
}
function liveCalls(node, name, sf) {
  return liveNodes(node, (child) => ts.isCallExpression(child) &&
    ts.isIdentifier(child.expression) && child.expression.text === name).map((call) => call);
}
function livePropertyCalls(node, property) {
  return liveNodes(node, (child) => ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) &&
    child.expression.name.text === property);
}
function literalTexts(node) {
  return liveNodes(node, (child) => ts.isStringLiteralLike(child)).map((child) => child.text);
}
function assertLiveCall(node, name, label) {
  if (!liveCalls(node, name).length) fail(`${label}: missing live ${name} call`);
}
function assertLiveReference(node, name, label) {
  if (!liveNodes(node, (child) => ts.isIdentifier(child) && child.text === name).length) fail(`${label}: missing live ${name} reference`);
}
function assertRegex(sf, expected, label) {
  const found = liveNodes(sf, (node) => ts.isRegularExpressionLiteral(node) && node.getText() === expected);
  if (!found.length) fail(`${label}: missing live canonical grammar ${expected}`);
}
function assertConditional(node, predicate, label) {
  if (!liveNodes(node, (child) => ts.isIfStatement(child) && predicate(child)).length) fail(`${label}: missing live guard`);
}

function assertContract(overrides = {}, label = "current source") {
  const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, overrides[key] ?? read(file)]));
  const ast = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, parse(value, files[key])]));

  if (!liveNodes(ast.names, (node) => ts.isStringLiteralLike(node) && node.text === "get_admin_operation_status").length) {
    fail(`${label} names: status action is not registered`);
  }

  const invoke = namedFunction(ast.client, "invokeAdminOperation");
  const reconcile = namedFunction(ast.client, "reconcileAdminOperation");
  const unknownResult = namedFunction(ast.client, "unknownResult");
  assertLiveCall(invoke, "withAdminActionDeadline", `${label} client invoke`);
  assertLiveCall(invoke, "invokeAdminAction", `${label} client invoke`);
  if (!liveNodes(invoke, (node) => ts.isIfStatement(node) && node.expression.getText(ast.client).includes("classifyUnknownTransport") && liveCalls(node, "unknownResult").length).length) fail(`${label} client invoke: deadline branch lost unknownResult`);
  if (!literalTexts(unknownResult).includes("unknown")) fail(`${label} client invoke: missing outcome classification`);
  assertLiveCall(reconcile, "invokeAdminRead", `${label} client reconcile`);
  if (!literalTexts(reconcile).includes("get_admin_operation_status")) fail(`${label} client reconcile: wrong status action`);
  assertLiveReference(namedFunction(ast.client, "requireTweetId"), "ADMIN_OPERATION_TWEET_ID_PATTERN", `${label} client tweet id`);
  assertRegex(namedVariableInitializer(ast.client, "ADMIN_OPERATION_TWEET_ID_PATTERN"), "/^[A-Za-z0-9_-]{1,128}$/", `${label} client tweet id`);
  assertLiveReference(reconcile, "ADMIN_OPERATION_ID_PATTERN", `${label} client operation id`);
  assertRegex(namedVariableInitializer(ast.client, "ADMIN_OPERATION_ID_PATTERN"), "/^(?:reprocess|hydrate:manual_monitoring):[A-Za-z0-9_-]{1,128}$/", `${label} client operation id`);

  const status = namedFunction(ast.status, "getAdminOperationStatus");
  const mapStatus = namedFunction(ast.status, "mapJobStatus");
  if (!livePropertyCalls(status, "eq").some((call) => literalTexts(call).includes("idempotency_key"))) fail(`${label} status: identity lookup moved`);
  assertLiveCall(status, "mapJobStatus", `${label} status mapping`);
  for (const truth of ["committed", "failed", "still_running", "unknown"]) {
    if (!literalTexts(mapStatus).includes(truth)) fail(`${label} status: missing ${truth} in mapJobStatus`);
  }
  assertLiveReference(namedFunction(ast.status, "canonicalAdminOperationId"), "ADMIN_OPERATION_TWEET_ID_PATTERN", `${label} server tweet id`);
  assertRegex(namedVariableInitializer(ast.status, "ADMIN_OPERATION_TWEET_ID_PATTERN"), "/^[A-Za-z0-9_-]{1,128}$/", `${label} server tweet id`);
  assertLiveReference(namedFunction(ast.status, "isSupportedAdminOperationId"), "ADMIN_OPERATION_ID_PATTERN", `${label} server operation id`);
  assertRegex(namedVariableInitializer(ast.status, "ADMIN_OPERATION_ID_PATTERN"), "/^(?:reprocess|hydrate:manual_monitoring):[A-Za-z0-9_-]{1,128}$/", `${label} server operation id`);

  const dispatcher = ast.server;
  const identityIf = liveNodes(dispatcher, (node) => ts.isIfStatement(node) &&
    node.expression.getText(ast.server).includes('action === "reprocess"') &&
    node.expression.getText(ast.server).includes('action === "hydrate_post"'));
  const identityOwner = identityIf.length ? ownerFunction(identityIf[0]) : null;
  if (!identityIf.length || !identityOwner || !liveCalls(identityIf[0], "validateAdminOperationIdentity").length || !liveCalls(identityOwner, "requireAdmin").length) fail(`${label} dispatcher: identity guard is not live in the request handler`);
  const statusCase = liveNodes(dispatcher, (node) => ts.isCaseClause(node) &&
    node.expression && node.expression.getText(ast.server).includes("get_admin_operation_status"));
  if (!statusCase.length || !liveCalls(statusCase[0], "getAdminOperationStatus").length || ownerFunction(statusCase[0]) !== identityOwner) fail(`${label} dispatcher: reconcile route is not live in the request handler`);

  const reprocess = namedFunction(ast.basic, "reprocessAdminAction");
  assertRegex(namedFunction(ast.basic, "normalizeSingleReprocessTweetId"), "/^[A-Za-z0-9_-]{1,128}$/", `${label} reprocess handler`);
  if (!livePropertyCalls(reprocess, "upsert").length || !livePropertyCalls(reprocess, "maybeSingle").length) fail(`${label} reprocess: no atomic insert result`);
  assertConditional(reprocess, (node) => node.expression.getText(ast.basic).includes("inserted") && liveCalls(node, "recordFeedback").length > 0, `${label} reprocess side effect`);
  assertLiveCall(reprocess, "addAdminOperationEnvelope", `${label} reprocess envelope`);

  const hydration = namedFunction(ast.hydrate, "queueHydrationJob");
  const hydrateHandler = namedFunction(ast.hydrate, "hydratePostAdminAction");
  assertLiveCall(hydrateHandler, "queueHydrationJob", `${label} hydrate handler queue`);
  assertLiveCall(hydrateHandler, "addAdminOperationEnvelope", `${label} hydrate handler envelope`);
  if (!livePropertyCalls(hydration, "upsert").length || !livePropertyCalls(hydration, "maybeSingle").length) fail(`${label} hydration: no atomic insert result`);
  assertConditional(hydration, (node) => node.expression.getText(ast.hydrate).includes("!inserted") &&
    node.getText(ast.hydrate).includes("hydrate_job_already_exists"), `${label} hydration duplicate guard`);
  if (!livePropertyCalls(hydration, "insertAdminPipelineEvent").length) fail(`${label} hydration side effect: missing live insertAdminPipelineEvent call`);

  const caller = namedFunction(ast.caller, "confirmAction");
  const reconcileUi = namedFunction(ast.caller, "reconcileUnknownOperation");
  const unknownGuards = liveNodes(caller, (node) => ts.isIfStatement(node) && node.expression.getText(ast.caller).includes("operation_status === 'unknown'"));
  if (unknownGuards.length < 2) fail(`${label} caller: unknown outcome is not handled for both selected mutations`);
  for (const guard of unknownGuards) {
    if (!liveNodes(guard, (node) => ts.isBreakStatement(node)).length || !liveCalls(guard, "setUnknownOperation").length) fail(`${label} caller: unknown path can fall through to success`);
  }
  if (!liveNodes(caller, (node) => ts.isStringLiteralLike(node) && node.text.includes("do not retry")).length) fail(`${label} caller: blind retry warning missing in confirmAction`);
  assertLiveCall(reconcileUi, "adminReconcileOperation", `${label} caller reconciliation affordance`);
}

function allSources() { return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)])); }
function assertRejects(mutator, label) {
  try { assertContract(mutator(allSources()), label); } catch (error) {
    if (String(error).includes("ADMIN_OPERATION_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract();
if (process.env.MUTATION_TEST === "1") {
  assertRejects((s) => ({ ...s, server: s.server.replace("!validateAdminOperationIdentity(action, tweetId, body.operation_id)", "false") + "\n// validateAdminOperationIdentity(action, tweetId, body.operation_id)" }), "dead identity decoy");
  assertRejects((s) => ({ ...s, server: s.server.replace("!validateAdminOperationIdentity(action, tweetId, body.operation_id)", "false") + "\nfunction decoyAdminGuard(action, tweetId, body) { if (action === \"reprocess\" || action === \"hydrate_post\") validateAdminOperationIdentity(action, tweetId, body.operation_id); }" }), "unrelated identity placement decoy");
  assertRejects((s) => ({ ...s, hydrate: s.hydrate.replace("if (!inserted) return { queued: false, reason: \"hydrate_job_already_exists\" };", "if (false) return { queued: false };\n// inserted duplicate guard") }), "dead hydration decoy");
  assertRejects((s) => ({ ...s, caller: s.caller.replace("result.operation_status === 'unknown'", "false") + "\n/* adminReconcileOperation and do not retry */" }), "dead caller decoy");
  assertRejects((s) => ({ ...s, client: s.client.replace("/^[A-Za-z0-9_-]{1,128}$/", "/^[A-Za-z0-9_]{1,128}$/") + "\nfunction decoyGrammar() { return /^[A-Za-z0-9_-]{1,128}$/; }" }), "unrelated grammar placement decoy");
  assertRejects((s) => ({ ...s, client: s.client.replace("operation_status: 'unknown'", "operation_status: 'not_unknown'") }), "unknown status bypass");
  assertRejects((s) => ({ ...s, status: s.status.replace('if (status === "completed") return "committed";', 'if (status === "completed") return "unknown";') + '\nconst unrelatedStatusLiteral = "committed";' }), "unrelated status mapping decoy");
  assertRejects((s) => ({ ...s, client: s.client.replace("return unknownResult(operationId);", "return { operation_id: operationId, operation_status: 'unknown' };") }), "unknownResult branch bypass");
  assertRejects((s) => ({ ...s, caller: s.caller.replace("result.operation_status === 'unknown'", "false") + "\nfunction unrelatedCallerGuard(result) { if (result.operation_status === 'unknown') return 'do not retry'; }" }), "unrelated caller guard decoy");
}
console.log(`ADMIN_OPERATION_CONTRACT_PASS mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

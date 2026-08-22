import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  basicActions: join(repoRoot, 'supabase/functions/admin-actions/basicActions.ts'),
  basicActionsTest: join(repoRoot, 'supabase/functions/admin-actions/basicActions.test.ts'),
  adminActionsIndex: join(repoRoot, 'supabase/functions/admin-actions/index.ts'),
  actionNames: join(repoRoot, 'supabase/functions/_shared/adminActionNames.ts'),
  worker: join(repoRoot, 'supabase/functions/worker/index.ts'),
  threads: join(repoRoot, 'src/pages/Threads.tsx'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, path + ' must transpile without TypeScript diagnostics');
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === '.ts' ? [path] : [];
  });
}

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, 'missing ' + startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end >= 0, 'missing ' + endNeedle);
  return source.slice(start, end);
}

function mutatePostThreadAction(source, mutate) {
  const startNeedle = 'export async function postThreadAdminAction';
  const endNeedle = 'export async function getHealthAdminAction';
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end >= 0 && start < end, 'postThreadAdminAction range is required for mutation');
  const block = source.slice(start, end);
  const mutatedBlock = mutate(block);
  assert.notEqual(mutatedBlock, block, 'postThreadAdminAction mutation target is required');
  return source.slice(0, start) + mutatedBlock + source.slice(end);
}

function getPostThreadDeclaration(source) {
  const file = typescript.createSourceFile(
    paths.basicActions,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    typescript.ScriptKind.TS,
  );
  let declaration;
  const visit = (node) => {
    if (typescript.isFunctionDeclaration(node) && node.name?.text === 'postThreadAdminAction') {
      declaration = node;
    }
    typescript.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(declaration?.body, 'postThreadAdminAction must remain a function with a body');
  return declaration;
}

function isAllowedThreadIdTrim(node) {
  return typescript.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'trim'
    && node.arguments.length === 0
    && typescript.isPropertyAccessExpression(node.expression.expression)
    && node.expression.expression.name.text === 'thread_id'
    && typescript.isIdentifier(node.expression.expression.expression)
    && node.expression.expression.expression.text === 'body';
}

function assertPostThreadHasNoSideEffects(source) {
  const declaration = getPostThreadDeclaration(source);
  const allowedStatementKinds = new Set([
    typescript.SyntaxKind.VariableStatement,
    typescript.SyntaxKind.IfStatement,
    typescript.SyntaxKind.ReturnStatement,
  ]);
  for (const statement of declaration.body.statements) {
    assert.ok(
      allowedStatementKinds.has(statement.kind),
      'thread action may contain only local admission and return statements while delivery is unavailable',
    );
  }

  const sideEffectSyntax = [];
  const visit = (node) => {
    if (typescript.isCallExpression(node) && !isAllowedThreadIdTrim(node)) {
      sideEffectSyntax.push('call:' + node.getText());
    }
    if (typescript.isNewExpression(node)) sideEffectSyntax.push('new:' + node.getText());
    if (typescript.isAwaitExpression(node)) sideEffectSyntax.push('await:' + node.getText());
    if (typescript.isTaggedTemplateExpression(node)) sideEffectSyntax.push('tag:' + node.getText());
    if (typescript.isDeleteExpression(node)) sideEffectSyntax.push('delete:' + node.getText());
    if (typescript.isBinaryExpression(node) && node.operatorToken.kind >= typescript.SyntaxKind.FirstAssignment && node.operatorToken.kind <= typescript.SyntaxKind.LastAssignment) {
      sideEffectSyntax.push('assignment:' + node.getText());
    }
    if (typescript.isPrefixUnaryExpression(node) && (node.operator === typescript.SyntaxKind.PlusPlusToken || node.operator === typescript.SyntaxKind.MinusMinusToken)) {
      sideEffectSyntax.push('mutation:' + node.getText());
    }
    if (typescript.isPostfixUnaryExpression(node) && (node.operator === typescript.SyntaxKind.PlusPlusToken || node.operator === typescript.SyntaxKind.MinusMinusToken)) {
      sideEffectSyntax.push('mutation:' + node.getText());
    }
    if (typescript.isIdentifier(node) && node.text === '_supabase') {
      sideEffectSyntax.push('supabase-reference');
    }
    typescript.forEachChild(node, visit);
  };
  visit(declaration.body);
  assert.deepEqual(sideEffectSyntax, [], 'thread action must be structurally side-effect-free while ordered delivery is unavailable');
}

function validateStructural(source) {
  for (const name of ['basicActions', 'basicActionsTest', 'adminActionsIndex', 'actionNames', 'worker', 'threads']) {
    transpile(paths[name], source[name]);
  }

  const postThread = between(
    source.basicActions,
    'export async function postThreadAdminAction',
    'export async function getHealthAdminAction',
  );
  assert.match(source.basicActions, /const THREAD_DELIVERY_UNAVAILABLE = "thread_delivery_unavailable";/, 'thread delivery must have one stable unavailable code');
  assert.match(postThread, /typeof body\.thread_id === "string"/, 'thread action must keep bounded string admission');
  assert.match(postThread, /success: false,\s*error: THREAD_DELIVERY_UNAVAILABLE,\s*code: THREAD_DELIVERY_UNAVAILABLE,\s*\},\s*status: 409,/s, 'thread action must return an explicit non-queued 409 result');
  assert.doesNotMatch(postThread, /(?:deliveries|subject_type|\.insert\(|Thread queued for delivery)/, 'thread action must not create a pending delivery or claim queued success');
  assertPostThreadHasNoSideEffects(source.basicActions);

  assert.match(source.actionNames, /'post_thread'/, 'the canonical action name must remain available for a stable failure response');
  assert.match(source.adminActionsIndex, /case 'post_thread': \{\s*const result = await postThreadAdminAction\(supabase, body\);/s, 'the dispatcher must preserve the fail-closed action boundary');
  assert.doesNotMatch(source.worker, /(?:\bpost_thread\b|subject_type\s*[:=]\s*["']thread["']|case\s+["']thread["'])/, 'worker must not contain an unreviewed thread delivery consumer');

  assert.doesNotMatch(source.threads, /(?:invokeAdminAction|handlePostThread|Thread queued for delivery|<Send\b)/, 'Threads UI must not expose a live delivery action');
  assert.match(source.threads, />Delivery unavailable</, 'Threads table must visibly identify the unavailable state');
  assert.match(source.threads, /Thread delivery is unavailable until ordered delivery is implemented\. This preview does not queue a message\./, 'preview must tell operators it does not queue a message');

  assert.match(source.basicActionsTest, /postThreadAdminAction/, 'future Deno coverage must import the disabled action');
  assert.match(source.basicActionsTest, /thread delivery is fail-closed until an ordered delivery consumer exists/, 'future Deno coverage must retain the containment fixture');
  assert.match(source.basicActionsTest, /assertEquals\(supabase\.calls, \[\]\);/, 'future Deno coverage must prove no table write occurs');

  assert.match(source.packageJson, /"check:thread-delivery-containment": "node scripts\/check-thread-delivery-containment-contract\.mjs"/, 'package scripts must retain the containment check');
  assert.match(source.ci, /npm run check:thread-delivery-containment/, 'hosted CI must retain the containment check');

  const threadSubjectFiles = sourceFiles(join(repoRoot, 'supabase/functions'))
    .filter((path) => !path.endsWith('.test.ts'))
    .filter((path) => /subject_type\s*:\s*["']thread["']/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(threadSubjectFiles, [], 'no deployed function source may create a thread delivery while the consumer is absent');

  const canonicalPostThreadFiles = new Set([
    paths.basicActions,
    paths.adminActionsIndex,
    paths.actionNames,
  ]);
  const unexpectedPostThreadFiles = sourceFiles(join(repoRoot, 'supabase/functions'))
    .filter((path) => !path.endsWith('.test.ts'))
    .filter((path) => !canonicalPostThreadFiles.has(path))
    .filter((path) => /\bpost_thread\b/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(unexpectedPostThreadFiles, [], 'post_thread must not gain an unreviewed consumer outside its canonical fail-closed boundary');
}

validateStructural(sources);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      label + ' mutation must fail the source contract',
    );
  };
  assertRejected('stable fail-closed result', (source) => ({
    ...source,
    basicActions: mutatePostThreadAction(source.basicActions, (block) =>
      block.replace('status: 409,', 'status: 200,')),
  }));
  assertRejected('non-success result', (source) => ({
    ...source,
    basicActions: mutatePostThreadAction(source.basicActions, (block) =>
      block.replace('success: false,', 'success: true,')),
  }));
  assertRejected('delivery insert', (source) => ({
    ...source,
    basicActions: source.basicActions.replace(
      '  return {\n    body: {\n      success: false,',
      '  await table(_supabase, "deliveries").insert({ subject_type: "thread" });\n  return {\n    body: {\n      success: false,',
    ),
  }));
  assertRejected('job upsert', (source) => ({
    ...source,
    basicActions: source.basicActions.replace(
      '  return {\n    body: {\n      success: false,',
      '  await table(_supabase, "jobs").upsert({ type: "post_thread" });\n  return {\n    body: {\n      success: false,',
    ),
  }));
  assertRejected('RPC call', (source) => ({
    ...source,
    basicActions: source.basicActions.replace(
      '  return {\n    body: {\n      success: false,',
      '  await _supabase.rpc("enqueue_thread_delivery");\n  return {\n    body: {\n      success: false,',
    ),
  }));
  assertRejected('provider fetch', (source) => ({
    ...source,
    basicActions: source.basicActions.replace(
      '  return {\n    body: {\n      success: false,',
      '  await fetch("https://provider.invalid/thread");\n  return {\n    body: {\n      success: false,',
    ),
  }));
  assertRejected('worker post_thread consumer', (source) => ({
    ...source,
    worker: source.worker + '\nconst containmentMutationWorkerConsumer = () => { switch ("post_thread") { case "post_thread": return; } };\n',
  }));
  assertRejected('UI unavailable notice', (source) => ({
    ...source,
    threads: source.threads.replace('>Delivery unavailable<', '>Ready to deliver<'),
  }));
  assertRejected('preview no-queue notice', (source) => ({
    ...source,
    threads: source.threads.replace(
      'Thread delivery is unavailable until ordered delivery is implemented. This preview does not queue a message.',
      'Thread delivery unavailable.',
    ),
  }));
  assertRejected('canonical action availability', (source) => ({
    ...source,
    actionNames: source.actionNames.replace("'post_thread'", "'post_thread_legacy'"),
  }));
  selfTest = 'pass';
}

console.log('THREAD_DELIVERY_CONTAINMENT_SOURCE_CONTRACT_PASS directAction=fail_closed ui=disabled workerConsumer=absent selfTest=' + selfTest);

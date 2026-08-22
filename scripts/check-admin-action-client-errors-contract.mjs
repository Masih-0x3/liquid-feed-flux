import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  helper: join(repoRoot, 'src/api/adminActionErrors.ts'),
  actions: join(repoRoot, 'src/api/adminActions.ts'),
  retry: join(repoRoot, 'src/api/adminRetry.ts'),
  monitoring: join(repoRoot, 'src/api/monitoringData.ts'),
  monitoringHook: join(repoRoot, 'src/hooks/useMonitoringData.ts'),
  dashboard: join(repoRoot, 'src/api/dashboardData.ts'),
  test: join(repoRoot, 'src/test/admin-actions.test.ts'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
  return result.outputText;
}

function loadHelper(source) {
  const module = { exports: {} };
  new Function('module', 'exports', transpile(paths.helper, source))(module, module.exports);
  return module.exports;
}

function validateStructural(source) {
  for (const [name, path] of Object.entries(paths)) transpile(path, source[name]);

  assert.match(source.helper, /export class AdminActionClientError extends Error/, 'shared client errors must remain typed Error instances');
  assert.match(source.helper, /readonly code: AdminActionClientErrorCode;/, 'shared errors must expose a stable code');
  assert.match(source.helper, /readonly status: number \| undefined;/, 'shared transport errors must expose a validated HTTP status');
  assert.match(source.helper, /case 401:\s*\n\s*case 403:\s*\n\s*return 'authorization_failed';/, 'auth statuses must normalize to authorization_failed');
  assert.match(source.helper, /case 429:\s*\n\s*return 'rate_limited';/, 'rate limits must retain a stable code');
  assert.match(source.helper, /return 'admin_action_unavailable';/, 'unknown or unavailable transport failures must fail to a stable client code');
  assert.match(source.helper, /admin_action_deadline_exceeded/, 'read deadlines must have a stable client error code');
  assert.match(source.helper, /export async function withAdminActionDeadline<T>/, 'read deadlines must use one shared helper');
  assert.match(source.helper, /Promise\.race\(\[request\(\), timeout\]\)/, 'read deadlines must race the request against the timer');
  assert.match(source.helper, /return new AdminActionClientError\('admin_action_failed', options\);/, 'in-band failures must not reuse server-provided text');
  assert.match(source.helper, /export async function withNormalizedAdminActionTransport<T>\(request: \(\) => Promise<T>\): Promise<T> \{\s*try \{\s*return await request\(\);\s*\} catch \(error\) \{\s*throw createAdminActionTransportError\(error\);/s, 'rejected transport promises must use the shared normalizer');
  assert.doesNotMatch(source.helper, /(?:\.clone\(\)|\.text\(\)|responseText|JSON\.parse\(|\.message|String\()/u, 'the shared normalizer must not read raw SDK/response text');

  for (const [name, wrapper] of Object.entries({ actions: source.actions, retry: source.retry })) {
    assert.match(wrapper, /createAdminActionResponseError,[\s\S]*?createAdminActionTransportError,[\s\S]*?withNormalizedAdminActionTransport/s, `${name} must import the shared error boundary`);
    assert.match(wrapper, /await withNormalizedAdminActionTransport\(\s*\(\) => supabase\.functions\.invoke\(/s, `${name} must normalize rejected invoke promises`);
    assert.match(wrapper, /if \(error\) throw createAdminActionTransportError\(error\);/, `${name} must normalize transport errors`);
    assert.match(wrapper, /throw createAdminActionResponseError\(options\);/, `${name} must normalize in-band failure responses`);
    assert.match(wrapper, /options\.throwOnFailure !== false/, `${name} must preserve the explicit inline-failure compatibility mode`);
    assert.doesNotMatch(wrapper, /(?:formatFunctionError|responseText|\.clone\(\)|\.text\(\)|data\??\.error|throw error;)/u, `${name} must not expose raw provider or response text`);
  }

  for (const [name, wrapper] of Object.entries({
    monitoring: source.monitoring,
    monitoringHook: source.monitoringHook,
    dashboard: source.dashboard,
  })) {
    assert.match(wrapper, /invokeAdminRead/, `${name} must use the read deadline boundary`);
  }

  assert.match(source.test, /without exposing response details/, 'future unit coverage must keep a raw-response regression fixture');
  assert.match(source.test, /uses the same normalized failure boundary for admin retries/, 'future unit coverage must include admin-retry parity');
  assert.match(source.test, /not\.toContain\("Unauthorized: invalid token"\)/, 'future unit coverage must prove raw auth detail is not rendered');
  assert.match(source.test, /normalizes a rejected admin-action invocation without exposing its message/, 'future unit coverage must keep a rejected-promise regression fixture');
}

validateStructural(sources);

const helper = loadHelper(sources.helper);

function assertTransport(status, code, message) {
  const rawDetail = `do-not-render-${status ?? 'network'}-detail`;
  const error = helper.createAdminActionTransportError({
    message: rawDetail,
    context: { status, body: rawDetail },
  });
  assert.equal(error.code, code, `status ${status} must use the expected stable code`);
  assert.equal(error.status, status, `status ${status} must be retained as metadata only`);
  assert.equal(error.message, message, `status ${status} must use the expected client-generated message`);
  assert.equal(error.message.includes(rawDetail), false, `status ${status} must not render raw detail`);
}

assertTransport(401, 'authorization_failed', 'You are not authorized to perform this action.');
assertTransport(403, 'authorization_failed', 'You are not authorized to perform this action.');
assertTransport(400, 'invalid_request', 'The request could not be accepted.');
assertTransport(429, 'rate_limited', 'The request is temporarily rate limited.');
assertTransport(503, 'admin_action_unavailable', 'The service is temporarily unavailable.');
assertTransport(undefined, 'admin_action_unavailable', 'The service is temporarily unavailable.');
assert.equal(helper.getAdminFunctionErrorStatus({ context: { status: 600 } }), undefined, 'invalid statuses must not be retained');

const responseError = helper.createAdminActionResponseError();
assert.equal(responseError.code, 'admin_action_failed');
assert.equal(responseError.message, 'The action could not be completed.');
const callerMessage = helper.createAdminActionResponseError({ failureMessage: 'Hydrate failed' });
assert.equal(callerMessage.message, 'Hydrate failed', 'explicit caller-authored static failures must remain supported');
const rejectedTransport = await helper.withNormalizedAdminActionTransport(() => Promise.reject(new Error('do-not-render-rejected-detail'))).catch((error) => error);
assert.equal(rejectedTransport.code, 'admin_action_unavailable');
assert.equal(rejectedTransport.message, 'The service is temporarily unavailable.');
assert.equal(rejectedTransport.message.includes('do-not-render-rejected-detail'), false, 'rejected promise text must not render');
const deadlineError = await helper.withAdminActionDeadline(() => new Promise(() => {}), 1).catch((error) => error);
assert.equal(deadlineError.code, 'admin_action_deadline_exceeded');
assert.equal(deadlineError.message, 'The request took too long to complete.');

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      `${label} mutation must fail the source contract`,
    );
  };
  assertRejected('authorization status mapping', (source) => ({
    ...source,
    helper: source.helper.replace('case 401:', 'case 402:'),
  }));
  assertRejected('rate-limit status mapping', (source) => ({
    ...source,
    helper: source.helper.replace('case 429:', 'case 428:'),
  }));
  assertRejected('rejected transport boundary', (source) => ({
    ...source,
    helper: source.helper.replace('throw createAdminActionTransportError(error);', 'throw error;'),
  }));
  assertRejected('deadline helper boundary', (source) => ({
    ...source,
    helper: source.helper.replace('return await Promise.race([request(), timeout]);', 'return await request();'),
  }));
  assertRejected('monitoring read deadline boundary', (source) => ({
    ...source,
    monitoring: source.monitoring.replace(/invokeAdminRead/g, 'invokeAdminAction'),
  }));
  assertRejected('admin-actions transport boundary', (source) => ({
    ...source,
    actions: source.actions.replace('throw createAdminActionTransportError(error);', 'throw error;'),
  }));
  assertRejected('admin-actions in-band boundary', (source) => ({
    ...source,
    actions: source.actions.replace('throw createAdminActionResponseError(options);', 'throw new Error(data.error);'),
  }));
  assertRejected('admin-retry transport boundary', (source) => ({
    ...source,
    retry: source.retry.replace('throw createAdminActionTransportError(error);', 'throw error;'),
  }));
  assertRejected('admin-retry in-band boundary', (source) => ({
    ...source,
    retry: source.retry.replace('throw createAdminActionResponseError(options);', 'throw new Error(data.error);'),
  }));
  selfTest = 'pass';
}

console.log(`ADMIN_ACTION_CLIENT_ERRORS_SOURCE_CONTRACT_PASS raw=false retries=normalized selfTest=${selfTest}`);

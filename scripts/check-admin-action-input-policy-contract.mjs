import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  adminActions: join(repoRoot, 'supabase/functions/admin-actions/index.ts'),
  actionNames: join(repoRoot, 'supabase/functions/_shared/adminActionNames.ts'),
  payloadPolicy: join(repoRoot, 'supabase/functions/_shared/rssWebhookPayloadPolicy.ts'),
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
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
  return result.outputText;
}

function indexOfOrFail(source, needle, message) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function validateStructural(source) {
  for (const [name, path] of Object.entries(paths)) transpile(path, source[name]);

  const adminActions = source.adminActions;
  const actionNames = source.actionNames;
  const payloadPolicy = source.payloadPolicy;

  for (const [name, expected] of [
    ['MAX_ADMIN_ACTION_JSON_DEPTH', '32'],
    ['MAX_ADMIN_ACTION_JSON_NODES', '16_384'],
    ['MAX_ADMIN_ACTION_JSON_OBJECT_KEYS', '256'],
    ['MAX_ADMIN_ACTION_JSON_ARRAY_ITEMS', '256'],
    ['MAX_ADMIN_ACTION_STRING_LENGTH', '64 * 1024'],
  ]) {
    assert.match(
      payloadPolicy,
      new RegExp(`${name} = ${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${name} must remain explicit and bounded`,
    );
  }
  assert.match(payloadPolicy, /export function parseBoundedAdminActionJson\(rawBody: string\): unknown/, 'admin actions must retain a bounded JSON parser');
  assert.match(payloadPolicy, /return parseBoundedJson\(rawBody, ADMIN_ACTION_JSON_LIMITS\);/, 'admin parser must use its own explicit limits');
  assert.match(payloadPolicy, /assertBoundedJsonSyntax\(rawBody, limits\);/, 'JSON syntax bounds must precede JSON.parse');
  assert.match(payloadPolicy, /assertBoundedJsonShape\(parsed, limits\);/, 'parsed JSON must retain a structural bound');

  const optionsIndex = indexOfOrFail(
    adminActions,
    "if (req.method === 'OPTIONS')",
    'OPTIONS handling must remain present',
  );
  const authIndex = indexOfOrFail(
    adminActions,
    'const authResult = await requireAdmin(req, corsHeaders);',
    'admin authentication must remain present',
  );
  const boundedReadIndex = indexOfOrFail(
    adminActions,
    'const boundedBody = await readBoundedRssWebhookBody(req);',
    'admin action bodies must use the bounded shared reader',
  );
  const parseIndex = indexOfOrFail(
    adminActions,
    'const parsedBody = parseBoundedAdminActionJson(boundedBody.text);',
    'admin action bodies must use the bounded shared JSON parser',
  );
  const allowlistIndex = indexOfOrFail(
    adminActions,
    'if (!isAdminActionName(requestedAction))',
    'admin actions must be checked against the canonical allowlist',
  );
  const sentryActionIndex = indexOfOrFail(
    adminActions,
    'actionForSentry = action;',
    'Sentry action attribution must use the canonical action only',
  );
  const handlerServiceClientIndex = indexOfOrFail(
    adminActions,
    'const supabase = createClient<any, any>(',
    'admin handler service client must remain present',
  );

  assert.ok(optionsIndex < authIndex, 'preflight must remain unauthenticated');
  assert.ok(authIndex < boundedReadIndex, 'admin authentication must complete before body allocation/read');
  assert.ok(boundedReadIndex < parseIndex, 'bounded bytes must be read before JSON parsing');
  assert.ok(parseIndex < allowlistIndex && allowlistIndex < sentryActionIndex, 'only a parsed allowlisted action may reach Sentry');
  assert.ok(parseIndex < handlerServiceClientIndex, 'the request handler must not create its service client before parsing');

  assert.match(adminActions, /function asAdminActionBody\(value: unknown\): Record<string, unknown> \| null/, 'top-level admin payloads must be records');
  assert.match(adminActions, /code: 'admin_action_body_invalid'/, 'invalid bodies must use a stable code');
  assert.match(adminActions, /code: 'admin_action_missing'/, 'missing actions must use a stable code');
  assert.match(adminActions, /code: 'admin_action_unknown'/, 'unknown actions must use a stable code');
  assert.match(adminActions, /const code = 'admin_action_handler_failed';/, 'unexpected handler failures must use a stable code');
  assert.match(adminActions, /captureEdgeException\(new Error\(code\)/, 'Sentry capture must receive a sanitized error');
  assert.match(adminActions, /return jsonResponse\(\{ error: 'Admin action failed', code \}, 500\);/, 'unexpected errors must not expose internal messages');
  assert.doesNotMatch(adminActions, /req\.text\(\)|req\.json\(\)|rawText|received:\s*rawText/, 'admin actions must not restore unbounded or echoed request bodies');
  assert.doesNotMatch(adminActions, /Unknown action: \$\{action\}/, 'unknown action responses must not reflect attacker input');
  assert.doesNotMatch(adminActions, /error instanceof Error \? error\.message/, 'unexpected errors must not expose exception messages');

  const registryBlock = actionNames.match(/export const ADMIN_ACTION_NAMES = \[([\s\S]*?)\] as const;/);
  assert.ok(registryBlock, 'canonical admin action registry must remain parseable');
  const registeredActions = [...registryBlock[1].matchAll(/^\s*'([^']+)',?$/gm)].map((match) => match[1]);
  const dispatchedActions = [...adminActions.matchAll(/case '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    registeredActions.filter((action) => !dispatchedActions.includes(action)),
    [],
    'every allowlisted admin action must preserve a dispatcher case',
  );
  assert.deepEqual(
    dispatchedActions.filter((action) => !registeredActions.includes(action)),
    [],
    'the dispatcher must not expose actions outside the canonical allowlist',
  );
}

validateStructural(sources);

const policyModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpile(paths.payloadPolicy, sources.payloadPolicy),
).toString('base64')}`;
const actionNamesModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpile(paths.actionNames, sources.actionNames),
).toString('base64')}`;
const policy = await import(policyModuleUrl);
const actionNames = await import(actionNamesModuleUrl);

const validBody = JSON.stringify({ action: 'version' });
const boundedBody = await policy.readBoundedRssWebhookBody(
  new Request('https://example.test/admin-actions', { method: 'POST', body: validBody }),
);
const parsedBody = policy.parseBoundedAdminActionJson(boundedBody.text);
assert.deepEqual(parsedBody, { action: 'version' }, 'valid admin action body must remain accepted');
assert.equal(actionNames.isAdminActionName(parsedBody.action), true, 'valid action must remain in the canonical allowlist');

const compatibleSettings = {
  action: 'save_settings',
  key: 'x_posting_config',
  value: {
    hashtag_pool: Array.from({ length: 100 }, (_, index) => `tag-${index}`),
  },
};
assert.deepEqual(
  policy.parseBoundedAdminActionJson(JSON.stringify(compatibleSettings)),
  compatibleSettings,
  'supported settings payloads larger than the RSS item cap must remain accepted',
);

function expectPolicyCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

expectPolicyCode(
  () => policy.parseBoundedAdminActionJson(JSON.stringify({ action: 'version', values: Array(257).fill(0) })),
  'rss_webhook_json_shape_invalid',
);
expectPolicyCode(
  () => policy.parseBoundedAdminActionJson('{"__proto__": {}}'),
  'rss_webhook_json_key_blocked',
);
await assert.rejects(
  () => policy.readBoundedRssWebhookBody(new Request('https://example.test/admin-actions', {
    method: 'POST',
    headers: { 'content-length': String(policy.MAX_RSS_WEBHOOK_BODY_BYTES + 1) },
  })),
  (error) => error?.code === 'rss_webhook_content_length_exceeded',
  'oversized admin bodies must be rejected before body read',
);
await assert.rejects(
  () => policy.readBoundedRssWebhookBody(new Request('https://example.test/admin-actions', {
    method: 'POST',
    headers: { 'content-encoding': 'gzip' },
  })),
  (error) => error?.code === 'rss_webhook_content_encoding_blocked',
  'compressed admin bodies must be rejected at the shared boundary',
);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      `${label} mutation must fail the source contract`,
    );
  };

  assertRejected('authentication before body read', (source) => ({
    ...source,
    adminActions: (() => {
      const authBlock = [
        '    const authResult = await requireAdmin(req, corsHeaders);',
        '    if (authResult instanceof Response) return authResult;',
        '',
      ].join('\n');
      return source.adminActions
        .replace(authBlock, '')
        .replace(
          '      const boundedBody = await readBoundedRssWebhookBody(req);',
          `      const boundedBody = await readBoundedRssWebhookBody(req);\n${authBlock}`,
        );
    })(),
  }));
  assertRejected('bounded body reader', (source) => ({
    ...source,
    adminActions: source.adminActions.replace(
      'const boundedBody = await readBoundedRssWebhookBody(req);',
      'const boundedBody = { text: await req.text() };',
    ),
  }));
  assertRejected('canonical action allowlist', (source) => ({
    ...source,
    adminActions: source.adminActions.replace('if (!isAdminActionName(requestedAction))', 'if (false)'),
  }));
  assertRejected('complete action dispatcher', (source) => ({
    ...source,
    adminActions: source.adminActions.replace("case 'version'", "case 'version_removed'"),
  }));
  assertRejected('safe Sentry action attribution', (source) => ({
    ...source,
    adminActions: source.adminActions.replace('actionForSentry = action;', 'actionForSentry = requestedAction;'),
  }));
  assertRejected('safe unexpected-error response', (source) => ({
    ...source,
    adminActions: source.adminActions.replace(
      "return jsonResponse({ error: 'Admin action failed', code }, 500);",
      'return jsonResponse({ error: error.message }, 500);',
    ),
  }));
  assertRejected('admin array limit', (source) => ({
    ...source,
    payloadPolicy: source.payloadPolicy.replace(
      'MAX_ADMIN_ACTION_JSON_ARRAY_ITEMS = 256',
      'MAX_ADMIN_ACTION_JSON_ARRAY_ITEMS = Number.MAX_SAFE_INTEGER',
    ),
  }));
  selfTest = 'pass';
}

console.log(`ADMIN_ACTION_INPUT_POLICY_SOURCE_CONTRACT_PASS auth=before-body bytes=1048576 action=allowlisted telemetry=stable selfTest=${selfTest}`);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/xApiActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_API_CREDENTIALS_READ_SOURCE_CONTRACT_FAIL ${message}`);
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertProviderFailureBoundary(handler, name, operation, responseEnd) {
  const providerFailure = section(
    handler,
    "if (!resp.ok) {",
    responseEnd,
    `${name} provider failure`,
  );
  if (!providerFailure.includes(`const errorCode = xApiFailureCode("${operation}", resp.status);`)) {
    fail(`${name}: provider failure must use a bounded operation code`);
  }
  if (!providerFailure.includes("error: errorCode,")) {
    fail(`${name}: provider failure must return the bounded operation code`);
  }
  if (providerFailure.includes("respText.slice") || providerFailure.includes("raw: respBody") || providerFailure.includes("response: respBody")) {
    fail(`${name}: provider failure must not return upstream response text or body`);
  }
  if (!providerFailure.includes("status: 502,")) {
    fail(`${name}: provider failure must use a non-success response status`);
  }

  const catchStart = handler.lastIndexOf("} catch (");
  if (catchStart < 0) fail(`${name}: request catch marker is missing`);
  const requestCatch = handler.slice(catchStart);
  if (!requestCatch.includes(`const errorCode = "${operation}_request_failed";`) ||
      !requestCatch.includes("error: errorCode,") ||
      !requestCatch.includes("return { body: { ok: false, error: errorCode }, status: 502 };")) {
    fail(`${name}: request catch must return a stable bounded error`);
  }
  if (requestCatch.includes("(e as Error).message") || requestCatch.includes("respBody") || requestCatch.includes("respText")) {
    fail(`${name}: request catch must not expose upstream or thrown error text`);
  }
}

function parse(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("TypeScript parse diagnostics");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("TypeScript transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parse(source);
  const handler = section(
    source,
    "export async function verifyXCredentialsAdminAction(",
    "export async function sendTestTweetAdminAction(",
    `${label} verify credentials handler`,
  );
  const controlsQuery = handler.indexOf('const { data: controlsRow, error: controlsError }');
  const controlsGuard = handler.indexOf('if (controlsError)', controlsQuery);
  const cachedQuery = handler.indexOf('const { data: cachedRow, error: cachedError }');
  const cachedGuard = handler.indexOf('if (cachedError)', cachedQuery);
  const providerCall = handler.indexOf('const url = "https://api.x.com/2/users/me";');
  if (controlsQuery < 0 || controlsGuard < controlsQuery) fail(`${label}: controls read must retain its error result and guard`);
  if (cachedQuery < 0 || cachedGuard < cachedQuery) fail(`${label}: self-id cache read must retain its error result and guard`);
  if (providerCall < 0 || controlsGuard > providerCall || cachedGuard > providerCall) fail(`${label}: settings read guards must precede provider work`);
  for (const marker of [
    'body: { ok: false, error: "x_api_controls_read_failed" },',
    'body: { ok: false, error: "x_self_id_read_failed" },',
    'const { error: cacheWriteError } = await table(supabase, "settings").upsert({',
    'if (cacheWriteError)',
    'error: "x_self_id_cache_write_failed",',
    'provider_verified: true,',
  ]) if (!handler.includes(marker)) fail(`${label}: missing ${marker}`);
  if ((handler.match(/status: 503,/g) ?? []).length < 3) {
    fail(`${label}: settings and cache persistence failures must use stable 503 responses`);
  }
  const cacheGuard = handler.indexOf('if (cacheWriteError)');
  const providerSuccess = handler.indexOf('return {\n      body: {\n        ok: true,\n        id: user?.id,');
  if (cacheGuard < 0 || providerSuccess < 0 || cacheGuard > providerSuccess) {
    fail(`${label}: cache write failure must be returned before success`);
  }

  const testTweet = section(
    source,
    "export async function sendTestTweetAdminAction(",
    "export async function testHydrateTweetAdminAction(",
    `${label} test tweet handler`,
  );
  const testHydrate = source.slice(source.indexOf("export async function testHydrateTweetAdminAction("));
  for (const [handler, name, reason] of [
    [testTweet, "test tweet", "owned_writes_disabled"],
    [testHydrate, "test hydrate", "owned_reads_disabled"],
  ]) {
    const controlsQueryIndex = handler.indexOf('const { data: controlsRow, error: controlsError }');
    const controlsGuardIndex = handler.indexOf('if (controlsError)', controlsQueryIndex);
    const controlDecisionIndex = handler.indexOf('if (!isMyXEnabled(asRecord(asRecord(controlsRow).value)))');
    const credsIndex = handler.indexOf('const creds = getXCreds(deps);');
    if (controlsQueryIndex < 0 || controlsGuardIndex < controlsQueryIndex || controlDecisionIndex < 0) {
      fail(`${label}: ${name} must read and enforce x_api_controls`);
    }
    if (credsIndex < 0 || controlsGuardIndex > credsIndex || controlDecisionIndex > credsIndex) {
      fail(`${label}: ${name} controls must be enforced before credentials/provider work`);
    }
    if (!handler.includes(`reason: "${reason}",`)) fail(`${label}: ${name} disabled response is missing`);
    if (!handler.includes('error: "x_api_controls_read_failed"')) fail(`${label}: ${name} controls read failure is missing`);
  }
  if (!testTweet.includes('if (!created || typeof created.id !== "string" || created.id.trim().length === 0)') ||
      !testTweet.includes('error: "x_provider_invalid_response"') ||
      !testTweet.includes('status: 502,')) {
    fail(`${label}: test tweet provider response shape must fail closed`);
  }
  if (!testHydrate.includes('if (!data || typeof data !== "object" || Array.isArray(data))') ||
      !testHydrate.includes('error: "x_provider_invalid_response"')) {
    fail(`${label}: test hydrate provider response shape must fail closed`);
  }

  if (!source.includes("function boundedHttpStatus(value: unknown): number") ||
      !source.includes("function xApiFailureCode(operation: string, status?: unknown): string") ||
      !source.includes("function safeXApiEventError(value: unknown")) {
    fail(`${label}: X API failure telemetry must have bounded helpers`);
  }
  if (!source.includes("error: input.error\n      ? safeXApiEventError(input.error)")) {
    fail(`${label}: X API event errors must be normalized before persistence`);
  }
  assertProviderFailureBoundary(testTweet, "test tweet", "x_test_tweet", "    const created =");
  assertProviderFailureBoundary(testHydrate, "test hydrate", "x_hydrate", "    const data =");
  assertProviderFailureBoundary(handler, "verify credentials", "x_credentials", "    const user =");
  if (handler.includes("raw: parsedBody") ||
      testTweet.includes("response: respBody") ||
      testHydrate.includes("raw: respBody")) {
    fail(`${label}: successful X admin envelopes must not forward raw provider bodies`);
  }
  if (!handler.includes('typeof user.id !== "string" || user.id.trim().length === 0') ||
      !handler.includes('error: "x_provider_invalid_response"')) {
    fail(`${label}: verify credentials provider response shape must fail closed`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-api-credentials-read"] !== "node scripts/check-x-api-credentials-read-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-api-credentials-read")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("X_API_CREDENTIALS_READ_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (controlsError) {',
      'if (false) {',
    ),
  }), "controls read guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (cachedError) {',
      'if (false) {',
    ),
  }), "self-id cache read guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (cacheWriteError) {',
      'if (false) {',
    ),
  }), "self-id cache write guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!isMyXEnabled(asRecord(asRecord(controlsRow).value)))',
      'if (false)',
    ),
  }), "owned X test-action control removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'const { data: controlsRow, error: controlsError } = await table(supabase, "settings").select(',
      'const { data: controlsRow } = await table(supabase, "settings").select(',
    ),
  }), "owned X test-action settings error result removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!created || typeof created.id !== "string" || created.id.trim().length === 0)',
      'if (false)',
    ),
  }), "test tweet provider response guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!data || typeof data !== "object" || Array.isArray(data))',
      'if (false)',
    ),
  }), "test hydrate provider response guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'status: 503,\n    };\n  }\n  const controls',
      'status: 200,\n    };\n  }\n  const controls',
    ),
  }), "controls failure status weakening");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'error: errorCode,\n        },\n        status: 502,\n      };\n    }\n    const user',
      'error: text.slice(0, 300), raw: parsedBody,\n        },\n        status: 502,\n      };\n    }\n    const user',
    ),
  }), "verify provider raw failure forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'typeof user.id !== "string" || user.id.trim().length === 0',
      'false',
    ),
  }), "verify provider response shape guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'error: errorCode,\n        },\n        status: 502,\n      };\n    }\n    const created',
      'error: respText.slice(0, 300), response: respBody,\n        },\n        status: 502,\n      };\n    }\n    const created',
    ),
  }), "test tweet provider raw failure forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'error: errorCode,\n        },\n        status: 502,\n      };\n    }\n    const data',
      'error: respText.slice(0, 300), raw: respBody,\n        },\n        status: 502,\n      };\n    }\n    const data',
    ),
  }), "test hydrate provider raw failure forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'return { body: { ok: false, error: errorCode }, status: 502 };',
      'return { body: { ok: false, error: (e as Error).message }, status: 502 };',
    ),
  }), "request catch raw error forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'name: user?.name,\n      },',
      'name: user?.name,\n        raw: parsedBody,\n      },',
    ),
  }), "verify successful raw response forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'return { body: { ok: true, tweet_id: created.id } };',
      'return { body: { ok: true, tweet_id: created.id, response: respBody } };',
    ),
  }), "test tweet successful raw response forwarding");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'note_tweet: data?.note_tweet?.text,\n      },',
      'note_tweet: data?.note_tweet?.text,\n        raw: respBody,\n      },',
    ),
  }), "test hydrate successful raw response forwarding");
}

console.log(`X_API_CREDENTIALS_READ_SOURCE_CONTRACT_PASS settingsReadFailClosed=true cacheWriteFailClosed=true ownedTestActionsFailClosed=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

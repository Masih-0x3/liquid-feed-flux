import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const paths = {
  action: join(repoRoot, 'supabase/functions/admin-actions/manualVideoIntakeActions.ts'),
  actionTest: join(repoRoot, 'supabase/functions/admin-actions/manualVideoIntakeActions.test.ts'),
  hook: join(repoRoot, 'src/hooks/useManualVideoIntakeData.ts'),
  panel: join(repoRoot, 'src/components/video/ManualVideoIntakePanel.tsx'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]));
}

function fail(message) {
  throw new Error(`MANUAL_POST_SNAPSHOT_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertNotIncludes(source, unexpected, label) {
  if (source.includes(unexpected)) fail(`${label} must not include: ${unexpected}`);
}

function assertTranspiles(path, source, scriptKind = typescript.ScriptKind.TS) {
  const parsed = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, scriptKind);
  if (parsed.parseDiagnostics.length > 0) fail(`${path} has TypeScript parse diagnostics`);
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail(`${path} has TypeScript transpilation diagnostics`);
}

function section(source, marker, label) {
  const index = source.indexOf(marker);
  if (index < 0) fail(`${label} marker is missing`);
  return source.slice(index);
}

function assertContract(source) {
  assertTranspiles(paths.action, source.action);
  assertTranspiles(paths.actionTest, source.actionTest);
  assertTranspiles(paths.hook, source.hook);
  assertTranspiles(paths.panel, source.panel, typescript.ScriptKind.TSX);

  const getAction = section(source.action, 'export async function manualVideoIntakeGetAdminAction(', 'manual detail action');
  const postAction = section(source.action, 'export async function manualVideoIntakePostAdminAction(', 'manual post action');

  assertIncludes(source.action, 'selectedRenderId?: string | null;', 'snapshot selected render option');
  assertIncludes(source.action, 'const completedOutputRenders = refreshedRenderRows.filter((row) =>', 'completed render collection');
  assertIncludes(source.action, 'const outputRender = requestedRenderId', 'selected render output routing');
  assertIncludes(source.action, '    ? completedOutputRenders.find((row) => String(row.id) === requestedRenderId) ?? null', 'selected render preview branch');
  assertIncludes(source.action, 'render_id: typeof outputRender?.id === "string" ? outputRender.id : null,', 'preview render identity');
  assertNotIncludes(source.action, '?? latestRender;', 'preview must not fall back to latest non-output render');
  assertIncludes(getAction, 'queueRender: body.queue_render === true,', 'detail render work must be explicit');
  assertIncludes(getAction, 'updateStatus: false,', 'detail read must not mutate status');
  assertIncludes(getAction, 'selectedRenderId: typeof body.render_id === "string" ? body.render_id : null,', 'detail selection identity');

  const configIndex = postAction.indexOf('const supabaseUrl = readEnv("SUPABASE_URL", deps).replace(/\\/+$/, "");');
  const snapshotIndex = postAction.indexOf('const snapshot = await assembleSnapshot(supabase, intake, deps, {');
  assert.ok(configIndex >= 0 && snapshotIndex >= 0 && configIndex < snapshotIndex, 'configuration must fail before snapshot work');
  assertIncludes(postAction, 'if (!selectedRenderId) return { body: { ok: false, error: "render_id is required before posting" }, status: 400 };', 'explicit post render id');
  assertIncludes(postAction, 'queueRender: false,', 'post must not queue a render as a side effect');
  assertIncludes(postAction, 'updateStatus: false,', 'post preflight snapshot must not mutate status');
  assertIncludes(postAction, 'selectedRenderId,', 'post snapshot selected render');
  assertNotIncludes(postAction, 'snapshot.intake.selected_render_id', 'post render fallback');
  assertNotIncludes(postAction, 'snapshot.latest_render', 'post latest-render fallback');
  assertIncludes(postAction, 'const requestedCaption = typeof body.caption === "string" ? body.caption.trim() : "";', 'saved caption confirmation');
  assertIncludes(postAction, 'if (requestedCaption !== caption) {', 'stale caption rejection');
  assertIncludes(postAction, 'const selectedRender = asRows(snapshot.renders).find((row) =>', 'completed selected output validation');
  assertIncludes(postAction, 'if (safety.x_posting_enabled !== true || safety.x_allow_video !== true) {', 'server posting guard');
  assertIncludes(postAction, 'if (safety.duplicate_blocked === true && snapshot.intake.duplicate_override !== true) {', 'server duplicate guard');
  assertIncludes(postAction, 'const { error: requestStateError } = await table(supabase, "manual_video_intakes").update({', 'checked post-request state write');
  assertIncludes(postAction, 'const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599', 'bounded x-poster failure status');
  assertIncludes(postAction, 'last_error: `x-poster_http_${status}`', 'safe x-poster failure persistence');
  assertIncludes(postAction, 'code: "x_poster_http_failure"', 'stable x-poster failure response code');
  assertIncludes(postAction, 'status: 502,', 'x-poster failure must not return an HTTP success');
  assertNotIncludes(postAction, 'raw: parsed', 'x-poster failure must not return raw provider response');
  assertNotIncludes(postAction, 'rawText.slice(0, 500)', 'x-poster failure must not persist raw provider response');
  assertIncludes(postAction, 'return { body: { ok: true, posted: true } };', 'bounded x-poster success envelope');
  assertNotIncludes(postAction, 'result: parsed', 'x-poster success must not return raw provider response');
  assertIncludes(postAction, 'const responseRecord = parsed && typeof parsed === "object" && !Array.isArray(parsed)', 'x-poster success envelope shape');
  assertIncludes(postAction, 'if (responseRecord?.ok !== true) {', 'x-poster unconfirmed result guard');
  assertIncludes(postAction, 'code: "x_poster_unconfirmed"', 'stable x-poster unconfirmed code');
  assertIncludes(source.actionTest, 'manual post action fails before changing intake state when server posting configuration is unavailable', 'configuration regression fixture');

  assertIncludes(source.hook, 'render_id: string | null;', 'typed preview render identity');
  assertIncludes(source.hook, "queryKey: ['manual-video-intakes', 'detail', input.intakeId ?? '', input.tweetId ?? '', input.renderId ?? '']", 'selection-keyed manual detail query');
  assertIncludes(source.hook, 'render_id: input.renderId ?? undefined,', 'manual detail render request');
  assertIncludes(source.hook, 'refresh_dedupe: false,', 'manual detail read avoids dedupe work');
  assertIncludes(source.panel, 'type PendingManualPostSnapshot = {', 'frozen UI publish snapshot');
  assertIncludes(source.panel, 'renderId: selectedRenderId || null,', 'panel fetches selected preview');
  assertIncludes(source.panel, 'const selectedRender = (snapshot?.renders ?? []).find((row) => row.id === selectedRenderId) ?? null;', 'panel no selected-render fallback');
  assertIncludes(source.panel, 'snapshot?.preview.render_id === selectedRender.id', 'selected preview identity guard');
  assertIncludes(source.panel, 'const snapshotIntakeId = snapshot?.intake.id;', 'stable manual snapshot identity');
  assertIncludes(source.panel, '}, [savedCaption, savedDuplicateOverride, savedDuplicateOverrideReason, snapshotIntakeId]);', 'manual draft reset only follows saved fields');
  assertIncludes(source.panel, 'const hasUnsavedCaption = Boolean(', 'unsaved caption guard');
  assertIncludes(source.panel, 'setPostSnapshot({', 'freeze post confirmation');
  assertIncludes(source.panel, 'This creates one public X post from the frozen render and saved caption below.', 'explicit confirmation copy');
  assertIncludes(source.panel, 'Save caption before posting', 'visible unsaved caption state');

  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.['check:manual-post-snapshot'],
    'node scripts/check-manual-post-snapshot-contract.mjs',
    'package script must retain manual-post snapshot contract',
  );
  assertIncludes(source.ci, '- run: npm run check:manual-post-snapshot', 'hosted CI manual-post snapshot contract');
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()));
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === '1') {
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('      queueRender: body.queue_render === true,', '      queueRender: true,'),
  }), 'detail read queue side effect');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('    queueRender: false,\n    updateStatus: false,\n    selectedRenderId,', '    queueRender: true,\n    updateStatus: true,'),
  }), 'post snapshot side effects');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('  if (requestedCaption !== caption) {', '  if (requestedCaption === caption) {'),
  }), 'stale caption rejection');
  assertRejects((source) => ({
    ...source,
    action: source.action.replaceAll('status: 502,', 'status: 200,'),
  }), 'x-poster failure success status');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('last_error: `x-poster_http_${status}`', 'last_error: `x-poster ${resp.status}: ${rawText.slice(0, 500)}`'),
  }), 'x-poster raw failure persistence');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('code: "x_poster_http_failure"', 'raw: parsed'),
  }), 'x-poster raw failure response');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('if (responseRecord?.ok !== true) {', 'if (false) {'),
  }), 'x-poster unconfirmed success mutant');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('return { body: { ok: true, posted: true } };', 'return { body: { ok: true, result: parsed } };'),
  }), 'x-poster raw success response');
  assertRejects((source) => ({
    ...source,
    action: source.action.replace('    ? completedOutputRenders.find((row) => String(row.id) === requestedRenderId) ?? null', '    ? completedOutputRenders[0] ?? null'),
  }), 'selected render preview identity');
  assertRejects((source) => ({
    ...source,
    panel: source.panel.replace('snapshot?.preview.render_id === selectedRender.id', 'snapshot?.preview.render_id !== selectedRender.id'),
  }), 'selected preview identity guard');
  assertRejects((source) => ({
    ...source,
    panel: source.panel.replace('}, [savedCaption, savedDuplicateOverride, savedDuplicateOverrideReason, snapshotIntakeId]);', '}, [snapshot]);'),
  }), 'manual draft reset follows unstable query object');
  assertRejects((source) => ({
    ...source,
    hook: source.hook.replace("input.tweetId ?? '', input.renderId ?? ''", "input.tweetId ?? ''"),
  }), 'selection-keyed manual detail query');
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:manual-post-snapshot\n', ''),
  }), 'hosted CI manual-post snapshot contract');
}

console.log(`MANUAL_POST_SNAPSHOT_SOURCE_CONTRACT_PASS selectedPreview=explicit postPreflight=fail-closed selfTest=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);

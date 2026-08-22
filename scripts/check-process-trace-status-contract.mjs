import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const paths = {
  traceMap: join(repoRoot, 'src/lib/processTraceMap.ts'),
  hud: join(repoRoot, 'src/components/monitoring/MonitoringProcessHud.tsx'),
  drawer: join(repoRoot, 'src/components/monitoring/MonitoringDetailDrawer.tsx'),
  css: join(repoRoot, 'src/index.css'),
  traceMapTest: join(repoRoot, 'src/test/process-trace-map.test.ts'),
  componentTest: join(repoRoot, 'src/test/monitoring-components.test.tsx'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, readFileSync(filePath, 'utf8')]));
}

function fail(message) {
  throw new Error(`PROCESS_TRACE_STATUS_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(`${label} must not include: ${unexpected}`);
}

function assertTranspiles(filePath, source, scriptKind = typescript.ScriptKind.TS) {
  const sourceFile = typescript.createSourceFile(filePath, source, typescript.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) fail(`${filePath} has TypeScript parse diagnostics`);
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: filePath,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail(`${filePath} has TypeScript transpilation diagnostics`);
}

async function loadTraceMap(source) {
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: paths.traceMap,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail('processTraceMap module could not transpile');
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString('base64')}`);
}

function entry(overrides = {}) {
  return {
    tweet_id: 'tweet-1',
    created_at: '2026-07-23T12:00:00.000Z',
    author_handle: 'source',
    account_handle: 'source',
    monitoring_state: null,
    delivery_decision: null,
    delivery_status: null,
    delivery_job_status: null,
    x_status: null,
    x_error: null,
    x_skip_reason: null,
    x_tweet_id: null,
    x_posted_at: null,
    is_delivered: false,
    telegram_message_ids: [],
    delivery_error: null,
    translation_error: null,
    translation_job_status: null,
    dedupe_status: null,
    dup_of_tweet_id: null,
    dedupe_reason: null,
    enrich_status: null,
    process_observability: null,
    ...overrides,
  };
}

function node(map, id) {
  const match = map.nodes.find((item) => item.id === id);
  assert.ok(match, `expected ${id} node`);
  return match;
}

async function assertTraceBehavior(trace) {
  const stalePendingSkip = trace.buildProcessTraceMap(entry({
    delivery_decision: 'skip',
    delivery_status: 'pending',
    delivery_job_status: 'pending',
    x_status: 'pending',
    monitoring_state: {
      code: 'below_threshold',
      telegram_state: 'pending',
      x_state: 'pending',
    },
  }));
  for (const id of ['telegram', 'x-dispatch', 'x-post']) {
    assert.equal(node(stalePendingSkip, id).status, 'skipped', `${id} must not retain stale pending after a terminal skip`);
    assert.equal(node(stalePendingSkip, id).skipReason, 'below_threshold', `${id} must retain terminal skip reason`);
  }
  assert.equal(stalePendingSkip.summary.status, 'skipped', 'shared trace summary must expose the terminal skip');

  const deliveredDespiteContradiction = trace.buildProcessTraceMap(entry({
    delivery_decision: 'skip',
    delivery_status: 'pending',
    is_delivered: true,
    telegram_message_ids: ['123'],
    x_status: 'posted',
    x_tweet_id: '2056',
    x_posted_at: '2026-07-23T12:05:00.000Z',
    monitoring_state: {
      code: 'below_threshold',
      telegram_state: 'delivered',
      x_state: 'posted',
    },
  }));
  for (const id of ['telegram', 'x-dispatch', 'x-post']) {
    assert.equal(node(deliveredDespiteContradiction, id).status, 'completed', `${id} must preserve actual terminal delivery evidence`);
  }
  assert.equal(deliveredDespiteContradiction.summary.status, 'completed', 'shared trace summary must preserve actual terminal delivery evidence');

  const timelineDeliveredDespiteContradiction = trace.buildProcessTraceMap(
    entry({
      delivery_decision: 'skip',
      delivery_status: 'pending',
      monitoring_state: {
        code: 'below_threshold',
        telegram_state: null,
        x_state: null,
      },
    }),
    [{
      step: 'telegram_delivery',
      status: 'completed',
      started_at: '2026-07-23T12:04:00.000Z',
      ended_at: '2026-07-23T12:05:00.000Z',
      error: null,
      meta: {},
    }],
  );
  assert.equal(node(timelineDeliveredDespiteContradiction, 'telegram').status, 'completed', 'timeline delivery completion must remain terminal evidence');
  assert.equal(timelineDeliveredDespiteContradiction.summary.status, 'completed', 'timeline delivery completion must dominate a stale terminal skip');

  const pending = trace.buildProcessTraceMap(entry({
    delivery_decision: 'deliver',
    translation_job_status: 'pending',
  }));
  assert.equal(node(pending, 'translate').tone, 'muted', 'pending translation must use waiting tone');
  assert.equal(pending.summary.running, 0, 'pending cannot inflate running summary count');
  assert.ok(pending.summary.pending > 0, 'pending summary count must be explicit');
  assert.equal(pending.summary.status, 'pending', 'pending summary status must remain pending');
  assert.equal(trace.isProcessTraceRunning('pending'), false, 'pending cannot be live/running');
  assert.equal(trace.isProcessTraceRunning('running'), true, 'running must remain live/running');
  assert.equal(trace.isProcessTraceWaiting('pending'), true, 'pending must be waiting');
  assert.equal(trace.processTraceStatusTone('pending'), 'muted', 'pending must be neutral/muted');

  const uncertainDuplicate = trace.buildProcessTraceMap(entry({
    dedupe_status: 'uncertain',
    dedupe_reason: 'needs manual duplicate review',
  }));
  assert.equal(node(uncertainDuplicate, 'dedupe').status, 'blocked', 'uncertain duplicate must be explicit review, not active work');
  assert.equal(uncertainDuplicate.summary.status, 'blocked', 'uncertain duplicate summary must be blocked');

  const manual = trace.buildProcessTraceMap(entry({
    delivery_decision: 'deliver',
    enrich_status: 'awaiting_approval',
  }));
  assert.equal(node(manual, 'enrich').kind, 'manual', 'manual enrichment cannot be typed as an AI node');
}

async function assertContract(source) {
  assertTranspiles(paths.traceMap, source.traceMap);
  assertTranspiles(paths.hud, source.hud, typescript.ScriptKind.TSX);
  assertTranspiles(paths.drawer, source.drawer, typescript.ScriptKind.TSX);
  assertTranspiles(paths.traceMapTest, source.traceMapTest);
  assertTranspiles(paths.componentTest, source.componentTest, typescript.ScriptKind.TSX);

  assertIncludes(source.traceMap, 'export type ProcessTraceNodeKind = "system" | "ai" | "manual" | "delivery" | "export";', 'manual trace node kind');
  assertIncludes(source.traceMap, '{ id: "enrich", label: "Manual enrichment", shortLabel: "Manual enrich", kind: "manual", optional: true },', 'manual enrichment node');
  assertIncludes(source.traceMap, 'pending: { label: "Pending", tone: "muted", priority: 50 }', 'pending status presentation');
  assertIncludes(source.traceMap, 'export function isProcessTraceRunning(status: ProcessTraceStatus): boolean {', 'running status helper');
  assertIncludes(source.traceMap, 'return status === "running";', 'running-only status helper');
  assertIncludes(source.traceMap, 'export function isProcessTraceWaiting(status: ProcessTraceStatus): boolean {', 'waiting status helper');
  assertIncludes(source.traceMap, 'const DOWNSTREAM_DELIVERY_NODE_IDS: ProcessTraceNodeId[] = ["telegram", "x-dispatch", "x-post"];', 'terminal delivery node set');
  assertIncludes(source.traceMap, 'function applyTerminalDownstreamSkip(nodes: Map<ProcessTraceNodeId, ProcessTraceNode>, entry: MonitoringEntry)', 'terminal skip helper');
  assertIncludes(source.traceMap, 'applyTerminalDownstreamSkip(nodes, entry);', 'terminal skip invocation');
  assertIncludes(source.traceMap, 'entry.dedupe_status === "uncertain") {\n    updateNode(dedupe, {\n      status: "blocked"', 'uncertain duplicate review state');
  assertIncludes(source.traceMap, 'export function processTraceTerminalStatus(', 'shared terminal trace status helper');
  assertIncludes(source.traceMap, 'const terminalStatus = processTraceTerminalStatus(entry, summary, visibleNodes);', 'shared summary terminal status');
  assertIncludes(source.traceMap, 'const running = nodes.filter((node) => node.status === "running").length;', 'running-only summary count');
  assertIncludes(source.traceMap, 'const pending = nodes.filter((node) => node.status === "pending").length;', 'explicit pending summary count');
  assertNotIncludes(source.traceMap, 'node.status === "running" || node.status === "pending"', 'pending cannot inflate running summary count');

  assertIncludes(source.hud, 'if (isProcessTraceRunning(status)) return "run";', 'HUD active status mapping');
  assertIncludes(source.hud, 'const status = processTraceTerminalStatus(entry, traceMap.summary, traceMap.nodes);', 'HUD shared terminal status adapter');
  assertIncludes(source.hud, 'if (kind === "manual") return <Hand className={className} />;', 'manual HUD glyph');
  assertIncludes(source.hud, 'className={cn("xot-hud-chip", `status-${node.status}`)}', 'status-specific HUD chip class');
  assertIncludes(source.hud, '<span className="xot-hud-chip-status">{node.statusLabel}</span>', 'visible HUD chip status label');
  assertNotIncludes(source.hud, 'node.status !== "unknown" && "used"', 'flattened HUD chip class');
  assertIncludes(source.drawer, 'processTraceStatusTone(normalizeProcessTraceStatus(status))', 'drawer status adapter');
  assert.ok(require('lucide-react').Hand, 'manual HUD glyph must be exported by the installed icon package');

  for (const status of ['completed', 'running', 'pending', 'blocked', 'skipped', 'failed']) {
    assertIncludes(source.css, `.xot-hud-chip.status-${status}`, `HUD ${status} chip style`);
  }
  assertNotIncludes(source.css, '.xot-hud-chip.used', 'flattened green chip style');
  assertIncludes(source.css, '.xot-hud-wf-label.manual .xot-hud-wf-icon', 'manual HUD visual distinction');
  assertIncludes(source.traceMapTest, 'lets a terminal skip decision override stale downstream pending fields', 'trace skip regression fixture');
  assertIncludes(source.componentTest, 'renders pending HUD stages as waiting rather than active or completed', 'HUD pending regression fixture');

  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.['check:process-trace-status'],
    'node scripts/check-process-trace-status-contract.mjs',
    'package script must retain process trace source contract',
  );
  assertIncludes(source.ci, '- run: npm run check:process-trace-status', 'hosted CI process trace source contract');

  await assertTraceBehavior(await loadTraceMap(source.traceMap));
  return { statuses: 7, downstreamNodes: 3 };
}

async function assertRejects(mutator, label) {
  try {
    await assertContract(mutator(sources()));
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

const result = await assertContract(sources());

if (process.env.MUTATION_TEST === '1') {
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('  applyTerminalDownstreamSkip(nodes, entry);\n', ''),
  }), 'terminal skip dominance');
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('  const terminalStatus = processTraceTerminalStatus(entry, summary, visibleNodes);\n', '  const terminalStatus = summary.status;\n'),
  }), 'shared terminal summary status');
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('        status,\n        preserveCompleted: true,\n        detail: `Telegram state ${entry.delivery_status || entry.delivery_job_status || entry.monitoring_state?.telegram_state}.`,', '        status,\n        detail: `Telegram state ${entry.delivery_status || entry.delivery_job_status || entry.monitoring_state?.telegram_state}.`,'),
  }), 'timeline delivery must outrank stale entry pending state');
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('pending: { label: "Pending", tone: "muted", priority: 50 }', 'pending: { label: "Pending", tone: "info", priority: 50 }'),
  }), 'pending neutral presentation');
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('entry.dedupe_status === "uncertain") {\n    updateNode(dedupe, {\n      status: "blocked"', 'entry.dedupe_status === "uncertain") {\n    updateNode(dedupe, {\n      status: "pending"'),
  }), 'uncertain duplicate review state');
  await assertRejects((source) => ({
    ...source,
    traceMap: source.traceMap.replace('kind: "manual", optional: true', 'kind: "ai", optional: true'),
  }), 'manual trace kind');
  await assertRejects((source) => ({
    ...source,
    hud: source.hud.replace('className={cn("xot-hud-chip", `status-${node.status}`)}', 'className={cn("xot-hud-chip")}'),
  }), 'status-specific HUD chip');
  await assertRejects((source) => ({
    ...source,
    css: source.css.replace('.xot-hud-chip.status-pending', '.xot-hud-chip.status-waiting'),
  }), 'pending HUD chip style');
  await assertRejects((source) => ({
    ...source,
    hud: source.hud.replace('if (isProcessTraceRunning(status)) return "run";', 'if (status === "running" || status === "pending") return "run";'),
  }), 'pending active HUD mapping');
  await assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:process-trace-status\n', ''),
  }), 'hosted CI source contract wiring');
}

console.log(`PROCESS_TRACE_STATUS_SOURCE_CONTRACT_PASS statuses=${result.statuses} downstreamNodes=${result.downstreamNodes} selfTest=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);

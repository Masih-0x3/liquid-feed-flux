import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const paths = {
  hook: join(repoRoot, 'src/hooks/useDashboardProcessHudData.ts'),
  dashboard: join(repoRoot, 'src/pages/Dashboard.tsx'),
  test: join(repoRoot, 'src/test/dashboard.test.tsx'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');

function sourceFiles() {
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, readFileSync(filePath, 'utf8')]));
}

function fail(message) {
  throw new Error(`DASHBOARD_HUD_LAZY_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(`${label} must not include: ${unexpected}`);
}

function sliceBetween(input, start, end, label) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) fail(`${label} could not be scoped`);
  return input.slice(startIndex, endIndex);
}

function assertTranspiles(filePath, source) {
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

function assertContract(source) {
  assertTranspiles(paths.hook, source.hook);
  assertTranspiles(paths.dashboard, source.dashboard);
  assertTranspiles(paths.test, source.test);

  assertIncludes(source.hook, 'export type DashboardProcessHudOptions = {', 'HUD hook options');
  assertIncludes(source.hook, 'enabled: boolean;', 'HUD hook options');
  assertIncludes(source.hook, 'export function useDashboardProcessHudData({ enabled }: DashboardProcessHudOptions)', 'HUD hook explicit visibility input');
  assertIncludes(source.hook, 'const enabledRef = useRef(enabled);', 'HUD current visibility ref');
  assertIncludes(source.hook, 'enabledRef.current = enabled;', 'HUD visibility ref update');
  const query = sliceBetween(source.hook, 'const query = useQuery<DashboardProcessHudPayload>({', 'const debouncedInvalidate', 'HUD query');
  assertIncludes(query, 'enabled,', 'HUD query visibility gate');
  assertIncludes(source.hook, 'if (!enabledRef.current) return;', 'HUD realtime callback visibility gate');
  assertIncludes(source.hook, 'if (!enabledRef.current) return;\n      queryClient.invalidateQueries', 'HUD delayed callback visibility gate');
  const realtimeEffect = sliceBetween(source.hook, 'useEffect(() => {', 'return {', 'HUD realtime effect');
  const disabledGate = realtimeEffect.indexOf('if (!enabled) {');
  const channelStart = realtimeEffect.indexOf("const channel = supabase.channel('dashboard-process-hud-realtime');");
  if (disabledGate === -1 || channelStart === -1 || disabledGate > channelStart) {
    fail('HUD realtime subscriptions must be gated before channel creation');
  }
  assertIncludes(realtimeEffect, "const channel = supabase.channel('dashboard-process-hud-realtime');", 'one HUD realtime channel');
  assertIncludes(realtimeEffect, "for (const table of ['posts', 'jobs', 'deliveries', 'x_deliveries', 'workflow_runs', 'ai_call_ledger'])", 'HUD realtime table registry');
  assertIncludes(realtimeEffect, "channel.on('postgres_changes', { event: '*', schema: 'public', table }, debouncedInvalidate);", 'HUD realtime table bindings');
  assertIncludes(realtimeEffect, 'channel.subscribe();', 'HUD realtime subscription');
  assertIncludes(realtimeEffect, 'supabase.removeChannel(channel);', 'HUD realtime cleanup');
  assertIncludes(realtimeEffect, 'clearTimeout(timerRef.current);', 'HUD pending invalidation cleanup');

  assertIncludes(source.dashboard, "const [processHudOpen, setProcessHudOpen] = useState(false);", 'dashboard initially closes HUD');
  assertIncludes(source.dashboard, 'useDashboardProcessHudData({ enabled: processHudOpen })', 'dashboard visibility-scoped HUD hook');
  assertNotIncludes(source.dashboard, 'useDashboardProcessHudData()', 'dashboard unscoped HUD hook');
  const refresh = sliceBetween(source.dashboard, 'const refresh = () => {', '\n\n  if (isLoading)', 'dashboard refresh');
  assertIncludes(refresh, 'if (processHudOpen) processHudQuery.refetch();', 'dashboard refresh visibility gate');
  const collapsible = sliceBetween(source.dashboard, '<Collapsible open={processHudOpen}', '\n\n        <Card className="glass-card">', 'dashboard HUD panel');
  assertIncludes(collapsible, 'onOpenChange={setProcessHudOpen}', 'dashboard HUD open state');
  assertIncludes(collapsible, 'Open process HUD', 'dashboard HUD open affordance');
  assertIncludes(collapsible, '<CollapsibleContent', 'dashboard HUD lazy content boundary');
  assertIncludes(collapsible, '<MonitoringProcessHud', 'dashboard HUD detail inside lazy boundary');

  assertIncludes(source.test, 'toHaveBeenLastCalledWith({ enabled: false })', 'dashboard closed HUD test');
  assertIncludes(source.test, 'toHaveBeenLastCalledWith({ enabled: true })', 'dashboard open HUD test');
  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.['check:dashboard-hud-lazy'],
    'node scripts/check-dashboard-hud-lazy-contract.mjs',
    'package script must retain the HUD source contract',
  );
  assertIncludes(source.ci, '- run: npm run check:dashboard-hud-lazy', 'hosted CI HUD source contract');
  return { subscriptions: 1, initialState: 'closed' };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sourceFiles()));
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

const result = assertContract(sourceFiles());

if (process.env.MUTATION_TEST === '1') {
  assertRejects((source) => ({
    ...source,
    hook: source.hook.replace('    enabled,\n    staleTime:', '    staleTime:'),
  }), 'query visibility gate');
  assertRejects((source) => ({
    ...source,
    hook: source.hook.replace("const channel = supabase.channel('dashboard-process-hud-realtime');", "const channel = supabase.channel('dash-hud-posts');"),
  }), 'stable HUD realtime channel');
  assertRejects((source) => ({
    ...source,
    hook: source.hook.replace("for (const table of ['posts', 'jobs', 'deliveries', 'x_deliveries', 'workflow_runs', 'ai_call_ledger'])", "for (const table of ['posts'])"),
  }), 'complete HUD realtime table registry');
  assertRejects((source) => ({
    ...source,
    hook: source.hook.replaceAll('if (!enabledRef.current) return;', 'if (false) return;'),
  }), 'realtime visibility gate');
  assertRejects((source) => ({
    ...source,
    dashboard: source.dashboard.replace('const [processHudOpen, setProcessHudOpen] = useState(false);', 'const [processHudOpen, setProcessHudOpen] = useState(true);'),
  }), 'initially closed HUD');
  assertRejects((source) => ({
    ...source,
    dashboard: source.dashboard.replace('useDashboardProcessHudData({ enabled: processHudOpen })', 'useDashboardProcessHudData({ enabled: true })'),
  }), 'dashboard visibility-scoped hook');
  assertRejects((source) => ({
    ...source,
    dashboard: source.dashboard.replace('if (processHudOpen) processHudQuery.refetch();', 'processHudQuery.refetch();'),
  }), 'dashboard refresh visibility gate');
  assertRejects((source) => ({
    ...source,
    packageJson: source.packageJson.replace('"check:dashboard-hud-lazy"', '"check:dashboard-hud-removed"'),
  }), 'package source contract wiring');
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:dashboard-hud-lazy\n', ''),
  }), 'hosted CI source contract wiring');
}

console.log(`DASHBOARD_HUD_LAZY_SOURCE_CONTRACT_PASS subscriptions=${result.subscriptions} initialState=${result.initialState}`);

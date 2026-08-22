import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dashboardPath = join(process.cwd(), 'src/pages/Dashboard.tsx');

function fail(message) {
  throw new Error(`E8C_DASHBOARD_HIERARCHY_SOURCE_CONTRACT_FAIL ${message}`);
}

function scopeBetween(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start === -1 || end === -1 || end <= start) fail(`${label} scope is missing or inverted`);
  return { start, end, source: source.slice(start, end + endToken.length) };
}

function assertContains(source, token, label) {
  if (!source.includes(token)) fail(`${label} is missing: ${token}`);
}

function countOccurrences(source, token) {
  return source.split(token).length - 1;
}

function assertInside(scope, token, label) {
  assertContains(scope.source, token, label);
}

function assertExactlyOnce(source, token, label) {
  const count = countOccurrences(source, token);
  if (count !== 1) fail(`${label} must occur exactly once; found ${count}: ${token}`);
}

function validate(source) {
  const cockpit = scopeBetween(source, '<section aria-label="Workflow cockpit"', '</section>', 'workflow cockpit');
  const disclosure = scopeBetween(source, '<details open={diagnosticsOpen}', '</details>', 'diagnostics disclosure');
  const tabsStart = source.indexOf('<Tabs value={activeTab}');
  if (tabsStart === -1) fail('secondary dashboard tabs are missing');

  if (!(cockpit.start < disclosure.start && disclosure.end < tabsStart)) {
    fail('source order must be cockpit, diagnostics disclosure, then secondary tabs');
  }

  for (const [token, label, bindings] of [
    ['Current ingest', 'ingest signal', ['heartbeat.state', 'heartbeat.ageSeconds']],
    ['Queue', 'queue signal', ['queueBreakdown.pending', 'queueBreakdown.running']],
    ['Delivery last 24h', 'delivery signal', ['metrics.postsDelivered', 'metrics.xPosts24h']],
    ['Latest workflow', 'latest workflow signal', ['latestProcessRun', 'latestProcessRun.workflowName']],
  ]) {
    assertInside(cockpit, token, label);
    for (const binding of bindings) assertInside(cockpit, binding, `${label} data binding`);
  }

  assertInside(cockpit, 'primaryAlert.title', 'primary exception title');
  assertInside(cockpit, 'primaryAlert.detail', 'primary exception detail');
  assertInside(cockpit, 'primaryAlert.ctaLabel', 'primary exception CTA');
  assertInside(cockpit, 'onClick={() => navigate(primaryAlert.route)}', 'primary exception route');

  assertContains(source, 'const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);', 'closed-by-default diagnostics state');
  assertContains(source, '<details open={diagnosticsOpen} onToggle={handleDiagnosticsToggle}', 'controlled diagnostics onToggle');
  const toggleHandler = scopeBetween(source, 'const handleDiagnosticsToggle =', '  };', 'diagnostics toggle handler');
  assertInside(toggleHandler, 'const open = event.currentTarget.open;', 'native details open state');
  assertInside(toggleHandler, 'setDiagnosticsOpen(open);', 'diagnostics state update');
  assertInside(toggleHandler, 'if (!open) setProcessHudOpen(false);', 'process HUD reset on diagnostics close');
  assertInside(disclosure, '<summary aria-expanded={diagnosticsOpen}', 'native disclosure summary state');
  assertInside(disclosure, 'triageCards.map', 'triage metric buttons');

  for (const token of ['Process trace detail', 'Limits & Trace Guard', 'Pipeline Speed', 'Resource Risk', 'Pipeline Funnel', 'X Cost Guard']) {
    assertExactlyOnce(source, token, token);
    assertInside(disclosure, token, `${token} disclosure boundary`);
  }

  const headerStart = source.indexOf('<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">');
  const statusWrapperStart = source.indexOf('{statusItems.length > 0 && (');
  if (headerStart === -1 || statusWrapperStart === -1 || headerStart >= statusWrapperStart) {
    fail('dashboard header/status boundaries are missing or inverted');
  }
  const header = { start: headerStart, end: statusWrapperStart, source: source.slice(headerStart, statusWrapperStart) };
  assertInside(header, "'Online'", 'header online chip');
  assertInside(header, "'Offline'", 'header offline chip');
  assertInside(header, 'Updated', 'header updated timestamp');

  const statusItems = scopeBetween(source, 'const statusItems = [', '  ].filter(Boolean)', 'dashboard status items');
  if (/Online|Offline|Updated/.test(statusItems.source)) {
    fail('statusItems must not repeat header Online/Offline/Updated chips');
  }
  assertContains(source, '{statusItems.length > 0 && (', 'conditional dashboard status wrapper');
  assertContains(source.slice(statusWrapperStart), 'statusItems.map((item) => (', 'dashboard status item rendering');

  const tabs = scopeBetween(source, '<Tabs value={activeTab}', '</Tabs>', 'secondary dashboard tabs');
  const tabLabels = [
    '<TabsTrigger value="pipeline">Pipeline</TabsTrigger>',
    '<TabsTrigger value="x">X usage</TabsTrigger>',
    '<TabsTrigger value="controls">Controls</TabsTrigger>',
  ];
  for (const tab of tabLabels) assertExactlyOnce(tabs.source, tab, 'secondary tab');

  return {
    cockpit: 'first-viewport workflow cockpit',
    signals: 4,
    disclosure: 'native details closed',
    secondaryTabsAfterDisclosure: true,
  };
}

function moveFirstScopedBlock(source, startToken, endToken, destination = source.length) {
  const block = scopeBetween(source, startToken, endToken, 'mutation block');
  const withoutBlock = source.slice(0, block.start) + source.slice(block.end + endToken.length);
  const insertion = Math.min(destination, withoutBlock.length);
  return withoutBlock.slice(0, insertion) + block.source + withoutBlock.slice(insertion);
}

const source = readFileSync(dashboardPath, 'utf8');
const result = validate(source);
const disclosureStart = source.indexOf('<details open={diagnosticsOpen}');
const insertBeforeDisclosure = (token) => `${source.slice(0, disclosureStart)}${token}\n${source.slice(disclosureStart)}`;
const moveLabelOutsideDisclosure = (label) => {
  const labelStart = source.indexOf(label);
  if (labelStart === -1) fail(`mutation source label is missing: ${label}`);
  const withoutLabel = source.slice(0, labelStart) + source.slice(labelStart + label.length);
  const outsideStart = withoutLabel.indexOf('<details open={diagnosticsOpen}');
  return `${withoutLabel.slice(0, outsideStart)}${label}\n${withoutLabel.slice(outsideStart)}`;
};

if (process.env.MUTATION_TEST === '1') {
  const rejects = [
    ['missing cockpit name', source.replace('aria-label="Workflow cockpit"', 'aria-label="Dashboard summary"')],
    ['missing ingest signal', source.replace('Current ingest', 'Ingest')],
    ['missing delivery signal', source.replace('Delivery last 24h', 'Delivery')],
    ['missing primary CTA', source.replace('primaryAlert.ctaLabel', 'primaryAlert.actionLabel')],
    ['diagnostics opens by default', source.replace('useState(false);\n  const [processHudOpen', 'useState(true);\n  const [processHudOpen')],
    ['wrong cockpit/disclosure/tab source order', moveFirstScopedBlock(source, '<section aria-label="Workflow cockpit"', '</section>', source.length)],
    ['process detail outside disclosure', insertBeforeDisclosure('Process trace detail')],
    ['limits detail outside disclosure', insertBeforeDisclosure('Limits & Trace Guard')],
    ['speed detail outside disclosure', insertBeforeDisclosure('Pipeline Speed')],
    ['resource detail outside disclosure', insertBeforeDisclosure('Resource Risk')],
    ['funnel moved outside disclosure', moveLabelOutsideDisclosure('<CardTitle className="text-lg font-display text-glass-foreground">Pipeline Funnel</CardTitle>')],
    ['cost guard moved outside disclosure', moveLabelOutsideDisclosure('<CardTitle className="text-lg font-display text-glass-foreground">X Cost Guard</CardTitle>')],
    ['missing HUD reset', source.replace('if (!open) setProcessHudOpen(false);', '')],
    ['duplicate Online status', source.replace('const statusItems = [', "const statusItems = [\n    { label: 'Online', className: '' },")],
    ['unconditional status wrapper', source.replace('{statusItems.length > 0 && (', '(')],
    ['empty status wrapper', source.replace('statusItems.map((item) => (', '[].map((item) => (')],
  ];

  for (const [label, mutated] of rejects) {
    assert.throws(() => validate(mutated), undefined, `mutation must fail: ${label}`);
  }
}

console.log(`E8C_DASHBOARD_HIERARCHY_SOURCE_CONTRACT_PASS signals=${result.signals} disclosure=${result.disclosure} secondaryTabsAfterDisclosure=${result.secondaryTabsAfterDisclosure} mutation=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);

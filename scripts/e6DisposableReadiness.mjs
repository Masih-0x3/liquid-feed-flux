/**
 * Bounded, synchronous readiness gate for disposable Supabase/Postgres runs.
 *
 * The upstream postgres image emits this marker after its initdb phase.  It is
 * deliberately required before readiness or catalog probes so that a running
 * postmaster cannot be mistaken for an initialized disposable database.
 */
export const UPSTREAM_INIT_COMPLETE_MARKER =
  'PostgreSQL init process complete; ready for start up.';

// Compatibility aliases make the contract easy to consume from older scripts.
export const INIT_COMPLETE_MARKER = UPSTREAM_INIT_COMPLETE_MARKER;
export const E6_INIT_COMPLETE_MARKER = UPSTREAM_INIT_COMPLETE_MARKER;

/**
 * Only checks objects guaranteed by the base postgres/Supabase image.  In
 * particular, pg_graphql/graphql are optional and must not be part of E6.
 * Output is one tab-separated row with eight required, non-empty fields.
 */
export const BASE_CATALOG_GATE_QUERY = `
SELECT concat_ws(E'\\t',
  pg_postmaster_start_time()::text,
  current_database(),
  version(),
  (SELECT nspname FROM pg_namespace WHERE nspname = 'extensions'),
  (SELECT extname FROM pg_extension WHERE extname = 'plpgsql'),
  (SELECT oid::text FROM pg_database WHERE datname = 'postgres'),
  (SELECT oid::text FROM pg_roles WHERE rolname = 'postgres'),
  (SELECT oid::text FROM pg_roles WHERE rolname = 'supabase_admin')
);`.trim();

const SAMPLE_FIELDS = Object.freeze([
  'postmasterStartTime',
  'currentDatabase',
  'serverVersion',
  'extensionsNamespace',
  'plpgsqlExtension',
  'postgresDatabaseOid',
  'postgresRoleOid',
  'supabaseAdminRoleOid',
]);
export const CATALOG_SAMPLE_FIELDS = SAMPLE_FIELDS;

/** Return only actual host-port binding records, ignoring exposed-only nulls. */
export function normalizePortBindings(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((record) => record && typeof record === 'object' && Object.keys(record).length > 0)
      .map((record, index) => [String(index), record]);
  }
  if (!raw || typeof raw !== 'object') return [];
  const records = [];
  for (const [port, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const record of value) {
        if (record && typeof record === 'object' && Object.keys(record).length > 0) records.push([port, record]);
      }
    } else if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      records.push([port, value]);
    }
  }
  return records;
}

const MAX_DIAGNOSTIC_LENGTH = 240;
const MAX_SAMPLE_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_MS = 1_000;

function redactedDiagnostic(value) {
  let text;
  try {
    text = value instanceof Error ? value.message : String(value ?? '');
  } catch {
    text = '[unprintable]';
  }
  text = text
    .replace(/(?:postgres(?:ql)?|supabase|database|db|api|service)?[_-]?(?:password|passwd|secret|token|key)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '[no detail]';
  return text.length > MAX_DIAGNOSTIC_LENGTH
    ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`
    : text;
}

function boundedSample(value) {
  const text = redactedDiagnostic(value);
  return text.length > MAX_SAMPLE_LENGTH ? `${text.slice(0, MAX_SAMPLE_LENGTH - 1)}…` : text;
}

function asSampleParts(raw) {
  if (Array.isArray(raw)) return raw.length === SAMPLE_FIELDS.length ? raw : null;
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw).sort();
    const expected = [...SAMPLE_FIELDS].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
    return SAMPLE_FIELDS.map((field) => raw[field]);
  }
  if (typeof raw !== 'string') return null;
  const lines = raw.replace(/\r/g, '').split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return null;
  const firstLine = lines[0];
  // psql -Atq uses the query's tab separator; accepting | keeps the parser
  // useful with the existing scalar helper while remaining strict on arity.
  const separator = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : null;
  if (!separator) return null;
  return firstLine.split(separator);
}

/** Parse exactly one complete eight-field base catalog sample. */
export function parseCatalogSample(raw) {
  const parts = asSampleParts(raw);
  if (!parts || parts.length !== SAMPLE_FIELDS.length) {
    throw new Error('catalog sample is incomplete');
  }
  const values = parts.map((part) => String(part ?? '').trim());
  if (values.some((value) => !value)) {
    throw new Error('catalog sample is incomplete');
  }
  return Object.freeze(Object.fromEntries(SAMPLE_FIELDS.map((field, index) => [field, values[index]])));
}

export const parseBaseCatalogSample = parseCatalogSample;
export const parseCatalogGateSample = parseCatalogSample;

function sameSample(left, right) {
  return left && right && SAMPLE_FIELDS.every((field) => left[field] === right[field]);
}

function getDeadline(now, deadline) {
  const supplied = typeof deadline === 'function' ? deadline() : deadline;
  if (Number.isFinite(supplied)) return supplied;
  return now() + DEFAULT_TIMEOUT_MS;
}

function timeoutError({ initComplete, lastCompleteSample, lastError }) {
  const sample = lastCompleteSample ? JSON.stringify(lastCompleteSample) : 'none';
  return new Error(
    `E6 disposable readiness timed out (initComplete=${Boolean(initComplete)}; ` +
      `lastCompleteSample=${boundedSample(sample)}; lastError=${redactedDiagnostic(lastError)})`,
  );
}

/**
 * Wait synchronously for init completion, pg_isready, and two identical
 * complete catalog samples. All I/O is injected so this state machine remains
 * deterministic and cannot accidentally broaden the E6 acceptance gate.
 */
export function waitForDisposableReadiness({
  readLogs,
  assertReady,
  readSample,
  sleep = () => {},
  now = () => Date.now(),
  deadline,
} = {}) {
  if (typeof readLogs !== 'function' || typeof assertReady !== 'function' || typeof readSample !== 'function') {
    throw new TypeError('readLogs, assertReady, and readSample are required');
  }

  const end = getDeadline(now, deadline);
  let initComplete = false;
  let previousSample = null;
  let lastCompleteSample = null;
  let lastError = 'not attempted';
  function ensureDeadline() {
    return now() < end;
  }

  while (now() < end) {
    try {
      if (!ensureDeadline()) break;
      const logs = readLogs();
      // A callback can consume the entire remaining budget. Do not process
      // its result or invoke a later probe after that point.
      if (!ensureDeadline()) break;
      const logLines = String(logs ?? '').replace(/\r/g, '').split('\n');
      if (logLines.some((line) => line.trim() === UPSTREAM_INIT_COMPLETE_MARKER)) {
        initComplete = true;
      } else if (!initComplete) {
        lastError = 'init-complete marker not observed';
      }
    } catch (error) {
      lastError = redactedDiagnostic(error);
    }

    // Never probe pg_isready or the catalog until initdb has completed.
    if (initComplete) {
      try {
        if (!ensureDeadline()) break;
        const ready = assertReady();
        if (!ensureDeadline()) break;
        if (ready === false) throw new Error('pg_isready reported not ready');
        if (!ensureDeadline()) break;
        const sample = parseCatalogSample(readSample());
        if (!ensureDeadline()) break;
        lastCompleteSample = sample;
        if (sameSample(previousSample, sample)) return sample;
        previousSample = sample;
        lastError = 'catalog sample changed; awaiting a stable repeat';
      } catch (error) {
        lastError = redactedDiagnostic(error);
      }
    }

    if (!ensureDeadline()) break;
    try {
      if (!ensureDeadline()) break;
      sleep(DEFAULT_POLL_MS);
      if (!ensureDeadline()) break;
    } catch (error) {
      lastError = redactedDiagnostic(error);
    }
  }

  throw timeoutError({ initComplete, lastCompleteSample, lastError });
}

export const waitForStableCatalogReady = waitForDisposableReadiness;
export const requireStableCatalogReady = waitForDisposableReadiness;

export { redactedDiagnostic };

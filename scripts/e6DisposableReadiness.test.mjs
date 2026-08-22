import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CATALOG_GATE_QUERY,
  normalizePortBindings,
  UPSTREAM_INIT_COMPLETE_MARKER,
  parseCatalogSample,
  waitForDisposableReadiness,
} from './e6DisposableReadiness.mjs';

const SAMPLE = '2026-08-10 10:00:00+00|db|17.6|extensions|plpgsql|1|10|11';
const OTHER_SAMPLE = '2026-08-10 10:00:01+00|db|17.6|extensions|plpgsql|1|10|11';
const withClock = (steps = 20) => {
  let tick = 0;
  return { now: () => tick, sleep: () => { tick += 1; }, deadline: steps };
};

function manualClock(deadline = 10) {
  let tick = 0;
  return {
    now: () => tick,
    advance: (amount) => { tick += amount; },
    sleep: () => { tick += 1; },
    deadline,
  };
}

test('missing init marker never invokes readiness or sample', () => {
  let readyCalls = 0;
  let sampleCalls = 0;
  const clock = withClock(4);
  assert.throws(
    () => waitForDisposableReadiness({
      readLogs: () => 'database system is ready to accept connections',
      assertReady: () => { readyCalls += 1; },
      readSample: () => { sampleCalls += 1; return SAMPLE; },
      ...clock,
    }),
    /initComplete=false/,
  );
  assert.equal(readyCalls, 0);
  assert.equal(sampleCalls, 0);
});

test('marker, readiness, and two identical samples pass', () => {
  let sampleCalls = 0;
  const result = waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => true,
    readSample: () => { sampleCalls += 1; return SAMPLE; },
    ...withClock(20),
  });
  assert.equal(result.serverVersion, '17.6');
  assert.equal(sampleCalls, 2);
});

test('init marker must be an exact trimmed upstream log line', () => {
  for (const decoy of [
    `prefix ${UPSTREAM_INIT_COMPLETE_MARKER}`,
    `${UPSTREAM_INIT_COMPLETE_MARKER} suffix`,
    `prefix ${UPSTREAM_INIT_COMPLETE_MARKER} suffix`,
  ]) {
    let readyCalls = 0;
    let sampleCalls = 0;
    const clock = manualClock(3);
    assert.throws(() => waitForDisposableReadiness({
      readLogs: () => decoy,
      assertReady: () => { readyCalls += 1; return true; },
      readSample: () => { sampleCalls += 1; return SAMPLE; },
      ...clock,
    }), /initComplete=false/);
    assert.equal(readyCalls, 0);
    assert.equal(sampleCalls, 0);
  }
});

test('marker is accepted only when it occupies a whole trimmed log line', () => {
  let readyCalls = 0;
  const result = waitForDisposableReadiness({
    readLogs: () => `noise\n  ${UPSTREAM_INIT_COMPLETE_MARKER}  \nnoise`,
    assertReady: () => { readyCalls += 1; return true; },
    readSample: () => SAMPLE,
    ...withClock(20),
  });
  assert.equal(result.currentDatabase, 'db');
  assert.equal(readyCalls, 2);
});

test('deadline after readLogs prevents readiness and sample probes', () => {
  const clock = manualClock(10);
  let readyCalls = 0;
  let sampleCalls = 0;
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => {
      clock.advance(11);
      return UPSTREAM_INIT_COMPLETE_MARKER;
    },
    assertReady: () => { readyCalls += 1; return true; },
    readSample: () => { sampleCalls += 1; return SAMPLE; },
    ...clock,
  }), /initComplete=false/);
  assert.equal(readyCalls, 0);
  assert.equal(sampleCalls, 0);
});

test('deadline after assertReady prevents the catalog probe', () => {
  const clock = manualClock(10);
  let sampleCalls = 0;
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => {
      clock.advance(11);
      return true;
    },
    readSample: () => { sampleCalls += 1; return SAMPLE; },
    ...clock,
  }), /initComplete=true/);
  assert.equal(sampleCalls, 0);
});

test('deadline after readSample cannot return a stable sample', () => {
  const clock = manualClock(10);
  let sampleCalls = 0;
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => true,
    readSample: () => {
      sampleCalls += 1;
      clock.advance(11);
      return SAMPLE;
    },
    ...clock,
  }), /lastCompleteSample=none/);
  assert.equal(sampleCalls, 1);
});

test('deadline after sleep prevents the next probe cycle', () => {
  const clock = manualClock(10);
  let logCalls = 0;
  let readyCalls = 0;
  let sampleCalls = 0;
  assert.throws(() => waitForDisposableReadiness({
    ...clock,
    readLogs: () => { logCalls += 1; return UPSTREAM_INIT_COMPLETE_MARKER; },
    assertReady: () => { readyCalls += 1; return true; },
    readSample: () => { sampleCalls += 1; return OTHER_SAMPLE; },
    sleep: () => clock.advance(11),
  }), /lastCompleteSample=/);
  assert.equal(logCalls, 1);
  assert.equal(readyCalls, 1);
  assert.equal(sampleCalls, 1);
});

test('one sample does not pass', () => {
  let calls = 0;
  const clock = withClock(6);
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => true,
    readSample: () => { calls += 1; if (calls === 1) return SAMPLE; throw new Error('sample unavailable'); },
    ...clock,
  }), /lastCompleteSample=/);
  assert.ok(calls > 1);
});

test('changing samples do not pass', () => {
  let calls = 0;
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => true,
    readSample: () => `${calls++} 2026-08-10 10:00:00+00|db|17.6|extensions|plpgsql|1|10|11`,
    ...withClock(6),
  }), /lastCompleteSample=/);
});

test('optional graphql extensions are absent from the gate query', () => {
  assert.doesNotMatch(BASE_CATALOG_GATE_QUERY, /graphql/i);
  assert.doesNotMatch(BASE_CATALOG_GATE_QUERY, /pg_graphql/i);
});

test('port binding normalization ignores exposed-only ports', () => {
  assert.deepEqual(normalizePortBindings({ '5432/tcp': null, '8080/tcp': [] }), []);
  assert.deepEqual(normalizePortBindings({ '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] }).length, 1);
  assert.deepEqual(normalizePortBindings([{ HostIp: '127.0.0.1', HostPort: '5432' }]).length, 1);
});

test('incomplete samples are rejected', () => {
  assert.throws(() => parseCatalogSample(SAMPLE.split('|').slice(0, 7).join('|')), /incomplete/);
  assert.throws(() => parseCatalogSample(`${SAMPLE}|extra`), /incomplete/);
});

test('transient readiness errors retry and are sanitized', () => {
  let readyCalls = 0;
  const result = waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => {
      readyCalls += 1;
      if (readyCalls === 1) throw new Error('password=super-secret transient failure');
      return true;
    },
    readSample: () => SAMPLE,
    ...withClock(20),
  });
  assert.equal(result.currentDatabase, 'db');
  assert.equal(readyCalls, 3);
});

test('timeout diagnostic is bounded and redacted', () => {
  const huge = `password=super-secret ${'x'.repeat(10_000)}`;
  const clock = withClock(2);
  assert.throws(() => waitForDisposableReadiness({
    readLogs: () => UPSTREAM_INIT_COMPLETE_MARKER,
    assertReady: () => { throw new Error(huge); },
    readSample: () => SAMPLE,
    ...clock,
  }), (error) => {
    assert.ok(error.message.length < 700);
    assert.doesNotMatch(error.message, /super-secret/);
    assert.match(error.message, /initComplete=true/);
    return true;
  });
});

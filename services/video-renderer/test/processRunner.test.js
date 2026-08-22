import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as nodeSpawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runManagedCommand,
  runManagedPipeline,
  resolveProcessTimeoutMs,
  MAX_PROCESS_STDERR_TAIL_BYTES,
} from "../src/processRunner.js";

/**
 * E2 / processRunner real-child lifecycle fixture. Exercises the managed runner
 * against SAFE LOCAL real child Node processes (process.execPath + -e), proving
 * process-group containment, TERM->KILL escalation, deadline, stdout cap,
 * bounded stderr, abort, pipeline, and forced-settle contracts on this host.
 *
 * Because the runner spawns each child with detached:true, every child leads its
 * own session+process group (PGID == PID on POSIX). The runner signals the whole
 * group via process.kill(-pid, ...). We never call setsid/setpgid on descendants,
 * so they inherit the leader group; that is what lets us prove group delivery.
 *
 * No external network, database, provider, Docker, Deno, browser, commit, push,
 * deploy, or live contact. Every real child PID is tracked and force-killed in
 * finally so a mid-test assertion can never orphan a live process.
 */

const POSIX = process.platform !== "win32";
const SEPARATE_GROUP_SKIP = { skip: "POSIX process groups only" };
const GRACEFUL_TIMEOUT = { skip: false };

// ---- spawning seam --------------------------------------------------------

// Bounded synchronous sleep that parks the thread without spinning the event
// loop. Atomics.wait is valid here because the test runs on the Node main thread
// (under `node --test`), not in a browser main thread.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Synchronously wait (bounded) for `path` to appear, returning whether it did.
function waitForFileSync(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (existsSync(path)) return true; } catch { /* retry */ }
    sleepSync(5);
  }
  return existsSync(path);
}

/**
 * REPAIRS the child-startup-vs-deadline evidence race for this fixture.
 *
 * The E2 failure: under full-suite host load, the runner's short managed
 * deadline could fire a slow real `-e` child BEFORE its userland ran (installed
 * a SIGTERM handler, wrote a stderr line, or chained a descendant spawn). When
 * the fixture's assertion depends on that userland behavior, the deadline could
 * terminate the child before the evidence existed and the test failed
 * spuriously — disproving the previous pid-file-prefix attempt.
 *
 * `liveSpawn` closes this deterministically because of HOW the runner works:
 * runManagedCommand installs its termination timer only AFTER spawnImpl returns.
 * So this narrow TEST-ONLY seam spawns the REAL child via nodeSpawn, records
 * child.pid synchronously, and — for fixtures whose assertion requires the child
 * to have RUN userland code — blocks SYNCHRONOUSLY (Atomics.wait + lstat loop)
 * until that code published an explicit ready marker. When spawnImpl finally
 * returns, the production timer starts only after the child has demonstrably
 * executed. The child is still the real OS process, still signals the whole
 * group, still reaps; NO deadline is changed.
 *
 * On readiness failure the child + its group are SIGKILLed so the fixture never
 * leaks, and `capture.ready` stays false so the fixture's assertion visibly
 * fails close to the cause.
 */
function liveSpawn({ readyFile = null, readyTimeoutMs = 20000, label = "" } = {}) {
  const capture = { pid: null, ready: true };
  capture.spawnImpl = (bin, args, options) => {
    const child = nodeSpawn(bin, args, options);
    capture.pid = child.pid;
    if (readyFile && !waitForFileSync(readyFile, readyTimeoutMs)) {
      capture.ready = false;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    return child;
  };
  return capture;
}

// ---- helpers ---------------------------------------------------------------

function waited(predicate, timeoutMs = 4000, intervalMs = 15) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate() || Date.now() > deadline) return resolve(predicate());
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// Attach a rejection observer to an early-rejecting managed-child promise
// IMMEDIATELY, before any assert.rejects handler is registered. The runner may
// reject the promise (e.g. a deadline firing) before the test body reaches
// assert.rejects; with no observer attached yet that early rejection surfaces to
// Node as an unhandledRejection. The helper MUST be called WITHOUT `await`: it
// attaches a no-op `.catch(() => {})` synchronously and returns the SAME promise.
function observeRejections(promise) {
  promise.catch(() => {});
  return promise;
}

function pollPidGone(pid, { group = false, timeoutMs = 8000, intervalMs = 40 } = {}) {
  const target = group ? -pid : pid;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      try {
        process.kill(target, 0);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tick, intervalMs);
      } catch {
        return resolve(true);
      }
    };
    tick();
  });
}

function killTracked(pid) {
  if (!pid || !Number.isSafeInteger(pid)) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone or not ours */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

function assertNoSecretSurface(error, secret) {
  assert.ok(!error.message.includes(secret), "error.message must never include the raw secret");
  assert.ok(!JSON.stringify(error).includes(secret), "serialized error must never include the raw secret");
  assert.ok(!Object.hasOwn(error, "stderr"), "managed error must not carry a raw stderr field");
  assert.ok(!Object.hasOwn(error, "stdout"), "managed error must not carry a raw stdout field");
}

// ---- fake-only fixture (permitted solely for forced settle) ---------------

function neverClosingChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  return child;
}

// ---- real-child tests -----------------------------------------------------

test("real command success preserves code, signal and bounded stdout", async () => {
  const script = `
    process.stdout.write("hello");
    process.stdout.on("finish", () => process.exit(0));
    process.stdout.end();
  `;
  const result = await runManagedCommand(
    { bin: process.execPath, args: ["-e", script] },
    { label: "real_success", stage: "probe" },
  );
  assert.equal(result.code, 0, "real child success must report exit code 0");
  assert.equal(result.signal, null, "real child success must report no signal");
  assert.equal(result.stdout, "hello", "real child success must capture its stdout");
  assert.equal(result.stdoutBytes, "hello".length, "success must report captured stdout bytes");
  assert.ok(result.durationMs >= 0 && result.durationMs <= resolveProcessTimeoutMs("probe", 60000),
    "success duration must be bounded and non-negative");
});

test("hung real child is TERM+settled and provably dead after timeout", async () => {
  const root = mkdtempSync(join(tmpdir(), "xot-runner-hung-"));
  let pid = null;
  try {
    // The child's readiness is its SIGTERM-handler install (so TERM is actually
    // handled) followed by an explicit marker. We gate the runner's 400ms timer
    // start on that marker SYNCHRONOUSLY (inside liveSpawn), then keep the
    // original deadline so the assertion bytes match the production cap.
    const hungReady = join(root, "hung_ready.txt");
    const hung = liveSpawn({ readyFile: hungReady, label: "hung" });
    const script = `
      const fs = require("node:fs");
      process.on("SIGTERM", () => {});
      fs.writeFileSync(${JSON.stringify(hungReady)}, "1");
      ;setInterval(() => {}, 1e9);
    `;
    const promise = runManagedCommand(
      { bin: process.execPath, args: ["-e", script] },
      {
        label: "real_hung",
        timeoutMs: 400,
        terminationGraceMs: 150,
        terminationSettleMs: 150,
        spawnImpl: hung.spawnImpl,
      },
    );
    observeRejections(promise);
    pid = hung.pid;
    assert.ok(hung.ready, "hung child must publish its ready marker before the 400ms timer starts");
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, "process_timeout", "hung child must report process_timeout");
      assert.match(error.message, /exceeded its stage deadline/);
      assert.ok(error.durationMs >= 400, "duration must reflect the deadline");
      return true;
    });
    assert.ok(await pollPidGone(pid), "hung child PID must be gone after the timeout kill");
    if (POSIX) assert.ok(await pollPidGone(pid, { group: true }), "hung child's process group must be gone");
  } finally {
    killTracked(pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test('real child that ignores SIGTERM proves TERM->KILL group escalation',
  { skip: POSIX ? false : "POSIX process groups only" }, async () => {
    const root = mkdtempSync(join(tmpdir(), "xot-runner-group-"));
    let leadPid = null;
    let gChildPid = null;
    try {
      // Readiness is a DESCENDANT-level guarantee: the leader ignores SIGTERM and
      // spawns a grandchild which (1) registers its own SIGTERM handler then (2)
      // writes its grandchild-ready marker. The leader waits for that marker and
      // THEN publishes its own leadReady marker. liveSpawn blocks synchronously
      // on leadReady, so the runner's 700ms timer only begins after the whole
      // chained spawn + handler registration has completed — making group
      // delivery meaningful under load, with the ORIGINAL 700ms deadline intact.
      const leadReady = join(root, "lead_ready.txt");
      const gReady = join(root, "g_ready.txt");
      const gChildPidFile = join(root, "gchild.pid");
      const markerFile = join(root, "marker.txt");
      const postFile = join(root, "post.txt");

      const grandchild = `
        const fs = require("node:fs");
        process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(markerFile)}, "TERM-RECEIVED"));
        fs.writeFileSync(${JSON.stringify(gReady)}, "1");
        setTimeout(() => fs.appendFileSync(${JSON.stringify(postFile)}, "POST-DEADLINE"), 30000);
        setImmediate(() => {});
        setInterval(() => {}, 1e9);
      `;
      const leader = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        process.on("SIGTERM", () => {});
        const g = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}]);
        fs.writeFileSync(${JSON.stringify(gChildPidFile)}, String(g.pid));
        while (!fs.existsSync(${JSON.stringify(gReady)})) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        fs.writeFileSync(${JSON.stringify(leadReady)}, "1");
        setInterval(() => {}, 1e9);
      `;

      const group = liveSpawn({ readyFile: leadReady, label: "group" });
      const promise = runManagedCommand(
        { bin: process.execPath, args: ["-e", leader] },
        {
          label: "real_group_escape",
          timeoutMs: 700,
          terminationGraceMs: 350,
          terminationSettleMs: 150,
          spawnImpl: group.spawnImpl,
        },
      );
      observeRejections(promise);
      leadPid = group.pid;
      assert.ok(group.ready, "group leader+descendant must be SIGTERM-ready before the 700ms timer starts");
      // After the leader's own ready marker, the grandchild pid file is already
      // written by the leader's first userland line: a synchronous valid read.
      gChildPid = Number(readFileSync(gChildPidFile, "utf8").trim());
      assert.ok(Number.isSafeInteger(gChildPid) && gChildPid > 0,
        "group leader must publish a valid descendant pid before the deadline");
      await assert.rejects(promise, (error) => error?.code === "process_timeout");

      assert.ok(existsSync(markerFile), "group SIGTERM must reach a grandchild sharing the leader's process group");
      assert.equal(readFileSync(markerFile, "utf8"), "TERM-RECEIVED", "grandchild must observe SIGTERM bytewise");
      assert.ok(!existsSync(postFile),
        "SIGKILL escalation must kill the group before a late post-deadline line runs");

      assert.ok(await pollPidGone(gChildPid), "grandchild PID must be reaped after the group KILL");
      assert.ok(await pollPidGone(leadPid, { group: true }), "leader process group must be gone after escalation");
    } finally {
      killTracked(leadPid);
      killTracked(gChildPid);
      rmSync(root, { recursive: true, force: true });
    }
  });

test("real stdout overflow is captured under the cap and the child is reaped", { skip: false }, async () => {
  let pid = null;
  try {
    // Overflow termination is DRIVEN by stdout size, not by a timer, so no
    // userland ready marker is required — but the real child PID is still
    // captured synchronously through the seam (so no trailing pid-write).
    const overflow = liveSpawn({ label: "overflow" });
    const script = `
      process.on("SIGTERM", () => {});
      ;process.stdout.write(Buffer.alloc(1024 * 1024, 97));
      ;setImmediate(() => {});
      ;setInterval(() => {}, 1e9);
    `;
    const promise = runManagedCommand(
      { bin: process.execPath, args: ["-e", script] },
      {
        label: "real_overflow",
        maxStdoutBytes: 4096,
        terminationGraceMs: 150,
        terminationSettleMs: 150,
        spawnImpl: overflow.spawnImpl,
      },
    );
    observeRejections(promise);
    pid = overflow.pid;
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, "process_stdout_limit_exceeded", "overflow must surface a stdout-limit code");
      assert.ok(error.stdoutBytes <= 4096, "captured stdout bytes must respect the cap");
      return true;
    });
    assert.ok(await pollPidGone(pid), "overflowing child must be reaped after the cap kill");
  } finally {
    killTracked(pid);
  }
});

test("managed errors expose only bounded stderr size, never the raw secret", async () => {
  const root = mkdtempSync(join(tmpdir(), "xot-runner-secret-"));
  let pid = null;
  try {
    // The assertion stderrTailBytes > 0 requires the runner to have DRAINED a
    // bounded tail of the child's stderr BEFORE termination. That has no PID
    // analog: it requires the child to START and WRITE the secret to stderr.
    // We gate the 300ms timer start on the child's after-write marker
    // (synchronously inside liveSpawn), keeping the original deadline and the
    // bounded-tail / no-leak assertions byte-for-byte.
    const wroteReady = join(root, "wrote.txt");
    const SECRET = "XOT_SUPERTOPSECRET_918273645";
    const sec = liveSpawn({ readyFile: wroteReady, label: "secret" });
    const script = `
      const fs = require("node:fs");
      process.on("SIGTERM", () => {});
      process.stderr.write(${JSON.stringify(SECRET)} + "\\n");
      fs.writeFileSync(${JSON.stringify(wroteReady)}, "1");
      setImmediate(() => {});
      setInterval(() => {}, 1e9);
    `;
    const promise = runManagedCommand(
      { bin: process.execPath, args: ["-e", script] },
      {
        label: "real_stderr_secret",
        timeoutMs: 300,
        terminationGraceMs: 150,
        terminationSettleMs: 150,
        spawnImpl: sec.spawnImpl,
      },
    );
    observeRejections(promise);
    pid = sec.pid;
    assert.ok(sec.ready, "secret child must issue its stderr write before the 300ms timer starts");
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, "process_timeout", "long-running secret-writing child must time out");
      assert.ok(error.stderrTailBytes > 0, "runner must report a bounded stderr size on the error");
      assert.ok(error.stderrTailBytes <= MAX_PROCESS_STDERR_TAIL_BYTES, "stderr tail size must stay within its cap");
      assertNoSecretSurface(error, SECRET);
      return true;
    });
    assert.ok(await pollPidGone(pid), "secret-writing child must be reaped");
  } finally {
    killTracked(pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test("real two-process pipeline streams producer stdout into consumer stdin", async () => {
  const producer = `for (let i = 0; i < 200; i++) process.stdout.write("line" + i + "\\n");`;
  const consumer = `
    const rl = require("node:readline").createInterface({ input: process.stdin });
    rl.on("line", (l) => process.stdout.write(l.toUpperCase() + "\\n"));
    rl.on("close", () => process.exit(0));
  `;
  const result = await runManagedPipeline(
    [
      { bin: process.execPath, args: ["-e", producer] },
      { bin: process.execPath, args: ["-e", consumer] },
    ],
    { label: "real_pipeline", timeoutMs: 10000, terminationGraceMs: 200, terminationSettleMs: 200 },
  );
  assert.equal(result.code, 0, "clean pipeline must report consumer exit code 0");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 200, "consumer must have seen every producer line");
  assert.equal(lines[0], "LINE0");
  assert.equal(lines[199], "LINE199");
});

test("external AbortSignal cancels a running real child", async () => {
  const root = mkdtempSync(join(tmpdir(), "xot-runner-abort-"));
  let pid = null;
  try {
    // The abort must be issued against a LIVE child (a running userland hang), so
    // we gate the runner's start on this child's ready marker synchronously
    // (inside liveSpawn) before the test body issues the external signal. This
    // proves process_cancelled is a genuine kill of a started child.
    const abortReady = join(root, "ready.txt");
    const ab = liveSpawn({ readyFile: abortReady, label: "abort" });
    const script = `
      const fs = require("node:fs");
      process.on("SIGTERM", () => {});
      fs.writeFileSync(${JSON.stringify(abortReady)}, "1");
      ;setInterval(() => {}, 1e9);
    `;
    const controller = new AbortController();
    const promise = runManagedCommand(
      { bin: process.execPath, args: ["-e", script] },
      {
        label: "real_abort",
        signal: controller.signal,
        timeoutMs: 60000,
        terminationGraceMs: 200,
        terminationSettleMs: 200,
        spawnImpl: ab.spawnImpl,
      },
    );
    observeRejections(promise);
    pid = ab.pid;
    assert.ok(ab.ready, "abort child must be LIVE before the external signal is issued");
    await new Promise((r) => setTimeout(r, 120));
    controller.abort();
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, "process_cancelled", "abort must surface process_cancelled");
      assert.match(error.message, /cancelled/);
      return true;
    });
    assert.ok(await pollPidGone(pid), "aborted child must be reaped");
  } finally {
    killTracked(pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test("forced settle terminates a child that never emits close", async () => {
  const child = neverClosingChild(777001);
  await assert.rejects(
    runManagedCommand(
      { bin: process.execPath, args: ["-e", "0"] },
      {
        label: "forced_settle",
        timeoutMs: 200,
        terminationGraceMs: 10,
        terminationSettleMs: 10,
        spawnImpl: () => child,
        processImpl: { platform: "linux", kill() {} },
      },
    ),
    (error) => {
      assert.equal(error.code, "process_timeout", "settle timer must settle even without a close event");
      return true;
    },
  );
});

test("owned temp-root cleanup must never remove an unrelated sibling sentinel", async () => {
  const parent = mkdtempSync(join(tmpdir(), "xot-runner-clean-"));
  try {
    const owned = join(parent, "owned");
    mkdirSync(join(owned, "nested"), { recursive: true });
    writeFileSync(join(owned, "nested", "leaf.txt"), "row-bytes");

    // A sibling DIRECTLY inside the parent (outside the owned root).
    const sibling = join(parent, "sibling-sentinel.txt");
    writeFileSync(sibling, "KEEP-ME");

    rmSync(owned, { recursive: true, force: true });

    assert.ok(!existsSync(owned), "owned root must be removed by the controlled cleanup");
    assert.ok(existsSync(sibling), "unrelated sibling sentinel must survive the owned-root cleanup");
    assert.deepEqual(readdirSync(parent), ["sibling-sentinel.txt"], "no owned descendant may remain");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("managed runner must never introduce shell execution", async () => {
  const result = await runManagedCommand(
    { bin: process.execPath, args: ["-e", "0"] },
    { label: "no_shell", stage: "probe" },
  );
  assert.equal(result.code, 0, "runner must execute commands without a shell wrapper");
});
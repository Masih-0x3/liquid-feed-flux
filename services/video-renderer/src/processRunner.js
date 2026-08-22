import { spawn as nodeSpawn } from "node:child_process";

export const PROCESS_STAGE_TIMEOUT_MS = Object.freeze({
  probe: 60_000,
  analysis: 180_000,
  ocr: 120_000,
  render: 1_800_000,
});
export const DEFAULT_PROCESS_TERMINATION_GRACE_MS = 10_000;
export const DEFAULT_PROCESS_TERMINATION_SETTLE_MS = 5_000;
export const MAX_PROCESS_TEXT_STDOUT_BYTES = 256 * 1024;
export const MAX_PROCESS_STDERR_TAIL_BYTES = 64 * 1024;
export const MAX_PROCESS_BINARY_STDOUT_BYTES = 32 * 1024 * 1024;

const ACTIVE_TERMINATORS = new Set();
// A renderer process is not reusable after SIGTERM/SIGINT. Keep this latch for
// its remaining lifetime so a render cannot start its next subprocess stage
// after shutdown has taken the initial active-process snapshot.
let MANAGED_PROCESS_SHUTDOWN_REQUESTED = false;

function processRunnerMessage(code, label) {
  switch (code) {
    case "process_timeout": return `${label} exceeded its stage deadline`;
    case "process_cancelled": return `${label} was cancelled`;
    case "process_stdout_limit_exceeded": return `${label} exceeded its stdout limit`;
    case "process_spawn_failed": return `${label} could not be started`;
    case "process_pipeline_failed": return `${label} pipeline failed`;
    default: return `${label} exited unsuccessfully`;
  }
}

export class ProcessRunnerError extends Error {
  constructor(code, details = {}) {
    super(processRunnerMessage(code, details.label || "process"));
    this.name = "ProcessRunnerError";
    this.code = code;
    this.label = details.label || "process";
    this.stage = details.stage || "analysis";
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stderrTailBytes = Number(details.stderrTailBytes ?? 0);
    this.stdoutBytes = Number(details.stdoutBytes ?? 0);
    this.durationMs = Number(details.durationMs ?? 0);
  }
}

function boundedPositiveInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) return fallback;
  return numeric;
}

function readAbortSignal(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function") return null;
  return value;
}

export function normalizeProcessStage(value) {
  const stage = String(value ?? "").trim().toLowerCase();
  return Object.hasOwn(PROCESS_STAGE_TIMEOUT_MS, stage) ? stage : "analysis";
}

export function resolveProcessTimeoutMs(stage, requestedTimeoutMs) {
  const normalizedStage = normalizeProcessStage(stage);
  return boundedPositiveInteger(
    requestedTimeoutMs,
    PROCESS_STAGE_TIMEOUT_MS[normalizedStage],
    100,
    PROCESS_STAGE_TIMEOUT_MS.render,
  );
}

class BoundedProcessBuffer {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.allocUnsafe(Math.min(maxBytes, 4 * 1024));
    this.length = 0;
  }

  append(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "");
    if (bytes.byteLength > this.maxBytes - this.length) return false;
    const requiredLength = this.length + bytes.byteLength;
    if (requiredLength > this.buffer.byteLength) {
      const nextLength = Math.min(this.maxBytes, Math.max(requiredLength, this.buffer.byteLength * 2));
      const next = Buffer.allocUnsafe(nextLength);
      this.buffer.copy(next, 0, 0, this.length);
      this.buffer = next;
    }
    bytes.copy(this.buffer, this.length);
    this.length = requiredLength;
    return true;
  }

  toBuffer() {
    return Buffer.from(this.buffer.subarray(0, this.length));
  }
}

class BoundedProcessTail {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.allocUnsafe(maxBytes);
    this.start = 0;
    this.length = 0;
  }

  append(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "");
    if (bytes.byteLength === 0) return;
    if (bytes.byteLength >= this.maxBytes) {
      bytes.copy(this.buffer, 0, bytes.byteLength - this.maxBytes);
      this.start = 0;
      this.length = this.maxBytes;
      return;
    }
    const overflow = Math.max(0, this.length + bytes.byteLength - this.maxBytes);
    if (overflow > 0) {
      this.start = (this.start + overflow) % this.maxBytes;
      this.length -= overflow;
    }
    const writeStart = (this.start + this.length) % this.maxBytes;
    const firstLength = Math.min(bytes.byteLength, this.maxBytes - writeStart);
    bytes.copy(this.buffer, writeStart, 0, firstLength);
    if (firstLength < bytes.byteLength) {
      bytes.copy(this.buffer, 0, firstLength);
    }
    this.length += bytes.byteLength;
  }

  toBuffer() {
    if (this.length === 0) return Buffer.alloc(0);
    if (this.start + this.length <= this.maxBytes) {
      return Buffer.from(this.buffer.subarray(this.start, this.start + this.length));
    }
    const first = this.buffer.subarray(this.start);
    const second = this.buffer.subarray(0, this.length - first.byteLength);
    return Buffer.concat([first, second], this.length);
  }
}

function signalChild(child, signal, { detached, processImpl }) {
  if (!child) return false;
  const pid = Number(child.pid);
  if (detached && processImpl.platform !== "win32" && Number.isSafeInteger(pid) && pid > 0) {
    try {
      processImpl.kill(-pid, signal);
      return true;
    } catch {
      // A child/process group may already be gone; fall through to direct kill.
    }
  }
  try {
    return child.kill?.(signal) !== false;
  } catch {
    return false;
  }
}

function runnerSettings(options = {}) {
  const stage = normalizeProcessStage(options.stage);
  const processImpl = options.processImpl || process;
  return {
    label: String(options.label || "process"),
    stage,
    timeoutMs: resolveProcessTimeoutMs(stage, options.timeoutMs),
    terminationGraceMs: boundedPositiveInteger(
      options.terminationGraceMs,
      DEFAULT_PROCESS_TERMINATION_GRACE_MS,
      1,
      60_000,
    ),
    terminationSettleMs: boundedPositiveInteger(
      options.terminationSettleMs,
      DEFAULT_PROCESS_TERMINATION_SETTLE_MS,
      1,
      60_000,
    ),
    maxStdoutBytes: boundedPositiveInteger(
      options.maxStdoutBytes,
      options.stdoutMode === "buffer" ? MAX_PROCESS_BINARY_STDOUT_BYTES : MAX_PROCESS_TEXT_STDOUT_BYTES,
      1,
      MAX_PROCESS_BINARY_STDOUT_BYTES,
    ),
    maxStderrBytes: boundedPositiveInteger(
      options.maxStderrBytes,
      MAX_PROCESS_STDERR_TAIL_BYTES,
      1,
      MAX_PROCESS_STDERR_TAIL_BYTES,
    ),
    stdoutMode: options.stdoutMode === "buffer" ? "buffer" : "text",
    spawnImpl: options.spawnImpl || nodeSpawn,
    processImpl,
    abortSignal: readAbortSignal(options.signal),
    detached: options.detached ?? processImpl.platform !== "win32",
    cwd: options.cwd,
    env: options.env,
  };
}

function resultFrom({ code, signal, stdout, stderr, startedAt, stdoutMode }) {
  return {
    code,
    signal: signal ?? null,
    stdout: stdoutMode === "buffer" ? stdout.toBuffer() : stdout.toBuffer().toString("utf8"),
    stderr: stderr.toBuffer().toString("utf8"),
    stdoutBytes: stdout.length,
    durationMs: Date.now() - startedAt,
  };
}

function terminationError(reason, settings, stdout, stderr, startedAt, exitCode = null, signal = null) {
  const code = reason === "timeout"
    ? "process_timeout"
    : reason === "shutdown" || reason === "abort"
      ? "process_cancelled"
      : reason === "stdout_limit"
        ? "process_stdout_limit_exceeded"
        : reason === "spawn_error"
          ? "process_spawn_failed"
          : "process_pipeline_failed";
  return new ProcessRunnerError(code, {
    label: settings.label,
    stage: settings.stage,
    exitCode,
    signal,
    stderrTailBytes: stderr.length,
    stdoutBytes: stdout.length,
    durationMs: Date.now() - startedAt,
  });
}

function spawnOptions(settings, stdio) {
  return {
    stdio,
    ...(settings.cwd ? { cwd: settings.cwd } : {}),
    ...(settings.env ? { env: settings.env } : {}),
    detached: settings.detached,
    windowsHide: true,
  };
}

/**
 * Starts one command without a shell, bounds captured output, and ensures a
 * timeout/shutdown path requests TERM, then KILL, then settles the caller even
 * if the child never reports close. Runtime proof of descendant cleanup still
 * requires the renderer host test environment.
 */
export function runManagedCommand(command, options = {}) {
  const settings = runnerSettings(options);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdout = new BoundedProcessBuffer(settings.maxStdoutBytes);
    const stderr = new BoundedProcessTail(settings.maxStderrBytes);
    let child = null;
    let settled = false;
    let terminationReason = null;
    let timeoutTimer = null;
    let killTimer = null;
    let settleTimer = null;
    let abortListener = null;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (settleTimer) clearTimeout(settleTimer);
      timeoutTimer = null;
      killTimer = null;
      settleTimer = null;
    };
    const detachAbortListener = () => {
      if (abortListener && settings.abortSignal) {
        settings.abortSignal.removeEventListener("abort", abortListener);
      }
      abortListener = null;
    };
    const finish = (error, code = null, signal = null) => {
      if (settled) return;
      settled = true;
      ACTIVE_TERMINATORS.delete(terminate);
      clearTimers();
      detachAbortListener();
      if (error) {
        reject(error);
        return;
      }
      resolve(resultFrom({ code, signal, stdout, stderr, startedAt, stdoutMode: settings.stdoutMode }));
    };
    const terminate = (reason) => {
      if (settled) return false;
      const firstTermination = !terminationReason;
      terminationReason ||= reason;
      signalChild(child, "SIGTERM", settings);
      if (!firstTermination) return false;
      killTimer = setTimeout(() => {
        if (settled) return;
        signalChild(child, "SIGKILL", settings);
        settleTimer = setTimeout(() => {
          finish(terminationError(terminationReason, settings, stdout, stderr, startedAt));
        }, settings.terminationSettleMs);
      }, settings.terminationGraceMs);
      return true;
    };
    const cancellationReason = () => {
      if (MANAGED_PROCESS_SHUTDOWN_REQUESTED) return "shutdown";
      return settings.abortSignal?.aborted ? "abort" : null;
    };
    const beforeSpawnCancellation = cancellationReason();
    if (beforeSpawnCancellation) {
      finish(terminationError(beforeSpawnCancellation, settings, stdout, stderr, startedAt));
      return;
    }
    if (settings.abortSignal) {
      abortListener = () => terminate("abort");
      settings.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    ACTIVE_TERMINATORS.add(terminate);

    const afterRegistrationCancellation = cancellationReason();
    if (afterRegistrationCancellation) {
      finish(terminationError(afterRegistrationCancellation, settings, stdout, stderr, startedAt));
      return;
    }

    try {
      child = settings.spawnImpl(command.bin, command.args, spawnOptions(settings, ["ignore", "pipe", "pipe"]));
    } catch {
      finish(terminationError("spawn_error", settings, stdout, stderr, startedAt));
      return;
    }

    child.stdout?.on("data", (chunk) => {
      if (!settled && !terminationReason && !stdout.append(chunk)) terminate("stdout_limit");
    });
    child.stderr?.on("data", (chunk) => stderr.append(chunk));
    child.stdout?.once("error", () => terminate("spawn_error"));
    child.stderr?.once("error", () => terminate("spawn_error"));
    child.once?.("error", () => terminate("spawn_error"));
    child.once?.("close", (code, signal) => {
      if (settled) return;
      if (terminationReason) {
        finish(terminationError(terminationReason, settings, stdout, stderr, startedAt, code, signal));
        return;
      }
      if (code === 0) {
        finish(null, code, signal);
        return;
      }
      finish(new ProcessRunnerError("process_exited_nonzero", {
        label: settings.label,
        stage: settings.stage,
        exitCode: code,
        signal,
        stderrTailBytes: stderr.length,
        stdoutBytes: stdout.length,
        durationMs: Date.now() - startedAt,
      }));
    });
    const afterSpawnCancellation = terminationReason || cancellationReason();
    if (afterSpawnCancellation) {
      terminate(afterSpawnCancellation);
      return;
    }
    timeoutTimer = setTimeout(() => terminate("timeout"), settings.timeoutMs);
  });
}

/**
 * Managed two-process pipeline. The producer stdout uses Node's backpressured
 * pipe directly; only consumer stdout and both stderr streams are captured.
 */
export function runManagedPipeline(pipeline, options = {}) {
  if (!Array.isArray(pipeline) || pipeline.length !== 2) {
    return Promise.reject(new ProcessRunnerError("process_pipeline_failed", { label: options.label || "pipeline" }));
  }
  const settings = runnerSettings(options);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdout = new BoundedProcessBuffer(settings.maxStdoutBytes);
    const stderr = new BoundedProcessTail(settings.maxStderrBytes);
    const children = [];
    const exits = { producer: null, consumer: null };
    let settled = false;
    let terminationReason = null;
    let timeoutTimer = null;
    let killTimer = null;
    let settleTimer = null;
    let abortListener = null;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (settleTimer) clearTimeout(settleTimer);
      timeoutTimer = null;
      killTimer = null;
      settleTimer = null;
    };
    const detachAbortListener = () => {
      if (abortListener && settings.abortSignal) {
        settings.abortSignal.removeEventListener("abort", abortListener);
      }
      abortListener = null;
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      ACTIVE_TERMINATORS.delete(terminate);
      clearTimers();
      detachAbortListener();
      if (error) {
        reject(error);
        return;
      }
      resolve(resultFrom({
        code: exits.consumer?.code ?? null,
        signal: exits.consumer?.signal ?? null,
        stdout,
        stderr,
        startedAt,
        stdoutMode: settings.stdoutMode,
      }));
    };
    const terminate = (reason) => {
      if (settled) return false;
      const firstTermination = !terminationReason;
      terminationReason ||= reason;
      for (const child of children) signalChild(child, "SIGTERM", settings);
      if (!firstTermination) return false;
      killTimer = setTimeout(() => {
        if (settled) return;
        for (const child of children) signalChild(child, "SIGKILL", settings);
        settleTimer = setTimeout(() => {
          finish(terminationError(terminationReason, settings, stdout, stderr, startedAt));
        }, settings.terminationSettleMs);
      }, settings.terminationGraceMs);
      return true;
    };
    const cancellationReason = () => {
      if (MANAGED_PROCESS_SHUTDOWN_REQUESTED) return "shutdown";
      return settings.abortSignal?.aborted ? "abort" : null;
    };
    const maybeFinish = () => {
      if (!exits.producer || !exits.consumer || settled) return;
      if (terminationReason) {
        finish(terminationError(
          terminationReason,
          settings,
          stdout,
          stderr,
          startedAt,
          exits.consumer.code,
          exits.consumer.signal,
        ));
        return;
      }
      if (exits.producer.code === 0 && exits.consumer.code === 0) {
        finish(null);
        return;
      }
      finish(new ProcessRunnerError("process_exited_nonzero", {
        label: settings.label,
        stage: settings.stage,
        exitCode: exits.consumer.code,
        signal: exits.consumer.signal,
        stderrTailBytes: stderr.length,
        stdoutBytes: stdout.length,
        durationMs: Date.now() - startedAt,
      }));
    };
    const attachChild = (role, child) => {
      child.stderr?.on("data", (chunk) => stderr.append(chunk));
      child.stderr?.once("error", () => terminate("spawn_error"));
      child.once?.("error", () => terminate("spawn_error"));
      child.once?.("close", (code, signal) => {
        exits[role] = { code, signal: signal ?? null };
        if (code !== 0 && !terminationReason) terminate("nonzero");
        maybeFinish();
      });
    };
    const beforeSpawnCancellation = cancellationReason();
    if (beforeSpawnCancellation) {
      finish(terminationError(beforeSpawnCancellation, settings, stdout, stderr, startedAt));
      return;
    }
    if (settings.abortSignal) {
      abortListener = () => terminate("abort");
      settings.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    ACTIVE_TERMINATORS.add(terminate);

    const afterRegistrationCancellation = cancellationReason();
    if (afterRegistrationCancellation) {
      finish(terminationError(afterRegistrationCancellation, settings, stdout, stderr, startedAt));
      return;
    }

    let producer = null;
    let consumer = null;
    try {
      producer = settings.spawnImpl(pipeline[0].bin, pipeline[0].args, spawnOptions(settings, ["ignore", "pipe", "pipe"]));
      children.push(producer);
      attachChild("producer", producer);
      const afterProducerCancellation = terminationReason || cancellationReason();
      if (afterProducerCancellation) {
        terminate(afterProducerCancellation);
        return;
      }
      consumer = settings.spawnImpl(pipeline[1].bin, pipeline[1].args, spawnOptions(settings, ["pipe", "pipe", "pipe"]));
      children.push(consumer);
      attachChild("consumer", consumer);
      const afterConsumerCancellation = terminationReason || cancellationReason();
      if (afterConsumerCancellation) {
        // A cancellation can arrive re-entrantly while the consumer is being
        // created. Signal both groups again now that the consumer has a PID.
        terminate(afterConsumerCancellation);
        return;
      }
      producer.stdout?.once("error", () => terminate("spawn_error"));
      consumer.stdin?.once("error", () => terminate("spawn_error"));
      consumer.stdout?.on("data", (chunk) => {
        if (!settled && !terminationReason && !stdout.append(chunk)) terminate("stdout_limit");
      });
      consumer.stdout?.once("error", () => terminate("spawn_error"));
      producer.stdout?.pipe(consumer.stdin);
    } catch {
      if (children.length === 0) {
        finish(terminationError("spawn_error", settings, stdout, stderr, startedAt));
        return;
      }
      terminate("spawn_error");
    }
    timeoutTimer = setTimeout(() => terminate("timeout"), settings.timeoutMs);
  });
}

/** Request best-effort termination for every active managed child group. */
export function abortAllManagedProcesses(reason = "shutdown") {
  if (reason === "shutdown") MANAGED_PROCESS_SHUTDOWN_REQUESTED = true;
  let requested = 0;
  for (const terminate of [...ACTIVE_TERMINATORS]) {
    if (terminate(reason)) requested += 1;
  }
  return requested;
}

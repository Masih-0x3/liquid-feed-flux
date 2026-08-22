export const DEFAULT_RENDER_CONCURRENCY = 1;
export const MAX_RENDER_CONCURRENCY = 4;
export const DEFAULT_RENDER_SHUTDOWN_GRACE_MS = 30_000;
export const MIN_RENDER_SHUTDOWN_GRACE_MS = 1_000;
export const MAX_RENDER_SHUTDOWN_GRACE_MS = 120_000;

function parseBoundedInteger(value, fallback, minimum, maximum, name) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseRenderConcurrency(value) {
  return parseBoundedInteger(
    value,
    DEFAULT_RENDER_CONCURRENCY,
    1,
    MAX_RENDER_CONCURRENCY,
    "RENDER_CONCURRENCY",
  );
}

export function parseRenderShutdownGraceMs(value) {
  return parseBoundedInteger(
    value,
    DEFAULT_RENDER_SHUTDOWN_GRACE_MS,
    MIN_RENDER_SHUTDOWN_GRACE_MS,
    MAX_RENDER_SHUTDOWN_GRACE_MS,
    "RENDER_SHUTDOWN_GRACE_MS",
  );
}

/**
 * Non-queuing renderer capacity gate. Callers receive a lease or a fixed
 * rejection reason; they never wait invisibly behind an unbounded in-memory
 * queue. The same gate is shared by HTTP render, HTTP preflight, and polling.
 */
export class RendererCapacityGate {
  #capacity;
  #inFlight = 0;
  #accepting = true;
  #drainWaiters = new Set();

  constructor(capacity = DEFAULT_RENDER_CONCURRENCY) {
    this.#capacity = parseRenderConcurrency(capacity);
  }

  get capacity() {
    return this.#capacity;
  }

  get inFlight() {
    return this.#inFlight;
  }

  get accepting() {
    return this.#accepting;
  }

  snapshot() {
    return {
      capacity: this.#capacity,
      in_flight: this.#inFlight,
      accepting: this.#accepting,
    };
  }

  tryAcquire() {
    if (!this.#accepting) {
      return { ok: false, reason: "shutting_down", retryAfterSeconds: 1 };
    }
    if (this.#inFlight >= this.#capacity) {
      return { ok: false, reason: "saturated", retryAfterSeconds: 1 };
    }

    this.#inFlight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return false;
        released = true;
        this.#inFlight -= 1;
        if (this.#inFlight === 0) this.#notifyDrained();
        return true;
      },
    };
  }

  stopAccepting() {
    this.#accepting = false;
    if (this.#inFlight === 0) this.#notifyDrained();
  }

  async waitForDrain(timeoutMs) {
    const timeout = parseRenderShutdownGraceMs(timeoutMs);
    if (this.#inFlight === 0) return true;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (drained) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#drainWaiters.delete(waiter);
        resolve(drained);
      };
      const waiter = () => finish(true);
      const timer = setTimeout(() => finish(false), timeout);
      this.#drainWaiters.add(waiter);
    });
  }

  #notifyDrained() {
    for (const waiter of this.#drainWaiters) waiter();
  }
}

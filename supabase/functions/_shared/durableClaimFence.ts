/**
 * durableClaimFence.ts — single-sourced checked-write fencing (AIR-005 / AIR-003).
 *
 * Every authoritative write on a claimed queue job (complete / fail / retry / defer /
 * spacing / heartbeat / reconciliation) is fenced by:
 *   id                 = the queue row we own
 *   owner (locked_by)  = the owning worker identity attached at claim time
 *   claim_token        = the cryptographically random token minted by claim_jobs
 *   claim_generation   = the monotonic generation minted by claim_jobs
 *   claim_state        = a valid in-flight claim (idle / preparing / ready / posting).
 *                        `idle` is the pre-provider/defer state and is fenced too.
 *
 * A stale worker whose lease expired or was reclaimed holds the OLD token and OLD
 * generation; applying its fence yields a zero-row update, which the caller surfaces
 * as a non-success rejection (never "success"). This module centralizes:
 *   (a) extracting the cryptographically-fresh claim envelope from a claimed row,
 *   (b) embedding that envelope into a checked write patch under reserved keys, and
 *   (c) a fail-closed validator for the presence of those fields.
 *
 * The envelope keys are stripped by the checked-write consumer (jobLifecycle) so the
 * token/generation act strictly as WHERE-equality fences, never as update values.
 */

export type ClaimEnvelope = {
  claimToken: string;
  claimGeneration: number;
};

export type DurableClaimJob = {
  id?: unknown;
  locked_by?: unknown;
  claim_token?: unknown;
  claim_generation?: unknown;
  claim_state?: unknown;
};

/** Reserved keys carrying the claim fence through a checked write patch. */
export const CLAIM_TOKEN_PATCH_KEY = "__claim_token";
export const CLAIM_GENERATION_PATCH_KEY = "__claim_generation";
export const CLAIM_STATE_PATCH_KEY = "__claim_state";

/** The only claim states in which a worker may write terminal/mid-flight transitions.
 * `idle` is intentionally included for pre-provider and defer transitions. */
export const ACTIVE_CLAIM_STATES = new Set(["preparing", "ready", "posting", "idle"]);

function generationNumber(job: DurableClaimJob | null | undefined): number | null {
  const raw = job?.claim_generation;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Extract the durable claim envelope from a claimed job row. Returns null when the
 * row does not carry the fresh cryptographically random token and monotonic
 * generation, which is how a stale/pre-transition row is detected.
 */
export function extractClaimEnvelope(job: DurableClaimJob | null | undefined): ClaimEnvelope | null {
  const token = typeof job?.claim_token === "string"
    ? job.claim_token.trim()
    : job?.claim_token != null
    ? String(job.claim_token)
    : "";
  if (!token) return null;
  const generation = generationNumber(job);
  if (generation == null) return null;
  return { claimToken: token, claimGeneration: generation };
}

/**
 * Embed the claim envelope into a patch under reserved keys so the checked-write
 * consumer can turn it into equality fences. Additive: existing keys are preserved.
 */
export function embedClaimEnvelope(
  patch: Record<string, unknown>,
  job: DurableClaimJob | null | undefined,
): Record<string, unknown> {
  const envelope = extractClaimEnvelope(job);
  if (!envelope) return { ...patch };
  return {
    ...patch,
    [CLAIM_TOKEN_PATCH_KEY]: envelope.claimToken,
    [CLAIM_GENERATION_PATCH_KEY]: envelope.claimGeneration,
  };
}

/**
 * Returns the extra checked-write fence entries (eq pairs) for the envelope, so a
 * consumer can append generation + token equality and optionally a claim-state gate.
 */
export function claimFencePairs(
  job: DurableClaimJob | null | undefined,
  stateGuard: string | null = null,
): Array<[string, unknown]> {
  const envelope = extractClaimEnvelope(job);
  if (!envelope) return [];
  const pairs: Array<[string, unknown]> = [
    ["claim_token", envelope.claimToken],
    ["claim_generation", envelope.claimGeneration],
  ];
  if (stateGuard && ACTIVE_CLAIM_STATES.has(stateGuard)) {
    pairs.push(["claim_state", stateGuard]);
  }
  return pairs;
}

/** Fail-closed guard: a claimed write without a valid envelope must not proceed. */
export function assertClaimEnvelope(
  job: DurableClaimJob | null | undefined,
  operation: string,
  fail: (message: string) => never,
): void {
  const envelope = extractClaimEnvelope(job);
  if (!envelope) {
    fail(`job_state_write_failed:${operation}:missing_claim_fence`);
  }
  const state = typeof job?.claim_state === "string"
    ? job.claim_state.trim()
    : "";
  if (!state) {
    fail(`job_state_write_failed:${operation}:missing_claim_state`);
  }
  if (!ACTIVE_CLAIM_STATES.has(state)) {
    fail(`job_state_write_failed:${operation}:invalid_claim_state:${state}`);
  }
}

// =============================================================================
// Durable provider-start boundary (SF1 / SF2).
//
// The AIR guarantees "provider_started is persisted BEFORE the first irreversible
// provider call; a DB marker failure means the provider is never called; once the
// provider may accept, a completion-DB failure is durable ambiguous/non-success"
// are enforced here on REAL behavior (not strings) via an injectable, dependency-free
// runtime helper. `withProviderBoundary` is sequenced to guarantee:
//
//   (a) marker success ALWAYS precedes the provider call,
//   (b) a marker DB error => the provider callback is invoked ZERO times,
//   (c) a provider that was allowed to accept but whose completion-DB write is
//       unknown/false => ambiguous / non-success, never labelled 'success'.
//
// The worker runtime wires its queue-job delivery handlers and the x-poster wires
// its media/text postTweet paths through this same helper; the Node transpile
// checkers exercise the real transpiled helper with fake injected callbacks so the
// durability ordering is load-bearing, not a string match.
// =============================================================================

export type ProviderBoundaryOutcome<T = unknown> =
  | { status: "marker_failed" | "marker_rejected"; markerSucceeded: false; result?: never }
  | { status: "success"; markerSucceeded: true; result: T; completionSucceeded: true }
  | { status: "ambiguous"; markerSucceeded: true; result: T; completionSucceeded: false };

export type ProviderBoundaryHooks<T = unknown> = {
  /** Durable provider-start marker. Throws on DB error; returns false when the
   *  conditional fence rejected the transition (stale / already-started). */
  markStarted: () => Promise<boolean>;
  /** The irreversible provider call. Invoked ONLY after markStarted resolves true. */
  provider: () => Promise<T>;
  /** Persist completion. False/throw => durable ambiguous (never success). */
  complete: (result: T) => Promise<boolean>;
  onMarkerError?: (code: string) => void;
};

function providerBoundaryErrorCode(error: unknown): string {
  return error instanceof Error && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(error.message)
    ? error.message
    : "provider_start_marker_failed";
}

/** The single load-bearing provider-start boundary. Deterministic and injectable so
 *  contract tests prove the ordering with fakes. */
export async function withProviderBoundary<T>(
  hooks: ProviderBoundaryHooks<T>,
): Promise<ProviderBoundaryOutcome<T>> {
  let markerSucceeded = false;
  try {
    markerSucceeded = await hooks.markStarted();
  } catch (error) {
    hooks.onMarkerError?.(providerBoundaryErrorCode(error));
    return { status: "marker_failed", markerSucceeded: false };
  }
  if (!markerSucceeded) {
    return { status: "marker_rejected", markerSucceeded: false };
  }
  const result = await hooks.provider();
  let completionSucceeded = false;
  try {
    completionSucceeded = await hooks.complete(result);
  } catch {
    completionSucceeded = false;
  }
  if (!completionSucceeded) {
    return { status: "ambiguous", markerSucceeded: true, result, completionSucceeded: false };
  }
  return { status: "success", markerSucceeded, result, completionSucceeded };
}

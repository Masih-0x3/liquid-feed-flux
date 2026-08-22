export class RenderClaimLostError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RenderClaimLostError";
    this.code = "video_render_claim_lost";
  }
}

export function claimFenceFor(row) {
  const renderId = typeof row?.id === "string" ? row.id.trim() : "";
  const claimToken = typeof row?.claim_token === "string" ? row.claim_token.trim() : "";
  const claimGeneration = Number(row?.claim_generation);
  if (!renderId) throw new Error("video render claim is missing a render id");
  if (!claimToken) throw new Error(`video render ${renderId} is missing a valid claim token`);
  if (!Number.isSafeInteger(claimGeneration) || claimGeneration < 1) {
    throw new Error(`video render ${renderId} is missing a valid claim generation`);
  }
  return { renderId, claimToken, claimGeneration };
}

function safePathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_");
}

export function processedPathFor(row, renderVersion, now = new Date()) {
  const { renderId, claimGeneration } = claimFenceFor(row);
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "processed",
    safePathSegment(renderVersion),
    yyyy,
    mm,
    safePathSegment(row.tweet_id),
    safePathSegment(renderId),
    `g${claimGeneration}.mp4`,
  ].join("/");
}

export function assertRenderTerminalAccepted(data, row, operation) {
  const result = Array.isArray(data) ? data[0] : data;
  const fence = claimFenceFor(row);
  if (!result || typeof result !== "object" || result.accepted !== true) {
    const detail = result && typeof result === "object" && typeof result.reason === "string"
      ? `: ${result.reason}`
      : " did not return an explicit accepted result";
    throw new RenderClaimLostError(
      `video render ${fence.renderId} generation ${fence.claimGeneration} ${operation} rejected${detail}`,
    );
  }
  return result;
}

export async function removeStaleGenerationOutput({
  supabase,
  bucket,
  outputStoragePath,
  metrics,
}) {
  const { error } = await supabase.storage.from(bucket).remove([outputStoragePath]);
  metrics.stale_output_cleanup = error ? "failed" : "removed";
  if (error) {
    metrics.stale_output_cleanup_error = error.message;
    return false;
  }
  return true;
}

export function createRenderLeaseController({
  supabase,
  row,
  rendererId,
  leaseSeconds = 600,
  renewalIntervalMs = 120_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const fence = claimFenceFor(row);
  const normalizedRendererId = typeof rendererId === "string" ? rendererId.trim() : "";
  if (!normalizedRendererId) throw new Error(`video render ${fence.renderId} is missing a renderer id`);
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new Error("video render lease seconds must be between 30 and 3600");
  }
  if (!Number.isSafeInteger(renewalIntervalMs) || renewalIntervalMs < 1_000) {
    throw new Error("video render renewal interval must be at least 1000ms");
  }

  let timer = null;
  let stopped = false;
  let lostCause = null;
  let renewalPromise = null;

  const lose = (cause) => {
    if (!lostCause) lostCause = cause instanceof Error ? cause : new Error(String(cause));
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };

  const renewNow = async () => {
    if (stopped || lostCause) return false;
    if (renewalPromise) return renewalPromise;
    renewalPromise = (async () => {
      try {
        const { data, error } = await supabase.rpc("renew_video_render_lease", {
          p_render_id: fence.renderId,
          p_worker_id: normalizedRendererId,
          p_claim_token: fence.claimToken,
          p_claim_generation: fence.claimGeneration,
          p_lease_seconds: leaseSeconds,
        });
        if (error) {
          lose(error);
          return false;
        }
        if (data !== true) {
          lose(new Error("lease renewal rejected by the current ownership fence"));
          return false;
        }
        return true;
      } catch (error) {
        lose(error);
        return false;
      } finally {
        renewalPromise = null;
      }
    })();
    return renewalPromise;
  };

  return {
    start() {
      if (stopped) throw new Error("cannot restart a stopped video render lease");
      if (timer === null && !lostCause) {
        timer = setIntervalFn(() => {
          void renewNow();
        }, renewalIntervalMs);
        if (typeof timer?.unref === "function") timer.unref();
      }
      return this;
    },
    renewNow,
    assertCurrent() {
      if (lostCause) {
        throw new RenderClaimLostError(
          `video render ${fence.renderId} claim generation ${fence.claimGeneration} is no longer current: ${lostCause.message}`,
          { cause: lostCause },
        );
      }
      if (stopped) {
        throw new RenderClaimLostError(`video render ${fence.renderId} lease is stopped`);
      }
      return true;
    },
    async stop() {
      stopped = true;
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
      if (renewalPromise) await renewalPromise;
    },
  };
}

export type XPosterOutcomeStatus =
  | "posted"
  | "skipped"
  | "deferred"
  | "not_candidate"
  | "failed";

export type XPosterOutcome = {
  status: XPosterOutcomeStatus;
  reason: string;
  xTweetId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function reasonFrom(row: Record<string, unknown>, fallback: string): string {
  return textOrNull(row.reason) ?? textOrNull(row.error) ?? fallback;
}

/**
 * Convert the x-poster function result into the small durable outcome
 * vocabulary used by worker dispatch receipts. A successful HTTP invocation
 * is not itself a successful post: the body must contain a matching result.
 */
export function classifyXPosterResponse(
  data: unknown,
  targetTweetId: string,
): XPosterOutcome {
  const body = asRecord(data);
  if (!body) {
    return { status: "failed", reason: "x_poster_invalid_response", xTweetId: null };
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const matching = results
    .map(asRecord)
    .find((row) => row && textOrNull(row.tweet_id) === targetTweetId);

  if (results.length > 0 && !matching) {
    return { status: "failed", reason: "x_poster_target_mismatch", xTweetId: null };
  }

  if (matching) {
    const status = textOrNull(matching.status);
    const xTweetId = textOrNull(matching.x_tweet_id);
    if (status === "posted") {
      return { status: "posted", reason: reasonFrom(matching, "posted"), xTweetId };
    }
    if (status === "skipped" || status?.startsWith("dry_run_skipped")) {
      return { status: "skipped", reason: reasonFrom(matching, "skipped"), xTweetId };
    }
    if (status === "deferred" || status?.startsWith("dry_run_deferred")) {
      return { status: "deferred", reason: reasonFrom(matching, "deferred"), xTweetId };
    }
    if (status === "failed" || status === "ambiguous") {
      return {
        status: "failed",
        reason: reasonFrom(matching, status === "ambiguous" ? "ambiguous_provider_outcome" : "failed"),
        xTweetId,
      };
    }
    return { status: "failed", reason: "x_poster_unknown_outcome", xTweetId };
  }

  const topReason = textOrNull(body.reason) ?? textOrNull(body.error);
  if (body.ok === false) {
    const topStatus = textOrNull(body.status);
    if (topStatus === "locked" || topStatus === "skipped") {
      return { status: "skipped", reason: topReason ?? "x_poster_skipped", xTweetId: null };
    }
    if (topStatus === "deferred") {
      return { status: "deferred", reason: topReason ?? "x_poster_deferred", xTweetId: null };
    }
    return { status: "failed", reason: topReason ?? "x_poster_failed", xTweetId: null };
  }

  return {
    status: "not_candidate",
    reason: topReason ?? "x_poster_no_candidate",
    xTweetId: null,
  };
}

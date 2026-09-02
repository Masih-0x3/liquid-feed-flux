export const X_QUOTA_UNAVAILABLE = "quota_unavailable" as const;
export const X_POSTING_QUOTA_MAX = {
  posts_per_hour: 1_000,
  posts_per_day: 10_000,
  monthly_post_budget: 1_000_000,
  media_uploads_per_day: 10_000,
} as const;

export type XQuotaBlockReason =
  | typeof X_QUOTA_UNAVAILABLE
  | "rate_limit_hour"
  | "rate_limit_day"
  | "rate_limit_month"
  | "rate_limit_media"
  | "daily_budget_reached"
  | "min_spacing"
  | null;

type XQuotaAdmissionInput = {
  available: boolean;
  nowMs: number;
  limits: {
    posts_per_hour: unknown;
    posts_per_day: unknown;
    monthly_post_budget: unknown;
    media_uploads_per_day: unknown;
  };
  config: {
    daily_budget?: unknown;
    min_spacing_minutes?: unknown;
  };
  snapshot: {
    posts1h: unknown;
    posts24h: unknown;
    posts30d: unknown;
    mediaUploads24h: unknown;
    lastPostTimeMs: unknown;
  };
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedPositiveInteger(value: unknown, max: number): value is number {
  return isPositiveInteger(value) && value <= max;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

/**
 * Keeps quota admission fail-closed while the planned database reservation RPC
 * is still pending. Inputs are deliberately unknown at this boundary because
 * settings and query data arrive from untyped persisted JSON/rows.
 */
export function getXQuotaBlockReason(input: XQuotaAdmissionInput): XQuotaBlockReason {
  if (!input.available || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return X_QUOTA_UNAVAILABLE;
  }

  const { limits, config, snapshot } = input;
  if (
    !isBoundedPositiveInteger(limits.posts_per_hour, X_POSTING_QUOTA_MAX.posts_per_hour) ||
    !isBoundedPositiveInteger(limits.posts_per_day, X_POSTING_QUOTA_MAX.posts_per_day) ||
    !isBoundedPositiveInteger(limits.monthly_post_budget, X_POSTING_QUOTA_MAX.monthly_post_budget) ||
    !isBoundedPositiveInteger(limits.media_uploads_per_day, X_POSTING_QUOTA_MAX.media_uploads_per_day) ||
    !isNonNegativeInteger(snapshot.posts1h) ||
    !isNonNegativeInteger(snapshot.posts24h) ||
    !isNonNegativeInteger(snapshot.posts30d) ||
    !isNonNegativeInteger(snapshot.mediaUploads24h) ||
    !isNonNegativeInteger(snapshot.lastPostTimeMs) ||
    !isOptionalNonNegativeInteger(config.daily_budget) ||
    !isOptionalNonNegativeInteger(config.min_spacing_minutes)
  ) {
    return X_QUOTA_UNAVAILABLE;
  }

  if (snapshot.posts1h >= limits.posts_per_hour) return "rate_limit_hour";
  if (snapshot.posts24h >= limits.posts_per_day) return "rate_limit_day";
  if (snapshot.posts30d >= limits.monthly_post_budget) return "rate_limit_month";
  if (snapshot.mediaUploads24h >= limits.media_uploads_per_day) return "rate_limit_media";

  if (
    typeof config.daily_budget === "number" &&
    config.daily_budget > 0 &&
    snapshot.posts24h >= config.daily_budget
  ) {
    return "daily_budget_reached";
  }

  if (
    typeof config.min_spacing_minutes === "number" &&
    config.min_spacing_minutes > 0 &&
    snapshot.lastPostTimeMs > 0 &&
    input.nowMs - snapshot.lastPostTimeMs < config.min_spacing_minutes * 60 * 1000
  ) {
    return "min_spacing";
  }

  return null;
}

export function getPayloadTweetId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).tweet_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function tweetReferenceVariants(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const raw = value.trim();
  const variants = new Set<string>([raw]);
  const statusMatch = raw.match(/(?:status|statuses)\/(\d{5,})/);
  const numeric = statusMatch?.[1] ?? (/^\d{5,}$/.test(raw) ? raw : null);
  if (numeric) {
    variants.add(numeric);
    variants.add(`https://twitter.com/i/status/${numeric}`);
    variants.add(`https://twitter.com/status/${numeric}`);
    variants.add(`https://x.com/i/status/${numeric}`);
    variants.add(`https://x.com/status/${numeric}`);
  }
  return [...variants];
}

export function jobReferenceValues(row: Record<string, unknown>): string[] {
  const values = new Set<string>();
  const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
  for (const key of ["tweet_id", "target_tweet_id", "post_id", "url", "src_url"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      tweetReferenceVariants(value).forEach((variant) => values.add(variant));
    }
  }
  const idempotency = typeof row.idempotency_key === "string" ? row.idempotency_key : "";
  const statusMatch = idempotency.match(/(?:status|statuses)\/(\d{5,})/);
  const numericMatch = idempotency.match(/(^|[:/])(\d{10,})(?=[:/]|$)/);
  const numeric = statusMatch?.[1] ?? numericMatch?.[2] ?? null;
  if (numeric) tweetReferenceVariants(numeric).forEach((variant) => values.add(variant));
  return [...values];
}

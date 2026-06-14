import type { SupabaseAdminClient } from "./types.ts";

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

export function isTerminalSkippedPost(post: Record<string, unknown> | null | undefined): boolean {
  if (!post) return false;
  return post.delivery_decision === "skip" && post.score_review_status !== "needs_review";
}

export function isFailedJobActionable(
  job: Record<string, unknown>,
  post: Record<string, unknown> | null | undefined,
): boolean {
  if (job.status !== "failed") return false;
  const meta = job.result_meta && typeof job.result_meta === "object" ? job.result_meta as Record<string, unknown> : {};
  if (meta.admin_ignored === true) return false;
  if (isTerminalSkippedPost(post)) return false;
  return true;
}

export function postForJob(
  job: Record<string, unknown>,
  postByRef: Map<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const value of jobReferenceValues(job)) {
    const post = postByRef.get(value);
    if (post) return post;
  }
  return null;
}

export async function loadPostsByJobReferences(
  supabase: SupabaseAdminClient,
  jobs: Array<Record<string, unknown>>,
): Promise<Map<string, Record<string, unknown>>> {
  const refs = [...new Set(jobs.flatMap(jobReferenceValues))].slice(0, 10000);
  const postByRef = new Map<string, Record<string, unknown>>();
  if (refs.length === 0) return postByRef;

  const columns = "tweet_id, url, delivery_decision, decision_reason, score_review_status, feedback_locked, dedupe_status, dup_of_tweet_id";
  const [{ data: byTweet, error: tweetError }, { data: byUrl, error: urlError }] = await Promise.all([
    (supabase.from("posts") as any).select(columns).in("tweet_id", refs),
    (supabase.from("posts") as any).select(columns).in("url", refs),
  ]);
  if (tweetError) throw tweetError;
  if (urlError) throw urlError;

  const addPost = (post: Record<string, unknown>) => {
    for (const key of ["tweet_id", "url"]) {
      const value = post[key];
      if (typeof value !== "string" || !value.trim()) continue;
      for (const variant of tweetReferenceVariants(value)) {
        if (!postByRef.has(variant)) postByRef.set(variant, post);
      }
    }
  };
  for (const post of (byTweet ?? []) as Array<Record<string, unknown>>) addPost(post);
  for (const post of (byUrl ?? []) as Array<Record<string, unknown>>) addPost(post);
  return postByRef;
}

export function isMissingSchemaError(error: unknown): boolean {
  const message = String((error as { message?: unknown; details?: unknown; code?: unknown })?.message ?? error ?? "");
  const details = String((error as { details?: unknown })?.details ?? "");
  const code = String((error as { code?: unknown })?.code ?? "");
  return code === "42P01" || code === "42703" || /does not exist|schema cache|column|relation/i.test(`${message} ${details}`);
}

export function monitoringPolicyRuleKind(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.policy_rule_applied === "string") return snapshot.policy_rule_applied;
  const rule = snapshot.policy_rule && typeof snapshot.policy_rule === "object" ? snapshot.policy_rule as Record<string, unknown> : null;
  return typeof rule?.kind === "string" ? rule.kind : null;
}

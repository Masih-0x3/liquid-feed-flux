import type { SupabaseAdminClient } from "./types.ts";
import { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";
export { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";

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

  const checkedPosts = (
    value: unknown,
    label: string,
  ): Array<Record<string, unknown>> => {
    if (!Array.isArray(value)) {
      throw new Error(`${label}_invalid_response`);
    }
    return value.map((post) => {
      if (!post || typeof post !== "object" || Array.isArray(post)) {
        throw new Error(`${label}_invalid_row`);
      }
      const row = post as Record<string, unknown>;
      if (typeof row.tweet_id !== "string" || !row.tweet_id.trim()) {
        throw new Error(`${label}_invalid_row`);
      }
      return row;
    });
  };
  const tweetPosts = checkedPosts(byTweet, "monitoring_posts_by_tweet");
  const urlPosts = checkedPosts(byUrl, "monitoring_posts_by_url");

  const addPost = (post: Record<string, unknown>) => {
    for (const key of ["tweet_id", "url"]) {
      const value = post[key];
      if (typeof value !== "string" || !value.trim()) continue;
      for (const variant of tweetReferenceVariants(value)) {
        if (!postByRef.has(variant)) postByRef.set(variant, post);
      }
    }
  };
  for (const post of tweetPosts) addPost(post);
  for (const post of urlPosts) addPost(post);
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

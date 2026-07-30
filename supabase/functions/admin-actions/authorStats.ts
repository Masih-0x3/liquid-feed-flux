import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

export const AUTHOR_STATS_DEFAULT_POST_LIMIT = 500;
export const AUTHOR_STATS_MAX_POST_LIMIT = 500;
export const AUTHOR_STATS_MAX_AUTHORS = 100;

type PostsQueryBuilder = {
  select(columns: string): PostsQueryBuilder;
  not(column: string, operator: string, value: unknown): PostsQueryBuilder;
  order(column: string, options?: Record<string, unknown>): PostsQueryBuilder;
  limit(limit: number): Promise<{
    data?: Array<{ author_handle?: unknown }> | null;
    error?: unknown;
  }>;
};

function postsTable(supabase: SupabaseAdminClient): PostsQueryBuilder {
  return supabase.from("posts") as PostsQueryBuilder;
}

function resolvePostLimit(value: unknown): number | null {
  if (value === undefined) return AUTHOR_STATS_DEFAULT_POST_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return Math.min(value, AUTHOR_STATS_MAX_POST_LIMIT);
}

export async function getRecentAuthorStatsAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const limit = resolvePostLimit(body.limit);
  if (limit === null) {
    return {
      body: { error: "limit must be a positive integer" },
      status: 400,
    };
  }

  const { data, error } = await postsTable(supabase)
    .select("author_handle")
    .not("author_handle", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  if (!Array.isArray(data)) {
    return {
      body: { ok: false, error: "author_stats_invalid_response" },
      status: 503,
    };
  }
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.author_handle !== "string") {
      return {
        body: { ok: false, error: "author_stats_invalid_row" },
        status: 503,
      };
    }
  }
  const records = data;
  const counts = new Map<string, number>();
  for (const row of records) {
    if (typeof row.author_handle !== "string") continue;
    const handle = row.author_handle.trim();
    if (!handle) continue;
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }

  const authors = [...counts.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((left, right) => right.count - left.count || left.handle.localeCompare(right.handle))
    .slice(0, AUTHOR_STATS_MAX_AUTHORS);

  return {
    body: {
      ok: true,
      scope: "recent_posts_sample",
      sampled_posts: records.length,
      limit,
      authors,
    },
  };
}

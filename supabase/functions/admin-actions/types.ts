export type AdminActionResponse = {
  body: unknown;
  status?: number;
};

export type SupabaseAdminClient = {
  from(table: string): unknown;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type RecordFeedbackFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  feedbackAction: string,
  polarity: number,
  meta?: Record<string, unknown>,
  relatedTweetId?: string | null,
) => Promise<void>;

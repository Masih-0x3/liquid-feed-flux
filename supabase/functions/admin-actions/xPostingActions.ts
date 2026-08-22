import { duplicateXSkipReason } from "../_shared/duplicateGuard.ts";
import {
  allowCompletedEnrichmentForPosting,
  doesEnrichmentBlockX,
  type EnrichmentConfig,
  normalizeEnrichmentConfig,
} from "../_shared/enrich.ts";
import {
  hasVideoIntent,
  isSendableImage,
  isValidVideoDownload,
  selectMediaTier,
  type XMediaRow,
} from "../_shared/mediaSelection.ts";
import {
  fetchReviewedRemoteJson,
  filterReviewedRemoteMediaItems,
  MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
  RemoteMediaPolicyError,
  type RemoteMediaDnsResolver,
} from "../_shared/remoteMediaPolicy.ts";
import { loadActiveThreshold } from "./activeThreshold.ts";
import {
  ExternalPostingBlockedError,
  requireExternalPosting,
} from "../_shared/externalPostingGuard.ts";
import type { RuntimeControlsQueryClient } from "../_shared/runtimeControls.ts";
import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";
import { addAdminOperationEnvelope } from "./adminOperation.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string, options?: Record<string, unknown>): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  gt(column: string, value: unknown): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  is(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  filter(column: string, operator: string, value: unknown): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

export type RunRescoreFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<{
  ok: boolean;
  score?: number;
  final_score?: number;
  base_score?: number;
  learned_score?: number;
  learned_delta?: number;
  x_gate_score?: number;
  decision?: string;
  error?: string;
}>;

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ReadEnvFn = (key: string) => string | undefined;

export type ResolvedMedia = {
  url: string;
  type: "video" | "gif" | "image";
  thumbnail_url?: string;
  resolution?: string;
  bitrate?: number;
  qualityLabel?: string;
};

export type ResolvedMediaMetadata = Omit<ResolvedMedia, "url" | "thumbnail_url">;

export type ResolvedXMediaMetadata = {
  user_name: string;
  user_screen_name: string;
  tweetID: string;
  media: ResolvedMediaMetadata[];
};

export type XDiagnosticBlocker = {
  code: string;
  label: string;
  severity: "blocker" | "deferred" | "note";
};

export type QueueHydrationDeps = {
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  now?: () => Date;
};

export type ResolveXMediaDeps = {
  fetchImpl?: FetchFn;
  resolveDns?: RemoteMediaDnsResolver;
};

export type RunXPostDeps = QueueHydrationDeps & {
  runRescore: RunRescoreFn;
  recordFeedback: RecordFeedbackFn;
  fetchImpl?: FetchFn;
  readEnv?: ReadEnvFn;
};

function externalPostingOptions(deps: RunXPostDeps): {
  environment: unknown;
  allowExternalPosting: unknown;
} {
  const env = deps.readEnv ?? ((key: string) => Deno.env.get(key));
  return {
    environment: env("XOT_ENVIRONMENT"),
    allowExternalPosting: env("ALLOW_EXTERNAL_POSTING"),
  };
}

export type RehydrateRecentTruncatedDeps = {
  now?: () => Date;
};

const DEFAULT_X_POSTING_DIAG_CONFIG = {
  enabled: false,
  min_score: 14,
  allow_video: false,
  dedupe_window_hours: 48,
  max_candidate_age_minutes: 30,
  max_posts_per_run: 1,
  post_only_decision_deliver: true,
  start_posting_from: null as string | null,
};

const DEFAULT_X_RATE_LIMIT_DIAG_CONFIG = {
  posts_per_hour: 20,
  posts_per_day: 100,
  monthly_post_budget: 2500,
  media_uploads_per_day: 200,
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function runtimeControlsClient(
  supabase: SupabaseAdminClient,
): RuntimeControlsQueryClient {
  return {
    from: (tableName) => ({
      select: (columns) =>
        (supabase.from(tableName) as TableQueryBuilder).select(columns),
    }),
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

function safeAdminActionErrorCode(error: unknown, fallback = "admin_action_failed"): string {
  const message = errorMessage(error).trim();
  const match = message.match(/^([a-z][a-z0-9_]{1,96})/);
  return match?.[1] ?? fallback;
}

function nowIso(deps?: { now?: () => Date }): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function readEnv(key: string, deps?: { readEnv?: ReadEnvFn }): string {
  return deps?.readEnv?.(key) ?? Deno.env.get(key) ?? "";
}

function mergeRecord<T extends Record<string, unknown>>(
  defaults: T,
  raw: unknown,
): T {
  return {
    ...defaults,
    ...(raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}),
  } as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasNonEmptyStringField(value: unknown, field: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" && fieldValue.trim().length > 0;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
    )
    : [];
}

function toResolveXMediaClientMetadata(tweet: {
  user_name?: unknown;
  user_screen_name?: unknown;
  tweetID?: unknown;
  media?: unknown;
}): ResolvedXMediaMetadata {
  const media: ResolvedMediaMetadata[] = asRecordArray(tweet.media).flatMap((item) => {
    const type = item.type;
    if (type !== "video" && type !== "gif" && type !== "image") return [];
    return [{
      type,
      resolution: typeof item.resolution === "string" ? item.resolution : undefined,
      bitrate: typeof item.bitrate === "number" && Number.isFinite(item.bitrate)
        ? item.bitrate
        : undefined,
      qualityLabel: typeof item.qualityLabel === "string" ? item.qualityLabel : undefined,
    }];
  });
  return {
    user_name: typeof tweet.user_name === "string" ? tweet.user_name : "",
    user_screen_name: typeof tweet.user_screen_name === "string"
      ? tweet.user_screen_name
      : "",
    tweetID: typeof tweet.tweetID === "string" ? tweet.tweetID : "",
    media,
  };
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreBreakdownNumber(
  breakdown: Record<string, unknown>,
  key: string,
): number | null {
  return finiteNumber(breakdown[key]);
}

function resolveXGateScore(post: Record<string, unknown>): {
  xGateScore: number | null;
  baseScore: number | null;
  learnedScore: number | null;
  learnedDelta: number | null;
} {
  const breakdown = asRecord(post.score_breakdown);
  const finalScore = finiteNumber(post.final_score);
  const importanceScore = finiteNumber(post.importance_score);
  const baseScore = finiteNumber(post.base_score) ??
    scoreBreakdownNumber(breakdown, "base") ??
    scoreBreakdownNumber(breakdown, "ai") ??
    finalScore ??
    importanceScore;
  const learnedScore = finiteNumber(post.learned_score) ??
    scoreBreakdownNumber(breakdown, "learned") ??
    scoreBreakdownNumber(breakdown, "final") ??
    finalScore;
  const learnedDelta = finiteNumber(post.learned_delta) ??
    scoreBreakdownNumber(breakdown, "learned_delta") ??
    (typeof learnedScore === "number" && typeof baseScore === "number"
      ? Math.round((learnedScore - baseScore) * 1000) / 1000
      : null);
  const xGateScore = finiteNumber(post.x_gate_score) ??
    scoreBreakdownNumber(breakdown, "x_gate_score") ??
    scoreBreakdownNumber(breakdown, "x_gate") ??
    baseScore ??
    finalScore ??
    importanceScore;
  return { xGateScore, baseScore, learnedScore, learnedDelta };
}

export function upgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("twimg.com")) {
      u.searchParams.set("name", "orig");
      return u.toString();
    }
  } catch {
    // Keep the original URL if parsing fails.
  }
  return url;
}

export function pickBestVideoVariant<
  T extends { url: string; bitrate?: number; content_type?: string },
>(
  variants: T[],
): T | undefined {
  const mp4s = variants.filter((v) =>
    (v.content_type ?? "").includes("mp4") || v.url.includes(".mp4")
  );
  const pool = mp4s.length ? mp4s : variants;
  return [...pool].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

function reviewedProxyMediaUrl(value: unknown): string | undefined {
  const { accepted } = filterReviewedRemoteMediaItems([{ url: value }], 1);
  const url = accepted[0]?.url;
  return typeof url === "string" ? url : undefined;
}

function resolveXMediaErrorCode(error: unknown): string {
  return error instanceof RemoteMediaPolicyError
    ? error.code
    : "resolve_x_media_fetch_failed";
}

export async function resolveXMedia(
  username: string,
  tweetId: string,
  deps: ResolveXMediaDeps = {},
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const { body, response } = await fetchReviewedRemoteJson(
      "fxtwitter",
      `https://api.fxtwitter.com/${username}/status/${tweetId}`,
      { fetchImpl, resolveDns: deps.resolveDns },
    );
    if (response.ok) {
      const json = asRecord(body);
      const t = asRecord(json.tweet);
      const mediaObject = asRecord(t.media);
      if (
        Object.keys(t).length > 0 &&
        (asRecordArray(mediaObject.videos).length ||
          asRecordArray(mediaObject.photos).length)
      ) {
        const media: ResolvedMedia[] = [];

        for (const v of asRecordArray(mediaObject.videos).slice(
          0,
          MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
        )) {
          if (media.length >= MAX_REMOTE_MEDIA_CANDIDATES_PER_POST) break;
          const variantCandidates = asRecordArray(v.variants).slice(
            0,
            MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
          ).flatMap((variant) => {
            const url = typeof variant.url === "string" ? variant.url : "";
            if (!url) return [];
            return [{
              url,
              bitrate: typeof variant.bitrate === "number"
                ? variant.bitrate
                : undefined,
              content_type: typeof variant.content_type === "string"
                ? variant.content_type
                : undefined,
            }];
          });
          const { accepted: variants } = filterReviewedRemoteMediaItems(
            variantCandidates,
            MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
          );
          const fallbackUrl = reviewedProxyMediaUrl(v.url) ?? "";
          const best = pickBestVideoVariant(variants) ??
            (fallbackUrl ? { url: fallbackUrl, bitrate: undefined } : null);
          if (!best) continue;
          const w = typeof v.width === "number" ? v.width : null;
          const h = typeof v.height === "number" ? v.height : null;
          media.push({
            url: best.url,
            type: v.type === "gif" ? "gif" : "video",
            thumbnail_url: reviewedProxyMediaUrl(v.thumbnail_url),
            resolution: w && h ? `${w}x${h}` : undefined,
            bitrate: best.bitrate ? Math.round(best.bitrate / 1000) : undefined,
            qualityLabel: best.bitrate && h
              ? `${h}p @ ${(best.bitrate / 1_000_000).toFixed(1)}Mbps`
              : best.bitrate
              ? `${(best.bitrate / 1_000_000).toFixed(1)}Mbps`
              : "best",
          });
        }

        const remainingMediaCandidates = Math.max(
          0,
          MAX_REMOTE_MEDIA_CANDIDATES_PER_POST - media.length,
        );
        for (const p of asRecordArray(mediaObject.photos).slice(
          0,
          remainingMediaCandidates,
        )) {
          const url = typeof p.url === "string" ? p.url : "";
          if (!url) continue;
          const width = typeof p.width === "number" ? p.width : null;
          const height = typeof p.height === "number" ? p.height : null;
          media.push({
            url: upgradeImageUrl(url),
            type: "image",
            resolution: width && height ? `${width}x${height}` : undefined,
            qualityLabel: "original",
          });
        }

        const { accepted: reviewedMedia } = filterReviewedRemoteMediaItems(media);
        if (reviewedMedia.length) {
          const author = asRecord(t.author);
          return {
            user_name: typeof author.name === "string" ? author.name : username,
            user_screen_name: typeof author.screen_name === "string"
              ? author.screen_name
              : username,
            user_profile_image_url: reviewedProxyMediaUrl(author.avatar_url),
            tweetID: tweetId,
            media: reviewedMedia,
          };
        }
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({
      function: "admin-actions",
      action: "resolve_x_media",
      provider: "fxtwitter",
      ok: false,
      error: resolveXMediaErrorCode(err),
    }));
  }

  let vx: Record<string, unknown>;
  try {
    const { body, response } = await fetchReviewedRemoteJson(
      "vxtwitter",
      `https://api.vxtwitter.com/${username}/status/${tweetId}`,
      { fetchImpl, resolveDns: deps.resolveDns },
    );
    if (!response.ok) {
      throw new Error("resolve_x_media_provider_not_ok");
    }
    vx = asRecord(body);
  } catch (err) {
    console.warn(JSON.stringify({
      function: "admin-actions",
      action: "resolve_x_media",
      provider: "vxtwitter",
      ok: false,
      error: resolveXMediaErrorCode(err),
    }));
    throw new Error(
      "Failed to fetch tweet. The post might be private, deleted, or rate-limited.",
    );
  }
  const candidates: ResolvedMedia[] = asRecordArray(vx.media_extended).slice(
    0,
    MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
  ).flatMap(
    (m) => {
      const url = typeof m.url === "string" ? m.url : "";
      if (!url) return [];
      const type = m.type === "video" || m.type === "gif" || m.type === "image"
        ? m.type
        : "image";
      const isVideo = type === "video" || type === "gif";
      const size = asRecord(m.size);
      const width = typeof size.width === "number" ? size.width : null;
      const height = typeof size.height === "number" ? size.height : null;
      return [{
        url: isVideo ? url : upgradeImageUrl(url),
        type,
        thumbnail_url: reviewedProxyMediaUrl(m.thumbnail_url),
        resolution: width && height ? `${width}x${height}` : undefined,
        qualityLabel: isVideo ? "best available" : "original",
      }];
    },
  );
  const { accepted: items } = filterReviewedRemoteMediaItems(candidates);

  if (!items.length) throw new Error("No media found in this post.");

  return {
    user_name: vx.user_name,
    user_screen_name: vx.user_screen_name,
    user_profile_image_url: reviewedProxyMediaUrl(vx.user_profile_image_url),
    tweetID: tweetId,
    media: items,
  };
}

export async function queueHydrationJob(
  supabase: SupabaseAdminClient,
  tweetId: string,
  source: string,
  deps: QueueHydrationDeps,
): Promise<{ queued: boolean; reason?: string }> {
  const { data: insertedJob, error } = await table(supabase, "jobs").upsert({
    type: "hydrate_tweet",
    payload: { tweet_id: tweetId, source },
    status: "pending",
    priority: 15,
    idempotency_key: `hydrate:${source}:${tweetId}`,
    next_run_at: nowIso(deps),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const inserted = insertedJob !== null && typeof insertedJob === "object" && !Array.isArray(insertedJob) && typeof (insertedJob as Record<string, unknown>).id === "string";
  if (insertedJob !== null && !inserted) throw new Error("hydrate_enqueue_invalid_response");
  if (!inserted) return { queued: false, reason: "hydrate_job_already_exists" };
  await deps.insertAdminPipelineEvent(supabase, tweetId, "hydrate", "queued", { source });
  return { queued: true };
}

function xQuotaBlock(snapshot: {
  posts_1h: number;
  posts_24h: number;
  posts_30d: number;
  media_24h: number;
}, limits: typeof DEFAULT_X_RATE_LIMIT_DIAG_CONFIG): string | null {
  if (snapshot.posts_1h >= limits.posts_per_hour) return "rate_limit_hour";
  if (snapshot.posts_24h >= limits.posts_per_day) return "rate_limit_day";
  if (snapshot.posts_30d >= limits.monthly_post_budget) {
    return "rate_limit_month";
  }
  if (snapshot.media_24h >= limits.media_uploads_per_day) {
    return "rate_limit_media";
  }
  return null;
}

export async function getXPostingDiagnostics(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: { now?: () => Date } = {},
) {
  const MAX_ACTIVE_JOBS_PER_DIAGNOSTIC = 50;
  const MAX_MEDIA_ROWS_PER_DIAGNOSTIC = 50;
  const now = deps.now?.() ?? new Date();
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
  const [settingsRows, threshold] = await Promise.all([
    table(supabase, "settings").select("key, value").in("key", [
      "x_posting_config",
      "x_rate_limits",
      "enrichment_config",
    ]),
    loadActiveThreshold(supabase),
  ]);
  if (settingsRows.error) {
    return { success: false, error: "x_diagnostics_settings_read_failed" };
  }
  if (!Array.isArray(settingsRows.data)) {
    return { success: false, error: "x_diagnostics_settings_invalid_response" };
  }
  if (settingsRows.data.some((row) =>
    !hasNonEmptyStringField(row, "key")
  )) {
    return { success: false, error: "x_diagnostics_settings_invalid_row" };
  }
  const settings = Object.fromEntries(
    settingsRows.data.map(
      (
        row,
      ) => [
        String((row as Record<string, unknown>).key),
        (row as Record<string, unknown>).value,
      ],
    ),
  );
  const xCfg = mergeRecord(
    DEFAULT_X_POSTING_DIAG_CONFIG,
    settings.x_posting_config,
  );
  const xLimits = mergeRecord(
    DEFAULT_X_RATE_LIMIT_DIAG_CONFIG,
    settings.x_rate_limits,
  );
  const enrichCfg = normalizeEnrichmentConfig(
    (settings.enrichment_config ?? { enabled: false }) as Partial<
      EnrichmentConfig
    >,
  );
  const enrichmentRequiredForX = doesEnrichmentBlockX(enrichCfg);
  const allowCompletedEnrichment = allowCompletedEnrichmentForPosting(
    enrichCfg,
  );

  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(
    now.getTime() - 30 * 24 * 3600 * 1000,
  ).toISOString();
  const [posts1h, posts24h, posts30d, media24h] = await Promise.all([
    table(supabase, "x_deliveries").select("id", {
      count: "exact",
      head: true,
    }).eq("status", "posted").gte("created_at", since1h),
    table(supabase, "x_deliveries").select("id", {
      count: "exact",
      head: true,
    }).eq("status", "posted").gte("created_at", since24h),
    table(supabase, "x_deliveries").select("id", {
      count: "exact",
      head: true,
    }).eq("status", "posted").gte("created_at", since30d),
    table(supabase, "x_deliveries").select("id", {
      count: "exact",
      head: true,
    }).eq("status", "posted").gt("media_count", 0).gte(
      "created_at",
      since24h,
    ),
  ]);
  if (posts1h.error || posts24h.error || posts30d.error || media24h.error) {
    return { success: false, error: "x_diagnostics_quota_read_failed" };
  }
  const quotaSnapshot = {
    posts_1h: posts1h.count ?? 0,
    posts_24h: posts24h.count ?? 0,
    posts_30d: posts30d.count ?? 0,
    media_24h: media24h.count ?? 0,
  };
  const quotaReason = xQuotaBlock(quotaSnapshot, xLimits);

  let q = table(supabase, "posts")
    .select(
      "tweet_id, text_original, text_translated, created_at, url, author_handle, has_media, delivery_decision, decision_reason, final_score, base_score, learned_score, learned_delta, x_gate_score, learning_confidence, score_breakdown, importance_score, dup_of_tweet_id, dedupe_status, dedupe_reason, is_truncated, hydrated_at, enrich_status, final_x_text",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tweetId) q = q.eq("tweet_id", tweetId).limit(1);
  const { data: posts, error } = await q;
  if (error) return { success: false, error: "x_diagnostics_posts_read_failed" };
  if (!Array.isArray(posts)) {
    return { success: false, error: "x_diagnostics_posts_invalid_response" };
  }
  if (posts.some((row) =>
    !hasNonEmptyStringField(row, "tweet_id")
  )) {
    return { success: false, error: "x_diagnostics_posts_invalid_row" };
  }
  const candidateRes = await supabase.rpc("get_x_post_candidates", {
    candidate_limit: limit,
    target_tweet_id: tweetId || null,
  }).then(
    (value) => value,
    (candidateError: unknown) => ({ data: null, error: candidateError }),
  );
  if (candidateRes.error) {
    return { success: false, error: "x_diagnostics_candidates_read_failed" };
  }
  if (!Array.isArray(candidateRes.data)) {
    return { success: false, error: "x_diagnostics_candidates_invalid_response" };
  }
  const sqlCandidatesById = new Map<string, Record<string, unknown>>();
  for (const row of candidateRes.data as Array<Record<string, unknown>>) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { success: false, error: "x_diagnostics_candidates_invalid_row" };
    }
    const id = String(row.tweet_id ?? "");
    if (id) sqlCandidatesById.set(id, row);
  }

  const dedupeCutoff = new Date(
    now.getTime() - Number(xCfg.dedupe_window_hours || 48) * 3600 * 1000,
  ).toISOString();
  const maxCandidateAgeMinutes = Math.max(
    1,
    Math.min(
      1440,
      Number(xCfg.max_candidate_age_minutes ?? 30) || 30,
    ),
  );
  const freshnessCutoff = new Date(
    now.getTime() - maxCandidateAgeMinutes * 60 * 1000,
  ).toISOString();
  const startFrom = typeof xCfg.start_posting_from === "string"
    ? xCfg.start_posting_from
    : null;
  const effectiveCutoff = [dedupeCutoff, freshnessCutoff, startFrom].filter((
    value,
  ): value is string => !!value).sort().at(-1) ?? freshnessCutoff;

  const items: Array<Record<string, unknown>> = [];
  for (const post of posts as Array<Record<string, unknown>>) {
    const tid = post.tweet_id as string;
    const [latestX, activeJobs, mediaRows] = await Promise.all([
      table(supabase, "x_deliveries")
        .select(
          "status, skip_reason, last_error, x_tweet_id, posted_at, created_at",
        )
        .eq("post_id", tid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      table(supabase, "jobs")
        .select("type, status, last_error, created_at")
        .in("status", ["pending", "running"])
        .filter("payload->>tweet_id", "eq", tid)
        .order("created_at", { ascending: false })
        .limit(MAX_ACTIVE_JOBS_PER_DIAGNOSTIC),
      table(supabase, "media")
        .select(
          "id, downloaded_at, storage_path, kind, mime_type, file_size, duration_ms, src_url",
        )
        .eq("tweet_id", tid)
        .limit(MAX_MEDIA_ROWS_PER_DIAGNOSTIC),
    ]);
    if (latestX.error || activeJobs.error || mediaRows.error) {
      return { success: false, error: "x_diagnostics_post_detail_read_failed" };
    }
    if (!Array.isArray(activeJobs.data) || !Array.isArray(mediaRows.data)) {
      return { success: false, error: "x_diagnostics_post_detail_invalid_response" };
    }
    const blockers: XDiagnosticBlocker[] = [];
    const notes: XDiagnosticBlocker[] = [];
    const {
      xGateScore,
      baseScore,
      learnedScore,
      learnedDelta,
    } = resolveXGateScore(post);
    const finalScore = finiteNumber(post.final_score);
    const score = xGateScore;
    const hasTranslation = typeof post.text_translated === "string" &&
      post.text_translated.trim().length > 0;
    const latestStatus = asRecord(latestX.data).status as string | undefined;
    const jobs =
      (Array.isArray(activeJobs.data) ? activeJobs.data : []) as Array<
        Record<string, unknown>
      >;
    const activeJobTypes = new Set(jobs.map((job) => String(job.type)));
    const activeEnrichJob = jobs.some((job) => job.type === "enrich");
    const activeMediaJob = jobs.some((job) =>
      job.type === "resolve_media" || job.type === "download_media"
    );
    const activeHydrateJob = jobs.some((job) => job.type === "hydrate_tweet");
    const media =
      (Array.isArray(mediaRows.data) ? mediaRows.data : []) as XMediaRow[];
    const downloadedMedia = media.filter((row) =>
      row.downloaded_at && row.storage_path
    ).length;
    const mediaSelection = selectMediaTier(media, {
      allowVideo: xCfg.allow_video === true,
    });
    const enrichStatus = typeof post.enrich_status === "string"
      ? post.enrich_status
      : null;
    const enrichmentApproved = enrichStatus === "approved" ||
      enrichStatus === "enriched" ||
      (enrichStatus === "completed" && allowCompletedEnrichment);

    if (!xCfg.enabled) {
      blockers.push({
        code: "x_disabled",
        label: "X posting is disabled in Settings",
        severity: "blocker",
      });
    }
    if (post.created_at && String(post.created_at) < effectiveCutoff) {
      blockers.push({
        code: "outside_x_auto_freshness_window",
        label:
          `Older than X auto-post freshness window (${maxCandidateAgeMinutes}m)`,
        severity: "blocker",
      });
    }
    if (!hasTranslation) {
      blockers.push({
        code: "missing_translation",
        label: "Missing Persian translation",
        severity: "blocker",
      });
    }
    if (score == null) {
      blockers.push({
        code: "missing_score",
        label: "Missing editorial score",
        severity: "blocker",
      });
    } else if (score < Number(xCfg.min_score || threshold)) {
      blockers.push({
        code: "score_below_x_min",
        label: `X gate score ${score} is below X minimum ${
          xCfg.min_score || threshold
        }`,
        severity: "blocker",
      });
    }
    if (
      xCfg.post_only_decision_deliver && post.delivery_decision !== "deliver"
    ) {
      blockers.push({
        code: "decision_not_deliver",
        label: `Decision is ${post.delivery_decision ?? "unset"}`,
        severity: "blocker",
      });
    }
    const duplicateSkipReason = duplicateXSkipReason(
      post as {
        dedupe_status?: string | null;
        dup_of_tweet_id?: string | null;
        dedupe_reason?: string | null;
      },
    );
    if (duplicateSkipReason) {
      blockers.push({
        code: "duplicate_gate",
        label: `Duplicate of ${post.dup_of_tweet_id ?? "another post"}`,
        severity: "blocker",
      });
    } else if (post.dedupe_status === "coverage_gap") {
      notes.push({
        code: "coverage_gap",
        label: `Possible duplicate is not covered yet (${
          post.dup_of_tweet_id ?? "no canonical"
        })`,
        severity: "note",
      });
    } else if (post.dedupe_status === "uncertain" && post.dup_of_tweet_id) {
      notes.push({
        code: "possible_duplicate",
        label:
          `Possible duplicate of ${post.dup_of_tweet_id}; human review or re-run dedupe recommended`,
        severity: "note",
      });
    }
    if (post.is_truncated === true && !post.hydrated_at) {
      blockers.push({
        code: activeHydrateJob ? "hydration_pending" : "waiting_hydration",
        label: activeHydrateJob
          ? "Hydration job is pending/running"
          : "Tweet is truncated and needs hydration before X",
        severity: "deferred",
      });
    }
    const latestXData = asRecord(latestX.data);
    if (latestStatus === "posted") {
      blockers.push({
        code: "already_posted",
        label: `Already posted to X${
          latestXData.x_tweet_id ? ` (${latestXData.x_tweet_id})` : ""
        }`,
        severity: "blocker",
      });
    }
    if (latestStatus === "posting" || latestStatus === "pending") {
      blockers.push({
        code: `active_x_${latestStatus}`,
        label: latestStatus === "posting"
          ? "X post is already being claimed/posting"
          : "X post retry is pending",
        severity: "deferred",
      });
    }
    if (latestStatus === "failed" || latestStatus === "skipped") {
      blockers.push({
        code: `previous_x_${latestStatus}`,
        label: `Previous X row is ${latestStatus}; automatic retry is disabled`,
        severity: "blocker",
      });
    }
    if (
      enrichmentRequiredForX && enrichStatus && !enrichmentApproved &&
      enrichStatus !== "skipped"
    ) {
      blockers.push({
        code: `enrichment_${enrichStatus}`,
        label: `Required enrichment is ${enrichStatus}`,
        severity: "blocker",
      });
    } else if (enrichStatus === "pending" && !activeEnrichJob) {
      notes.push({
        code: "stale_enrichment_pending_ignored",
        label:
          "Stale enrichment pending is ignored because enrichment is not required for X",
        severity: "note",
      });
    } else if (
      enrichStatus && !enrichmentApproved && enrichStatus !== "skipped"
    ) {
      notes.push({
        code: `enrichment_${enrichStatus}_not_required`,
        label: `Enrichment is ${enrichStatus}, but plain X posting is allowed`,
        severity: "note",
      });
    }
    if (post.has_media === true && mediaSelection.tier === "blocked") {
      const labels: Record<string, string> = {
        video_pending_resolution: activeMediaJob
          ? "Video is resolving/downloading"
          : "Video media needs resolution before X",
        video_media_mismatch:
          "Video row has non-video bytes; X posting is blocked until media is re-resolved",
        video_disabled_by_config: "Video posting is disabled in Settings",
      };
      blockers.push({
        code: mediaSelection.reason ?? "media_blocked",
        label: labels[mediaSelection.reason ?? ""] ??
          `Media blocked: ${mediaSelection.reason ?? "unknown reason"}`,
        severity: mediaSelection.reason === "video_disabled_by_config"
          ? "blocker"
          : "deferred",
      });
    } else if (post.has_media === true && downloadedMedia === 0) {
      blockers.push({
        code: activeMediaJob ? "media_pending" : "media_missing",
        label: activeMediaJob
          ? "Media is still resolving/downloading"
          : "Source has media but no downloaded X-uploadable media",
        severity: "deferred",
      });
    }
    if (quotaReason) {
      blockers.push({
        code: quotaReason,
        label: `X quota blocked: ${quotaReason}`,
        severity: "blocker",
      });
    }

    const eligible = blockers.length === 0;
    const sqlCandidate = sqlCandidatesById.get(tid) ?? null;
    items.push({
      tweet_id: tid,
      eligible,
      blockers,
      notes,
      score,
      x_gate_score: xGateScore,
      base_score: baseScore,
      learned_score: learnedScore,
      learned_delta: learnedDelta,
      final_score: finalScore,
      learning_confidence: post.learning_confidence ?? null,
      threshold: xCfg.min_score || threshold,
      decision: post.delivery_decision ?? null,
      latest_x: latestX.data ?? null,
      candidate: {
        sql_gate_passed: Boolean(sqlCandidate),
        reason: sqlCandidate?.candidate_reason ??
          (eligible ? "local_gate_only" : "blocked"),
        age_ms: sqlCandidate?.candidate_age_ms ??
          (post.created_at
            ? now.getTime() - new Date(String(post.created_at)).getTime()
            : null),
        dispatch_source: sqlCandidate?.dispatch_source ?? null,
      },
      active_jobs: jobs.map((job) => ({
        type: job.type,
        status: job.status,
        error: job.last_error ?? null,
      })),
      active_job_types: [...activeJobTypes],
      hydration: {
        is_truncated: post.is_truncated === true,
        hydrated_at: post.hydrated_at ?? null,
        active_hydrate_job: activeHydrateJob,
      },
      media: {
        has_media: post.has_media === true,
        rows: media.length,
        downloaded: downloadedMedia,
        active_media_job: activeMediaJob,
        selected_tier: mediaSelection.tier,
        selected_reason: mediaSelection.reason ?? null,
        row_details: media.map((row) => ({
          id: row.id ?? null,
          kind: row.kind ?? null,
          mime_type: row.mime_type ?? null,
          file_size: row.file_size ?? null,
          downloaded: Boolean(row.downloaded_at && row.storage_path),
          video_intent: hasVideoIntent(row),
          sendable: isValidVideoDownload(row) || isSendableImage(row),
          role: String(row.kind ?? "").toLowerCase() === "thumbnail"
            ? "thumbnail_only"
            : hasVideoIntent(row)
            ? isValidVideoDownload(row) ? "sendable_video" : "video_blocked"
            : isSendableImage(row)
            ? "sendable_image"
            : "not_sendable",
        })),
      },
      enrichment: {
        status: enrichStatus,
        pipeline_mode: enrichCfg.pipeline_mode,
        required_for_x: enrichmentRequiredForX,
        approved_for_text: enrichmentApproved,
        text_source: enrichmentApproved &&
            typeof post.final_x_text === "string" && post.final_x_text.trim()
          ? "approved_enrichment"
          : "plain_translation",
      },
    });
  }

  return {
    success: true,
    diagnostics: {
      generated_at: now.toISOString(),
      config: {
        x_enabled: xCfg.enabled,
        x_min_score: xCfg.min_score,
        start_posting_from: xCfg.start_posting_from,
        effective_cutoff: effectiveCutoff,
        enrichment_pipeline_mode: enrichCfg.pipeline_mode,
        enrichment_required_for_x: enrichmentRequiredForX,
      },
      quota: {
        ...quotaSnapshot,
        blocked_reason: quotaReason,
      },
      eligible_candidates: items.filter((item) => item.eligible),
      rejected_or_deferred_candidates: items.filter((item) => !item.eligible),
      items,
    },
  };
}

export async function hydratePostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: QueueHydrationDeps,
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tweetId)) {
    return { body: { ok: false, error: "tweet_id is required" }, status: 400 };
  }
  const result = await queueHydrationJob(
    supabase,
    tweetId,
    "manual_monitoring",
    deps,
  );
  return {
    body: await addAdminOperationEnvelope(
      supabase,
      typeof body.operation_id === "string" ? body.operation_id : undefined,
      { ok: true, queued: result.queued, reason: result.reason },
    ),
  };
}

export async function resolveXMediaAdminAction(
  body: Record<string, unknown>,
  deps: ResolveXMediaDeps = {},
): Promise<AdminActionResponse> {
  const username = typeof body.username === "string"
    ? body.username.trim()
    : "";
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (
    !/^[A-Za-z0-9_]{1,15}$/.test(username) || !/^[0-9]{5,32}$/.test(tweetId)
  ) {
    return {
      body: { error: "Valid username and tweet_id are required" },
      status: 400,
    };
  }
  const tweet = await resolveXMedia(username, tweetId, deps);
  return { body: { success: true, tweet: toResolveXMediaClientMetadata(tweet) } };
}

export async function runXPostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  action: "dry_run_x_post" | "retry_x_post",
  deps: RunXPostDeps,
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string"
    ? body.tweet_id.trim()
    : null;
  const supabaseUrl = readEnv("SUPABASE_URL", deps);
  const svcKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", deps);

  // Force/retry is a cost-bearing self-heal path. Check the shared breaker
  // before any rescore, queue, or other downstream work.
  if (action === "retry_x_post") {
    try {
      await requireExternalPosting(
        runtimeControlsClient(supabase),
        externalPostingOptions(deps),
      );
    } catch (error) {
      if (error instanceof ExternalPostingBlockedError) {
        return {
          body: {
            ok: false,
            locked: true,
            code: "external_posting_blocked",
            reason: error.reason,
            prep: { ran: false, ok: true },
          },
          status: 200,
        };
      }
      throw error;
    }
  }

  const { data: xPostingRow, error: xPostingConfigError } = await table(supabase, "settings").select(
    "value",
  )
    .eq("key", "x_posting_config")
    .maybeSingle();
  const xPostingValue = xPostingRow && typeof xPostingRow === "object" &&
      !Array.isArray(xPostingRow)
    ? (xPostingRow as Record<string, unknown>).value
    : null;
  if (
    xPostingConfigError ||
    xPostingRow === null ||
    typeof xPostingRow !== "object" ||
    Array.isArray(xPostingRow) ||
    xPostingValue === null ||
    typeof xPostingValue !== "object" ||
    Array.isArray(xPostingValue)
  ) {
    return {
      body: { ok: false, error: "x_posting_config_unavailable" },
      status: 503,
    };
  }
  const xPostingCfg = asRecord(xPostingValue);
  const xPostingEnabled = xPostingCfg.enabled === true;
  if (action === "retry_x_post" && !xPostingEnabled) {
    return {
      body: {
        ok: false,
        skipped: true,
        error:
          "X posting is turned off in Settings -> X Automation. Turn on Enable X posting before posting to X.",
      },
      status: 200,
    };
  }

  let prep: {
    ran: boolean;
    ok: boolean;
    score?: number;
    decision?: string;
    error?: string;
    hydrate?: string;
  } = { ran: false, ok: true };

  if (tweetId && action === "retry_x_post") {
    const { data: existing, error: existingError } = await table(supabase, "posts")
      .select(
        "text_translated, importance_score, final_score, base_score, learned_score, learned_delta, x_gate_score, learning_confidence, score_breakdown, is_truncated, hydrated_at, dedupe_status, dup_of_tweet_id, dedupe_reason",
      )
      .eq("tweet_id", tweetId)
      .maybeSingle();
    if (existingError) {
      return {
        body: { ok: false, error: "x_post_preflight_read_failed", prep },
        status: 503,
      };
    }
    if (existing !== null && (typeof existing !== "object" || Array.isArray(existing))) {
      return {
        body: { ok: false, error: "x_post_preflight_read_failed", prep },
        status: 503,
      };
    }
    const existingPost = asRecord(existing);
    const duplicateSkipReason = duplicateXSkipReason(
      existingPost as {
        dedupe_status?: string | null;
        dup_of_tweet_id?: string | null;
        dedupe_reason?: string | null;
      },
    );
    if (duplicateSkipReason) {
      return {
        body: {
          ok: false,
          skipped: true,
          status: "skipped",
          reason: "duplicate_gate",
          error:
            "This post is marked as a duplicate. Clear or override the duplicate first before forcing X.",
          dup_of_tweet_id: existingPost.dup_of_tweet_id ?? null,
        },
        status: 200,
      };
    }
    const translated = typeof existingPost.text_translated === "string"
      ? existingPost.text_translated
      : "";
    const needsRescore = Object.keys(existingPost).length === 0 ||
      translated.trim().length === 0 ||
      existingPost.importance_score == null ||
      existingPost.final_score == null;
    if (needsRescore) {
      const r = await deps.runRescore(supabase, tweetId);
      prep = {
        ran: true,
        ok: r.ok,
        score: r.score,
        decision: r.decision,
        error: r.ok ? undefined : "pre_post_rescore_failed",
      };
      if (!r.ok) {
        return {
          body: {
            ok: false,
            error: "pre_post_rescore_failed",
            prep,
          },
          status: 502,
        };
      }
    }

    const { data: afterPrep, error: afterPrepError } = await table(supabase, "posts")
      .select("is_truncated, hydrated_at")
      .eq("tweet_id", tweetId)
      .maybeSingle();
    if (afterPrepError || (afterPrep !== null && (typeof afterPrep !== "object" || Array.isArray(afterPrep)))) {
      return {
        body: { ok: false, error: "x_post_preflight_read_failed", prep },
        status: 503,
      };
    }
    const postAfterPrep = asRecord(afterPrep);
    if (postAfterPrep.is_truncated === true && !postAfterPrep.hydrated_at) {
      const hydrate = await queueHydrationJob(
        supabase,
        tweetId,
        "force_x",
        deps,
      );
      return {
        body: {
          ok: true,
          status: "waiting_hydration",
          queued: hydrate.queued ? "hydrate" : false,
          reason: hydrate.reason ??
            "truncated_post_requires_hydration_before_x",
          prep: {
            ...prep,
            hydrate: hydrate.queued ? "queued" : hydrate.reason,
          },
        },
        status: 200,
      };
    }
  }

  try {
    try {
      await requireExternalPosting(
        runtimeControlsClient(supabase),
        externalPostingOptions(deps),
      );
    } catch (error) {
      if (error instanceof ExternalPostingBlockedError) {
        return {
          body: {
            ok: false,
            locked: true,
            code: "external_posting_blocked",
            reason: error.reason,
            prep,
          },
          status: 200,
        };
      }
      throw error;
    }
    const resp = await (deps.fetchImpl ?? fetch)(
      `${supabaseUrl}/functions/v1/x-poster`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${svcKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dry_run: action === "dry_run_x_post",
          force_retry: action === "retry_x_post",
          dispatch_source: action === "retry_x_post"
            ? "admin_retry"
            : "admin_dry_run",
          ...(tweetId ? { tweet_id: tweetId } : {}),
        }),
      },
    );
    const text = await resp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (!resp.ok) {
      return {
        body: {
          ok: false,
          error: "x_poster_request_failed",
          code: "x_poster_http_failure",
          prep,
        },
        status: 502,
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        body: {
          ok: false,
          error: "x_poster_invalid_response",
          code: "x_poster_invalid_response",
          prep,
        },
        status: 502,
      };
    }
    const parsedObj = asRecord(parsed);
    if (parsedObj.ok !== true) {
      return {
        body: {
          ok: false,
          error: "x_poster_unconfirmed",
          code: "x_poster_unconfirmed",
          prep,
        },
        status: 502,
      };
    }
    const results = Array.isArray(parsedObj.results)
      ? parsedObj.results as Array<Record<string, unknown>>
      : [];
    const result = tweetId ? results[0] ?? null : null;
    if (
      tweetId && action === "retry_x_post" &&
      (!result || result.status === "failed" || result.status === "ambiguous")
    ) {
      return {
        body: {
          ok: false,
          error: result?.status === "ambiguous"
            ? "x_poster_ambiguous"
            : "x_poster_failed",
          code: result?.status === "ambiguous"
            ? "x_poster_ambiguous"
            : "x_poster_failed",
          status: result?.status ?? "missing_result",
          prep,
        },
        status: 502,
      };
    }
    if (tweetId && action === "retry_x_post" && result?.status === "posted") {
      await deps.recordFeedback(supabase, tweetId, "force_x", 1).catch(
        () => {},
      );
      const { error: feedbackLockError } = await table(supabase, "posts").update({ feedback_locked: true }).eq(
        "tweet_id",
        tweetId,
      );
      if (feedbackLockError) throw feedbackLockError;
    }
    return {
      body: {
        ok: true,
        prep,
        ...(parsed as Record<string, unknown>),
        ...(result
          ? {
            status: result.status as string | undefined,
            x_tweet_id: result.x_tweet_id as string | undefined,
            error: result.error as string | undefined,
          }
          : {}),
      },
    };
  } catch (e) {
    return {
      body: { ok: false, error: safeAdminActionErrorCode(e), code: "x_poster_request_failed", prep },
      status: 502,
    };
  }
}

export function looksTruncatedForHydration(
  raw: string | null | undefined,
): boolean {
  if (!raw) return false;
  const t = raw.trim();
  if (!t) return false;
  if (/(^|\s)(show\s+more|show\s+this\s+thread|read\s+more)\s*$/i.test(t)) {
    return true;
  }
  if (/(\u2026|\.{3}|\[\u2026\]|\[\.{3}\])\s*$/.test(t) && t.length >= 200) {
    return true;
  }
  if (t.length >= 270) {
    const last = t.charAt(t.length - 1);
    if (
      ![".", "!", "?", "\u061F", '"', ")", "\u201D", "\u300D"].includes(last)
    ) {
      return true;
    }
  }
  if (/\b(pic\.?|pic\.t|pic\.tw(?:itter)?(?:\.c(?:om?)?)?\/?)\s*$/i.test(t)) {
    return true;
  }
  if (t.length >= 240 && /(\u2026|\[\u2026\]|\.{3}|\[\.{3}\])/.test(t)) {
    const last = t.charAt(t.length - 1);
    if (!['"', ")", "\u201D", "\u300D", "]", "}"].includes(last)) {
      return true;
    }
  }
  if (t.length >= 240) {
    const tokens = t.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || "";
    if (
      /^(a|an|the|to|of|in|on|for|and|or|but|with|by|at|as|is|was|are|were|has|have|had)\.?$/i
        .test(lastToken)
    ) {
      return true;
    }
  }
  return false;
}

export async function rehydrateRecentTruncatedAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: RehydrateRecentTruncatedDeps = {},
): Promise<AdminActionResponse> {
  const now = deps.now?.() ?? new Date();
  const hours = typeof body.hours === "number" && body.hours > 0 &&
      body.hours <= 168
    ? body.hours
    : 24;
  const dryRun = body.dry_run !== false;
  const force = body.force === true;
  const requestedMax = typeof body.max === "number" && body.max > 0
    ? Math.floor(body.max)
    : null;
  const threshold = await loadActiveThreshold(supabase);
  const { data: controlsRow, error: controlsError } = await table(supabase, "settings").select(
    "value",
  )
    .eq("key", "x_api_controls")
    .maybeSingle();
  if (controlsError) throw new Error("hydrate_backfill_controls_read_failed");
  const controls = asRecord(asRecord(controlsRow).value);
  const defaultMax = typeof controls.backfill_max_hydrate_jobs_per_run ===
      "number"
    ? controls.backfill_max_hydrate_jobs_per_run
    : 100;
  const maxJobs = Math.min(Math.max(requestedMax ?? defaultMax, 1), 500);
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  const { data: posts, error: fetchErr } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, url, delivery_decision, final_score, base_score, learned_score, learned_delta, x_gate_score, score_breakdown, importance_score",
    )
    .is("hydrated_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (fetchErr) {
    return { body: { ok: false, error: "hydrate_backfill_posts_read_failed" }, status: 503 };
  }

  if (!Array.isArray(posts) || posts.some((row) =>
    !hasNonEmptyStringField(row, "tweet_id")
  )) {
    return {
      body: { ok: false, error: "hydrate_backfill_posts_invalid_response" },
      status: 503,
    };
  }
  const rows = posts as Array<Record<string, unknown>>;
  const truncatedMatches = rows.filter((p) =>
    looksTruncatedForHydration(p.text_original as string | null)
  );
  const matches = truncatedMatches.filter((p) => {
    if (force) return true;
    const score = resolveXGateScore(p).xGateScore;
    return p.delivery_decision === "deliver" && typeof score === "number" &&
      score >= threshold;
  }).slice(0, maxJobs);
  const excludedByGate = truncatedMatches.length - matches.length;
  let queued = 0;
  let skippedExisting = 0;
  const errors: string[] = [];

  for (const p of matches) {
    const tweetId = p.tweet_id as string;
    const { data: existingJob, error: existingJobError } = await table(supabase, "jobs")
      .select("id")
      .eq("type", "hydrate_tweet")
      .in("status", ["pending", "running"])
      .filter("payload->>tweet_id", "eq", tweetId)
      .limit(1);
    if (existingJobError) {
      throw new Error("hydrate_backfill_pending_job_read_failed");
    }
    if (!Array.isArray(existingJob)) {
      throw new Error("hydrate_backfill_pending_job_invalid_response");
    }
    if (existingJob.length > 0) {
      skippedExisting++;
      continue;
    }

    if (dryRun) {
      queued++;
      continue;
    }

    const { error: upErr } = await table(supabase, "posts")
      .update({ is_truncated: true })
      .eq("tweet_id", tweetId);
    if (upErr) {
      errors.push("hydrate_backfill_post_update_failed");
      continue;
    }

    const { error: jobErr } = await table(supabase, "jobs")
      .upsert({
        type: "hydrate_tweet",
        payload: { tweet_id: tweetId },
        status: "pending",
        priority: 15,
        idempotency_key: `hydrate:backfill:${tweetId}`,
        next_run_at: nowIso({ now: () => now }),
      }, { onConflict: "idempotency_key", ignoreDuplicates: true });

    if (jobErr) {
      errors.push("hydrate_backfill_enqueue_failed");
      continue;
    }
    queued++;
  }

  return {
    body: {
      ok: true,
      dry_run: dryRun,
      scanned: rows.length,
      matched: matches.length,
      excluded_by_gate: excludedByGate,
      queued,
      skipped_existing: skippedExisting,
      max: maxJobs,
      hours,
      force,
      errors: errors.slice(0, 10),
    },
  };
}

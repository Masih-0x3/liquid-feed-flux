import { buildXPostText, type XPostTextConfig } from "../_shared/xPostText.ts";
import { normalizeVideoRenderConfigValue } from "../_shared/videoRenderConfig.ts";
import { selectSourceVideo, type VideoRenderRow } from "../_shared/videoRenderGate.ts";
import type { XMediaRow } from "../_shared/mediaSelection.ts";
import {
  fetchReviewedRemoteJson,
  filterReviewedRemoteMediaItems,
  MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
  type RemoteMediaDnsResolver,
} from "../_shared/remoteMediaPolicy.ts";
import { xOauthHeader, recordAdminXApiAttempt } from "./xApiActions.ts";
import { runDedupeAdminAction } from "./dedupeActions.ts";
import {
  ExternalPostingBlockedError,
  requireExternalPosting,
} from "../_shared/externalPostingGuard.ts";
import {
  fetchRuntimeControls,
  type RuntimeControlsQueryClient,
  type RuntimeControls,
} from "../_shared/runtimeControls.ts";
import { requireDeliveryCutover } from "../_shared/deliveryCutover.ts";
import type {
  AdminActionResponse,
  SupabaseAdminClient,
} from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  insert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
  ): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
};

type StorageClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): PromiseLike<{ data?: { signedUrl?: string }; error?: unknown }>;
    };
  };
};

type FunctionsClient = {
  functions: {
    invoke(
      name: string,
      options: Record<string, unknown>,
    ): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
  };
};

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RunTranslationOnlyFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<{ ok: boolean; translated?: string; model?: string; error?: string }>;

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

export type ManualVideoIntakeDeps = {
  runTranslationOnly?: RunTranslationOnlyFn;
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  requireExternalPosting?: (supabase: SupabaseAdminClient) => Promise<void>;
  fetchImpl?: FetchFn;
  resolveDns?: RemoteMediaDnsResolver;
  readEnv?: (key: string) => string | undefined;
  now?: () => Date;
};

async function loadManualRuntimeControls(
  supabase: SupabaseAdminClient,
): Promise<RuntimeControls> {
  return await fetchRuntimeControls(runtimeControlsClient(supabase));
}

function runtimeControlsClient(
  supabase: SupabaseAdminClient,
): RuntimeControlsQueryClient {
  return {
    from: () => {
      const query = supabase.from("runtime_controls") as {
        select: (columns: "*") => PromiseLike<QueryResult>;
      };
      return { select: (columns: "*") => query.select(columns) };
    },
  };
}

function pausedManualResponse(
  controls: RuntimeControls,
  extra: Record<string, unknown> = {},
): AdminActionResponse {
  return {
    body: {
      ok: true,
      paused: true,
      status: "paused",
      reason: "runtime_control_paused",
      dedupe_enabled: controls.dedupe_enabled,
      translation_enabled: controls.translation_enabled,
      retained: 0,
      enqueued: 0,
      ...extra,
    },
    status: 200,
  };
}

async function requireManualControls(
  supabase: SupabaseAdminClient,
  extra: Record<string, unknown> = {},
): Promise<{ controls: RuntimeControls } | AdminActionResponse> {
  try {
    const controls = await loadManualRuntimeControls(supabase);
    if (!controls.dedupe_enabled || !controls.translation_enabled) {
      return pausedManualResponse(controls, extra);
    }
    return { controls };
  } catch {
    return {
      body: {
        ok: false,
        error: "runtime_controls_unavailable",
        code: "runtime_controls_unavailable",
      },
      status: 503,
    };
  }
}

function manualExternalPostingOptions(deps: ManualVideoIntakeDeps): {
  environment: unknown;
  allowExternalPosting: unknown;
} {
  const env = deps.readEnv ?? ((key: string) => Deno.env.get(key));
  return {
    environment: env("XOT_ENVIRONMENT"),
    allowExternalPosting: env("ALLOW_EXTERNAL_POSTING"),
  };
}

async function runManualExternalPostingGuard(
  supabase: SupabaseAdminClient,
  deps: ManualVideoIntakeDeps,
): Promise<void> {
  if (deps.requireExternalPosting) {
    await deps.requireExternalPosting(supabase);
    return;
  }
  await requireExternalPosting(
    runtimeControlsClient(supabase),
    manualExternalPostingOptions(deps),
  );
}

type ParsedXPostUrl = {
  tweetId: string;
  handle: string | null;
  normalizedUrl: string;
};

type ResolvedTweetMetadata = {
  text: string | null;
  authorHandle: string | null;
  lang: string | null;
  createdAt: string | null;
  mediaRows: Array<{
    kind: "image" | "video";
    src_url: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    ordering: number;
  }>;
  source: "x_api" | "proxy" | "url_only";
  warning?: string | null;
};

const ACTIVE_STATUSES = new Set([
  "draft",
  "fetching",
  "media_resolving",
  "media_downloading",
  "translating",
  "render_queued",
  "rendering",
  "ready",
  "blocked",
  "post_requested",
  "failed",
]);

const DEFAULT_X_POST_CFG: XPostTextConfig = {
  post_template: "{leading_emoji} {translated_text}",
  leading_emoji: "📰",
  max_chars: 280,
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Array<Record<string, unknown>>
    : [];
}

function nowIso(deps?: Pick<ManualVideoIntakeDeps, "now">): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function readEnv(key: string, deps?: Pick<ManualVideoIntakeDeps, "readEnv">): string {
  return deps?.readEnv?.(key) ?? Deno.env.get(key) ?? "";
}

export function parseXPostUrl(input: string): ParsedXPostUrl | null {
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) =>
    part.toLowerCase() === "status" || part.toLowerCase() === "statuses"
  );
  if (statusIndex < 0 || !parts[statusIndex + 1]) return null;
  const tweetId = parts[statusIndex + 1].replace(/[^0-9].*$/, "");
  if (!/^[0-9]{5,32}$/.test(tweetId)) return null;
  const possibleHandle = statusIndex > 0 ? parts[statusIndex - 1] : null;
  const reserved = new Set(["i", "intent", "share", "search", "home"]);
  const handle = possibleHandle && /^[A-Za-z0-9_]{1,15}$/.test(possibleHandle) &&
      !reserved.has(possibleHandle.toLowerCase())
    ? possibleHandle
    : null;
  return {
    tweetId,
    handle,
    normalizedUrl: handle
      ? `https://x.com/${handle}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
  };
}

async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function isVideoLikeType(value: unknown): boolean {
  const type = String(value ?? "").toLowerCase();
  return type === "video" || type === "animated_gif" || type === "gif";
}

function pickBestVariant(media: Record<string, unknown>): string | null {
  const variants = Array.isArray(media.variants)
    ? media.variants.slice(0, MAX_REMOTE_MEDIA_CANDIDATES_PER_POST) as Array<Record<string, unknown>>
    : [];
  const videoVariants = variants.filter((variant) => {
    const url = typeof variant.url === "string" ? variant.url : "";
    const contentType = String(variant.content_type ?? "").toLowerCase();
    return url && (contentType.includes("mp4") || /\.mp4(?:[?#]|$)/i.test(url));
  });
  videoVariants.sort((a, b) => Number(b.bit_rate ?? 0) - Number(a.bit_rate ?? 0));
  return typeof videoVariants[0]?.url === "string" ? videoVariants[0].url : null;
}

function normalizeXApiMetadata(
  parsedUrl: ParsedXPostUrl,
  body: unknown,
): ResolvedTweetMetadata {
  const root = asRecord(body);
  const data = asRecord(root.data);
  const includes = asRecord(root.includes);
  const noteTweet = asRecord(data.note_tweet);
  const users = asRows(includes.users);
  const media = asRows(includes.media).slice(0, MAX_REMOTE_MEDIA_CANDIDATES_PER_POST);
  const author = users.find((user) => user.id === data.author_id) ?? users[0];
  const text = typeof noteTweet.text === "string"
    ? noteTweet.text
    : typeof data.text === "string"
    ? data.text
    : null;
  const authorHandle = typeof author?.username === "string"
    ? author.username
    : parsedUrl.handle;

  const mediaRows = media.flatMap((item, index) => {
    const kind: "image" | "video" = isVideoLikeType(item.type) ? "video" : "image";
    const src = kind === "video"
      ? pickBestVariant(item) ??
        (typeof item.url === "string" ? item.url : null) ??
        (typeof item.preview_image_url === "string" ? item.preview_image_url : null)
      : typeof item.url === "string"
      ? item.url
      : typeof item.preview_image_url === "string"
      ? item.preview_image_url
      : null;
    if (!src) return [];
    return [{
      kind,
      src_url: src,
      width: typeof item.width === "number" ? item.width : null,
      height: typeof item.height === "number" ? item.height : null,
      duration_ms: typeof item.duration_ms === "number" ? Math.round(item.duration_ms) : null,
      ordering: index,
    }];
  });

  return {
    text,
    authorHandle,
    lang: typeof data.lang === "string" ? data.lang : null,
    createdAt: typeof data.created_at === "string" ? data.created_at : null,
    mediaRows,
    source: "x_api",
  };
}

async function fetchTweetFromXApi(
  supabase: SupabaseAdminClient,
  parsedUrl: ParsedXPostUrl,
  deps: ManualVideoIntakeDeps,
): Promise<ResolvedTweetMetadata | null> {
  const ck = readEnv("TWITTER_CONSUMER_KEY", deps);
  const cs = readEnv("TWITTER_CONSUMER_SECRET", deps);
  const at = readEnv("TWITTER_ACCESS_TOKEN", deps);
  const ats = readEnv("TWITTER_ACCESS_TOKEN_SECRET", deps);
  if (!ck || !cs || !at || !ats) return null;

  const baseUrl = `https://api.x.com/2/tweets/${parsedUrl.tweetId}`;
  const queryParams = {
    "tweet.fields": "note_tweet,text,lang,created_at,author_id",
    "expansions": "author_id,attachments.media_keys",
    "user.fields": "username,name",
    "media.fields": "type,url,preview_image_url,duration_ms,width,height,variants",
  };
  const query = new URLSearchParams(queryParams).toString();
  const { body, response } = await fetchReviewedRemoteJson(
    "x_api",
    `${baseUrl}?${query}`,
    {
      authorization: await xOauthHeader("GET", baseUrl, queryParams, ck, cs, at, ats),
      fetchImpl: deps.fetchImpl ?? fetch,
      resolveDns: deps.resolveDns,
    },
  );
  await recordAdminXApiAttempt(supabase, {
    action: "manual_video_intake_lookup",
    endpoint: baseUrl,
    method: "GET",
    tweetId: parsedUrl.tweetId,
    estimatedBillableUnit: "post_read",
  }, response);
  if (!response.ok) {
    return {
      text: null,
      authorHandle: parsedUrl.handle,
      lang: null,
      createdAt: null,
      mediaRows: [],
      source: "url_only",
      warning: `x_api_${response.status}`,
    };
  }
  return normalizeXApiMetadata(parsedUrl, body);
}

async function fetchTweetFromProxy(
  parsedUrl: ParsedXPostUrl,
  deps: Pick<ManualVideoIntakeDeps, "fetchImpl" | "resolveDns"> = {},
): Promise<ResolvedTweetMetadata | null> {
  const handle = parsedUrl.handle;
  if (!handle) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const endpoints: Array<{
    provider: "fxtwitter" | "vxtwitter";
    source: "proxy";
    url: string;
  }> = [
    {
      provider: "fxtwitter",
      source: "proxy",
      url: `https://api.fxtwitter.com/${handle}/status/${parsedUrl.tweetId}`,
    },
    {
      provider: "vxtwitter",
      source: "proxy",
      url: `https://api.vxtwitter.com/${handle}/status/${parsedUrl.tweetId}`,
    },
  ];
  for (const endpoint of endpoints) {
    try {
      const { body, response } = await fetchReviewedRemoteJson(
        endpoint.provider,
        endpoint.url,
        { fetchImpl, resolveDns: deps.resolveDns },
      );
      if (!response.ok) continue;
      const json = asRecord(body);
      const tweet = asRecord(json.tweet || json);
      const author = asRecord(tweet.author || json.user);
      const text = typeof tweet.text === "string"
        ? tweet.text
        : typeof json.text === "string"
        ? json.text
        : null;
      const authorHandle = typeof author.screen_name === "string"
        ? author.screen_name
        : typeof author.username === "string"
        ? author.username
        : handle;
      if (text || authorHandle) {
        return {
          text,
          authorHandle,
          lang: null,
          createdAt: null,
          mediaRows: [],
          source: endpoint.source,
        };
      }
    } catch {
      // Try the next proxy.
    }
  }
  return null;
}

async function resolveTweetMetadata(
  supabase: SupabaseAdminClient,
  parsedUrl: ParsedXPostUrl,
  deps: ManualVideoIntakeDeps,
): Promise<ResolvedTweetMetadata> {
  const fromX = await fetchTweetFromXApi(supabase, parsedUrl, deps).catch(() => ({
    text: null,
    authorHandle: parsedUrl.handle,
    lang: null,
    createdAt: null,
    mediaRows: [],
    source: "url_only" as const,
    warning: "x_api_fetch_failed",
  }));
  if (fromX?.text || fromX?.mediaRows.length) return fromX;
  const fromProxy = await fetchTweetFromProxy(parsedUrl, deps);
  if (fromProxy?.text) return { ...fromProxy, warning: fromX?.warning ?? null };
  return {
    text: null,
    authorHandle: parsedUrl.handle,
    lang: null,
    createdAt: null,
    mediaRows: [],
    source: "url_only",
    warning: fromX?.warning ?? "tweet_lookup_unavailable",
  };
}

async function ensureAccountId(
  supabase: SupabaseAdminClient,
  handle: string | null,
): Promise<string | null> {
  const { data: accounts, error } = await table(supabase, "accounts")
    .select("id")
    .eq("enabled", true)
    .limit(1);
  if (error) throw error;
  const first = asRows(accounts)[0];
  if (typeof first?.id === "string") return first.id;

  const { data: inserted, error: insertError } = await table(supabase, "accounts")
    .insert({
      handle: handle || "manual-intake",
      display_name: handle ? `@${handle}` : "Manual Intake",
      enabled: true,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  const row = asRecord(inserted);
  return typeof row.id === "string" ? row.id : null;
}

async function loadPost(
  supabase: SupabaseAdminClient,
  tweetId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await table(supabase, "posts")
    .select(
      "tweet_id, account_id, url, text_original, text_translated, lang_original, tweeted_at, has_media, created_at, author_handle, is_truncated, hydrated_at, delivery_decision, decision_reason, final_score, importance_score, dedupe_status, dup_of_tweet_id, dup_similarity, dedupe_reason, final_x_text, composed_post_text, enrich_status",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error) throw error;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

async function upsertManualPost(
  supabase: SupabaseAdminClient,
  parsedUrl: ParsedXPostUrl,
  metadata: ResolvedTweetMetadata,
): Promise<{ post: Record<string, unknown> | null; existingPost: boolean; warning?: string | null }> {
  const existing = await loadPost(supabase, parsedUrl.tweetId);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.text_original && metadata.text) patch.text_original = metadata.text;
    if (!existing.url) patch.url = parsedUrl.normalizedUrl;
    if (!existing.author_handle && metadata.authorHandle) {
      patch.author_handle = metadata.authorHandle;
    }
    if (metadata.mediaRows.length > 0 && existing.has_media !== true) {
      patch.has_media = true;
    }
    if (!existing.delivery_decision && existing.decision_reason !== "manual_video_intake") {
      patch.delivery_decision = "manual_review";
      patch.decision_reason = "manual_video_intake";
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await table(supabase, "posts").update(patch)
        .eq("tweet_id", parsedUrl.tweetId);
      if (error) throw error;
    }
    return {
      post: await loadPost(supabase, parsedUrl.tweetId),
      existingPost: true,
      warning: existing.delivery_decision === "deliver"
        ? "existing_post_is_in_automatic_pipeline"
        : null,
    };
  }

  const accountId = await ensureAccountId(supabase, metadata.authorHandle ?? parsedUrl.handle);
  if (!accountId) throw new Error("No account available for manual intake post");
  const { error } = await table(supabase, "posts").upsert({
    tweet_id: parsedUrl.tweetId,
    account_id: accountId,
    text_original: metadata.text ?? `Manual X intake: ${parsedUrl.normalizedUrl}`,
    lang_original: metadata.lang ?? "auto",
    url: parsedUrl.normalizedUrl,
    tweeted_at: metadata.createdAt ? new Date(metadata.createdAt).toISOString() : new Date().toISOString(),
    has_media: true,
    author_handle: metadata.authorHandle ?? parsedUrl.handle,
    is_truncated: false,
    delivery_decision: "manual_review",
    decision_reason: "manual_video_intake",
  }, { onConflict: "tweet_id" });
  if (error) throw error;
  return { post: await loadPost(supabase, parsedUrl.tweetId), existingPost: false };
}

async function upsertResolvedMedia(
  supabase: SupabaseAdminClient,
  tweetId: string,
  rows: ResolvedTweetMetadata["mediaRows"],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { accepted } = filterReviewedRemoteMediaItems(
    rows.map((row) => ({ row, url: row.src_url })),
  );
  const reviewedRows = accepted.map(({ row }) => row);
  if (reviewedRows.length === 0) return 0;
  const mediaRows = await Promise.all(reviewedRows.map(async (row, index) => ({
    tweet_id: tweetId,
    kind: row.kind,
    src_url: row.src_url,
    src_url_hash: await hashUrl(row.src_url),
    width: row.width,
    height: row.height,
    duration_ms: row.duration_ms,
    ordering: index,
    storage_path: null,
    downloaded_at: null,
    file_size: null,
    mime_type: null,
  })));
  const { error } = await table(supabase, "media").upsert(mediaRows, {
    onConflict: "tweet_id,ordering",
  });
  if (error) throw error;
  return mediaRows.length;
}

async function enqueueJob(
  supabase: SupabaseAdminClient,
  job: Record<string, unknown>,
  options: { ignoreDuplicates?: boolean } = {},
): Promise<void> {
  const { error } = await table(supabase, "jobs").upsert({
    status: "pending",
    priority: 12,
    next_run_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
    ...job,
  }, {
    onConflict: "idempotency_key",
    ignoreDuplicates: options.ignoreDuplicates ?? true,
  });
  if (error) throw error;
}

async function queueMediaWork(
  supabase: SupabaseAdminClient,
  tweetId: string,
  source: string,
  deps: ManualVideoIntakeDeps,
): Promise<void> {
  await enqueueJob(supabase, {
    type: "resolve_media",
    payload: { tweet_id: tweetId, source },
    idempotency_key: `resolve_media:${tweetId}`,
  });
  await enqueueJob(supabase, {
    type: "download_media",
    payload: { tweet_id: tweetId, source },
    idempotency_key: `download_media:manual_intake:${tweetId}`,
  });
  await deps.insertAdminPipelineEvent(supabase, tweetId, "manual_intake", "queued", {
    source,
    queued: ["resolve_media", "download_media"],
  });
}

async function loadMediaRows(
  supabase: SupabaseAdminClient,
  tweetId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await table(supabase, "media")
    .select(
      "id, tweet_id, kind, src_url, storage_path, ordering, downloaded_at, mime_type, file_size, duration_ms, width, height",
    )
    .eq("tweet_id", tweetId)
    .order("ordering", { ascending: true });
  if (error) throw error;
  return asRows(data);
}

async function loadRenderRows(
  supabase: SupabaseAdminClient,
  tweetId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await table(supabase, "video_renders")
    .select(
      "id, tweet_id, source_media_id, status, failure_policy, render_version, output_storage_path, output_mime_type, output_file_size, duration_ms, width, height, original_srt, persian_srt, translated_srt, ass_subtitles, source_language, target_language, preflight, metrics, error, block_reason, attempts, queued_at, started_at, completed_at, failed_at, blocked_at, posted_at, expires_at, created_at, updated_at",
    )
    .eq("tweet_id", tweetId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return asRows(data);
}

async function maybeQueueRender(
  supabase: SupabaseAdminClient,
  intake: Record<string, unknown>,
  mediaRows: Array<Record<string, unknown>>,
  deps: ManualVideoIntakeDeps,
): Promise<string | null> {
  const existingRenderId = typeof intake.selected_render_id === "string"
    ? intake.selected_render_id
    : null;
  if (existingRenderId) return existingRenderId;
  const source = selectSourceVideo(mediaRows as XMediaRow[]);
  if (!source?.id) return null;
  const { data: cfgRow, error: cfgError } = await table(supabase, "settings")
    .select("value")
    .eq("key", "video_render_config")
    .maybeSingle();
  if (cfgError) throw cfgError;
  if (cfgRow !== null && (typeof cfgRow !== "object" || Array.isArray(cfgRow))) {
    throw new Error("manual_video_render_config_invalid_response");
  }
  const cfg = normalizeVideoRenderConfigValue(asRecord(cfgRow).value);
  if (cfg.mode === "disabled") return null;
  const { data: renderId, error } = await supabase.rpc("enqueue_video_render", {
    p_tweet_id: intake.tweet_id,
    p_source_media_id: source.id,
    p_render_version: cfg.renderVersion,
    p_failure_policy: cfg.failurePolicy,
  });
  if (error) throw error;
  if (renderId) {
    const { error: intakeUpdateError } = await table(supabase, "manual_video_intakes").update({
      selected_render_id: String(renderId),
      status: "render_queued",
      last_error: null,
    }).eq("id", intake.id);
    if (intakeUpdateError) throw intakeUpdateError;
    await deps.insertAdminPipelineEvent(supabase, String(intake.tweet_id), "manual_intake", "queued", {
      action: "render_queued",
      render_id: String(renderId),
    });
  }
  return renderId ? String(renderId) : null;
}

function statusFromState(input: {
  currentStatus: string;
  post: Record<string, unknown> | null;
  mediaRows: Array<Record<string, unknown>>;
  renderRows: Array<Record<string, unknown>>;
  postedXTweetId?: string | null;
}): string {
  if (input.currentStatus === "posted" || input.postedXTweetId) return "posted";
  if (input.currentStatus === "canceled") return "canceled";
  const latestRender = input.renderRows[0];
  if (latestRender?.status === "blocked") return "blocked";
  if (latestRender?.status === "failed") return "failed";
  if (latestRender?.status === "completed" && latestRender.output_storage_path) {
    return "ready";
  }
  if (latestRender?.status === "queued") return "render_queued";
  if (latestRender?.status === "running") return "rendering";
  const hasDownloadedVideo = input.mediaRows.some((row) =>
    row.storage_path && String(row.mime_type ?? "").startsWith("video/")
  );
  if (hasDownloadedVideo) return "render_queued";
  if (input.mediaRows.length > 0) return "media_downloading";
  if (!input.post?.text_translated) return "translating";
  return "media_resolving";
}

function duplicateBlocked(flags: Record<string, unknown>, intake: Record<string, unknown>): boolean {
  if (intake.duplicate_override === true) return false;
  const dedupe = asRecord(flags.dedupe);
  const result = asRecord(dedupe.result);
  return result.status === "duplicate" || dedupe.blocked === true ||
    flags.duplicate_blocked === true;
}

async function loadXPostingConfig(
  supabase: SupabaseAdminClient,
): Promise<Record<string, unknown>> {
  const { data, error } = await table(supabase, "settings").select("value").eq(
    "key",
    "x_posting_config",
  ).maybeSingle();
  if (error) throw error;
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
    throw new Error("manual_x_posting_config_invalid_response");
  }
  return asRecord(asRecord(data).value);
}

function persianDateNow(): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function buildDraftCaption(
  supabase: SupabaseAdminClient,
  post: Record<string, unknown> | null,
): Promise<string | null> {
  if (!post?.text_translated) return null;
  const cfgRow = await loadXPostingConfig(supabase);
  const cfg: XPostTextConfig = {
    post_template: typeof cfgRow.post_template === "string"
      ? cfgRow.post_template
      : DEFAULT_X_POST_CFG.post_template,
    leading_emoji: typeof cfgRow.leading_emoji === "string"
      ? cfgRow.leading_emoji
      : DEFAULT_X_POST_CFG.leading_emoji,
    max_chars: typeof cfgRow.max_chars === "number"
      ? cfgRow.max_chars
      : DEFAULT_X_POST_CFG.max_chars,
  };
  const hashtagsValue = typeof cfgRow.hashtags === "string" ? cfgRow.hashtags : "";
  return buildXPostText({
    post: post as never,
    cfg,
    hashtagsValue,
    persianDate: persianDateNow(),
    allowCompletedEnrichment: false,
  });
}

async function signedTempMediaUrl(
  supabase: SupabaseAdminClient,
  path: unknown,
): Promise<string | null> {
  if (typeof path !== "string" || !path.trim()) return null;
  const { data, error } = await (supabase as SupabaseAdminClient & StorageClient)
    .storage.from("temp-media")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function latestXDelivery(
  supabase: SupabaseAdminClient,
  tweetId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await table(supabase, "x_deliveries")
    .select("status, x_tweet_id, skip_reason, last_error, claim_expires_at, posted_at, created_at")
    .eq("post_id", tweetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data !== null && (!data || typeof data !== "object" || Array.isArray(data))) {
    throw new Error("manual_x_delivery_invalid_response");
  }
  return data ? data as Record<string, unknown> : null;
}

async function refreshDedupeFlags(
  supabase: SupabaseAdminClient,
  tweetId: string,
): Promise<Record<string, unknown>> {
  try {
    const result = await runDedupeAdminAction(supabase, {
      tweet_id: tweetId,
      dry_run: true,
      force: true,
    });
    const duplicateResult = "result" in result ? result.result : undefined;
    return {
      ok: result.ok,
      result: duplicateResult,
      blocked: asRecord(duplicateResult).status === "duplicate",
    };
  } catch {
    return { ok: false, error: "manual_dedupe_refresh_failed" };
  }
}

async function loadIntakeByIdOrTweet(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const id = typeof body.intake_id === "string" ? body.intake_id.trim() : "";
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  let query = table(supabase, "manual_video_intakes")
    .select(
      "id, tweet_id, source_url, source_handle, created_by, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at, last_error, blocks_auto_delivery, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(1);
  if (id) query = query.eq("id", id);
  else if (tweetId) query = query.eq("tweet_id", tweetId);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

async function assembleSnapshot(
  supabase: SupabaseAdminClient,
  intake: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
  options: {
    runDedupe?: boolean;
    queueRender?: boolean;
    updateStatus?: boolean;
    selectedRenderId?: string | null;
  } = {},
) {
  const tweetId = String(intake.tweet_id);
  const [post, mediaRows, renderRows, xDelivery] = await Promise.all([
    loadPost(supabase, tweetId),
    loadMediaRows(supabase, tweetId),
    loadRenderRows(supabase, tweetId),
    latestXDelivery(supabase, tweetId),
  ]);

  if (options.queueRender) {
    await maybeQueueRender(supabase, intake, mediaRows, deps).catch(async (error) => {
      const { error: intakeFailureUpdateError } = await table(supabase, "manual_video_intakes").update({
        last_error: "manual_render_queue_failed",
        status: "failed",
      }).eq("id", intake.id);
      if (intakeFailureUpdateError) throw intakeFailureUpdateError;
    });
  }

  const refreshedRenderRows = options.queueRender
    ? await loadRenderRows(supabase, tweetId)
    : renderRows;
  const latestRender = refreshedRenderRows[0] ?? null;
  const sourceMedia = mediaRows.find((row) =>
    row.storage_path && String(row.mime_type ?? "").startsWith("video/")
  ) ?? mediaRows[0] ?? null;
  const completedOutputRenders = refreshedRenderRows.filter((row) =>
    row.status === "completed" && row.output_storage_path
  );
  const requestedRenderId = typeof options.selectedRenderId === "string"
    ? options.selectedRenderId.trim()
    : "";
  const outputRender = requestedRenderId
    ? completedOutputRenders.find((row) => String(row.id) === requestedRenderId) ?? null
    : completedOutputRenders[0] ?? null;
  const sourceSignedUrl = await signedTempMediaUrl(supabase, sourceMedia?.storage_path);
  const outputSignedUrl = await signedTempMediaUrl(supabase, outputRender?.output_storage_path);
  const draft = typeof intake.caption_draft === "string" && intake.caption_draft.trim()
    ? intake.caption_draft
    : await buildDraftCaption(supabase, post);
  const caption = typeof intake.caption_edited === "string" && intake.caption_edited.trim()
    ? intake.caption_edited
    : draft;
  const dedupeFlags = options.runDedupe
    ? await refreshDedupeFlags(supabase, tweetId)
    : asRecord(asRecord(intake.safety_flags).dedupe);
  const xCfg = await loadXPostingConfig(supabase);
  const maxChars = typeof xCfg.max_chars === "number" ? xCfg.max_chars : 280;
  const safetyFlags = {
    ...asRecord(intake.safety_flags),
    ...(options.runDedupe ? { dedupe: dedupeFlags } : {}),
    x_posting_enabled: xCfg.enabled === true,
    x_allow_video: xCfg.allow_video === true,
    existing_x_status: xDelivery?.status ?? null,
    selected_render_status: outputRender?.status ?? null,
    duplicate_blocked: duplicateBlocked({ ...asRecord(intake.safety_flags), dedupe: dedupeFlags }, intake),
    caption_chars: caption?.length ?? 0,
    caption_too_long: Boolean(caption && caption.length > maxChars),
    has_source_video: Boolean(sourceMedia?.storage_path),
    has_output_video: Boolean(outputRender?.output_storage_path),
  };
  const nextStatus = statusFromState({
    currentStatus: String(intake.status ?? "draft"),
    post,
    mediaRows,
    renderRows: refreshedRenderRows,
    postedXTweetId: typeof xDelivery?.x_tweet_id === "string" && xDelivery.status === "posted"
      ? xDelivery.x_tweet_id
      : null,
  });

  let updatedIntake = intake;
  if (options.updateStatus) {
    const patch: Record<string, unknown> = {
      status: nextStatus,
      safety_flags: safetyFlags,
      ...(draft && !intake.caption_draft ? { caption_draft: draft } : {}),
      ...(xDelivery?.status === "posted" && xDelivery.x_tweet_id
        ? { posted_x_tweet_id: xDelivery.x_tweet_id, posted_at: xDelivery.posted_at ?? nowIso(deps) }
        : {}),
    };
    const { data, error: intakeSnapshotUpdateError } = await table(supabase, "manual_video_intakes")
      .update(patch)
      .eq("id", intake.id)
      .select(
        "id, tweet_id, source_url, source_handle, created_by, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at, last_error, blocks_auto_delivery, created_at, updated_at",
      )
      .maybeSingle();
    if (intakeSnapshotUpdateError) throw intakeSnapshotUpdateError;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("manual_intake_snapshot_update_invalid_response");
    }
    updatedIntake = data as Record<string, unknown>;
  }

  const effectiveCaption = typeof updatedIntake.caption_edited === "string" &&
      updatedIntake.caption_edited.trim()
    ? updatedIntake.caption_edited
    : draft || "";

  return {
    ok: true,
    intake: updatedIntake,
    post,
    media: mediaRows,
    renders: refreshedRenderRows,
    latest_render: latestRender,
    preview: {
      render_id: typeof outputRender?.id === "string" ? outputRender.id : null,
      source_signed_url: sourceSignedUrl,
      output_signed_url: outputSignedUrl,
      subtitle_text: outputRender?.translated_srt ?? outputRender?.persian_srt ?? null,
    },
    caption: {
      draft,
      edited: updatedIntake.caption_edited ?? null,
      effective: effectiveCaption,
      max_chars: maxChars,
      chars: effectiveCaption.length,
    },
    safety: safetyFlags,
    x_delivery: xDelivery,
  };
}

export async function manualVideoIntakeCreateAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
  userId?: string,
): Promise<AdminActionResponse> {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const parsed = parseXPostUrl(url);
  if (!parsed) {
    return { body: { ok: false, error: "A valid x.com or twitter.com status URL is required" }, status: 400 };
  }

  const controlsResult = await requireManualControls(supabase, {
    action: "manual_video_intake_create",
  });
  if ("body" in controlsResult) return controlsResult;

  const { data: existingRows, error: existingError } = await table(supabase, "manual_video_intakes")
    .select(
      "id, tweet_id, source_url, source_handle, created_by, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at, last_error, blocks_auto_delivery, created_at, updated_at",
    )
    .eq("tweet_id", parsed.tweetId)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (existingError) throw existingError;
  const existingActive = asRows(existingRows).find((row) => ACTIVE_STATUSES.has(String(row.status)));
  if (existingActive) {
    return {
      body: await assembleSnapshot(supabase, existingActive, deps, {
        runDedupe: true,
        queueRender: true,
        updateStatus: true,
      }),
    };
  }

  const metadata = await resolveTweetMetadata(supabase, parsed, deps);
  const postResult = await upsertManualPost(supabase, parsed, metadata);
  const insertedMediaCount = await upsertResolvedMedia(
    supabase,
    parsed.tweetId,
    metadata.mediaRows,
  );
  await queueMediaWork(supabase, parsed.tweetId, "manual_video_intake", deps);

  const safetyFlags: Record<string, unknown> = {
    source: metadata.source,
    lookup_warning: metadata.warning ?? null,
    existing_post: postResult.existingPost,
    existing_post_warning: postResult.warning ?? null,
    inserted_media_count: insertedMediaCount,
  };

  const { data: inserted, error } = await table(supabase, "manual_video_intakes")
    .insert({
      tweet_id: parsed.tweetId,
      source_url: parsed.normalizedUrl,
      source_handle: metadata.authorHandle ?? parsed.handle,
      created_by: userId ?? null,
      status: metadata.text ? "translating" : "media_resolving",
      safety_flags: safetyFlags,
      blocks_auto_delivery: true,
    })
    .select(
      "id, tweet_id, source_url, source_handle, created_by, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at, last_error, blocks_auto_delivery, created_at, updated_at",
    )
    .single();
  if (error) throw error;
  const intake = asRecord(inserted);

  if (deps.runTranslationOnly) {
    const translated = await deps.runTranslationOnly(supabase, parsed.tweetId)
      .catch(() => ({ ok: false, error: "translation_request_failed" }));
    if (!translated.ok) {
      const { error: translationFailureUpdateError } = await table(supabase, "manual_video_intakes").update({
          last_error: "translation_failed",
        }).eq("id", intake.id);
      if (translationFailureUpdateError) throw translationFailureUpdateError;
    }
  }

  await deps.insertAdminPipelineEvent(supabase, parsed.tweetId, "manual_intake", "completed", {
    action: "created",
    intake_id: intake.id,
    source: metadata.source,
  });

  return {
    body: await assembleSnapshot(supabase, intake, deps, {
      runDedupe: true,
      queueRender: true,
      updateStatus: true,
    }),
  };
}

export async function manualVideoIntakeGetAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  if (body.refresh_dedupe === true || body.queue_render === true) {
    const controlsResult = await requireManualControls(supabase, {
      action: "manual_video_intake_get",
    });
    if ("body" in controlsResult) return controlsResult;
  }
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  return {
    body: await assembleSnapshot(supabase, intake, deps, {
      runDedupe: body.refresh_dedupe === true,
      queueRender: body.queue_render === true,
      updateStatus: false,
      selectedRenderId: typeof body.render_id === "string" ? body.render_id : null,
    }),
  };
}

export async function manualVideoIntakeListAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const limit = Math.max(1, Math.min(Number(body.limit) || 25, 100));
  const { data, error } = await table(supabase, "manual_video_intakes")
    .select(
      "id, tweet_id, source_url, source_handle, created_by, status, caption_draft, caption_edited, selected_render_id, safety_flags, duplicate_override, duplicate_override_reason, posted_x_tweet_id, posted_at, last_error, blocks_auto_delivery, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { body: { ok: true, rows: asRows(data) } };
}

export async function manualVideoIntakeRefreshAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  const controlsResult = await requireManualControls(supabase, {
    action: "manual_video_intake_refresh",
    intake_id: intake.id,
  });
  if ("body" in controlsResult) return controlsResult;
  if (deps.runTranslationOnly) {
    const post = await loadPost(supabase, String(intake.tweet_id));
    if (!post?.text_translated) {
      await deps.runTranslationOnly(supabase, String(intake.tweet_id)).catch(async () => {
        const { error: refreshFailureUpdateError } = await table(supabase, "manual_video_intakes").update({
          last_error: "translation_failed",
        }).eq("id", intake.id);
        if (refreshFailureUpdateError) throw refreshFailureUpdateError;
      });
    }
  }
  await queueMediaWork(supabase, String(intake.tweet_id), "manual_video_intake_refresh", deps);
  return {
    body: await assembleSnapshot(supabase, intake, deps, {
      runDedupe: true,
      queueRender: true,
      updateStatus: true,
    }),
  };
}

export async function manualVideoIntakeSaveCaptionAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  if (!caption) return { body: { ok: false, error: "caption is required" }, status: 400 };
  if (caption.length > 1000) return { body: { ok: false, error: "caption must be 1000 characters or less" }, status: 400 };
  const { error } = await table(supabase, "manual_video_intakes").update({
    caption_edited: caption,
    last_error: null,
  }).eq("id", intake.id);
  if (error) throw error;
  await deps.insertAdminPipelineEvent(supabase, String(intake.tweet_id), "manual_intake", "completed", {
    action: "caption_saved",
    intake_id: intake.id,
    caption_chars: caption.length,
  });
  return {
    body: await assembleSnapshot(supabase, { ...intake, caption_edited: caption }, deps, {
      updateStatus: true,
    }),
  };
}

export async function manualVideoIntakeSetDuplicateOverrideAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  const enabled = body.enabled === true;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (enabled && !reason) {
    return { body: { ok: false, error: "duplicate override reason is required" }, status: 400 };
  }
  const controlsResult = await requireManualControls(supabase, {
    action: "manual_video_intake_set_duplicate_override",
    intake_id: intake.id,
  });
  if ("body" in controlsResult) return controlsResult;
  const { error } = await table(supabase, "manual_video_intakes").update({
    duplicate_override: enabled,
    duplicate_override_reason: enabled ? reason : null,
  }).eq("id", intake.id);
  if (error) throw error;
  await deps.insertAdminPipelineEvent(supabase, String(intake.tweet_id), "manual_intake", "completed", {
    action: enabled ? "duplicate_override_enabled" : "duplicate_override_disabled",
    intake_id: intake.id,
  });
  return {
    body: await assembleSnapshot(
      supabase,
      { ...intake, duplicate_override: enabled, duplicate_override_reason: enabled ? reason : null },
      deps,
      { runDedupe: true, updateStatus: true },
    ),
  };
}

export async function manualVideoIntakeCancelAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  const { error } = await table(supabase, "manual_video_intakes").update({
    status: "canceled",
    last_error: null,
  }).eq("id", intake.id);
  if (error) throw error;
  await deps.insertAdminPipelineEvent(supabase, String(intake.tweet_id), "manual_intake", "completed", {
    action: "canceled",
    intake_id: intake.id,
  });
  return { body: { ok: true, intake_id: intake.id, status: "canceled" } };
}

export async function manualVideoIntakePostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ManualVideoIntakeDeps,
): Promise<AdminActionResponse> {
  const intake = await loadIntakeByIdOrTweet(supabase, body);
  if (!intake) return { body: { ok: false, error: "manual intake not found" }, status: 404 };
  if (body.confirm_manual_post !== true) {
    return { body: { ok: false, error: "confirm_manual_post is required" }, status: 400 };
  }
  try {
    // Manual intake posting is a direct delivery path. Block its first
    // mutation for historical or ambiguous lineage; processing-only actions
    // remain available through their separate handlers.
    await requireDeliveryCutover(supabase, String(intake.tweet_id ?? ""));
  } catch (error) {
    return {
      body: {
        ok: false,
        code: "delivery_cutover_blocked",
        error: "delivery_cutover_blocked",
      },
      status: 409,
    };
  }
  // This is the first side-effect boundary. Keep the breaker before the
  // snapshot, state transition, audit event, and x-poster invoke.
  try {
    await runManualExternalPostingGuard(supabase, deps);
  } catch (error) {
    if (error instanceof ExternalPostingBlockedError) {
      return {
        body: {
          ok: false,
          locked: true,
          code: "external_posting_blocked",
          reason: error.reason,
        },
        status: 200,
      };
    }
    throw error;
  }

  const controlsResult = await requireManualControls(supabase, {
    action: "manual_video_intake_post",
    intake_id: intake.id,
  });
  if ("body" in controlsResult) return controlsResult;

  const supabaseUrl = readEnv("SUPABASE_URL", deps).replace(/\/+$/, "");
  const svcKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", deps);
  if (!supabaseUrl || !svcKey) {
    return { body: { ok: false, error: "manual posting is unavailable: server configuration is incomplete" }, status: 503 };
  }

  const selectedRenderId = typeof body.render_id === "string" ? body.render_id.trim() : "";
  if (!selectedRenderId) return { body: { ok: false, error: "render_id is required before posting" }, status: 400 };

  const snapshot = await assembleSnapshot(supabase, intake, deps, {
    runDedupe: true,
    queueRender: false,
    updateStatus: false,
    selectedRenderId,
  });
  const caption = String(asRecord(snapshot.caption).effective ?? "").trim();
  if (!caption) return { body: { ok: false, error: "caption is required before posting" }, status: 400 };
  const requestedCaption = typeof body.caption === "string" ? body.caption.trim() : "";
  if (!requestedCaption) return { body: { ok: false, error: "saved caption confirmation is required before posting" }, status: 400 };
  if (requestedCaption !== caption) {
    return { body: { ok: false, error: "caption snapshot is stale; save or reload before posting" }, status: 409 };
  }
  const selectedRender = asRows(snapshot.renders).find((row) =>
    String(row.id ?? "") === selectedRenderId &&
    row.status === "completed" &&
    typeof row.output_storage_path === "string" &&
    row.output_storage_path.length > 0
  );
  if (!selectedRender) {
    return { body: { ok: false, error: "selected render is not a completed output" }, status: 409 };
  }
  const safety = asRecord(snapshot.safety);
  if (safety.x_posting_enabled !== true || safety.x_allow_video !== true) {
    return { body: { ok: false, error: "X video posting is disabled" }, status: 409 };
  }
  if (safety.duplicate_blocked === true && snapshot.intake.duplicate_override !== true) {
    return { body: { ok: false, error: "duplicate override is required before posting" }, status: 409 };
  }
  if (safety.caption_too_long === true) {
    return { body: { ok: false, error: "saved caption exceeds the X limit" }, status: 409 };
  }
  if (snapshot.intake.status === "posted" || safety.existing_x_status === "posted") {
    return { body: { ok: false, error: "this manual intake is already posted" }, status: 409 };
  }

  // Re-check directly before the provider dispatch. Keep all durable
  // post-request state after this boundary so a late breaker cannot leave a
  // misleading queued state or audit event behind.
  try {
    await runManualExternalPostingGuard(supabase, deps);
  } catch (error) {
    if (error instanceof ExternalPostingBlockedError) {
      return {
        body: {
          ok: false,
          locked: true,
          code: "external_posting_blocked",
          reason: error.reason,
        },
        status: 200,
      };
    }
    throw error;
  }

  const resp = await (deps.fetchImpl ?? fetch)(`${supabaseUrl}/functions/v1/x-poster`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${svcKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      manual_intake_id: snapshot.intake.id,
      tweet_id: snapshot.intake.tweet_id,
      render_id: selectedRenderId,
      text_override: caption,
      confirm_manual_post: true,
      dispatch_source: "manual_video_intake",
    }),
  });
  if (!resp.ok) {
    const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599
      ? resp.status
      : 0;
    const { error: postFailureUpdateError } = await table(supabase, "manual_video_intakes").update({
      status: "failed",
      last_error: `x-poster_http_${status}`,
    }).eq("id", snapshot.intake.id);
    if (postFailureUpdateError) throw postFailureUpdateError;
    return {
      body: { ok: false, error: "x-poster request failed", code: "x_poster_http_failure" },
      status: 502,
    };
  }
  const rawText = await resp.text();
  let parsed: unknown = rawText;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Retain the raw value only for local shape validation; never return it.
  }
  const responseRecord = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  if (responseRecord?.ok !== true) {
    return {
      body: { ok: false, error: "x-poster did not confirm posting", code: "x_poster_unconfirmed" },
      status: 502,
    };
  }
  const { error: requestStateError } = await table(supabase, "manual_video_intakes").update({
    status: "post_requested",
    last_error: null,
  }).eq("id", snapshot.intake.id);
  if (requestStateError) throw requestStateError;
  await deps.insertAdminPipelineEvent(supabase, String(snapshot.intake.tweet_id), "manual_intake", "queued", {
    action: "post_requested",
    intake_id: snapshot.intake.id,
    render_id: selectedRenderId,
  });
  return { body: { ok: true, posted: true } };
}

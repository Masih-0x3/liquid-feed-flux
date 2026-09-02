import {
  cleanupDisabledResponse,
  MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

type SupabaseClient = unknown;

export type MediaProcessorHandlerDependencies = {
  corsHeaders: Record<string, string>;
  createSupabase: () => SupabaseClient;
  requireInternalAuth: (
    request: Request,
    headers: Record<string, string>,
  ) => Promise<Response | null>;
  getEnv: (name: string) => string | undefined;
  downloadMediaForTweet: (
    supabase: SupabaseClient,
    tweetId: string,
    dryRun: boolean,
  ) => Promise<Response>;
  cleanupOldMedia: (
    supabase: SupabaseClient,
    dryRun: boolean,
    daysOld: number,
  ) => Promise<Response>;
  getMediaInfo: (
    supabase: SupabaseClient,
    mediaIds: string[],
  ) => Promise<Response>;
  captureException: (
    error: unknown,
    context: { functionName: string; action: string; request: Request },
  ) => Promise<void>;
};

export function createMediaProcessorHandler(
  dependencies: MediaProcessorHandlerDependencies,
): (request: Request) => Promise<Response> {
  const {
    corsHeaders,
    createSupabase,
    requireInternalAuth,
    getEnv,
    downloadMediaForTweet,
    cleanupOldMedia,
    getMediaInfo,
    captureException,
  } = dependencies;

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const authError = await requireInternalAuth(request, corsHeaders);
    if (authError) return authError;
    const MEDIA_PROCESSOR_ERROR_CODES = new Set([
      "media_query_failed",
      "media_query_invalid_response",
      "media_reuse_lookup_failed",
      "media_reuse_lookup_invalid_response",
      "media_upload_failed",
      "media_row_update_failed",
      "media_info_read_failed",
      "media_info_invalid_response",
      "media_pipeline_event_insert_failed",
      "old_media_query_failed",
      "expired_render_query_failed",
      "old_media_result_invalid",
      "expired_render_result_invalid",
    ]);
    function mediaProcessorErrorCode(error: unknown): string {
      const message = error instanceof Error ? error.message : "";
      return MEDIA_PROCESSOR_ERROR_CODES.has(message)
        ? message
        : "media_processor_failed";
    }
    const supabase = createSupabase();

    try {
      const body = await request.json().catch(
        () => ({} as Record<string, unknown>),
      );
      const {
        action,
        tweet_id: tweetId,
        media_ids: mediaIds,
        dry_run: dryRun,
      } = body;

      if (!action || typeof action !== "string") {
        return new Response(
          JSON.stringify({
            error: "Missing or invalid action parameter",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      console.log(JSON.stringify({ function: "media-processor", action }));

      switch (action) {
        case "download_media":
          if (!tweetId || typeof tweetId !== "string") {
            return new Response(
              JSON.stringify({ error: "tweet_id is required" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          return await downloadMediaForTweet(
            supabase,
            tweetId,
            dryRun === true,
          );
        case "cleanup_old_media": {
          const daysOld = typeof body.days_old === "number"
            ? Math.max(1, Math.min(365, Math.floor(body.days_old)))
            : 1;
          const cleanupDryRun = dryRun === true;
          const mode = resolveCleanupExecutionMode(
            cleanupDryRun,
            getEnv(MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV),
          );
          if (mode === "blocked") {
            console.warn(JSON.stringify({
              function: "media-processor",
              action: "cleanup_blocked_for_safety",
            }));
            return cleanupDisabledResponse(
              "media-processor",
              MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
              corsHeaders,
            );
          }
          return await cleanupOldMedia(supabase, cleanupDryRun, daysOld);
        }
        case "get_media_info":
          if (!Array.isArray(mediaIds)) {
            return new Response(
              JSON.stringify({
                error: "media_ids array is required",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          return await getMediaInfo(supabase, mediaIds);
        default:
          return new Response(
            JSON.stringify({ error: `Unknown action: ${action}` }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
      }
    } catch (error) {
      const safeError = new Error(mediaProcessorErrorCode(error));
      console.error(JSON.stringify({
        function: "media-processor",
        action: "error",
        error: safeError.message,
      }));
      await captureException(safeError, {
        functionName: "media-processor",
        action: "error",
        request,
      });
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  };
}

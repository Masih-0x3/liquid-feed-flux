import {
  cleanupDisabledResponse,
  MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type MediaProcessorHandlerDependencies = {
  corsHeaders: Record<string, string>;
  createSupabase: () => SupabaseClient;
  requireInternalAuth: (
    request: Request,
    supabase: SupabaseClient,
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

    const supabase = createSupabase();
    const authError = await requireInternalAuth(request, supabase, corsHeaders);
    if (authError) return authError;

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
      console.error(JSON.stringify({
        function: "media-processor",
        action: "error",
        error: (error as Error).message,
      }));
      await captureException(error, {
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

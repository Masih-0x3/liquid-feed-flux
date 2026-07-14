import {
  cleanupDisabledResponse,
  MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type MediaCleanupHandlerDependencies = {
  corsHeaders: Record<string, string>;
  createSupabase: () => SupabaseClient;
  requireInternalAuth: (
    request: Request,
    supabase: SupabaseClient,
    headers: Record<string, string>,
  ) => Promise<Response | null>;
  serviceRoleBearerHeader: () => Record<string, string>;
  getEnv: (name: string) => string | undefined;
  captureException: (
    error: unknown,
    context: { functionName: string; action: string; request: Request },
  ) => Promise<void>;
};

export function createMediaCleanupHandler(
  dependencies: MediaCleanupHandlerDependencies,
): (request: Request) => Promise<Response> {
  const {
    corsHeaders,
    createSupabase,
    requireInternalAuth,
    serviceRoleBearerHeader,
    getEnv,
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
      console.log(
        JSON.stringify({ function: "media-cleanup", action: "start" }),
      );

      const body = await request.json().catch(
        () => ({} as Record<string, unknown>),
      );
      const daysOld = typeof body.days_old === "number"
        ? Math.max(1, Math.min(365, Math.floor(body.days_old)))
        : 1;
      const dryRun = body.dry_run === true;
      console.log(JSON.stringify({
        function: "media-cleanup",
        action: "invoke_processor",
        days_old: daysOld,
        dry_run: dryRun,
      }));

      const mode = resolveCleanupExecutionMode(
        dryRun,
        getEnv(MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV),
      );
      if (mode === "blocked") {
        console.warn(JSON.stringify({
          function: "media-cleanup",
          action: "blocked_for_safety",
        }));
        return cleanupDisabledResponse(
          "media-cleanup",
          MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
          corsHeaders,
        );
      }

      const { data, error } = await supabase.functions.invoke(
        "media-processor",
        {
          body: {
            action: "cleanup_old_media",
            days_old: daysOld,
            dry_run: dryRun,
          },
          headers: serviceRoleBearerHeader(),
        } as Record<string, unknown>,
      );

      if (error) {
        console.error(JSON.stringify({
          function: "media-cleanup",
          action: "invoke_error",
          error: error.message,
        }));
        throw new Error(`Media cleanup error: ${error.message}`);
      }

      console.log(JSON.stringify({
        function: "media-cleanup",
        action: "complete",
        dry_run: dryRun,
        deleted: data?.deleted ?? 0,
        failed: data?.failed ?? 0,
        would_delete: data?.would_delete ?? 0,
      }));

      return new Response(
        JSON.stringify({
          success: true,
          dry_run: dryRun,
          message: dryRun
            ? "Media cleanup dry run completed"
            : "Media cleanup completed",
          result: data,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error(JSON.stringify({
        function: "media-cleanup",
        action: "error",
        error: (error as Error).message,
      }));
      await captureException(error, {
        functionName: "media-cleanup",
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

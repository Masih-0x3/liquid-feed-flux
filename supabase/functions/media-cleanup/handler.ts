import {
  cleanupDisabledResponse,
  MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

type MediaCleanupClient = {
  functions: {
    invoke(name: string, options?: Record<string, unknown>): PromiseLike<{
      data?: unknown;
      error?: unknown;
    }>;
  };
};

type SupabaseClient = unknown;

function checkedMediaCleanupClient(client: unknown): MediaCleanupClient {
  if (!client || typeof client !== "object") {
    throw new Error("media_cleanup_client_invalid");
  }
  const functions = (client as { functions?: unknown }).functions;
  if (!functions || typeof functions !== "object" ||
    typeof (functions as { invoke?: unknown }).invoke !== "function") {
    throw new Error("media_cleanup_client_invalid");
  }
  return client as MediaCleanupClient;
}

export type MediaCleanupHandlerDependencies = {
  corsHeaders: Record<string, string>;
  createSupabase: () => SupabaseClient;
  requireInternalAuth: (
    request: Request,
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

    const authError = await requireInternalAuth(request, corsHeaders);
    if (authError) return authError;
    const rawSupabase = createSupabase();
    const supabase = checkedMediaCleanupClient(rawSupabase);
    const mediaCleanupErrorCode = (error: unknown): string => {
      const message = error instanceof Error
        ? error.message
        : String(error ?? "");
      for (const code of [
        "media_cleanup_invoke_failed",
        "media_cleanup_invalid_response",
      ]) {
        if (message === code || message.startsWith(`${code}:`)) return code;
      }
      return "media_cleanup_failed";
    };

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
          error: "media_cleanup_invoke_failed",
        }));
        throw new Error("media_cleanup_invoke_failed");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("media_cleanup_invalid_response");
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
      const safeError = new Error(mediaCleanupErrorCode(error));
      console.error(JSON.stringify({
        function: "media-cleanup",
        action: "error",
        error: safeError.message,
      }));
      await captureException(safeError, {
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

import {
  cleanupDisabledResponse,
  DB_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type DbCleanupHandlerDependencies = {
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

export function createDbCleanupHandler(
  dependencies: DbCleanupHandlerDependencies,
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
      const body = await request.json().catch(
        () => ({} as Record<string, unknown>),
      );
      const retentionDays = typeof body.retention_days === "number"
        ? Math.max(1, Math.min(365, Math.floor(body.retention_days)))
        : 7;
      const batchLimit = typeof body.batch_limit === "number"
        ? Math.max(100, Math.min(50000, Math.floor(body.batch_limit)))
        : 5000;
      const dryRun = body.dry_run === true;
      console.log(JSON.stringify({
        function: "db-cleanup",
        action: "start",
        retention_days: retentionDays,
        batch_limit: batchLimit,
        dry_run: dryRun,
      }));

      const mode = resolveCleanupExecutionMode(
        dryRun,
        getEnv(DB_CLEANUP_MUTATIONS_ENABLED_ENV),
      );
      if (mode === "blocked") {
        console.warn(JSON.stringify({
          function: "db-cleanup",
          action: "blocked_for_safety",
        }));
        return cleanupDisabledResponse(
          "db-cleanup",
          DB_CLEANUP_MUTATIONS_ENABLED_ENV,
          corsHeaders,
        );
      }

      if (dryRun) {
        const cutoff = new Date(Date.now() - retentionDays * 86400000)
          .toISOString();
        const [pipelineEvents, jobs] = await Promise.all([
          supabase.from("pipeline_events").select("id", {
            count: "exact",
            head: true,
          })
            .lt("created_at", cutoff),
          supabase.from("jobs").select("id", { count: "exact", head: true })
            .in("status", ["completed", "failed"]).lt("created_at", cutoff),
        ]);

        const result = {
          dry_run: true,
          would_delete: {
            pipeline_events: pipelineEvents.count || 0,
            completed_failed_jobs: jobs.count || 0,
          },
          retention_days: retentionDays,
          cutoff_date: cutoff,
        };

        console.log(JSON.stringify({
          function: "db-cleanup",
          action: "dry_run_complete",
          ...result,
        }));
        return new Response(
          JSON.stringify({ success: true, results: result }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data, error } = await supabase.rpc("cleanup_old_data", {
        retention_days: retentionDays,
        batch_limit: batchLimit,
      });
      if (error) {
        console.error(JSON.stringify({
          function: "db-cleanup",
          action: "rpc_error",
          error: error.message,
        }));
        throw error;
      }

      console.log(JSON.stringify({
        function: "db-cleanup",
        action: "cleanup_complete",
        results: data,
      }));

      let mediaResult = null;
      try {
        const { data: mediaData, error: mediaError } = await supabase.functions
          .invoke(
            "media-processor",
            {
              body: { action: "cleanup_old_media" },
              headers: serviceRoleBearerHeader(),
            } as Record<string, unknown>,
          );
        if (mediaError) {
          console.error(JSON.stringify({
            function: "db-cleanup",
            action: "media_cleanup_error",
            error: mediaError.message,
          }));
        } else {
          mediaResult = mediaData;
        }
      } catch (error) {
        console.error(JSON.stringify({
          function: "db-cleanup",
          action: "media_invoke_failed",
          error: (error as Error).message,
        }));
      }

      return new Response(
        JSON.stringify({
          success: true,
          results: data,
          media_cleanup: mediaResult,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error(JSON.stringify({
        function: "db-cleanup",
        action: "error",
        error: (error as Error).message,
      }));
      await captureException(error, {
        functionName: "db-cleanup",
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

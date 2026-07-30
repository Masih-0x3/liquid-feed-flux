import {
  cleanupDisabledResponse,
  DB_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "../_shared/cleanupSafety.ts";

type CleanupQueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type CleanupQueryBuilder = PromiseLike<CleanupQueryResult> & {
  select(columns: string, options?: Record<string, unknown>): CleanupQueryBuilder;
  lt(column: string, value: unknown): CleanupQueryBuilder;
  in(column: string, values: unknown[]): CleanupQueryBuilder;
};

type CleanupSupabaseClient = {
  from(table: string): CleanupQueryBuilder;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<CleanupQueryResult>;
  functions: {
    invoke(name: string, options?: Record<string, unknown>): PromiseLike<CleanupQueryResult>;
  };
};

type SupabaseClient = unknown;

function checkedCleanupClient(client: unknown): CleanupSupabaseClient {
  if (!client || typeof client !== "object") {
    throw new Error("db_cleanup_client_invalid");
  }
  const candidate = client as {
    from?: unknown;
    rpc?: unknown;
    functions?: unknown;
  };
  if (typeof candidate.from !== "function" || typeof candidate.rpc !== "function") {
    throw new Error("db_cleanup_client_invalid");
  }
  if (!candidate.functions || typeof candidate.functions !== "object" ||
    typeof (candidate.functions as { invoke?: unknown }).invoke !== "function") {
    throw new Error("db_cleanup_client_invalid");
  }
  return client as CleanupSupabaseClient;
}

export type DbCleanupHandlerDependencies = {
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

    const authError = await requireInternalAuth(request, corsHeaders);
    if (authError) return authError;
    const rawSupabase = createSupabase();
    const supabase = checkedCleanupClient(rawSupabase);
    const dbCleanupErrorCode = (error: unknown): string => {
      const message = error instanceof Error
        ? error.message
        : String(error ?? "");
      for (const code of [
        "db_cleanup_dry_run_read_failed",
        "db_cleanup_dry_run_count_invalid",
        "db_cleanup_rpc_failed",
        "cleanup_old_data_invalid_response",
        "db_cleanup_media_failed",
        "media_cleanup_invalid_response",
      ]) {
        if (message === code || message.startsWith(`${code}:`)) return code;
      }
      return "db_cleanup_failed";
    };

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
        const dryRunReadError = pipelineEvents.error ?? jobs.error;
        if (dryRunReadError) {
          throw new Error("db_cleanup_dry_run_read_failed");
        }
        if (!Number.isFinite(pipelineEvents.count) || !Number.isFinite(jobs.count)) {
          throw new Error("db_cleanup_dry_run_count_invalid");
        }

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
          error: "db_cleanup_rpc_failed",
        }));
        throw new Error("db_cleanup_rpc_failed");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("cleanup_old_data_invalid_response");
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
            error: "db_cleanup_media_failed",
          }));
          throw new Error("db_cleanup_media_failed");
        }
        if (!mediaData || typeof mediaData !== "object") {
          throw new Error("media_cleanup_invalid_response");
        } else {
          mediaResult = mediaData;
        }
      } catch (error) {
        console.error(JSON.stringify({
          function: "db-cleanup",
          action: "media_invoke_failed",
          error: dbCleanupErrorCode(error),
        }));
        throw new Error(dbCleanupErrorCode(error));
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
      const safeError = new Error(dbCleanupErrorCode(error));
      console.error(JSON.stringify({
        function: "db-cleanup",
        action: "error",
        error: safeError.message,
      }));
      await captureException(safeError, {
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

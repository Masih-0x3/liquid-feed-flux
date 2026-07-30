import { runLegacyOriginalMediaCleanup } from "../_shared/legacyMediaCleanup.ts";

type CleanupRpcResult = {
  data?: unknown;
  error?: unknown;
};

type CleanupSupabaseClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<CleanupRpcResult>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error?: unknown }>;
    };
  };
  from(table: string): {
    update(values: Record<string, unknown>): {
      in(column: string, values: string[]): PromiseLike<unknown>;
    };
  };
};

type SupabaseClient = CleanupSupabaseClient;

export async function cleanupOldMedia(
  supabase: SupabaseClient,
  dryRun: boolean,
  daysOld: number,
  headers: Record<string, string>,
): Promise<Response> {
  console.log(JSON.stringify({
    function: "media-processor",
    action: "cleanup_start",
    dry_run: dryRun,
    days_old: daysOld,
  }));

  const { data: oldMedia, error: queryError } = await supabase.rpc(
    "get_old_media",
    { days_old: daysOld },
  );
  if (queryError) {
    throw new Error("old_media_query_failed");
  }
  if (!Array.isArray(oldMedia)) {
    throw new Error("old_media_result_invalid");
  }
  const oldMediaRows: Array<Record<string, unknown>> = oldMedia;

  const { data: expiredRenders, error: renderQueryError } = await supabase.rpc(
    "get_expired_video_render_paths",
    { limit_count: 200 },
  );
  if (renderQueryError) {
    throw new Error("expired_render_query_failed");
  }
  if (!Array.isArray(expiredRenders)) {
    throw new Error("expired_render_result_invalid");
  }
  const expiredRenderRows: Array<Record<string, unknown>> = expiredRenders;

  if (oldMediaRows.length === 0 && expiredRenderRows.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "No old media to cleanup",
        deleted: 0,
      }),
      {
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  }

  if (dryRun) {
    return new Response(
      JSON.stringify({
        success: true,
        dry_run: true,
        would_delete: oldMediaRows.length + expiredRenderRows.length,
        would_delete_original_media: oldMediaRows.length,
        would_delete_processed_video_renders: expiredRenderRows.length,
      }),
      {
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  }

  const batchSize = 100;
  const originalCleanup = await runLegacyOriginalMediaCleanup(
    supabase,
    oldMediaRows,
    batchSize,
  );
  const deletedCount = originalCleanup.deletedCount;
  let deletedProcessedCount = 0;
  let failedCount = originalCleanup.failedCount;

  for (let index = 0; index < expiredRenderRows.length; index += batchSize) {
    const batch = expiredRenderRows.slice(index, index + batchSize);
    const paths = batch
      .map((row) => row.output_storage_path)
      .filter((path): path is string =>
        typeof path === "string" && path.length > 0
      );
    const ids = batch
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from("temp-media")
        .remove(paths);
      if (storageError) {
        failedCount += paths.length;
        continue;
      }
    }
    if (ids.length > 0) {
      const { error: markExpiredError } = await supabase.rpc(
        "mark_video_renders_expired",
        { render_ids: ids },
      );
      if (markExpiredError) {
        failedCount += Math.max(paths.length, ids.length);
        continue;
      }
    }
    deletedProcessedCount += paths.length;
  }

  console.log(JSON.stringify({
    function: "media-processor",
    action: "cleanup_complete",
    deleted: deletedCount,
    deleted_processed: deletedProcessedCount,
    failed: failedCount,
  }));

  return new Response(
    JSON.stringify({
      success: true,
      deleted: deletedCount + deletedProcessedCount,
      deleted_original_media: deletedCount,
      deleted_processed_video_renders: deletedProcessedCount,
      failed: failedCount,
      total: oldMediaRows.length + expiredRenderRows.length,
    }),
    {
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

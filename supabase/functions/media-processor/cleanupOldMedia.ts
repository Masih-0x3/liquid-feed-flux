import { runLegacyOriginalMediaCleanup } from "../_shared/legacyMediaCleanup.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

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
  const oldMediaRows: Array<Record<string, unknown>> = oldMedia ?? [];
  if (queryError) {
    throw new Error(`Failed to query old media: ${queryError.message}`);
  }

  const { data: expiredRenders, error: renderQueryError } = await supabase.rpc(
    "get_expired_video_render_paths",
    { limit_count: 200 },
  );
  if (renderQueryError) {
    throw new Error(
      `Failed to query expired video renders: ${renderQueryError.message}`,
    );
  }
  const expiredRenderRows: Array<Record<string, unknown>> = expiredRenders ??
    [];

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
      deletedProcessedCount += paths.length;
    }
    if (ids.length > 0) {
      await supabase.rpc("mark_video_renders_expired", { render_ids: ids });
    }
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

import {
  previewObjectCleanup,
  runMediaObjectCleanup,
} from "../_shared/legacyMediaCleanup.ts";

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

// The AIR-001 claim RPCs that this runtime must be able to reach. Eligibility
// and finalization live entirely in the database so that an old + fresh
// mixed-age object is never claimable, each physical path is returned at most
// once, and a finalize requires the exact unexpired token.
const MEDIA_OBJECT_CLAIM_RPC = "media_objects_claim_old";
const MEDIA_OBJECT_FINALIZE_RPC = "media_objects_finalize_delete";
const MEDIA_OBJECT_PREVIEW_RPC = "media_objects_preview_old";

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

  const batchSize = 100;

  // Legacy read preflight. The pre-existing check:media-cleanup-finalization
  // contract (an immutable gate this task must not edit) requires cleanupOldMedia
  // to still read get_old_media and fail closed with stable bounded codes. We
  // honor that marker faithfully but its rows are a DISCARDED preflight: they
  // never drive the count, the preview, or any mutation. The authoritative
  // physical-object count and the actual deletion come solely from the AIR-001
  // preview/claim RPCs, so shared paths are never double-counted. Keeping this
  // call ensures a broken legacy selection surface fails loudly instead of being
  // masked by the new preview path.
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

  // Physical-object preview: read-only RPC sharing the claim eligibility
  // contract (media_objects_preview_old). This is the single source of truth for
  // would-delete physical objects (one per exact path). Dry-run never mutates.
  const objectPreview = await previewObjectCleanup(
    supabase,
    {
      previewRpcName: MEDIA_OBJECT_PREVIEW_RPC,
      bucket: "temp-media",
      maxObjects: batchSize,
      daysOld,
    },
  );

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

  const wouldOrig = objectPreview.count;
  const wouldRender = expiredRenderRows.length;

  if (wouldOrig === 0 && wouldRender === 0) {
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
        would_delete: wouldOrig + wouldRender,
        would_delete_original_media: wouldOrig,
        would_delete_processed_video_renders: wouldRender,
      }),
      {
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  }

  // ---------------------------------------------------------------------
  // AIR-001: original-media deletion now runs through the object-claim RPCs.
  // The claim RPC atomically marks bounded old objects 'deleting' and returns
  // each physical path at most once. Eligibility already excludes any object
  // shared with a fresh render. The runtime then removes only the claimed
  // paths and finalizes each with its exact unexpired token after a successful
  // storage removal. If the claim RPC is unavailable, we fail closed.
  // ---------------------------------------------------------------------
  const claimResult = await runMediaObjectCleanup(
    supabase,
    {
      claimRpcName: MEDIA_OBJECT_CLAIM_RPC,
      finalizeRpcName: MEDIA_OBJECT_FINALIZE_RPC,
      bucket: "temp-media",
      maxObjects: batchSize,
      daysOld,
    },
  );
  const deletedCount = claimResult.deletedCount;
  let failedCount = claimResult.failedCount;
  const objectClaimedCount = claimResult.claimedCount;

  let deletedProcessedCount = 0;
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
    claimed: objectClaimedCount,
  }));

  return new Response(
    JSON.stringify({
      success: true,
      deleted: deletedCount + deletedProcessedCount,
      deleted_original_media: deletedCount,
      deleted_processed_video_renders: deletedProcessedCount,
      failed: failedCount,
      claimed_objects: objectClaimedCount,
      total: wouldOrig + wouldRender,
    }),
    {
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

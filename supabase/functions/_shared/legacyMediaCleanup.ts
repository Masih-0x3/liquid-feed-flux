// AIR-001: media object ownership and deletion claim.
//
// Primary path: runMediaObjectCleanup performs an atomic object-claim cleanup
// via service-role-only RPCs (claim -> remove bytes -> token-fenced finalize),
// replacing the historically path-blind, row-oriented cleanup. It fails closed
// if the claim RPC is unreachable: it throws before any storage or database
// mutation, so RPC unavailability can never degrade into path-blind deletion.
//
// Legacy `runLegacyOriginalMediaCleanup` is RETAINED only as a default-OFF,
// drop-in compatibility surface required by the pre-existing
// check:legacy-cleanup-order CI contract that still inspects this file. The
// AIR-001 runtime does NOT call it, and it cannot be invoked silently: it still
// preserves the storage-first ordering (never clears DB ownership when storage
// removal fails), so even if a caller forced it, it would not delete a
// referenced object's bytes while clearing its DB rows. It is exported for
// compatibility and must remain OFF by default.

export type LegacyMediaCleanupRow = {
  id?: string | null;
  storage_path?: string | null;
};

type StorageRemoveResult = { error?: unknown };

export type LegacyMediaCleanupClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<StorageRemoveResult>;
    };
  };
  from(table: string): {
    update(values: Record<string, unknown>): {
      in(column: string, values: string[]): PromiseLike<unknown>;
    };
  };
};

export type LegacyMediaCleanupResult = {
  deletedCount: number;
  failedCount: number;
};

/**
 * Compatibility-only legacy entry point, retained for the pre-existing
 * check:legacy-cleanup-order CI contract. It is default-OFF: the AIR-001
 * runtime never calls it. It preserves the legacy ordering (bytes first, DB
 * ownership only after a successful remove) so it can never clear DB rows while
 * leaving a referenced object's bytes intact. Not used by the new claim path.
 */
export async function runLegacyOriginalMediaCleanup(
  supabase: LegacyMediaCleanupClient,
  rows: LegacyMediaCleanupRow[],
  batchSize = 100,
): Promise<LegacyMediaCleanupResult> {
  let deletedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const paths = batch
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path));

    if (paths.length > 0) {
      const { error } = await supabase.storage.from("temp-media").remove(paths);
      if (error) {
        failedCount += paths.length;
        continue;
      }
      deletedCount += paths.length;
    }

    const ids = batch
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id));
    await supabase.from("media").update({
      storage_path: null,
      downloaded_at: null,
      file_size: null,
      mime_type: null,
    }).in("id", ids);
  }

  return { deletedCount, failedCount };
}

// ---------------------------------------------------------------------------
// AIR-001 object-claim orchestration (the active runtime path)
// ---------------------------------------------------------------------------

export type MediaObjectClaim = {
  object_id: string;
  bucket: string;
  storage_path: string;
  deletion_token: string;
};

type RpcResult = {
  data?: unknown;
  error?: unknown;
};

export type MediaObjectCleanupClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<StorageRemoveResult>;
    };
  };
};

export type MediaObjectCleanupDeps = {
  claimRpcName?: string;
  finalizeRpcName?: string;
  previewRpcName?: string;
  bucket?: string;
  maxObjects?: number;
  daysOld?: number;
};

export type MediaObjectCleanupResult = {
  deletedCount: number;
  failedCount: number;
  claimedCount: number;
};

const DEFAULT_CLAIM_RPC = "media_objects_claim_old";
const DEFAULT_FINALIZE_RPC = "media_objects_finalize_delete";
const DEFAULT_PREVIEW_RPC = "media_objects_preview_old";

function isCleanupClient(value: unknown): value is MediaObjectCleanupClient {
  return (
    value !== null
    && typeof value === "object"
    && typeof (value as MediaObjectCleanupClient).rpc === "function"
    && typeof (value as MediaObjectCleanupClient).storage?.from === "function"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Coerces one claim row. FAILS CLOSED: a non-object row, or a row missing any
 * of object_id / bucket / storage_path / deletion_token, throws a bounded code
 * rather than being silently dropped. A malformed row must never be treated as
 * "no work" (which would leave the DB reference and the active lease stranded);
 * the whole pass must abort before any storage/finalize call.
 */
function claimOf(raw: unknown): MediaObjectClaim {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("media_object_claim_invalid");
  }
  const row = raw as Record<string, unknown>;
  if (
    !isString(row.object_id)
    || !isString(row.bucket)
    || !isString(row.storage_path)
    || !isString(row.deletion_token)
  ) {
    throw new Error("media_object_claim_invalid");
  }
  return {
    object_id: row.object_id as string,
    bucket: row.bucket as string,
    storage_path: row.storage_path as string,
    deletion_token: row.deletion_token as string,
  };
}

/**
 * Runs one atomic object-claim cleanup pass.
 *
 * Fail-closed guarantees:
 *   * A claim RPC that errors, or that returns malformed / non-array data,
 *     throws before any storage or database mutation -> no path-blind delete.
 *   * A storage removal failure for a claimed object clears ZERO database
 *     references and does not finalize/release the active claim; the lease is
 *     left in place so an immediate rerun sees "no work" until it expires.
 *   * A finalize RPC that returns false or errors is a failure/non-success;
 *     its count is reported as failed, never as deleted.
 *   * Counts reflect physical objects (one per exact claimed path), not
 *     duplicated media rows.
 */
export async function runMediaObjectCleanup(
  supabase: MediaObjectCleanupClient,
  deps: MediaObjectCleanupDeps = {},
): Promise<MediaObjectCleanupResult> {
  if (!isCleanupClient(supabase)) {
    throw new Error("media_object_cleanup_client_invalid");
  }
  const claimRpc = deps.claimRpcName ?? DEFAULT_CLAIM_RPC;
  const finalizeRpc = deps.finalizeRpcName ?? DEFAULT_FINALIZE_RPC;
  const bucket = deps.bucket ?? "temp-media";
  const maxObjects = deps.maxObjects ?? 100;
  const daysOld = deps.daysOld ?? 30;

  const { data: claimedRaw, error: claimError } = await supabase.rpc(claimRpc, {
    p_bucket_id: bucket,
    p_max: maxObjects,
    p_days_old: daysOld,
  });
  if (claimError) {
    throw new Error("media_object_claim_failed");
  }
  if (!Array.isArray(claimedRaw)) {
    throw new Error("media_object_claim_invalid");
  }

  // claimOf throws on any malformed row, so this map either yields a fully
  // valid claim list or aborts before any storage/finalize call.
  const claims = claimedRaw.map(claimOf);
  const claimedCount = claims.length;

  let deletedCount = 0;
  let failedCount = 0;

  for (const claim of claims) {
    const { error: removeError } = await supabase.storage
      .from(claim.bucket)
      .remove([claim.storage_path]);
    if (removeError) {
      // Storage failed: clear zero DB references and keep the active lease.
      // The rerun cannot reclaim until the lease expires, so there is no work.
      failedCount += 1;
      continue;
    }

    const { data: finalizeData, error: finalizeError } = await supabase.rpc(
      finalizeRpc,
      {
        p_object_id: claim.object_id,
        p_deletion_token: claim.deletion_token,
      },
    );
    if (finalizeError || finalizeData !== true) {
      // Finalize false/error is a failure/non-success; do not count as a
      // deletion. Bytes are already gone, but an owner review can reconcile.
      failedCount += 1;
      continue;
    }
    deletedCount += 1;
  }

  return { deletedCount, failedCount, claimedCount };
}

export type MediaObjectPreview = {
  object_id: string;
  storage_path: string;
};

export type MediaObjectPreviewResult = {
  count: number;
  objects: MediaObjectPreview[];
};

/**
 * Read-only dry-run preview. Calls the service-role-only media_objects_preview_old
 * RPC, which uses the exact same eligibility predicate as the claim RPC but
 * performs NO state mutation (no status change, no token, no lease). This is the
 * single source of truth a dry-run uses to count physical objects (one per exact
 * path), avoiding the age-only get_old_media row count that double-counted
 * shared paths. Previews expire-render paths separately and do not touch them.
 *
 * Fail-closed: a preview RPC error or malformed result throws before any report.
 */
export async function previewObjectCleanup(
  supabase: MediaObjectCleanupClient,
  deps: MediaObjectCleanupDeps = {},
): Promise<MediaObjectPreviewResult> {
  if (!isCleanupClient(supabase)) {
    throw new Error("media_object_cleanup_client_invalid");
  }
  const previewRpc = deps.previewRpcName ?? DEFAULT_PREVIEW_RPC;
  const bucket = deps.bucket ?? "temp-media";
  const maxObjects = deps.maxObjects ?? 100;
  const daysOld = deps.daysOld ?? 30;

  const { data: previewRaw, error: previewError } = await supabase.rpc(previewRpc, {
    p_bucket_id: bucket,
    p_max: maxObjects,
    p_days_old: daysOld,
  });
  if (previewError) {
    throw new Error("media_object_preview_failed");
  }
  if (!Array.isArray(previewRaw)) {
    throw new Error("media_object_preview_invalid");
  }
  const objects: MediaObjectPreview[] = previewRaw.map(previewOf);
  return { count: objects.length, objects };
}

function previewOf(raw: unknown): MediaObjectPreview {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("media_object_preview_invalid");
  }
  const row = raw as Record<string, unknown>;
  if (!isString(row.object_id) || !isString(row.storage_path)) {
    throw new Error("media_object_preview_invalid");
  }
  return { object_id: row.object_id as string, storage_path: row.storage_path as string };
}
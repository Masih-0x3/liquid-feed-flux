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
 * Characterized legacy behavior used only until BR-MEDIA-03 replaces the
 * row-oriented cleanup path. It intentionally preserves the current unsafe
 * ordering so tests can prove the existing defect without changing runtime
 * semantics during the containment slice.
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
      if (error) failedCount += paths.length;
      else deletedCount += paths.length;
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

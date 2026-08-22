export interface ChunkReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ChunkReloadRuntime {
  buildSha: string;
  getStorage(): ChunkReloadStorage;
  reload(): void;
}

const CHUNK_RELOAD_KEY_PREFIX = "xot_chunk_reloaded:";

function normalizedBuildSha(buildSha: string): string {
  const value = buildSha.trim();
  return value || "unknown";
}

export function chunkReloadKey(buildSha: string): string {
  return `${CHUNK_RELOAD_KEY_PREFIX}${normalizedBuildSha(buildSha)}`;
}

/**
 * Records the single recovery reload allowed for a specific frontend build.
 *
 * Storage failures deliberately bubble to the caller so it can preserve the
 * original dynamic-import error instead of treating an unavailable browser
 * storage API as permission to reload.
 */
export function claimChunkReloadAttempt(
  storage: ChunkReloadStorage,
  buildSha: string,
): boolean {
  const key = chunkReloadKey(buildSha);
  if (storage.getItem(key)) return false;

  storage.setItem(key, "1");
  return true;
}

/**
 * A successful import means a previous retry marker for this build is stale.
 * Removing it allows a later, unrelated stale-chunk failure to recover once.
 */
export function clearChunkReloadAttempt(
  storage: ChunkReloadStorage,
  buildSha: string,
): void {
  storage.removeItem(chunkReloadKey(buildSha));
}

/**
 * Runs a lazy import with bounded stale-chunk recovery. The browser adapter is
 * injected so the state transitions can be exercised without starting a UI.
 */
export async function loadChunkWithRecovery<T>(
  factory: () => Promise<T>,
  runtime: ChunkReloadRuntime,
): Promise<T> {
  try {
    const loadedModule = await factory();

    // Storage can be disabled without making an otherwise valid route unusable.
    try {
      clearChunkReloadAttempt(runtime.getStorage(), runtime.buildSha);
    } catch {
      // Preserve the successful dynamic import when browser storage is unavailable.
    }

    return loadedModule;
  } catch (error) {
    let shouldReload = false;
    try {
      shouldReload = claimChunkReloadAttempt(runtime.getStorage(), runtime.buildSha);
    } catch {
      // Do not hide the import failure behind an unavailable storage API.
      throw error;
    }

    if (!shouldReload) throw error;

    try {
      runtime.reload();
    } catch {
      // A failed reload must not mask the route import error.
      throw error;
    }

    return new Promise<T>(() => {});
  }
}

export const MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV =
  "MEDIA_CLEANUP_MUTATIONS_ENABLED";
export const DB_CLEANUP_MUTATIONS_ENABLED_ENV = "DB_CLEANUP_MUTATIONS_ENABLED";

export type CleanupExecutionMode = "dry_run" | "mutation" | "blocked";

export function isCleanupMutationEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function resolveCleanupExecutionMode(
  dryRun: boolean,
  enableValue: string | undefined,
): CleanupExecutionMode {
  if (dryRun) return "dry_run";
  return isCleanupMutationEnabled(enableValue) ? "mutation" : "blocked";
}

export function cleanupDisabledResponse(
  functionName: string,
  enableFlag: string,
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: "cleanup_disabled_for_safety",
      function: functionName,
      required_flag: enableFlag,
      dry_run_available: true,
    }),
    {
      status: 423,
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

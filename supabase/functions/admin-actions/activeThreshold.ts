import {
  resolveEffectiveThreshold,
  type EffectiveThresholdEnvelope,
} from "../_shared/effectiveThreshold.ts";

type SettingsQuery = PromiseLike<{
  data?: unknown;
  error?: unknown;
}> & {
  select(columns: string): SettingsQuery;
  in(column: string, values: string[]): PromiseLike<{
    data?: unknown;
    error?: unknown;
  }>;
};

function settingsQuery(supabase: unknown): SettingsQuery {
  if (!supabase || typeof supabase !== "object") {
    throw new Error("active_threshold_client_invalid");
  }
  const from = (supabase as { from?: unknown }).from;
  if (typeof from !== "function") {
    throw new Error("active_threshold_client_invalid");
  }
  const query = from.call(supabase, "settings");
  if (!query || typeof query !== "object") {
    throw new Error("active_threshold_query_invalid");
  }
  const select = (query as { select?: unknown }).select;
  if (typeof select !== "function") {
    throw new Error("active_threshold_query_invalid");
  }
  const selected = select.call(query, "key, value");
  if (!selected || typeof selected !== "object") {
    throw new Error("active_threshold_query_invalid");
  }
  const inFilter = (selected as { in?: unknown }).in;
  if (typeof inFilter !== "function") {
    throw new Error("active_threshold_query_invalid");
  }
  return selected as SettingsQuery;
}

export async function loadActiveThresholdEnvelope(
  supabase: unknown,
): Promise<EffectiveThresholdEnvelope> {
  const { data: settings, error } = await settingsQuery(supabase)
    .in("key", ["content_filter", "editorial_profiles", "active_profile_id", "scoring_policy"]);
  if (error) throw new Error("active_threshold_settings_read_failed");
  try {
    return resolveEffectiveThreshold(settings);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("effective_threshold_")) {
      throw new Error(error.message.replace("effective_threshold_", "active_threshold_"));
    }
    throw error;
  }
}

/** Numeric compatibility seam for existing X/scoring action callers. */
export async function loadActiveThreshold(supabase: unknown): Promise<number> {
  return (await loadActiveThresholdEnvelope(supabase)).threshold;
}

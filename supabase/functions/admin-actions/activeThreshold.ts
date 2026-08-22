import { normalizeScoringPolicy } from "../_shared/scoringPolicy.ts";

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

export async function loadActiveThreshold(supabase: unknown): Promise<number> {
  const { data: settings, error } = await settingsQuery(supabase)
    .in("key", ["content_filter", "editorial_profiles", "active_profile_id", "scoring_policy"]);
  if (error) throw new Error("active_threshold_settings_read_failed");
  if (!Array.isArray(settings)) {
    throw new Error("active_threshold_settings_invalid_response");
  }
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const row of settings) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("active_threshold_settings_invalid_row");
    }
    const key = (row as Record<string, unknown>).key;
    const value = (row as Record<string, unknown>).value;
    if (typeof key !== "string" || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("active_threshold_settings_invalid_row");
    }
    byKey[key] = value as Record<string, unknown>;
  }
  const activeId = typeof byKey.active_profile_id?.id === "string" ? byKey.active_profile_id.id : "";
  if (byKey.scoring_policy) {
    const policy = normalizeScoringPolicy(byKey.scoring_policy);
    if (policy.enabled && policy.mode === "active") {
      const profile = policy.profiles.find((p) => p.id === policy.active_profile_id) ?? policy.profiles[0];
      if (profile?.thresholds?.direct_focus?.threshold) return profile.thresholds.direct_focus.threshold;
    }
  }
  const profiles = Array.isArray(byKey.editorial_profiles?.profiles) ? byKey.editorial_profiles.profiles as Array<Record<string, unknown>> : [];
  const active = profiles.find((p) => p.id === activeId);
  if (typeof active?.threshold === "number") return active.threshold;
  if (typeof byKey.content_filter?.default_threshold === "number") return byKey.content_filter.default_threshold as number;
  return 14;
}

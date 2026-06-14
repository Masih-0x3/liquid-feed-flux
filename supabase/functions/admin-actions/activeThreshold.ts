import { normalizeScoringPolicy } from "../_shared/scoringPolicy.ts";

export async function loadActiveThreshold(supabase: any): Promise<number> {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["content_filter", "editorial_profiles", "active_profile_id", "scoring_policy"]);
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const row of settings ?? []) {
    if (row.value && typeof row.value === "object") byKey[row.key] = row.value as Record<string, unknown>;
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

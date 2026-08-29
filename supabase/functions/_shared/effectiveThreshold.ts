import {
  normalizeScoringPolicy,
  type ScoringPolicyMode,
} from "./scoringPolicy.ts";

export const EFFECTIVE_THRESHOLD_VERSION = "threshold-envelope-v1";
export const LEGACY_THRESHOLD_VERSION = "legacy-threshold-v1";
export const DEFAULT_EFFECTIVE_THRESHOLD = 14;

export type EffectiveThresholdMode = "active" | "legacy";
export type EffectiveThresholdSource =
  | "scoring_policy"
  | "editorial_profile"
  | "content_filter"
  | "default";

/** The threshold contract shared by settings consumers, the worker, and Monitoring. */
export interface EffectiveThresholdEnvelope {
  threshold: number;
  mode: EffectiveThresholdMode;
  source: EffectiveThresholdSource;
  version: string;
  compatibility_fallback: boolean;
  /** The policy mode is retained when a legacy gate remains authoritative. */
  policy_mode: ScoringPolicyMode | null;
}

type SettingsRow = { key?: unknown; value?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function envelope(
  threshold: number,
  source: EffectiveThresholdSource,
  version: string,
  compatibilityFallback: boolean,
  policyMode: ScoringPolicyMode | null,
  mode: EffectiveThresholdMode = "legacy",
): EffectiveThresholdEnvelope {
  return {
    threshold,
    mode,
    source,
    version,
    compatibility_fallback: compatibilityFallback,
    policy_mode: policyMode,
  };
}

/**
 * Resolve the one effective delivery threshold from the settings snapshot.
 *
 * A scoring policy in active mode owns the gate. Shadow/disabled policy modes
 * retain the legacy gate until cutover, but carry the policy mode so consumers
 * can report that compatibility state truthfully.
 */
export function resolveEffectiveThreshold(
  settings: unknown,
): EffectiveThresholdEnvelope {
  if (!Array.isArray(settings)) {
    throw new Error("effective_threshold_settings_invalid_response");
  }

  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of settings as SettingsRow[]) {
    if (!isRecord(row) || typeof row.key !== "string") {
      throw new Error("effective_threshold_settings_invalid_row");
    }
    // The worker asks for additional settings in the same query. Only the
    // threshold sources are validated here so unrelated optional settings do
    // not make this shared compatibility resolver brittle.
    if (
      row.key !== "content_filter" && row.key !== "editorial_profiles" &&
      row.key !== "active_profile_id" && row.key !== "scoring_policy"
    ) continue;
    if (!isRecord(row.value)) {
      throw new Error("effective_threshold_settings_invalid_row");
    }
    byKey.set(row.key, row.value);
  }

  let policyMode: ScoringPolicyMode | null = null;
  const policyValue = byKey.get("scoring_policy");
  if (policyValue) {
    const policy = normalizeScoringPolicy(policyValue);
    policyMode = policy.mode;
    if (policy.enabled && policy.mode === "active") {
      const profile = policy.profiles.find((p) => p.id === policy.active_profile_id) ??
        policy.profiles[0];
      const threshold = profile?.thresholds?.direct_focus?.threshold;
      if (numeric(threshold)) {
        return envelope(
          threshold,
          "scoring_policy",
          policy.version,
          false,
          policy.mode,
          "active",
        );
      }
    }
  }

  const activeId = byKey.get("active_profile_id")?.id;
  const profiles = byKey.get("editorial_profiles")?.profiles;
  if (typeof activeId === "string" && Array.isArray(profiles)) {
    const active = profiles.find((profile) =>
      isRecord(profile) && profile.id === activeId
    );
    if (isRecord(active) && numeric(active.threshold)) {
      return envelope(
        active.threshold,
        "editorial_profile",
        LEGACY_THRESHOLD_VERSION,
        true,
        policyMode,
      );
    }
  }

  const legacyThreshold = byKey.get("content_filter")?.default_threshold;
  if (numeric(legacyThreshold)) {
    return envelope(
      legacyThreshold,
      "content_filter",
      LEGACY_THRESHOLD_VERSION,
      true,
      policyMode,
    );
  }

  return envelope(
    DEFAULT_EFFECTIVE_THRESHOLD,
    "default",
    LEGACY_THRESHOLD_VERSION,
    true,
    policyMode,
  );
}

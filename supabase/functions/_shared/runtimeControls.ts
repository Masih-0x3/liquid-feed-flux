export type RuntimeEnvironment = "preview" | "production";
export type PostingMode = "blocked" | "enabled";

export type RuntimeControls = {
  singleton_id: true;
  environment: RuntimeEnvironment;
  dedupe_enabled: boolean;
  translation_enabled: boolean;
  posting_mode: PostingMode;
  updated_at: string;
  updated_by: string | null;
};

export type RuntimeControlsQueryClient = {
  from: (table: "runtime_controls") => {
    select: (columns: "*") => PromiseLike<{
      data?: unknown;
      error?: unknown;
    }>;
  };
};

export class RuntimeControlsError extends Error {
  readonly code = "runtime_controls_unavailable";

  constructor() {
    super("runtime controls unavailable");
    this.name = "RuntimeControlsError";
  }
}

const CONTROL_KEYS = [
  "singleton_id",
  "environment",
  "dedupe_enabled",
  "translation_enabled",
  "posting_mode",
  "updated_at",
  "updated_by",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateRuntimeControls(value: unknown): RuntimeControls | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...CONTROL_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
  if (value.singleton_id !== true) return null;
  if (value.environment !== "preview" && value.environment !== "production") return null;
  if (typeof value.dedupe_enabled !== "boolean" || typeof value.translation_enabled !== "boolean") return null;
  if (value.posting_mode !== "blocked" && value.posting_mode !== "enabled") return null;
  if (value.environment === "preview" && value.posting_mode !== "blocked") return null;
  if (typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) return null;
  const updatedBy: string | null = value.updated_by === null
    ? null
    : typeof value.updated_by === "string" && UUID_PATTERN.test(value.updated_by)
    ? value.updated_by
    : null;
  if (value.updated_by !== null && updatedBy === null) return null;

  return {
    singleton_id: true,
    environment: value.environment,
    dedupe_enabled: value.dedupe_enabled,
    translation_enabled: value.translation_enabled,
    posting_mode: value.posting_mode,
    updated_at: value.updated_at,
    updated_by: updatedBy,
  };
}

/** Read one and only one row. Any read, cardinality, or shape failure blocks callers. */
export async function fetchRuntimeControls(
  client: RuntimeControlsQueryClient,
): Promise<RuntimeControls> {
  try {
    const result = await client.from("runtime_controls").select("*");
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
      throw new RuntimeControlsError();
    }
    const controls = validateRuntimeControls(result.data[0]);
    if (!controls) throw new RuntimeControlsError();
    return controls;
  } catch (_error) {
    throw new RuntimeControlsError();
  }
}

export type RuntimePauseDecision = {
  paused: boolean;
  reason: "control_disabled" | "control_enabled";
};

export function dedupePauseDecision(controls: RuntimeControls): RuntimePauseDecision {
  return controls.dedupe_enabled
    ? { paused: false, reason: "control_enabled" }
    : { paused: true, reason: "control_disabled" };
}

export function translationPauseDecision(controls: RuntimeControls): RuntimePauseDecision {
  return controls.translation_enabled
    ? { paused: false, reason: "control_enabled" }
    : { paused: true, reason: "control_disabled" };
}

export function isDedupePaused(controls: RuntimeControls): boolean {
  return dedupePauseDecision(controls).paused;
}

export function isTranslationPaused(controls: RuntimeControls): boolean {
  return translationPauseDecision(controls).paused;
}

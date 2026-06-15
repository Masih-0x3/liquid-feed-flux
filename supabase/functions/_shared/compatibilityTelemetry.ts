export type CompatibilityUsageEvent = {
  source: string;
  feature: string;
  legacyValue?: string | null;
  canonicalValue?: string | null;
  action?: string | null;
  actorId?: string | null;
  request?: Request | null;
  metadata?: Record<string, unknown>;
};

function compactString(value: unknown, maxLength = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function requestPathForTelemetry(
  req: Request | null | undefined,
): string | null {
  if (!req) return null;
  try {
    return new URL(req.url).pathname;
  } catch {
    return null;
  }
}

function cleanMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    result[key] = typeof value === "string" ? compactString(value, 500) : value;
  }
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

// deno-lint-ignore no-explicit-any
export async function recordCompatibilityUsage(
  supabase: any,
  event: CompatibilityUsageEvent,
): Promise<void> {
  try {
    const result = await supabase.from("compatibility_usage_events").insert({
      source: compactString(event.source, 120) ?? "unknown",
      feature: compactString(event.feature, 120) ?? "unknown",
      legacy_value: compactString(event.legacyValue),
      canonical_value: compactString(event.canonicalValue),
      action: compactString(event.action, 120),
      actor_id: compactString(event.actorId, 120),
      request_method: compactString(event.request?.method, 20),
      request_path: requestPathForTelemetry(event.request),
      metadata: cleanMetadata(event.metadata),
    });
    if (result?.error) throw result.error;
  } catch (error) {
    console.warn(
      "recordCompatibilityUsage failed:",
      errorMessage(error),
    );
  }
}

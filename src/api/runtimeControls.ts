import { createAdminActionResponseError } from './adminActionErrors';
import { invokeAdminAction, invokeAdminRead, type AdminActionBody } from './adminActions';

export type RuntimeControlName = 'dedupe_enabled' | 'translation_enabled';

export type RuntimeQueueCounts = {
  dedupe_queued?: number;
  dedupe_deferred?: number;
  translation_queued?: number;
  translation_deferred?: number;
  [key: string]: number | undefined;
};

export type RuntimeControls = {
  environment: 'preview' | 'production';
  dedupe_enabled: boolean;
  translation_enabled: boolean;
  posting_mode: 'blocked' | 'enabled';
  updated_at: string;
  updated_by: string | null;
  queue_counts?: RuntimeQueueCounts;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function parseQueueCounts(value: unknown): RuntimeQueueCounts | undefined {
  if (!isRecord(value)) return undefined;
  const counts: RuntimeQueueCounts = {};
  for (const [key, raw] of Object.entries(value)) {
    const count = asFiniteCount(raw);
    if (count !== undefined) {
      counts[key] = count;
      continue;
    }
    if (isRecord(raw)) {
      const queued = asFiniteCount(raw.queued);
      const deferred = asFiniteCount(raw.deferred);
      if (queued !== undefined) counts[`${key}_queued`] = queued;
      if (deferred !== undefined) counts[`${key}_deferred`] = deferred;
    }
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function parseControls(value: unknown): RuntimeControls {
  const envelope = isRecord(value) ? value : {};
  const candidate = isRecord(envelope.controls)
    ? envelope.controls
    : isRecord(envelope.runtime_controls)
      ? envelope.runtime_controls
      : envelope;

  if (
    (candidate.environment !== 'preview' && candidate.environment !== 'production')
    || typeof candidate.dedupe_enabled !== 'boolean'
    || typeof candidate.translation_enabled !== 'boolean'
    || (candidate.posting_mode !== 'blocked' && candidate.posting_mode !== 'enabled')
    || typeof candidate.updated_at !== 'string'
    || (candidate.updated_by !== null && typeof candidate.updated_by !== 'string')
  ) {
    throw createAdminActionResponseError({ failureMessage: 'Runtime controls are unavailable.' });
  }

  const queueCounts = parseQueueCounts(
    candidate.queue_counts ?? candidate.queued_counts ?? candidate.counts ?? {
      dedupe_queued: candidate.dedupe_queued,
      dedupe_deferred: candidate.dedupe_deferred,
      translation_queued: candidate.translation_queued,
      translation_deferred: candidate.translation_deferred,
    },
  );

  return {
    environment: candidate.environment,
    dedupe_enabled: candidate.dedupe_enabled,
    translation_enabled: candidate.translation_enabled,
    posting_mode: candidate.posting_mode,
    updated_at: candidate.updated_at,
    updated_by: candidate.updated_by,
    ...(queueCounts ? { queue_counts: queueCounts } : {}),
  };
}

export async function getRuntimeControls(): Promise<RuntimeControls> {
  const response = await invokeAdminRead<Record<string, unknown>>({
    action: 'get_runtime_controls',
  } as AdminActionBody);
  return parseControls(response);
}

export async function updateRuntimeControls(input: Pick<RuntimeControls, RuntimeControlName>): Promise<RuntimeControls> {
  // Keep this request deliberately narrow. It must never carry posting state,
  // credentials, or arbitrary settings from a browser draft.
  const response = await invokeAdminAction<Record<string, unknown>>({
    action: 'update_runtime_controls',
    dedupe_enabled: input.dedupe_enabled === true,
    translation_enabled: input.translation_enabled === true,
  } as AdminActionBody);
  return parseControls(response);
}
